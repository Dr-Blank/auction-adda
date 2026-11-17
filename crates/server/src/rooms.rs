//! Rooms, seats and the game in each room. Synchronous and single-owner: the server keeps it in a
//! mutex and never holds the lock across an `.await`, which is the same model as the single thread
//! of the Node server it replaces.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::os::unix::fs::MetadataExt as _;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{fs, io};

use engine::{
    Action, AuctionKind, GameState, LogEntry, RuleError, Seat, apply_action, apply_ruling, apply_skip, config,
    end_early, new_game, pending, undo_ruling, view_for,
};
use rand::RngExt;
use rand::seq::IndexedRandom;
use serde::{Deserialize, Serialize};
use tracing::{debug, error, info, warn};

use crate::bot::choose_action;
use crate::protocol::{
    Cast, ClientMsg, ErrorCode, MyRoom, Prefs, RoomInfo, RoomSettings, RoomStage, SeatInfo, SeatKey, ServerMsg,
    ThemeId, Watcher,
};

const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH: usize = 6;
const NAME_LIMIT: usize = 20;
/// Base-36 digits in a seat's look; the client reads as many as it has parts.
const AVATAR_LIMIT: usize = 16;
const FILE_VERSION: u64 = 1;
/// While the admin can still undo a call, bots wait at least this long, so their move does not
/// take the undo away at once.
const BOT_WAIT_AFTER_CALL_MS: u64 = 8_000;

/// The admin away this long: any player may take the role.
const ADMIN_CLAIM_MS: u64 = 20_000;
/// The admin away this long and nobody took the role: the first player still here gets it.
const ADMIN_AUTO_MS: u64 = 30_000;
/// Open auctions: seconds after the lot goes up before everyone still in is done. Long enough to
/// notice the lot at all.
const DEFAULT_BID_TIMER_S: u16 = 30;
const MAX_BID_TIMER_S: u16 = 600;
/// Open auctions: after a bid, everyone still in has at least this many seconds left.
const DEFAULT_BID_EXTEND_S: u16 = 10;
const MIN_BID_EXTEND_S: u16 = 3;
const MAX_BID_EXTEND_S: u16 = 120;
/// Upper bound on a theme's genre list; the server does not know each theme's length.
const MAX_GENRES: u8 = 64;
/// At most this many rooms in one `rooms` answer; tokens beyond it are left alone.
const MAX_LISTED_ROOMS: usize = 50;

const fn default_bid_timer() -> u16 {
    DEFAULT_BID_TIMER_S
}

const fn default_bid_extend() -> u16 {
    DEFAULT_BID_EXTEND_S
}

fn check_timer(seconds: u16, extend: u16) -> Result<(), Fail> {
    if seconds > MAX_BID_TIMER_S {
        return fail(format!("The bid timer is at most {MAX_BID_TIMER_S} seconds"));
    }
    if !(MIN_BID_EXTEND_S..=MAX_BID_EXTEND_S).contains(&extend) {
        return fail(format!(
            "Time after a bid is {MIN_BID_EXTEND_S} to {MAX_BID_EXTEND_S} seconds"
        ));
    }
    Ok(())
}

/// The admin's genre pick, sorted: one per suit, or empty for a random cast.
fn check_genres(genres: &[u8]) -> Result<Vec<u8>, Fail> {
    let suits = usize::from(config().suits);
    let mut sorted = genres.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    if !genres.is_empty()
        && (sorted.len() != genres.len() || genres.len() != suits || sorted.iter().any(|&g| g >= MAX_GENRES))
    {
        return fail(format!("Pick {suits} different genres, or none for a random cast"));
    }
    Ok(sorted)
}

/// The running open-auction clock.
#[derive(Clone, Copy)]
struct BidClock {
    /// Log line that put this lot up (or undid a call on it): a new one starts the clock afresh.
    lot: usize,
    /// Log line of the last bid (or `lot`): a new one adds time.
    last: usize,
    /// When the current stretch started, and when it runs out.
    from: u64,
    due: u64,
}

pub type ClientId = u64;

/// Delivers one message to a client. Returns false when the client cannot take more (its queue
/// is full); the client is then disconnected.
pub type Sink = Box<dyn FnMut(&ServerMsg) -> bool + Send>;

/// Milliseconds since the Unix epoch.
pub type Clock = Box<dyn Fn() -> u64 + Send>;

pub struct CreateLimit {
    pub count: u32,
    pub window_ms: u64,
}

pub struct Options {
    /// Directory for one JSON file per room; `None` keeps rooms in memory only.
    pub data_dir: Option<PathBuf>,
    pub now: Clock,
    pub skip_after_ms: u64,
    pub max_rooms: usize,
    pub room_ttl_ms: u64,
    pub create_limit: CreateLimit,
    /// Average thinking time of a bot seat before each move (half to one and a half of it).
    pub bot_delay_ms: u64,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            data_dir: None,
            now: Box::new(system_now),
            skip_after_ms: 30_000,
            bot_delay_ms: 1_500,
            max_rooms: 200,
            room_ttl_ms: 7 * 24 * 3600 * 1000,
            create_limit: CreateLimit {
                count: 10,
                window_ms: 10 * 60 * 1000,
            },
        }
    }
}

fn system_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// One connected browser tab.
struct Client {
    ip: String,
    sink: Sink,
    room: Option<String>,
    seat: Option<Seat>,
    /// The seat token this tab showed when it joined (or was given), for bans.
    token: Option<String>,
    /// Name shown in the watcher list while it watches.
    viewer: String,
}

/// Someone the admin kicked from a seat or removed from watching, known by the seat token their
/// browser keeps.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Ban {
    name: String,
    token: String,
    /// Removed from watching too, not only from the seats.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    out: bool,
}

/// Bans kept per room; the oldest goes first.
const MAX_BANS: usize = 32;

const BANNED: &str = "The admin took you off the seats here. They can let you back in from the watcher list";

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct SeatData {
    name: String,
    /// Secret that lets a browser re-attach to this seat. `None` = released, anyone may claim it
    /// (unless it is a bot that is not `free`).
    token: Option<String>,
    /// Played by the server. With a token it stands in for a player who may come back.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    bot: bool,
    /// Its player left the game (`leave`): a bot plays, and the token takes the seat back only with
    /// `back`, so a reconnect does not seat them again unasked.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    left: bool,
    /// A bot seat the admin freed in a game: the bot plays on until someone claims it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    free: bool,
    /// As in `SeatInfo`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    avatar: String,
}

impl SeatData {
    fn open(&self) -> bool {
        self.token.is_none() && (!self.bot || self.free)
    }
}

/// The admin's last called result: the game before it, and the room's game version it produced.
/// Undo works while nothing has changed the game since.
struct LastCall {
    before: GameState,
    version: u64,
}

struct Room {
    code: String,
    theme: String,
    cast: Cast,
    seats: Vec<SeatData>,
    /// Seat allowed to call auction results by voice.
    admin: Seat,
    game: Option<GameState>,
    created_at: u64,
    updated_at: u64,
    /// Open-auction clock in seconds from the lot going up; 0 = off (tables that bid by voice).
    bid_timer_s: u16,
    /// After a bid, everyone still in has at least this many seconds.
    bid_extend_s: u16,
    settings: RoomSettings,
    banned: Vec<Ban>,
    // Not saved:
    /// Goes up every time `game` changes.
    version: u64,
    bid_clock: Option<BidClock>,
    last_call: Option<LastCall>,
    clients: Vec<ClientId>,
    /// Per seat: when its last connection dropped (`None` while connected, and always for a bot).
    away: Vec<Option<u64>>,
    /// When a bot that owes a move makes it.
    bot_due: Option<u64>,
    /// Why a seat was taken from a player who was not here, by its old token: told when they
    /// come back. Newest last, at most `MAX_MISSED`.
    missed: Vec<(String, String)>,
}

/// Messages kept for players who lost their seat while away.
const MAX_MISSED: usize = 16;

impl Room {
    fn name(&self, seat: Seat) -> String {
        self.seats.get(usize::from(seat)).map_or_default(|s| s.name.clone())
    }

    fn ban_of(&self, token: Option<&str>) -> Option<usize> {
        let token = token.filter(|t| !t.is_empty())?;
        self.banned.iter().position(|b| b.token == token)
    }

