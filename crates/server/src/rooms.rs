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
    new_game, pending, undo_ruling, view_for,
};
use rand::RngExt;
use rand::seq::IndexedRandom;
use serde::{Deserialize, Serialize};
use tracing::{debug, error, info, warn};

use crate::bot::choose_action;
use crate::protocol::{Cast, ClientMsg, ErrorCode, Prefs, RoomInfo, SeatInfo, ServerMsg, ThemeId};

const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH: usize = 6;
const NAME_LIMIT: usize = 20;
/// Base-36 digits in a seat's look; the client reads as many as it has parts.
const AVATAR_LIMIT: usize = 16;
const FILE_VERSION: u64 = 1;
/// While the admin can still undo a call, bots wait at least this long, so their move does not
/// take the undo away at once.
const BOT_WAIT_AFTER_CALL_MS: u64 = 8_000;
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
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SeatData {
    name: String,
    /// Secret that lets a browser re-attach to this seat. `None` = released, anyone may claim it
    /// (unless it is a bot).
    token: Option<String>,
    /// Played by the server; never has a token.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    bot: bool,
    /// As in `SeatInfo`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    avatar: String,
}

impl SeatData {
    fn open(&self) -> bool {
        self.token.is_none() && !self.bot
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
}

impl Room {
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
        for room in self.rooms.values_mut() {
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
            } => {
                return self.join(
                    id,
                    &room,
                    token.as_deref(),
                    name.as_deref(),
                    clean_avatar(avatar.as_deref()),
                );
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
                let room = self.room_mut(&code)?;
                let open = room.game.is_some() && room.seats.get(usize::from(seat)).is_some_and(SeatData::open);
                if !open {
                    return fail("That seat is taken");
                }
                if has_seat {
                    return fail("You already have a seat");
                }
                let name = clean_name(&name)?;
                info!(client = id, room = %code, seat, "{name} claimed a released seat");
                let token = new_token();
                if let Some(s) = room.seats.get_mut(usize::from(seat)) {
                    s.name = name;
                    s.token = Some(token.clone());
                    s.avatar = clean_avatar(avatar.as_deref());
                }
                self.attach(id, &code, Some(seat));
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
                    return fail("The game has started; you cannot leave your seat");
                }
                info!(client = id, room = %code, seat, "Left the lobby");
                self.remove_lobby_seat(&code, seat);
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
            ClientMsg::Bot { seat } => {
                room.require_admin(me, "add a bot")?;
                if room.game.is_some() {
                    let Some(seat) = seat else {
                        return fail("The game has started; seats are locked");
                    };
                    if !room.has_seat(seat) {
                        return fail("No such seat");
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
                    token: None,
                    bot: true,
                    avatar: random_avatar(),
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
                if room.game.is_none() {
                    info!(room = %code, seat = me, "Kicked seat {seat} from the lobby");
                    self.remove_lobby_seat(&code, seat);
                } else {
                    // The token goes, so the player cannot come back to the seat; a bot plays on.
                    if let Some(s) = room.seats.get_mut(usize::from(seat)) {
                        s.token = None;
                        s.bot = true;
                    }
                    if let Some(away) = room.away.get_mut(usize::from(seat)) {
                        *away = None;
                    }
                    info!(room = %code, seat = me, "Kicked seat {seat}; a bot plays it");
                    self.unseat(&code, seat);
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
                    require_away(room, room.admin)?;
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
            ClientMsg::Release { seat } => {
                if !room.has_seat(seat) {
                    return fail("No such seat");
                }
                if seat == me {
                    return fail("You cannot release your own seat");
                }
                if room.game.is_some() {
                    room.require_admin(me, "free a seat")?;
                    require_away(room, seat)?;
                    if let Some(s) = room.seats.get_mut(usize::from(seat)) {
                        s.token = None;
                    }
                    info!(room = %code, seat = me, "Released away seat {seat}");
                } else if room.is_bot(seat) {
                    room.require_admin(me, "remove a seat")?;
                    info!(room = %code, seat = me, "Removed the bot in seat {seat} from the lobby");
                    self.remove_lobby_seat(&code, seat);
                } else {
                    room.require_admin(me, "remove a seat")?;
                    if room.away.get(usize::from(seat)).copied().flatten().is_none() {
                        return fail("That player is connected");
                    }
                    info!(room = %code, seat = me, "Removed away seat {seat} from the lobby");
                    self.remove_lobby_seat(&code, seat);
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
        let mut recent: Vec<u64> = self
            .creates
            .get(&ip)
            .map(|times| {
                times
                    .iter()
                    .copied()
                    .filter(|&t| now.saturating_sub(t) < window_ms)
                    .collect()
            })
            .unwrap_or_default();
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
                    bot: false,
                    avatar,
                }],
                admin: 0,
                game: None,
                created_at: now,
                updated_at: now,
                bid_timer_s,
                bid_extend_s,
                version: 0,
                bid_clock: None,
                last_call: None,
                clients: Vec::new(),
                away: vec![Some(now)],
                bot_due: None,
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
        let known = token
            .filter(|t| !t.is_empty())
            .and_then(|t| room.seats.iter().position(|s| s.token.as_deref() == Some(t)));
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
            info!(client = id, room = %code, seat = room.seats.len(), "{name} joined the lobby");
            let token = new_token();
            room.seats.push(SeatData {
                name,
                token: Some(token.clone()),
                bot: false,
                avatar,
            });
            room.away.push(Some(now));
            seat = u8::try_from(room.seats.len() - 1).ok();
            seat_token = Some(token);
        } else {
            // Debug: the app joins as a viewer before it takes a seat.
            debug!(client = id, room = %code, "Watching");
        }
        self.attach(id, &code, seat);
        self.send(
            id,
            &ServerMsg::Joined {
                room: code.clone(),
                seat,
                token: seat_token,
            },
        );
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

    /// Clients on `seat` become watchers, and are told so.
    fn unseat(&mut self, code: &str, seat: Seat) {
        let Some(room) = self.rooms.get(code) else {
            return;
        };
        for &cid in &room.clients {
            if let Some(c) = self.clients.get_mut(&cid)
                && c.seat == Some(seat)
            {
                c.seat = None;
                let msg = ServerMsg::Joined {
                    room: code.to_owned(),
                    seat: None,
                    token: None,
                };
                if !(c.sink)(&msg) {
                    self.dropped.push(cid);
                }
            }
        }
    }

    fn remove_lobby_seat(&mut self, code: &str, seat: Seat) {
        self.unseat(code, seat);
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
            bid_timer_s: room.bid_timer_s,
            bid_extend_s: room.bid_extend_s,
            bid_ms_left: room.bid_clock.map(|c| c.due.saturating_sub(now)),
            bid_ms_window: room.bid_clock.map(|c| c.due - c.from),
        }
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
        version: 0,
        bid_clock: None,
        last_call: None,
        clients: Vec::new(),
        bot_due: None,
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
