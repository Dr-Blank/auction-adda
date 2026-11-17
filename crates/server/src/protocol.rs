//! Messages between the browser and the server. The client gets these types from `src/generated/`.

use engine::{Action, Money, Seat, View};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Themes the server accepts. The client's theme registry is typed by this, so a theme missing on
/// either side does not compile.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeId {
    BoxOffice,
    LeatherWillow,
}

/// Which of a theme's genres play and which of their names show. The server stores it; every
/// client resolves it the same way from the theme's lists.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Cast {
    /// Picks the names, labels and titles shown, and the genres when none are picked. New for
    /// every game.
    pub seed: u32,
    /// Genres (indices into the theme's list) the admin picked, one per suit. Empty = picked by
    /// `seed`.
    #[serde(default)]
    pub genres: Vec<u8>,
}

impl ThemeId {
    #[must_use]
    pub fn parse(id: &str) -> Option<Self> {
        serde_json::from_value(serde_json::Value::String(id.into())).ok()
    }

    /// The id as the client and the save file spell it (`box-office`).
    #[must_use]
    pub fn id(self) -> String {
        serde_json::to_value(self)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default()
    }
}

/// Room settings a creator brings from their last game (their browser keeps them). A setting the
/// server would refuse is dropped for the default.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    pub bid_timer_s: u16,
    pub bid_extend_s: u16,
    /// Genres for this theme, as in `Cast`; empty = random.
    #[serde(default)]
    pub genres: Vec<u8>,
    #[serde(default)]
    #[ts(optional)]
    pub settings: Option<RoomSettings>,
}

/// The admin's switches for how the room plays. Saved with the room, sent to everyone, changed
/// with `settings` in the lobby or a game; the admin's browser keeps them for their next room. A
/// field missing (older files and clients) takes its default.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
pub struct RoomSettings {
    /// Nobody new takes a seat in the lobby; people opening the link can only watch. Seats the
    /// admin frees in a game can still be claimed.
    pub locked: bool,
    /// Who may freeze a running game (`freeze`).
    pub freeze: FreezeBy,
    /// Players may change their name (`rename`) in the lobby and in a game.
    pub rename: bool,
    /// The seats are drawn again at the start of every round, not only when a game starts.
    pub shuffle_each_round: bool,
    /// Emoji players can send over their seat (`react`), at most `MAX_REACTIONS`; empty = off.
    pub reactions: Vec<String>,
}

/// The reactions a new room offers.
pub const DEFAULT_REACTIONS: [&str; 6] = ["👏", "😂", "😮", "🔥", "😬", "🙏"];
/// At most this many reactions in a room's set.
pub const MAX_REACTIONS: usize = 8;

impl Default for RoomSettings {
    fn default() -> Self {
        Self {
            locked: false,
            freeze: FreezeBy::default(),
            rename: false,
            shuffle_each_round: false,
            reactions: DEFAULT_REACTIONS.map(str::to_owned).to_vec(),
        }
    }
}

impl RoomSettings {
    /// A reaction is one short, visible symbol (an emoji with its modifiers, or a few letters).
    #[must_use]
    pub fn reactions_ok(&self) -> bool {
        let mut seen = self.reactions.clone();
        seen.sort();
        seen.dedup();
        self.reactions.len() <= MAX_REACTIONS
            && seen.len() == self.reactions.len()
            && self
                .reactions
                .iter()
                .all(|r| !r.is_empty() && r.len() <= 16 && r.chars().all(|c| !c.is_control() && !c.is_whitespace()))
    }
}