    /// The first player (not a bot) who is connected.
    fn first_here(&self) -> Option<Seat> {
        let i = (0..self.seats.len())
            .find(|&i| self.seats.get(i).is_some_and(|s| !s.bot) && self.away.get(i) == Some(&None))?;
        u8::try_from(i).ok()
    }

    /// The admin away `ADMIN_AUTO_MS`: the first connected player takes the role. Returns the new
    /// admin and the old one's name.
    fn replace_away_admin(&mut self, now: u64) -> Option<(Seat, String)> {
        let since = self.away.get(usize::from(self.admin)).copied().flatten()?;
        if now.saturating_sub(since) < ADMIN_AUTO_MS {
            return None;
        }
        let p = self.first_here()?;
        info!(room = %self.code, "The admin was away; seat {p} is admin now");
        let was = self.name(self.admin);
        self.admin = p;
        self.last_call = None;
        Some((p, was))
    }

    /// The seat `token`'s holder left to a bot in this game, which `back` returns to them.
    fn left_by(&self, token: Option<&str>) -> Option<Seat> {
        let token = token.filter(|t| !t.is_empty())?;
        let i = self
            .seats
            .iter()
            .position(|s| s.left && s.token.as_deref() == Some(token))?;
        u8::try_from(i).ok()
    }

    /// Bans `token`; `out` also from watching. An existing ban only gets stricter.
    fn ban(&mut self, name: String, token: String, out: bool) {
        if let Some(i) = self.ban_of(Some(&token)) {
            if let Some(b) = self.banned.get_mut(i) {
                b.out |= out;
            }
            return;
        }
        if self.banned.len() >= MAX_BANS {
            self.banned.remove(0);
        }
        self.banned.push(Ban { name, token, out });
    }

    fn tell_later(&mut self, token: String, message: String) {
        self.missed.retain(|(t, _)| *t != token);
        if self.missed.len() >= MAX_MISSED {
            self.missed.remove(0);
        }
        self.missed.push((token, message));
    }

    fn set_game(&mut self, game: GameState) {
        if game.over && !self.game.as_ref().is_some_and(|g| g.over) {
            info!(room = %self.code, "Game over");
        }
        self.game = Some(game);
        self.version += 1;
    }

    /// Starts the open-auction clock when a lot goes up or a call is undone, and tops it up to
    /// `bid_extend_s` when someone bids; stops it when no open auction runs or the timer is off.
    fn sync_bid_clock(&mut self, now: u64) {
        let marks = self
            .game
            .as_ref()
            .filter(|_| self.bid_timer_s > 0)
            .and_then(bid_clock_marks);
        let first = now + u64::from(self.bid_timer_s) * 1000;
        let extend = now + u64::from(self.bid_extend_s) * 1000;
        self.bid_clock = marks.map(|(lot, last)| match self.bid_clock {
            Some(c) if c.lot == lot && c.last == last => c,
            Some(c) if c.lot == lot && c.due >= extend => BidClock { last, ..c },
            Some(c) if c.lot == lot => BidClock {
                last,
                from: now,
                due: extend,
                ..c
            },
            _ => BidClock {
                lot,
                last,
                from: now,
                due: first,
            },
        });
    }

    fn game(&self) -> Result<&GameState, Fail> {
        self.game.as_ref().ok_or_else(|| Fail::new("The game has not started"))
    }

    fn has_seat(&self, seat: Seat) -> bool {
        usize::from(seat) < self.seats.len()
    }

    fn is_bot(&self, seat: Seat) -> bool {
        self.seats.get(usize::from(seat)).is_some_and(|s| s.bot)
    }

    fn require_admin(&self, seat: Seat, doing: &str) -> Result<(), Fail> {
        if seat == self.admin {
            Ok(())
        } else {
            fail(format!("Only the room admin can {doing}"))
        }
    }
}

/// For the running open auction: the log line that put the lot up (or undid a call on it), and
/// the last line that moved its clock (that one or a later bid). `None` when no open auction runs.
fn bid_clock_marks(g: &GameState) -> Option<(usize, usize)> {
    g.auction.as_ref().filter(|a| a.kind == AuctionKind::Open)?;
    let lot = g
        .log
        .iter()
        .rposition(|e| matches!(e, LogEntry::Play { .. } | LogEntry::Undo { .. }))?;
    let last = g
        .log
        .iter()
        .rposition(|e| matches!(e, LogEntry::Bid { .. }))
        .filter(|&i| i > lot)
        .unwrap_or(lot);
    Some((lot, last))
}

/// The open-auction clock ran out: everyone still in is done, which closes the auction.
fn time_up(game: &GameState) -> Result<GameState, RuleError> {
    let high = game.auction.as_ref().map_or(0, |a| a.high);
    pending(game).into_iter().try_fold(game.clone(), |g, seat| {
        apply_action(&g, seat, &Action::Done { seen_high: high })
    })
}

/// The save file, version 1: `{ v, code, theme, cast, seats, admin, game, createdAt, updatedAt,
/// bidTimerS, bidExtendS }` (`cast`, `bidTimerS` or `bidExtendS` missing in older files: the
/// default).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedRef<'a> {
    v: u64,
    code: &'a str,
    theme: &'a str,
    cast: &'a Cast,
    seats: &'a [SeatData],
    admin: Seat,
    game: &'a Option<GameState>,
    created_at: u64,
    updated_at: u64,
    bid_timer_s: u16,
    bid_extend_s: u16,
    settings: &'a RoomSettings,
    #[serde(skip_serializing_if = "<[Ban]>::is_empty")]
    banned: &'a [Ban],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    theme: String,
    #[serde(default)]
    cast: Cast,
    seats: Vec<SeatData>,
    #[serde(default)]
    admin: serde_json::Value,
    game: Option<GameState>,
    created_at: u64,
    updated_at: u64,
    #[serde(default = "default_bid_timer")]
    bid_timer_s: u16,
    #[serde(default = "default_bid_extend")]
    bid_extend_s: u16,
    #[serde(default)]
    settings: RoomSettings,
    #[serde(default)]
    banned: Vec<Ban>,
}

/// A rejected message: the text goes back to the sender.
#[derive(Debug)]
struct Fail {
    message: String,
    code: Option<ErrorCode>,
}

impl Fail {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: None,
        }
    }
}

impl From<RuleError> for Fail {
    fn from(e: RuleError) -> Self {
        Self::new(e.0)
    }
}

fn fail<T>(message: impl Into<String>) -> Result<T, Fail> {
    Err(Fail::new(message))
}

fn clean_name(raw: &str) -> Result<String, Fail> {
    let visible: String = raw
        .chars()
        .filter(|c| !matches!(c, '\0'..='\u{1f}' | '\u{7f}'))
        .collect();
    let cut: String = visible.trim().chars().take(NAME_LIMIT).collect();
    let name = cut.trim();
    if name.is_empty() {
        return fail("Enter a name");
    }
    Ok(name.to_owned())
}

/// Keeps the base-36 digits of a look, lower-cased, up to the limit. Nothing is refused: the
/// client draws any string.
fn clean_avatar(raw: Option<&str>) -> String {
    raw.unwrap_or_default()
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .take(AVATAR_LIMIT)
        .collect()
}

fn random_avatar() -> String {
    let mut rng = rand::rng();
    (0..AVATAR_LIMIT)
        .filter_map(|_| char::from_digit(rng.random_range(0..36), 36))
        .collect()
}

