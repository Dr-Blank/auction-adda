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
    Action, GameState, RuleError, Seat, apply_action, apply_ruling, apply_skip, config, new_game, undo_ruling, view_for,
};
use rand::RngExt;
use rand::seq::IndexedRandom;
use serde::{Deserialize, Serialize};
use tracing::{debug, error, info, warn};

use crate::protocol::{ClientMsg, ErrorCode, RoomInfo, SeatInfo, ServerMsg, ThemeId};

const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH: usize = 6;
const NAME_LIMIT: usize = 20;
const FILE_VERSION: u64 = 1;

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
}

impl Default for Options {
    fn default() -> Self {
        Self {
            data_dir: None,
            now: Box::new(system_now),
            skip_after_ms: 30_000,
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
    /// Secret that lets a browser re-attach to this seat. `None` = released, anyone may claim it.
    token: Option<String>,
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
    seats: Vec<SeatData>,
    /// Seat allowed to call auction results by voice.
    admin: Seat,
    game: Option<GameState>,
    created_at: u64,
    updated_at: u64,
    // Not saved:
    /// Goes up every time `game` changes.
    version: u64,
    last_call: Option<LastCall>,
    clients: Vec<ClientId>,
    /// Per seat: when its last connection dropped (`None` while connected).
    away: Vec<Option<u64>>,
}

impl Room {
    fn set_game(&mut self, game: GameState) {
        if game.over && !self.game.as_ref().is_some_and(|g| g.over) {
            info!(room = %self.code, "Game over");
        }
        self.game = Some(game);
        self.version += 1;
    }

    fn game(&self) -> Result<&GameState, Fail> {
        self.game.as_ref().ok_or_else(|| Fail::new("The game has not started"))
    }

    fn has_seat(&self, seat: Seat) -> bool {
        usize::from(seat) < self.seats.len()
    }
}

/// The save file, version 1: `{ v, code, theme, seats, admin, game, createdAt, updatedAt }`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedRef<'a> {
    v: u64,
    code: &'a str,
    theme: &'a str,
    seats: &'a [SeatData],
    admin: Seat,
    game: &'a Option<GameState>,
    created_at: u64,
    updated_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    theme: String,
    seats: Vec<SeatData>,
    #[serde(default)]
    admin: serde_json::Value,
    game: Option<GameState>,
    created_at: u64,
    updated_at: u64,
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
            ClientMsg::Create { theme, name } => return self.create(id, &theme, &name),
            ClientMsg::Join { room, token, name } => {
                return self.join(id, &room, token.as_deref(), name.as_deref());
            }
            msg => msg,
        };
        let code = self
            .client(id)?
            .room
            .clone()
            .ok_or_else(|| Fail::new("Join a room first"))?;
        let msg = match msg {
            ClientMsg::Claim { seat, name } => {
                let has_seat = self.client(id)?.seat.is_some();
                let room = self.room_mut(&code)?;
                let open = room.game.is_some() && room.seats.get(usize::from(seat)).is_some_and(|s| s.token.is_none());
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
            ClientMsg::Start => {
                if room.game.is_some() {
                    return fail("The game has already started");
                }
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
                let (n, seed) = (game.n, new_seed());
                room.set_game(new_game(n, seed)?);
                info!(room = %code, seat = me, "Rematch with {n} players (seed {seed})");
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
                if me == room.admin {
                    if seat == me {
                        return fail("You are already the admin");
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
            ClientMsg::Release { seat } => {
                if !room.has_seat(seat) {
                    return fail("No such seat");
                }
                if seat == me {
                    return fail("You cannot release your own seat");
                }
                if room.game.is_some() {
                    require_away(room, seat)?;
                    if let Some(s) = room.seats.get_mut(usize::from(seat)) {
                        s.token = None;
                    }
                    info!(room = %code, seat = me, "Released away seat {seat}");
                } else {
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

    fn create(&mut self, id: ClientId, theme: &str, raw_name: &str) -> Result<(), Fail> {
        let name = clean_name(raw_name)?;
        if ThemeId::parse(theme).is_none() {
            return fail("Unknown theme");
        }
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
                seats: vec![SeatData {
                    name,
                    token: Some(token.clone()),
                }],
                admin: 0,
                game: None,
                created_at: now,
                updated_at: now,
                version: 0,
                last_call: None,
                clients: Vec::new(),
                away: vec![Some(now)],
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

    fn join(&mut self, id: ClientId, raw_code: &str, token: Option<&str>, raw_name: Option<&str>) -> Result<(), Fail> {
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
        if let Some(known) = known {
            seat = u8::try_from(known).ok();
            seat_token = room.seats.get(known).and_then(|s| s.token.clone());
            info!(client = id, room = %code, seat, "Rejoined");
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
        if seat.is_some() && known.is_none() {
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

    fn remove_lobby_seat(&mut self, code: &str, seat: Seat) {
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
            room.admin = 0;
        } else if seat < room.admin {
            room.admin -= 1;
        }
        for &cid in &room.clients {
            let Some(c) = self.clients.get_mut(&cid) else {
                continue;
            };
            match c.seat {
                Some(s) if s == seat => {
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
                Some(s) if s > seat => c.seat = Some(s - 1),
                _ => {}
            }
        }
    }

    fn info(&self, room: &Room) -> RoomInfo {
        let now = (self.now)();
        let cfg = config();
        RoomInfo {
            code: room.code.clone(),
            theme: room.theme.clone(),
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
                        open: s.token.is_none(),
                    }
                })
                .collect(),
            admin: room.admin,
            can_undo: room.game.is_some() && room.last_call.as_ref().is_some_and(|c| c.version == room.version),
            min_players: cfg.min_players(),
            max_players: cfg.max_players(),
            skip_after_ms: self.skip_after_ms,
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
        away: vec![Some(now); saved.seats.len()],
        seats: saved.seats,
        admin,
        game: saved.game,
        created_at: saved.created_at,
        updated_at: saved.updated_at,
        version: 0,
        last_call: None,
        clients: Vec::new(),
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
            seats: &room.seats,
            admin: room.admin,
            game: &room.game,
            created_at: room.created_at,
            updated_at: room.updated_at,
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