/// Who may freeze a running game. Whoever froze it, and the admin, may unfreeze it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum FreezeBy {
    #[default]
    Admin,
    /// Any player with a seat.
    Anyone,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ClientMsg {
    Create {
        theme: String,
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional = nullable)]
        prefs: Option<Prefs>,
        /// The creator's look, as in `SeatInfo`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional = nullable)]
        avatar: Option<String>,
    },
    Join {
        room: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional = nullable)]
        token: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional = nullable)]
        name: Option<String>,
        /// Used when the join takes a new seat.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional = nullable)]
        avatar: Option<String>,
        /// The name shown in the watcher list while this tab watches (the browser's saved name).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional = nullable)]
        viewer: Option<String>,
    },
    Claim {
        seat: Seat,
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional = nullable)]
        avatar: Option<String>,
    },
    /// The sender's new look, in the lobby or a game.
    Avatar {
        avatar: String,
    },
    /// The sender's new name, in the lobby or a game, while `RoomSettings::rename` is on.
    Rename {
        name: String,
    },
    /// In the lobby: the sender is ready to play (or not any more). The admin may start anyway.
    Ready {
        on: bool,
    },
    /// One of the room's reactions over the sender's seat, sent on to everyone as `reaction`. A
    /// few per seconds at most; never saved.
    React {
        emoji: String,
    },
    /// Admin only.
    Start,
    /// Admin only. In the lobby: seat a bot the server plays (`seat` is ignored; `release` removes
    /// it again). In a game: a bot plays the disconnected `seat` until its player comes back.
    Bot {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional = nullable)]
        seat: Option<Seat>,
    },
    /// Admin only. In the lobby the seat goes; in a game the player loses it and a bot plays on.
    Kick {
        seat: Seat,
    },
    Action {
        action: Action,
    },
    Skip {
        seat: Seat,
    },
    /// Admin only. In a game: an away player's seat opens for anyone with the link; a bot seat
    /// opens too, and its bot plays on until someone claims it (`bot` keeps it a bot). In the
    /// lobby: removes a bot or an away player.
    Release {
        seat: Seat,
    },
    /// In the lobby: give up the seat. In a game: a bot plays it; `back` takes it again.
    Leave,
    /// Take back the seat this tab left in the running game (`State::left`).
    Back,
    /// This tab left the room screen: it stops watching, and its seat counts as disconnected.
    Part,
    /// The rooms this browser has a seat in, by their saved seat tokens. Answered with `rooms`.
    Rooms {
        seats: Vec<SeatKey>,
    },
    /// Admin only: a new game at once, same players and setup.
    Rematch,
    /// Admin only, once the game is over: back to the lobby with the same seats, to change the
    /// setup (theme, cast, clock, players) before the next game.
    Lobby,
    /// Admin only: end the running game now; the money as it stands decides.
    End,
    /// Admin only, in the lobby: play another theme. The genre pick goes back to random.
    Theme {
        theme: ThemeId,
    },
    /// Admin only: delete the room. Everyone in it gets `closed`.
    Close,
    /// Admin only: end the running auction with a result agreed on voice. `winner` null = no sale.
    Rule {
        winner: Option<Seat>,
        price: Money,
    },
    /// Admin only: take back the result just called, while nobody has moved since.
    Undo,
    /// Admin: hand the role to `seat`. Anyone: take the role for themselves once the admin has been
    /// away 30 s.
    Admin {
        seat: Seat,
    },
    /// Admin only, in the lobby or a game: the open-auction clock. `seconds` from the lot going up
    /// (0 = no clock); after a bid, everyone still in gets at least `extend` seconds.
    Timer {
        seconds: u16,
        extend: u16,
    },
    /// Admin only, in the lobby: the genres that play (one per suit, or empty for a random pick);
    /// `reroll` draws new names.
    Cast {
        genres: Vec<u8>,
        #[serde(default)]
        reroll: bool,
    },
    /// Admin only, in the lobby or a game: replaces the room's settings.
    Settings {
        settings: RoomSettings,
    },
    /// In a game: `on` stops the bid clock, the bots and every move (calls and undo too) until
    /// `on: false`. Freezing is
    /// for the admin, or any player when `RoomSettings::freeze` is `anyone`; whoever froze the game
    /// and the admin may unfreeze it.
    Freeze {
        on: bool,
    },
    /// Admin only: send a watcher (`Watcher::id`) out of the room; they cannot come back to watch
    /// or take a seat until let back in.
    Remove {
        watcher: u64,
    },
    /// Admin only: let a removed or kicked person (`Watcher::ban`) back in.
    Unban {
        ban: u8,
    },
    /// Any other `type`: answered with "Unknown message".
    #[serde(other)]
    #[ts(skip)]
    Unknown,
}