fn new_token() -> String {
    let bytes: [u8; 16] = rand::rng().random();
    bytes.iter().fold(String::with_capacity(32), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

fn new_code() -> String {
    let mut rng = rand::rng();
    (0..CODE_LENGTH)
        .filter_map(|_| CODE_ALPHABET.choose(&mut rng).copied().map(char::from))
        .collect()
}

fn new_seed() -> u32 {
    rand::rng().random_range(0..1 << 31)
}

#[expect(clippy::struct_field_names, reason = "the names of the options they come from")]
pub struct Rooms {
    rooms: HashMap<String, Room>,
    clients: HashMap<ClientId, Client>,
    next_client: ClientId,
    creates: HashMap<String, Vec<u64>>,
    now: Clock,
    skip_after_ms: u64,
    max_rooms: usize,
    room_ttl_ms: u64,
    create_limit: CreateLimit,
    bot_delay_ms: u64,
    store: Option<Store>,
    /// Clients whose queue overflowed, disconnected once the current message is done.
    dropped: Vec<ClientId>,
}

impl Rooms {
    /// Loads the saved rooms from `data_dir`, if set.
    ///
    /// # Errors
    /// When the data directory cannot be created, read or written.
    pub fn new(opts: Options) -> io::Result<Self> {
        let mut rooms = Self {
            rooms: HashMap::new(),
            clients: HashMap::new(),
            next_client: 0,
            creates: HashMap::new(),
            now: opts.now,
            skip_after_ms: opts.skip_after_ms,
            max_rooms: opts.max_rooms,
            room_ttl_ms: opts.room_ttl_ms,
            create_limit: opts.create_limit,
            bot_delay_ms: opts.bot_delay_ms,
            store: None,
            dropped: Vec::new(),
        };
        if let Some(dir) = opts.data_dir {
            fs::create_dir_all(&dir).map_err(|e| io_context(&e, &format!("creating {}", dir.display())))?;
            check_writable(&dir)?;
            rooms
                .load(&dir)
                .map_err(|e| io_context(&e, &format!("reading {}", dir.display())))?;
            info!("Loaded {} rooms from {}", rooms.rooms.len(), dir.display());
            rooms.store = Some(Store::start(dir)?);
        } else {
            info!("No data directory: rooms are kept in memory only");
        }
        rooms.sweep();
        Ok(rooms)
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.rooms.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.rooms.is_empty()
    }

    /// Registers a connection. `ip` counts towards the room creation limit.
    pub fn connect(&mut self, ip: String, sink: Sink) -> ClientId {
        let id = self.next_client;
        self.next_client += 1;
        self.clients.insert(
            id,
            Client {
                ip,
                sink,
                room: None,
                seat: None,
                token: None,
                viewer: String::new(),
            },
        );
        id
    }

    /// Handles one message as received. Anything that is not a valid message, and every rule
    /// violation, goes back to the sender as an error.
    pub fn handle_text(&mut self, id: ClientId, text: &str) {
        match serde_json::from_str::<ClientMsg>(text) {
            Ok(msg) => self.handle(id, msg),
            Err(e) => {
                debug!(client = id, "Bad message ({e}), {} bytes", text.len());
                self.reply_error(id, "Bad message");
                self.drop_overflowed();
            }
        }
    }

    pub fn handle(&mut self, id: ClientId, msg: ClientMsg) {
        let kind = msg.kind();
        if let Err(e) = self.dispatch(id, msg) {
            let (room, seat) = self
                .clients
                .get(&id)
                .map_or((None, None), |c| (c.room.as_deref(), c.seat));
            debug!(client = id, room, seat, "Refused {kind}: {}", e.message);
            self.send(
                id,
                &ServerMsg::Error {
                    message: e.message,
                    code: e.code,
                },
            );
        }
        self.drop_overflowed();
    }

    /// Sends an error to one client, outside the normal handling (the server uses it after a
    /// panic).
    pub fn reply_error(&mut self, id: ClientId, message: &str) {
        self.send(
            id,
            &ServerMsg::Error {
                message: message.into(),
                code: None,
            },
        );
    }

    /// The connection is gone. Safe to call more than once.
    pub fn disconnect(&mut self, id: ClientId) {
        self.detach(id);
        self.clients.remove(&id);
        self.drop_overflowed();
    }

    /// Deletes rooms nobody has touched for a long time.
    pub fn sweep(&mut self) {
        let cutoff = (self.now)().saturating_sub(self.room_ttl_ms);
        let old: Vec<String> = self
            .rooms
            .values()
            .filter(|r| r.updated_at < cutoff && r.clients.is_empty())
            .map(|r| r.code.clone())
            .collect();
        for code in &old {
            self.rooms.remove(code);
            if let Some(store) = &self.store {
                store.remove(code);
            }
        }
        if !old.is_empty() {
            info!(
                "Expired {} idle rooms ({} left): {}",
                old.len(),
                self.rooms.len(),
                old.join(", ")
            );
        }
    }

    /// Plays bot seats: a bot that owes a move makes it once its thinking time has passed. Called
    /// a few times a second. Only rooms someone is watching move, so an abandoned game waits.
    pub fn tick(&mut self) {
        let now = (self.now)();
        let mut rng = rand::rng();
        let mut moved = Vec::new();
        let mut promoted = Vec::new();
        for room in self.rooms.values_mut() {
            if let Some((p, was)) = room.replace_away_admin(now) {
                promoted.push((room.code.clone(), p, was));
            }
            room.sync_bid_clock(now);
            if !room.clients.is_empty()
                && room.bid_clock.is_some_and(|c| c.due <= now)
                && let Some(game) = &room.game
            {
                match time_up(game) {
                    Ok(game) => {
                        info!(room = %room.code, "Open auction timed out");
                        room.set_game(game);
                        room.bot_due = None;
                        moved.push(room.code.clone());
                        continue;
                    }
                    Err(e) => {
                        error!(room = %room.code, "Cannot close the timed-out auction: {}", e.0);
                        room.bid_clock = None;
                    }
                }
            }
            let bot = room.game.as_ref().filter(|_| !room.clients.is_empty()).and_then(|g| {
                pending(g)
                    .into_iter()
                    .filter(|&s| room.is_bot(s))
                    .collect::<Vec<_>>()
                    .choose(&mut rng)
                    .copied()
            });
            let (Some(seat), Some(game)) = (bot, &room.game) else {
                room.bot_due = None;
                continue;
            };
            let due = *room.bot_due.get_or_insert_with(|| {
                let think = rng.random_range(self.bot_delay_ms / 2..=self.bot_delay_ms * 3 / 2);
                let undoable = room.last_call.as_ref().is_some_and(|c| c.version == room.version);
                now + if undoable {
                    think.max(BOT_WAIT_AFTER_CALL_MS)
                } else {
                    think
                }
            });
            if due > now {
                continue;
            }
            room.bot_due = None;
            let next = choose_action(&view_for(game, Some(seat)), &mut rng)
                .ok_or_else(|| Fail::new("No move found"))
                .and_then(|action| {
                    debug!(room = %room.code, seat, "Bot move {action:?}");
                    apply_action(game, seat, &action).map_err(Fail::from)
                })
                .or_else(|e| {
                    warn!(room = %room.code, seat, "Bot move refused ({}); skipping it", e.message);
                    apply_skip(game, seat).map_err(Fail::from)
                });
            match next {
                Ok(game) => {
                    room.set_game(game);
                    moved.push(room.code.clone());
                }
                Err(e) => error!(room = %room.code, seat, "Bot cannot move: {}", e.message),
            }
        }
        for (code, seat, was) in promoted {
            let message = format!("{was} was away, so you are the room admin now.");
            let here: Vec<ClientId> = self.rooms.get(&code).map_or_default(|r| {
                (r.clients.iter().copied())
                    .filter(|c| self.clients.get(c).is_some_and(|c| c.seat == Some(seat)))
                    .collect()
            });
            for id in here {
                self.send(
                    id,
                    &ServerMsg::Notice {
                        message: message.clone(),
                    },
                );
            }
            if !moved.contains(&code) {
                moved.push(code);
            }
        }
        for code in moved {
            self.changed(&code);
        }
        self.drop_overflowed();
    }

    /// Waits until every save so far is on disk.
    pub fn flush(&self) {
        if let Some(store) = &self.store {
            store.flush();
        }
    }

    fn drop_overflowed(&mut self) {
        while let Some(id) = self.dropped.pop() {
            if self.clients.contains_key(&id) {
                warn!(client = id, "Dropping a client that fell behind (send queue full)");
            }
            self.detach(id);
            self.clients.remove(&id);
        }
    }

    fn send(&mut self, id: ClientId, msg: &ServerMsg) {
        if let Some(c) = self.clients.get_mut(&id)
            && !(c.sink)(msg)
        {
            self.dropped.push(id);
        }
    }

    fn client(&self, id: ClientId) -> Result<&Client, Fail> {
        self.clients.get(&id).ok_or_else(|| Fail::new("Join a room first"))
    }

    fn room_mut(&mut self, code: &str) -> Result<&mut Room, Fail> {
        self.rooms.get_mut(code).ok_or_else(|| Fail::new("Join a room first"))
    }

    fn seat_of(&self, id: ClientId) -> Result<Seat, Fail> {
        self.client(id)?
            .seat
            .ok_or_else(|| Fail::new("You are watching; take a seat first"))
    }

    #[expect(
        clippy::too_many_lines,
        reason = "one arm per message, in the order of the TypeScript original"
    )]
    fn dispatch(&mut self, id: ClientId, msg: ClientMsg) -> Result<(), Fail> {
        let msg = match msg {
            ClientMsg::Create {
                theme,
                name,
                prefs,
                avatar,
            } => return self.create(id, &theme, &name, prefs, clean_avatar(avatar.as_deref())),
            ClientMsg::Join {
                room,
                token,
                name,
                avatar,
                viewer,
            } => {
                if let Some(c) = self.clients.get_mut(&id) {
                    c.viewer = viewer.as_deref().and_then(|v| clean_name(v).ok()).unwrap_or_default();
                }
                return self.join(
                    id,
                    &room,
                    token.as_deref(),
                    name.as_deref(),
                    clean_avatar(avatar.as_deref()),
                );
            }
            ClientMsg::Part => {
                self.detach(id);
                return Ok(());
            }
            ClientMsg::Rooms { seats } => {
                let msg = self.my_rooms(&seats);
                self.send(id, &msg);
                return Ok(());
            }
            msg => msg,
        };
        let code = self
            .client(id)?
            .room
            .clone()
            .ok_or_else(|| Fail::new("Join a room first"))?;
        let msg = match msg {
            ClientMsg::Claim { seat, name, avatar } => {
                let has_seat = self.client(id)?.seat.is_some();
                let shown = self.client(id)?.token.clone();
                let room = self.room_mut(&code)?;
                let open = room.game.is_some() && room.seats.get(usize::from(seat)).is_some_and(SeatData::open);
                if !open {
                    return fail("That seat is taken");
                }
                if has_seat {
                    return fail("You already have a seat");
                }
                if room.ban_of(shown.as_deref()).is_some() {
                    return fail(BANNED);
                }
                let name = clean_name(&name)?;
                info!(client = id, room = %code, seat, "{name} claimed a released seat");
                let token = new_token();
                if let Some(s) = room.seats.get_mut(usize::from(seat)) {
                    s.name = name;
                    s.token = Some(token.clone());
                    s.avatar = clean_avatar(avatar.as_deref());
                    s.bot = false;
                    s.free = false;
                    s.left = false;
                }
                self.attach(id, &code, Some(seat));
                if let Some(c) = self.clients.get_mut(&id) {
                    c.token = Some(token.clone());
                }
                self.send(
                    id,
                    &ServerMsg::Joined {
                        room: code.clone(),
                        seat: Some(seat),
                        token: Some(token),
                    },
                );
                self.changed(&code);
                return Ok(());
            }
            ClientMsg::Leave => {
                let seat = self.seat_of(id)?;
                if self.room_mut(&code)?.game.is_some() {
                    info!(client = id, room = %code, seat, "Left the game; a bot plays the seat");
                    self.unseat(&code, seat, None);
                    let now = (self.now)();
                    let room = self.room_mut(&code)?;
                    if let Some(s) = room.seats.get_mut(usize::from(seat)) {
                        s.bot = true;
                        s.left = true;
                    }
                    if let Some(away) = room.away.get_mut(usize::from(seat)) {
                        *away = Some(now);
                    }
                    // The role goes to the first player still here, if any.
                    if room.admin == seat
                        && let Some(p) = room.first_here()
                    {
                        room.admin = p;
                    }
                } else {
                    info!(client = id, room = %code, seat, "Left the lobby");
                    self.remove_lobby_seat(&code, seat, None);
                }
                self.changed(&code);
                return Ok(());
            }
            ClientMsg::Back => {
                if self.client(id)?.seat.is_some() {
                    return fail("You already have a seat");
                }
                let token = self.client(id)?.token.clone();
                let room = self.room_mut(&code)?;
                let Some(seat) = room.left_by(token.as_deref()) else {
                    return fail("That seat is no longer yours");
                };
                if let Some(s) = room.seats.get_mut(usize::from(seat)) {
                    s.bot = false;
                    s.left = false;
                }
                info!(client = id, room = %code, seat, "Took back the seat they left");
                self.attach(id, &code, Some(seat));
                self.send(
                    id,
                    &ServerMsg::Joined {
                        room: code.clone(),
                        seat: Some(seat),
                        token,
                    },
                );
                self.changed(&code);
                return Ok(());
            }
            msg => msg,
        };

        // Everything below needs a seat.
        let me = self.seat_of(id)?;
        let now = (self.now)();
        let skip_after_ms = self.skip_after_ms;
        let require_away = |room: &Room, seat: Seat| -> Result<(), Fail> {
            if !room.has_seat(seat) {
                return fail("No such seat");
            }
            if room.is_bot(seat) {
                return fail("A bot is playing that seat");
            }
            let Some(since) = room.away.get(usize::from(seat)).copied().flatten() else {
                return fail("That player is connected");
            };
            if now.saturating_sub(since) < skip_after_ms {
                return fail("Give them a little longer to reconnect");
            }
            Ok(())
        };
        let room = self.room_mut(&code)?;
        match msg {
            ClientMsg::Avatar { avatar } => {
                if let Some(s) = room.seats.get_mut(usize::from(me)) {
                    s.avatar = clean_avatar(Some(&avatar));
                }
                debug!(room = %code, seat = me, "New look");
            }
            ClientMsg::Start => {
                if room.game.is_some() {
                    return fail("The game has already started");
                }
                room.require_admin(me, "start the game")?;
                let n = u8::try_from(room.seats.len()).unwrap_or(u8::MAX);
                let cfg = config();
                if !cfg.players.contains_key(&n) {
                    return fail(format!("Needs {}–{} players", cfg.min_players(), cfg.max_players()));
                }
                let seed = new_seed();
                room.set_game(new_game(n, seed)?);
                info!(room = %code, seat = me, "Game started with {n} players (seed {seed})");
            }
            ClientMsg::Rematch => {
                let Some(game) = room.game.as_ref().filter(|g| g.over) else {
                    return fail("The game is not over yet");
                };
                room.require_admin(me, "start a rematch")?;
                let (n, seed) = (game.n, new_seed());
                room.set_game(new_game(n, seed)?);
                // Same genres, new names.
                room.cast.seed = new_seed();
                info!(room = %code, seat = me, "Rematch with {n} players (seed {seed})");
            }
            ClientMsg::End => {
                let before = room.game()?;
                room.require_admin(me, "end the game")?;
                let game = end_early(before, me)?;
                room.set_game(game);
                room.last_call = None;
                info!(room = %code, seat = me, "Admin ended the game early");
            }
            ClientMsg::Lobby => {
                if !room.game.as_ref().is_some_and(|g| g.over) {
                    return fail("End the game first");
                }
                room.require_admin(me, "change the setup")?;
                self.back_to_lobby(&code);
                info!(room = %code, seat = me, "Back to the lobby");
            }
            ClientMsg::Theme { theme } => {
                room.require_admin(me, "change the theme")?;
                if room.game.is_some() {
                    return fail("Change the theme in the lobby");
                }
                let id = theme.id();
                if room.theme != id {
                    room.theme = id;
                    // A genre's number means another genre in another theme.
                    room.cast = Cast {
                        seed: new_seed(),
                        genres: Vec::new(),
                    };
                    info!(room = %code, seat = me, "Theme set to {}", room.theme);
                }
            }
            ClientMsg::Close => {
                room.require_admin(me, "close the room")?;
                let by = room.name(me);
                info!(room = %code, seat = me, "Admin closed the room");
                self.close(&code, &by);
                return Ok(());
            }
            ClientMsg::Bot { seat } => {
                room.require_admin(me, "add a bot")?;
                if room.game.is_some() {
                    let Some(seat) = seat else {
                        return fail("The game has started; seats are locked");
                    };
                    if !room.has_seat(seat) {
                        return fail("No such seat");
                    }
                    if let Some(s) = room.seats.get_mut(usize::from(seat)).filter(|s| s.free) {
                        // Taking back a freed bot seat: nobody may claim it now.
                        s.free = false;
                        info!(room = %code, seat = me, "Kept the bot in seat {seat}");
                        self.changed(&code);
                        return Ok(());
                    }
                    if room.is_bot(seat) {
                        return fail("A bot is already playing that seat");
                    }
                    if room.away.get(usize::from(seat)).copied().flatten().is_none() {
                        return fail("That player is connected");
                    }
                    if let Some(s) = room.seats.get_mut(usize::from(seat)) {
                        s.bot = true;
                    }
                    info!(room = %code, seat = me, "A bot plays seat {seat} until its player is back");
                    self.changed(&code);
                    return Ok(());
                }
                if room.seats.len() >= usize::from(config().max_players()) {
                    return fail("The room is full");
                }
                // Fewer seats than bot numbers, so one is free.
                let name = (1..=config().max_players())
                    .map(|k| format!("Bot {k}"))
                    .find(|n| room.seats.iter().all(|s| s.name != *n))
                    .unwrap_or_default();
                info!(room = %code, seat = me, "Added {name} in seat {}", room.seats.len());
                room.seats.push(SeatData {
                    name,
                    bot: true,
                    avatar: random_avatar(),
                    ..SeatData::default()
                });
                room.away.push(None);
            }
            ClientMsg::Kick { seat } => {
                room.require_admin(me, "kick a player")?;
                if !room.has_seat(seat) {
                    return fail("No such seat");
                }
                if seat == me {
                    return fail("You cannot kick yourself");
                }
                let by = room.name(me);
                // The kicked player keeps their token; it is their ban until the admin lifts it.
                if let Some(token) = room.seats.get(usize::from(seat)).and_then(|s| s.token.clone()) {
                    room.ban(room.name(seat), token, false);
                }
                if room.game.is_none() {
                    info!(room = %code, seat = me, "Kicked seat {seat} from the lobby");
                    let why = format!("{by} removed you from the lobby. You can still watch.");
                    self.remove_lobby_seat(&code, seat, Some(why));
                } else {
                    info!(room = %code, seat = me, "Kicked seat {seat}; a bot plays it");
                    let why = format!("{by} gave your seat to a bot. You can still watch.");
                    self.unseat(&code, seat, Some(why));
                    // The token goes, so the player cannot come back to the seat; a bot plays on.
                    let room = self.room_mut(&code)?;
                    if let Some(s) = room.seats.get_mut(usize::from(seat)) {
                        s.token = None;
                        s.bot = true;
                        s.left = false;
                    }
                    if let Some(away) = room.away.get_mut(usize::from(seat)) {
                        *away = None;
                    }
                }
            }
            ClientMsg::Action { action } => {
                let before = room.game()?;
                if action == Action::Unknown {
                    return fail("Unknown move");
                }
                let game = apply_action(before, me, &action)?;
                debug!(room = %code, seat = me, "Move {action:?}");
                room.set_game(game);
            }
            ClientMsg::Skip { seat } => {
                let before = room.game()?;
                room.require_admin(me, "skip a move")?;
                require_away(room, seat)?;
                let game = apply_skip(before, seat)?;
                info!(room = %code, seat = me, "Skipped away seat {seat}");
                room.set_game(game);
            }
            ClientMsg::Rule { winner, price } => {
                let before = room.game()?;
                if me != room.admin {
                    return fail("Only the room admin can call a result");
                }
                let game = apply_ruling(before, me, winner, price)?;
                if let Some(w) = winner {
                    info!(room = %code, seat = me, "Admin called a sale to seat {w} for {price}");
                } else {
                    info!(room = %code, seat = me, "Admin called no sale");
                }
                let before = before.clone();
                room.set_game(game);
                room.last_call = Some(LastCall {
                    before,
                    version: room.version,
                });
            }
            ClientMsg::Undo => {
                if me != room.admin {
                    return fail("Only the room admin can undo a call");
                }
                let (Some(call), Some(after)) = (&room.last_call, &room.game) else {
                    return fail("Nothing to undo: someone has moved since the call");
                };
                if call.version != room.version {
                    return fail("Nothing to undo: someone has moved since the call");
                }
                let game = undo_ruling(&call.before, after, me)?;
                room.set_game(game);
                room.last_call = None;
                info!(room = %code, seat = me, "Admin undid the last call");
            }
            ClientMsg::Admin { seat } => {
                if !room.has_seat(seat) {
                    return fail("No such seat");
                }
                if room.is_bot(seat) {
                    return fail("A bot cannot be the admin");
                }
                if me == room.admin {
                    if seat == me {
                        return fail("You are already the admin");
                    }
                    // A disconnected admin would leave the room without one for the next 30 s.
                    if room.away.get(usize::from(seat)).copied().flatten().is_some() {
                        return fail("That player is not connected");
                    }
                } else {
                    if seat != me {
                        return fail("Only the admin can hand the role to someone else");
                    }
                    let Some(since) = room.away.get(usize::from(room.admin)).copied().flatten() else {
                        return fail("The admin is connected");
                    };
                    if now.saturating_sub(since) < ADMIN_CLAIM_MS {
                        return fail("Give the admin a little longer to reconnect");
                    }
                }
                room.admin = seat;
                room.last_call = None;
                info!(room = %code, seat = me, "Seat {seat} is now admin");
            }
            ClientMsg::Timer { seconds, extend } => {
                room.require_admin(me, "set the bid timer")?;
                check_timer(seconds, extend)?;
                room.bid_timer_s = seconds;
                room.bid_extend_s = extend;
                // A running clock starts again at the new length.
                room.bid_clock = None;
                info!(room = %code, seat = me, "Bid timer set to {seconds} s, {extend} s after a bid");
            }
            ClientMsg::Cast { genres, reroll } => {
                room.require_admin(me, "pick the cast")?;
                if room.game.is_some() {
                    return fail("The game has started; the cast is set");
                }
                room.cast.genres = check_genres(&genres)?;
                if reroll {
                    room.cast.seed = new_seed();
                }
                info!(room = %code, seat = me, "Cast set: genres {:?}, seed {}", room.cast.genres, room.cast.seed);
            }
            ClientMsg::Settings { settings } => {
                room.require_admin(me, "change the room settings")?;
                info!(room = %code, seat = me, "Settings: {settings:?}");
                room.settings = settings;
            }
            ClientMsg::Remove { watcher } => {
                room.require_admin(me, "remove a watcher")?;
                let by = room.name(me);
                let Some(c) = self
                    .clients
                    .get(&watcher)
                    .filter(|c| c.room.as_deref() == Some(code.as_str()) && c.seat.is_none())
                else {
                    return fail("That person is not watching");
                };
                let token = c.token.clone().unwrap_or_else(new_token);
                let name = if c.viewer.is_empty() {
                    "Someone".to_owned()
                } else {
                    c.viewer.clone()
                };
                info!(room = %code, seat = me, "Removed watcher {watcher}");
                self.room_mut(&code)?.ban(name, token.clone(), true);
                self.detach(watcher);
                if let Some(c) = self.clients.get_mut(&watcher) {
                    c.token = None;
                }
                let message = format!("{by} removed you from room {code}.");
                self.send(
                    watcher,
                    &ServerMsg::Removed {
                        room: code.clone(),
                        token,
                        message,
                    },
                );
            }
            ClientMsg::Unban { ban } => {
                room.require_admin(me, "let someone back in")?;
                if usize::from(ban) >= room.banned.len() {
                    return fail("No such person");
                }
                let b = room.banned.remove(usize::from(ban));
                info!(room = %code, seat = me, "Let {} back in", b.name);
            }
            ClientMsg::Release { seat } => {
                if !room.has_seat(seat) {
                    return fail("No such seat");
                }
                if seat == me {
                    return fail("You cannot release your own seat");
                }
                let by = room.name(me);
                if room.game.is_some() && room.is_bot(seat) {
                    room.require_admin(me, "free a seat")?;
                    let Some(s) = room.seats.get(usize::from(seat)).filter(|s| !s.free) else {
                        return fail("That seat is already free");
                    };
                    // A player the bot stands in for (away, or left) loses the seat.
                    let why = s.token.is_some().then(|| {
                        format!(
                            "{by} freed your seat for someone else; a bot plays it until they take it. You can watch."
                        )
                    });
                    info!(room = %code, seat = me, "Freed bot seat {seat}; the bot plays until someone claims it");
                    self.unseat(&code, seat, why);
                    if let Some(s) = self.room_mut(&code)?.seats.get_mut(usize::from(seat)) {
                        s.token = None;
                        s.free = true;
                        s.left = false;
                    }
                } else if room.game.is_some() {
                    room.require_admin(me, "free a seat")?;
                    require_away(room, seat)?;
                    info!(room = %code, seat = me, "Released away seat {seat}");
                    let why = format!("While you were away, {by} freed your seat for someone else. You can watch.");
                    self.unseat(&code, seat, Some(why));
                    if let Some(s) = self.room_mut(&code)?.seats.get_mut(usize::from(seat)) {
                        s.token = None;
                    }
                } else if room.is_bot(seat) {
                    room.require_admin(me, "remove a seat")?;
                    info!(room = %code, seat = me, "Removed the bot in seat {seat} from the lobby");
                    self.remove_lobby_seat(&code, seat, None);
                } else {
                    room.require_admin(me, "remove a seat")?;
                    if room.away.get(usize::from(seat)).copied().flatten().is_none() {
                        return fail("That player is connected");
                    }
                    info!(room = %code, seat = me, "Removed away seat {seat} from the lobby");
                    let why = format!("While you were away, {by} removed your seat from the lobby. You can watch.");
                    self.remove_lobby_seat(&code, seat, Some(why));
                }
            }
            _ => return fail("Unknown message"),
        }
        self.changed(&code);
        Ok(())
    }

    fn create(
        &mut self,
        id: ClientId,
        theme: &str,
        raw_name: &str,
        prefs: Option<Prefs>,
        avatar: String,
    ) -> Result<(), Fail> {
        let name = clean_name(raw_name)?;
        if ThemeId::parse(theme).is_none() {
            return fail("Unknown theme");
        }
        let prefs = prefs.unwrap_or_default();
        let (bid_timer_s, bid_extend_s) = match check_timer(prefs.bid_timer_s, prefs.bid_extend_s) {
            Ok(()) => (prefs.bid_timer_s, prefs.bid_extend_s),
            Err(_) => (DEFAULT_BID_TIMER_S, DEFAULT_BID_EXTEND_S),
        };
        let genres = check_genres(&prefs.genres).unwrap_or_default();
        let now = (self.now)();
        let ip = self.client(id)?.ip.clone();
        let window_ms = self.create_limit.window_ms;
        let mut recent: Vec<u64> = self.creates.get(&ip).map_or_default(|times| {
            times
                .iter()
                .copied()
                .filter(|&t| now.saturating_sub(t) < window_ms)
                .collect()
        });
        if recent.len() >= usize::try_from(self.create_limit.count).unwrap_or(usize::MAX) {
            warn!(client = id, ip, "Room creation limit reached for this address");
            return fail("Too many rooms created; try again later");
        }
        if self.rooms.len() >= self.max_rooms {
            self.sweep();
        }
        if self.rooms.len() >= self.max_rooms {
            warn!(client = id, ip, "Server full: {} rooms", self.rooms.len());
            return fail("The server is full; try again later");
        }
        recent.push(now);
        self.creates.insert(ip.clone(), recent);

        let code = loop {
            let code = new_code();
            if !self.rooms.contains_key(&code) {
                break code;
            }
        };
        info!(
            client = id,
            room = %code,
            ip,
            "{name} created a {theme} room ({} rooms open)",
            self.rooms.len() + 1
        );
        let token = new_token();
        self.rooms.insert(
            code.clone(),
            Room {
                code: code.clone(),
                theme: theme.to_owned(),
                cast: Cast {
                    seed: new_seed(),
                    genres,
                },
                seats: vec![SeatData {
                    name,
                    token: Some(token.clone()),
                    avatar,
                    ..SeatData::default()
                }],
                admin: 0,
                game: None,
                created_at: now,
                updated_at: now,
                bid_timer_s,
                bid_extend_s,
                settings: prefs.settings.unwrap_or_default(),
                banned: Vec::new(),
                version: 0,
                bid_clock: None,
                last_call: None,
                clients: Vec::new(),
                away: vec![Some(now)],
                bot_due: None,
                missed: Vec::new(),
            },
        );
        self.attach(id, &code, Some(0));
        self.send(
            id,
            &ServerMsg::Joined {
                room: code.clone(),
                seat: Some(0),
                token: Some(token),
            },
        );
        self.changed(&code);
        Ok(())
    }

    fn join(
        &mut self,
        id: ClientId,
        raw_code: &str,
        token: Option<&str>,
        raw_name: Option<&str>,
        avatar: String,
    ) -> Result<(), Fail> {
        let code = raw_code.trim().to_uppercase();
        let now = (self.now)();
        let Some(room) = self.rooms.get_mut(&code) else {
            return Err(Fail {
                message: "That room does not exist (it may have expired)".into(),
                code: Some(ErrorCode::NoRoom),
            });
        };
        let ban = room.ban_of(token);
        let out = ban
            .and_then(|i| room.banned.get(i))
            .filter(|b| b.out)
            .map(|b| b.token.clone());
        if let Some(token) = out {
            let msg = ServerMsg::Removed {
                room: code.clone(),
                token,
                message: format!("The admin removed you from room {code}."),
            };
            info!(client = id, room = %code, "Removed person tried to come back");
            self.detach(id);
            self.send(id, &msg);
            return Ok(());
        }
        // A seat its player left to a bot comes back only with `back`; until then they watch.
        let known = token
            .filter(|t| !t.is_empty())
            .and_then(|t| room.seats.iter().position(|s| s.token.as_deref() == Some(t) && !s.left));
        let mut seat = None;
        let mut seat_token = None;
        let mut took_back = false;
        if let Some(known) = known {
            seat = u8::try_from(known).ok();
            if let Some(s) = room.seats.get_mut(known) {
                seat_token.clone_from(&s.token);
                took_back = std::mem::take(&mut s.bot);
            }
            if took_back {
                info!(client = id, room = %code, seat, "Rejoined and took the seat back from its bot");
            } else {
                info!(client = id, room = %code, seat, "Rejoined");
            }
        } else if room.game.is_none()
            && let Some(raw_name) = raw_name
        {
            let name = clean_name(raw_name)?;
            if room.seats.len() >= usize::from(config().max_players()) {
                return fail("The room is full");
            }
            if room.settings.locked {
                return fail("The admin locked this room; you can watch");
            }
            if ban.is_some() {
                return fail(BANNED);
            }
            info!(client = id, room = %code, seat = room.seats.len(), "{name} joined the lobby");
            let token = new_token();
            room.seats.push(SeatData {
                name,
                token: Some(token.clone()),
                avatar,
                ..SeatData::default()
            });
            room.away.push(Some(now));
            seat = u8::try_from(room.seats.len() - 1).ok();
            seat_token = Some(token);
        } else {
            // Debug: the app joins as a viewer before it takes a seat.
            debug!(client = id, room = %code, "Watching");
        }
        self.attach(id, &code, seat);
        if let Some(c) = self.clients.get_mut(&id) {
            c.token = seat_token.clone().or_else(|| token.map(str::to_owned));
        }
        self.send(
            id,
            &ServerMsg::Joined {
                room: code.clone(),
                seat,
                token: seat_token,
            },
        );
        if took_back {
            let message = "A bot played your seat while you were away. It is yours again.".to_owned();
            self.send(id, &ServerMsg::Notice { message });
        } else if seat.is_none() {
            self.tell_missed(id, &code, token);
        }
        if seat.is_some() && (known.is_none() || took_back) {
            self.changed(&code);
        } else {
            self.broadcast(&code);
        }
        Ok(())
    }

    fn attach(&mut self, id: ClientId, code: &str, seat: Option<Seat>) {
        if self.clients.get(&id).is_some_and(|c| c.room.is_some()) {
            self.detach(id);
        }
        let (Some(client), Some(room)) = (self.clients.get_mut(&id), self.rooms.get_mut(code)) else {
            return;
        };
        client.room = Some(code.to_owned());
        client.seat = seat;
        room.clients.push(id);
        if let Some(away) = seat.and_then(|s| room.away.get_mut(usize::from(s))) {
            *away = None;
        }
    }

    fn detach(&mut self, id: ClientId) {
        let now = (self.now)();
        let Some(client) = self.clients.get_mut(&id) else {
            return;
        };
        let Some(code) = client.room.take() else {
            return;
        };
        let seat = client.seat.take();
        let Some(room) = self.rooms.get_mut(&code) else {
            return;
        };
        room.clients.retain(|&c| c != id);
        if let Some(seat) = seat {
            let still_here = room
                .clients
                .iter()
                .any(|c| self.clients.get(c).is_some_and(|c| c.seat == Some(seat)));
            if !still_here && let Some(away) = room.away.get_mut(usize::from(seat)) {
                *away = Some(now);
                info!(client = id, room = %code, seat, "Seat disconnected");
            }
        }
        self.broadcast(&code);
    }

    /// Clients on `seat` become watchers, and are told so, with `why` when someone else took the
    /// seat away (as is a watcher holding the seat's token, who left it to a bot). A player who is
    /// not here hears `why` when they come back with the seat's token.
    fn unseat(&mut self, code: &str, seat: Seat, why: Option<String>) {
        let Some(room) = self.rooms.get_mut(code) else {
            return;
        };
        let token = room.seats.get(usize::from(seat)).and_then(|s| s.token.clone());
        let mut told = false;
        for &cid in &room.clients {
            let Some(c) = self.clients.get_mut(&cid) else {
                continue;
            };
            if c.seat.is_none() && token.is_some() && c.token == token {
                // Watching already, after leaving the seat to a bot.
                told = true;
                if let Some(message) = why.clone()
                    && !(c.sink)(&ServerMsg::Notice { message })
                {
                    self.dropped.push(cid);
                }
            } else if c.seat == Some(seat) {
                c.seat = None;
                c.token.clone_from(&token);
                told = true;
                let joined = ServerMsg::Joined {
                    room: code.to_owned(),
                    seat: None,
                    token: None,
                };
                let notice = why.clone().map(|message| ServerMsg::Notice { message });
                if !(c.sink)(&joined) || notice.is_some_and(|n| !(c.sink)(&n)) {
                    self.dropped.push(cid);
                }
            }
        }
        if !told && let (Some(token), Some(message)) = (token, why) {
            room.tell_later(token, message);
        }
    }

    /// Sends what `token`'s holder missed while away, if anything.
    fn tell_missed(&mut self, id: ClientId, code: &str, token: Option<&str>) {
        let Some(room) = self.rooms.get_mut(code) else {
            return;
        };
        let Some(i) = token.and_then(|t| room.missed.iter().position(|(k, _)| k == t)) else {
            return;
        };
        let (_, message) = room.missed.remove(i);
        self.send(id, &ServerMsg::Notice { message });
    }

    /// After a game: the same seats in the lobby. Stand-in bots hand their seats back (the player
    /// shows as away until they return); freed bot seats stay bots; seats freed mid-game and never
    /// claimed go, as do seats their players left.
    fn back_to_lobby(&mut self, code: &str) {
        let Some(room) = self.rooms.get_mut(code) else {
            return;
        };
        room.game = None;
        room.version += 1;
        room.last_call = None;
        room.bid_clock = None;
        room.bot_due = None;
        for s in &mut room.seats {
            s.free = false;
            if s.token.is_some() && !s.left {
                s.bot = false;
            }
        }
        let open: Vec<Seat> = (0..room.seats.len())
            .rev()
            .filter(|&i| room.seats.get(i).is_some_and(|s| s.open() || s.left))
            .filter_map(|i| u8::try_from(i).ok())
            .collect();
        for seat in open {
            self.remove_lobby_seat(code, seat, None);
        }
    }

    /// Deletes the room; everyone in it is told and goes Home.
    fn close(&mut self, code: &str, by: &str) {
        let Some(room) = self.rooms.remove(code) else {
            return;
        };
        if let Some(store) = &self.store {
            store.remove(code);
        }
        let msg = ServerMsg::Closed {
            room: code.to_owned(),
            by: by.to_owned(),
        };
        for cid in room.clients {
            if let Some(c) = self.clients.get_mut(&cid) {
                c.room = None;
                c.seat = None;
                if !(c.sink)(&msg) {
                    self.dropped.push(cid);
                }
            }
        }
    }

    fn remove_lobby_seat(&mut self, code: &str, seat: Seat, why: Option<String>) {
        self.unseat(code, seat, why);
        let Some(room) = self.rooms.get_mut(code) else {
            return;
        };
        let i = usize::from(seat);
        if i < room.seats.len() {
            room.seats.remove(i);
        }
        if i < room.away.len() {
            room.away.remove(i);
        }
        if seat == room.admin {
            // The first player left, never a bot. With no player left the bots go too.
            if let Some(p) = room.seats.iter().position(|s| !s.bot) {
                room.admin = u8::try_from(p).unwrap_or(0);
            } else {
                room.seats.clear();
                room.away.clear();
                room.admin = 0;
            }
        } else if seat < room.admin {
            room.admin -= 1;
        }
        for &cid in &room.clients {
            if let Some(c) = self.clients.get_mut(&cid)
                && let Some(s) = c.seat.filter(|&s| s > seat)
            {
                c.seat = Some(s - 1);
            }
        }
    }

    /// The rooms where one of `seats` still holds a seat. Only the token counts: a code that was
    /// freed by expiry and reused by a new room does not match an old token.
    fn my_rooms(&self, seats: &[SeatKey]) -> ServerMsg {
        let now = (self.now)();
        let mut rooms = Vec::new();
        let mut gone = Vec::new();
        for key in seats.iter().take(MAX_LISTED_ROOMS) {
            let code = key.room.trim().to_uppercase();
            let found = self.rooms.get(&code).and_then(|room| {
                let seat = (!key.token.is_empty())
                    .then(|| {
                        room.seats
                            .iter()
                            .position(|s| s.token.as_deref() == Some(key.token.as_str()))
                    })
                    .flatten()?;
                let seat = u8::try_from(seat).ok()?;
                let idle_ms = now.saturating_sub(room.updated_at);
                Some(MyRoom {
                    code: code.clone(),
                    theme: room.theme.clone(),
                    stage: match &room.game {
                        None => RoomStage::Lobby,
                        Some(g) if g.over => RoomStage::Over,
                        Some(g) => RoomStage::Playing { round: g.round },
                    },
                    players: room.seats.iter().map(|s| s.name.clone()).collect(),
                    seat,
                    admin: room.admin == seat,
                    idle_ms,
                    expires_in_ms: self.room_ttl_ms.saturating_sub(idle_ms),
                })
            });
            // A kicked person's token is their ban: the browser must keep it.
            let banned = self
                .rooms
                .get(&code)
                .is_some_and(|room| room.ban_of(Some(&key.token)).is_some());
            match found {
                Some(r) => rooms.push(r),
                None if banned => {}
                None => gone.push(key.room.clone()),
            }
        }
        rooms.sort_by_key(|r| (!r.admin, r.idle_ms));
        ServerMsg::Rooms { rooms, gone }
    }

    fn info(&self, room: &Room) -> RoomInfo {
        let now = (self.now)();
        let cfg = config();
        RoomInfo {
            code: room.code.clone(),
            theme: room.theme.clone(),
            cast: room.cast.clone(),
            started: room.game.is_some(),
            seats: room
                .seats
                .iter()
                .enumerate()
                .map(|(i, s)| {
                    let away = room.away.get(i).copied().flatten();
                    SeatInfo {
                        name: s.name.clone(),
                        connected: away.is_none(),
                        away_ms: away.map(|since| now.saturating_sub(since)),
                        open: s.open(),
                        bot: s.bot,
                        avatar: s.avatar.clone(),
                    }
                })
                .collect(),
            admin: room.admin,
            can_undo: room.game.is_some() && room.last_call.as_ref().is_some_and(|c| c.version == room.version),
            min_players: cfg.min_players(),
            max_players: cfg.max_players(),
            skip_after_ms: self.skip_after_ms,
            admin_claim_ms: ADMIN_CLAIM_MS,
            admin_auto_ms: ADMIN_AUTO_MS,
            bid_timer_s: room.bid_timer_s,
            bid_extend_s: room.bid_extend_s,
            bid_ms_left: room.bid_clock.map(|c| c.due.saturating_sub(now)),
            bid_ms_window: room.bid_clock.map(|c| c.due - c.from),
            settings: room.settings.clone(),
            watchers: self.watchers(room),
        }
    }

    /// Tabs here without a seat, then the banned people who are not here.
    fn watchers(&self, room: &Room) -> Vec<Watcher> {
        let mut here = vec![false; room.banned.len()];
        let mut list: Vec<Watcher> = room
            .clients
            .iter()
            .filter_map(|cid| {
                let c = self.clients.get(cid).filter(|c| c.seat.is_none())?;
                let ban = room.ban_of(c.token.as_deref());
                let mut name = c.viewer.clone();
                if let Some(i) = ban {
                    if let Some(h) = here.get_mut(i) {
                        *h = true;
                    }
                    if name.is_empty() {
                        name = room.banned.get(i).map_or_default(|b| b.name.clone());
                    }
                }
                Some(Watcher {
                    id: Some(*cid),
                    name,
                    ban: ban.and_then(|i| u8::try_from(i).ok()),
                })
            })
            .collect();
        for (i, b) in room.banned.iter().enumerate() {
            if !here.get(i).copied().unwrap_or(true) {
                list.push(Watcher {
                    id: None,
                    name: b.name.clone(),
                    ban: u8::try_from(i).ok(),
                });
            }
        }
        list
    }

    fn broadcast(&mut self, code: &str) {
        let Some(room) = self.rooms.get(code) else {
            return;
        };
        let info = self.info(room);
        for &cid in &room.clients {
            let Some(c) = self.clients.get_mut(&cid) else {
                continue;
            };
            let msg = ServerMsg::State {
                room: info.clone(),
                you: c.seat,
                left: c.seat.is_none().then(|| room.left_by(c.token.as_deref())).flatten(),
                game: room.game.as_ref().map(|g| view_for(g, c.seat)),
            };
            if !(c.sink)(&msg) {
                self.dropped.push(cid);
            }
        }
    }

    fn changed(&mut self, code: &str) {
        let now = (self.now)();
        if let Some(room) = self.rooms.get_mut(code) {
            room.updated_at = now;
            room.sync_bid_clock(now);
            if let Some(store) = &self.store {
                store.save(room);
            }
        }
        self.broadcast(code);
    }

    fn load(&mut self, dir: &Path) -> io::Result<()> {
        let now = (self.now)();
        for entry in fs::read_dir(dir)? {
            let name = entry?.file_name();
            let Some(code) = name.to_str().and_then(|n| n.strip_suffix(".json")) else {
                continue;
            };
            if code.len() != CODE_LENGTH || !code.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit()) {
                continue;
            }
            match read_room(&dir.join(&name), code, now) {
                Ok(Some(room)) => {
                    self.rooms.insert(code.to_owned(), room);
                }
                Ok(None) => warn!("Skipping {}: another file version or room", dir.join(&name).display()),
                Err(e) => error!("Skipping unreadable room file {}: {e:#}", dir.join(&name).display()),
            }
        }
        Ok(())
    }
}

