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
}

impl ThemeId {
    #[must_use]
    pub fn parse(id: &str) -> Option<Self> {
        serde_json::from_value(serde_json::Value::String(id.into())).ok()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ClientMsg {
    Create {
        theme: String,
        name: String,
    },
    Join {
        room: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional = nullable)]
        token: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional = nullable)]
        name: Option<String>,
    },
    Claim {
        seat: Seat,
        name: String,
    },
    Start,
    Action {
        action: Action,
    },
    Skip {
        seat: Seat,
    },
    Release {
        seat: Seat,
    },
    Leave,
    Rematch,
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
    /// Any other `type`: answered with "Unknown message".
    #[serde(other)]
    #[ts(skip)]
    Unknown,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SeatInfo {
    pub name: String,
    pub connected: bool,
    /// Milliseconds since the seat's last connection dropped; null while connected.
    pub away_ms: Option<u64>,
    /// Released mid-game: anyone opening the link may claim it.
    pub open: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RoomInfo {
    pub code: String,
    pub theme: String,
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
        game: Option<View>,
    },
    Error {
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        code: Option<ErrorCode>,
    },
}