impl ClientMsg {
    /// The `type` tag, for logs. The message itself may hold a seat token, so it is never logged.
    #[must_use]
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Create { .. } => "create",
            Self::Join { .. } => "join",
            Self::Claim { .. } => "claim",
            Self::Avatar { .. } => "avatar",
            Self::Rename { .. } => "rename",
            Self::Ready { .. } => "ready",
            Self::React { .. } => "react",
            Self::Start => "start",
            Self::Bot { .. } => "bot",
            Self::Kick { .. } => "kick",
            Self::Action { .. } => "action",
            Self::Skip { .. } => "skip",
            Self::Release { .. } => "release",
            Self::Leave => "leave",
            Self::Back => "back",
            Self::Part => "part",
            Self::Rooms { .. } => "rooms",
            Self::Rematch => "rematch",
            Self::Lobby => "lobby",
            Self::End => "end",
            Self::Theme { .. } => "theme",
            Self::Close => "close",
            Self::Rule { .. } => "rule",
            Self::Undo => "undo",
            Self::Admin { .. } => "admin",
            Self::Timer { .. } => "timer",
            Self::Cast { .. } => "cast",
            Self::Settings { .. } => "settings",
            Self::Freeze { .. } => "freeze",
            Self::Remove { .. } => "remove",
            Self::Unban { .. } => "unban",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[expect(
    clippy::struct_excessive_bools,
    reason = "independent facts the client shows one by one"
)]
pub struct SeatInfo {
    pub name: String,
    pub connected: bool,
    /// Milliseconds since the seat's last connection dropped; null while connected.
    pub away_ms: Option<u64>,
    /// Released mid-game: anyone opening the link may claim it.
    pub open: bool,
    /// Played by the server; never open, never admin. A bot standing in for a player who may come
    /// back shows as disconnected.
    pub bot: bool,
    /// The seat's look: up to 16 base-36 digits, one per part, that the client draws (each digit
    /// modulo that part's choices, so any string draws). Empty = drawn from the name. The server
    /// only cleans it, and rolls one for each bot.
    pub avatar: String,
    /// In the lobby: the player said they are ready. Bots are always ready.
    pub ready: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RoomInfo {
    pub code: String,
    pub theme: String,
    pub cast: Cast,
    pub started: bool,
    pub seats: Vec<SeatInfo>,
    /// Seat that may call auction results by voice (`rule`). Starts as the room creator.
    pub admin: Seat,
    /// The admin's last called result can still be taken back (nobody has moved since).
    pub can_undo: bool,
    pub min_players: u8,
    pub max_players: u8,
    /// How long a seat must be disconnected before it can be skipped or released.
    pub skip_after_ms: u64,
    /// The admin away this long: any player may take the role (`admin` with their own seat).
    pub admin_claim_ms: u64,
    /// The admin away this long: the first connected player becomes admin.
    pub admin_auto_ms: u64,
    /// Open auctions: seconds from the lot going up until everyone still in is done. 0 = no clock.
    pub bid_timer_s: u16,
    /// Open auctions: after a bid, everyone still in has at least this many seconds left.
    pub bid_extend_s: u16,
    /// Milliseconds left on the running open-auction clock; null when none runs.
    pub bid_ms_left: Option<u64>,
    /// Length of the clock's current stretch (since the lot went up or a bid added time); null
    /// when none runs.
    pub bid_ms_window: Option<u64>,
    /// The seat that froze the game; null while it runs. A frozen clock keeps `bid_ms_left`.
    pub frozen_by: Option<Seat>,
    pub settings: RoomSettings,
    /// People here without a seat, then kicked or removed people who are not here.
    pub watchers: Vec<Watcher>,
}

/// Someone watching the room, or someone the admin kicked or removed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Watcher {
    /// The connection, for `remove`; null when they are not here.
    pub id: Option<u64>,
    /// Their saved name; empty when the browser has none.
    pub name: String,
    /// Kicked or removed: the index for `unban`; null when they may take a seat.
    pub ban: Option<u8>,
}

/// A room code and the seat token this browser keeps for it.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct SeatKey {
    pub room: String,
    pub token: String,
}

/// Where a game stands, for a list of rooms.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum RoomStage {
    Lobby,
    /// `round` counts from 0.
    Playing {
        round: u8,
    },
    Over,
}

/// One room this browser has a seat in.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MyRoom {
    pub code: String,
    pub theme: String,
    pub stage: RoomStage,
    /// Everyone seated, in seat order.
    pub players: Vec<String>,
    pub seat: Seat,
    pub admin: bool,
    /// Since anything last happened in the room.
    pub idle_ms: u64,
    /// Until the room is deleted, if nothing happens in it before then.
    pub expires_in_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorCode {
    NoRoom,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "lowercase")]
#[expect(clippy::large_enum_variant, reason = "built, sent and dropped; never stored")]
pub enum ServerMsg {
    Joined {
        room: String,
        seat: Option<Seat>,
        token: Option<String>,
    },
    State {
        room: RoomInfo,
        you: Option<Seat>,
        /// The seat this tab left to a bot in the running game; `back` takes it again.
        left: Option<Seat>,
        game: Option<View>,
    },
    /// Answer to `rooms`: the rooms where a token still holds a seat, admin rooms first, then the
    /// most recently active. `gone`: codes where it does not (expired, left, or a new room that
    /// reused the code); the browser forgets those tokens.
    Rooms { rooms: Vec<MyRoom>, gone: Vec<String> },
    /// The admin (`by`, their name) deleted the room; the browser forgets it and goes Home.
    Closed { room: String, by: String },
    /// The admin sent this tab out of the room; the browser keeps `token` (its ban) and goes Home.
    Removed {
        room: String,
        token: String,
        message: String,
    },
    /// Something happened to this tab that it did not ask for (removed from a seat, say).
    Notice { message: String },
    /// `seat` sent a reaction.
    Reaction { seat: Seat, emoji: String },
    Error {
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        code: Option<ErrorCode>,
    },
}