/// `Ok(None)` for a file of another version or another room, which is left alone.
fn read_room(path: &Path, code: &str, now: u64) -> anyhow::Result<Option<Room>> {
    let data: serde_json::Value = serde_json::from_slice(&fs::read(path)?)?;
    if data.get("v").and_then(serde_json::Value::as_u64) != Some(FILE_VERSION)
        || data.get("code").and_then(serde_json::Value::as_str) != Some(code)
        || !data.get("seats").is_some_and(serde_json::Value::is_array)
    {
        return Ok(None);
    }
    let saved: Saved = serde_json::from_value(data)?;
    let admin = saved
        .admin
        .as_u64()
        .and_then(|a| u8::try_from(a).ok())
        .filter(|&a| usize::from(a) < saved.seats.len())
        .unwrap_or(0);
    Ok(Some(Room {
        code: code.to_owned(),
        theme: saved.theme,
        cast: saved.cast,
        away: saved.seats.iter().map(|s| (!s.bot).then_some(now)).collect(),
        seats: saved.seats,
        admin,
        game: saved.game,
        created_at: saved.created_at,
        updated_at: saved.updated_at,
        bid_timer_s: saved.bid_timer_s.min(MAX_BID_TIMER_S),
        bid_extend_s: saved.bid_extend_s.clamp(MIN_BID_EXTEND_S, MAX_BID_EXTEND_S),
        settings: saved.settings,
        banned: saved.banned,
        version: 0,
        bid_clock: None,
        last_call: None,
        clients: Vec::new(),
        bot_due: None,
        missed: Vec::new(),
    }))
}

/// Prefixes an I/O error with what was being done; the plain error does not name the file.
fn io_context(e: &io::Error, doing: &str) -> io::Error {
    io::Error::new(e.kind(), format!("{doing}: {e}"))
}

/// The user this process runs as. Linux only, like the rest of the server: `/proc/self` belongs
/// to it.
fn process_uid() -> Option<u32> {
    fs::metadata("/proc/self").ok().map(|m| m.uid())
}

/// Fails at startup when room files could not be saved, instead of failing on every save later.
/// The usual cause is a Docker volume or bind mount owned by root while the image runs as uid 1000.
fn check_writable(dir: &Path) -> io::Result<()> {
    let probe = dir.join(".write-check");
    let Err(e) = fs::write(&probe, b"").and_then(|()| fs::remove_file(&probe)) else {
        return Ok(());
    };
    let owner = fs::metadata(dir).map_or_else(
        |_| "unknown".to_owned(),
        |m| format!("uid {} gid {} mode {:o}", m.uid(), m.gid(), m.mode() & 0o7777),
    );
    let me = process_uid().map_or_else(|| "unknown".to_owned(), |u| u.to_string());
    Err(io::Error::new(
        e.kind(),
        format!(
            "cannot write room files to {}: {e}. The directory is {owner}; this server runs as uid {me}. \
             Give that user write access (e.g. `chown -R {me} {}`), or set DATA_DIR to a writable \
             directory, or to empty to keep rooms in memory only",
            dir.display(),
            dir.display(),
        ),
    ))
}

enum Job {
    Write { code: String, bytes: Vec<u8> },
    Remove { code: String },
    Flush(mpsc::Sender<()>),
}

/// Writes room files on its own thread, in order, so the game never waits for the disk.
/// Dropping it writes what is queued and stops the thread.
struct Store {
    jobs: Option<mpsc::Sender<Job>>,
    thread: Option<JoinHandle<()>>,
}

impl Store {
    fn start(dir: PathBuf) -> io::Result<Self> {
        let (jobs, rx) = mpsc::channel::<Job>();
        let thread = std::thread::Builder::new().name("room-files".into()).spawn(move || {
            for job in rx {
                match job {
                    Job::Write { code, bytes } => {
                        let file = dir.join(format!("{code}.json"));
                        let tmp = dir.join(format!("{code}.json.tmp"));
                        let saved = fs::write(&tmp, &bytes)
                            .map_err(|e| io_context(&e, &format!("writing {}", tmp.display())))
                            .and_then(|()| {
                                fs::rename(&tmp, &file).map_err(|e| {
                                    io_context(&e, &format!("renaming {} to {}", tmp.display(), file.display()))
                                })
                            });
                        match saved {
                            Ok(()) => debug!(room = %code, "Saved {} bytes", bytes.len()),
                            Err(e) => error!(room = %code, "Could not save room: {e}"),
                        }
                    }
                    Job::Remove { code } => {
                        let file = dir.join(format!("{code}.json"));
                        match fs::remove_file(&file) {
                            Err(e) if e.kind() != io::ErrorKind::NotFound => {
                                error!(room = %code, "Could not delete {}: {e}", file.display());
                            }
                            _ => debug!(room = %code, "Deleted {}", file.display()),
                        }
                    }
                    Job::Flush(done) => {
                        let _ = done.send(());
                    }
                }
            }
        })?;
        Ok(Self {
            jobs: Some(jobs),
            thread: Some(thread),
        })
    }

    fn send(&self, job: Job) {
        if let Some(jobs) = &self.jobs {
            let _ = jobs.send(job);
        }
    }

    fn save(&self, room: &Room) {
        let saved = SavedRef {
            v: FILE_VERSION,
            code: &room.code,
            theme: &room.theme,
            cast: &room.cast,
            seats: &room.seats,
            admin: room.admin,
            game: &room.game,
            created_at: room.created_at,
            updated_at: room.updated_at,
            bid_timer_s: room.bid_timer_s,
            bid_extend_s: room.bid_extend_s,
            settings: &room.settings,
            banned: &room.banned,
        };
        match serde_json::to_vec(&saved) {
            Ok(bytes) => self.send(Job::Write {
                code: room.code.clone(),
                bytes,
            }),
            Err(e) => error!("Could not save room {}: {e}", room.code),
        }
    }

    fn remove(&self, code: &str) {
        self.send(Job::Remove { code: code.to_owned() });
    }

    fn flush(&self) {
        let (done, wait) = mpsc::channel();
        self.send(Job::Flush(done));
        let _ = wait.recv();
    }
}

impl Drop for Store {
    fn drop(&mut self) {
        self.jobs = None;
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
