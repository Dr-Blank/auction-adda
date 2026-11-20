//! State, moves and views. The view, the moves and the log are part of the wire protocol; the
//! state is what the room file keeps. TypeScript names start with `Pahunch` (one folder holds the
//! types of every game).

pub use game::{RuleError, Seat};
use serde::{Deserialize, Deserializer, Serialize};
use ts_rs::TS;

use crate::board::{Layout, Rooms};

/// What a special coin lets its taker do.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(rename = "PahunchBonus")]
pub enum Bonus {
    /// The mover may also move the blocker this turn.
    Block,
    /// The mover may also nudge a neutral this turn.
    Nudge,
    /// A used favour gets one use back.
    Favour,
}

/// A point token out of the bag. Board coins lie face up, so their bonus is public; in a hand
/// only the value counts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(rename = "PahunchCoin")]
pub struct Coin {
    pub value: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub bonus: Option<Bonus>,
}

impl Coin {
    #[must_use]
    pub const fn plain(value: u8) -> Self {
        Self { value, bonus: None }
    }
}

/// Games saved before special coins kept a bare number.
impl<'de> Deserialize<'de> for Coin {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Repr {
            Bare(u8),
            Full {
                value: u8,
                #[serde(default)]
                bonus: Option<Bonus>,
            },
        }
        Ok(match Repr::deserialize(d)? {
            Repr::Bare(value) => Coin::plain(value),
            Repr::Full { value, bonus } => Coin { value, bonus },
        })
    }
}

/// Extra moves the mover has left this turn, after the main move. While any is left the turn
/// stays with them, until they use it or end the turn.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "PahunchBonuses")]
pub struct Bonuses {
    /// Blocker moves left.
    pub block: u8,
    /// Neutral nudges left.
    pub nudge: u8,
}

impl Bonuses {
    #[must_use]
    pub const fn any(&self) -> bool {
        self.block > 0 || self.nudge > 0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Player {
    /// Climbers not yet on the board.
    pub hand: u8,
    /// Point tokens by value; hidden from the others until the end.
    pub tokens: Vec<u8>,
}

/// A climb that waits for votes: the mover's climber leaves `room` by `path` once `need` yes
/// votes are in.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "PahunchVote")]
pub struct Vote {
    pub room: u8,
    pub path: u8,
    pub need: u8,
    /// Yes votes per seat; `null` = not answered (or no climber there). The mover's own climbers
    /// count as yes.
    pub answers: Vec<Option<u8>>,
    /// Neutrals in the room the mover paid: each a yes.
    pub bribed: u8,
    /// Log line that asked: the vote clock starts there.
    pub start: u32,
}

impl Vote {
    #[must_use]
    pub fn yes(&self) -> u8 {
        self.answers
            .iter()
            .flatten()
            .fold(self.bribed, |a, &b| a.saturating_add(b))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "lowercase")]
#[ts(rename = "PahunchLog")]
pub enum LogEntry {
    Start {
        first: Seat,
    },
    Enter {
        p: Seat,
        room: u8,
    },
    /// `token`: a token was taken on the way (its value only the climber sees, until the end).
    /// `free`: no vote was needed (enough own climbers, or the blocker on the path).
    Climb {
        p: Seat,
        path: u8,
        token: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        took: Option<u8>,
        free: bool,
    },
    /// A vote starts.
    Ask {
        p: Seat,
        path: u8,
        need: u8,
    },
    Vote {
        p: Seat,
        yes: u8,
        of: u8,
    },
    Bribe {
        p: Seat,
    },
    /// `p` earned `ones` 1-point tokens for needed yes votes (or for nudging a neutral).
    Reward {
        p: Seat,
        ones: u8,
    },
    /// The vote did not pass (or the mover gave up): the climber stays.
    Fail {
        p: Seat,
    },
    Nudge {
        p: Seat,
        path: u8,
    },
    Block {
        p: Seat,
        path: u8,
    },
    /// The mover took a special coin: its bonus is theirs.
    Bonus {
        p: Seat,
        kind: Bonus,
    },
    /// The mover ended the turn with bonus moves left.
    Done {
        p: Seat,
    },
    /// A gift of tokens; their values stay between the two.
    Gift {
        from: Seat,
        to: Seat,
        count: u8,
    },
    /// The admin skipped an absent player: the next line is a random move made for them.
    Skip {
        p: Seat,
    },
    /// `by`: the admin ended the game early; nobody wins then.
    End {
        winners: Vec<Seat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        by: Option<Seat>,
    },
}

/// The admin's switches for one game, fixed when it starts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "PahunchOptions")]
pub struct Options {
    /// A failed vote ends the mover's turn; off, they choose another move.
    pub fail_ends_turn: bool,
    /// Every player has a favour to lend.
    pub favours: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            fail_ends_turn: false,
            favours: true,
        }
    }
}

impl Options {
    /// Games saved before options existed played this way.
    #[must_use]
    pub const fn legacy() -> Self {
        Self {
            fail_ends_turn: true,
            favours: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub n: u8,
    pub seed: u32,
    #[serde(default = "Options::legacy")]
    pub options: Options,
    /// Rooms that voted the mover down this turn: no second vote there until the turn passes.
    #[serde(default)]
    pub tried: Vec<u8>,
    /// Bonus moves the mover has left this turn.
    #[serde(default)]
    pub bonuses: Bonuses,
    pub layout: Layout,
    /// Who holds each place, room by room, in order of arrival; `null` = a neutral.
    pub rooms: Rooms,
    /// The token on each path; `null` = none.
    pub tokens_on: Vec<Option<Coin>>,
    pub blocker: u8,
    /// Tokens left to refill paths, drawn from the end.
    pub bag: Vec<Coin>,
    /// 1-point tokens left.
    pub supply: u16,
    pub players: Vec<Player>,
    pub turn: Seat,
    pub vote: Option<Vote>,
    pub log: Vec<LogEntry>,
    pub over: bool,
    pub winners: Vec<Seat>,
    /// Moves made for absent players so far: each draws its random move from the seed and this.
    pub skips: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "lowercase")]
#[ts(rename = "PahunchAction")]
pub enum Action {
    /// A climber from your hand into a bottom room.
    Enter { room: u8 },
    /// One of your climbers up `path`.
    Climb { path: u8 },
    /// Your answer to the running vote: how many of your climbers there say yes.
    Vote { yes: u8 },
    /// The mover pays a neutral in the room one token of this value for its yes.
    Bribe { token: u8 },
    /// The mover gives up the climb; the turn ends.
    Withdraw,
    /// A neutral up `path`, no vote needed; you get a 1-point token.
    Nudge { path: u8 },
    /// The blocker onto `path`.
    Block { path: u8 },
    /// The mover ends the turn with bonus moves left.
    Done,
    /// Tokens (by value) to another player, at any time.
    Give { to: Seat, tokens: Vec<u8> },
    /// Any other `type`: answered with "Unknown move".
    #[serde(other)]
    #[ts(skip)]
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "PahunchPlayer")]
pub struct PlayerView {
    pub hand: u8,
    /// `null` = hidden: own tokens always show; everyone's show at the end.
    pub tokens: Option<Vec<u8>>,
}

/// What one seat (or a spectator, `you: null`) may know.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "PahunchView")]
pub struct View {
    pub n: u8,
    pub you: Option<Seat>,
    pub options: Options,
    /// Rooms that voted the mover down this turn.
    pub tried: Vec<u8>,
    /// Bonus moves the mover has left this turn.
    pub bonuses: Bonuses,
    pub layout: Layout,
    pub rooms: Rooms,
    pub tokens_on: Vec<Option<Coin>>,
    pub blocker: u8,
    /// Tokens left in the bag.
    pub bag: u8,
    pub supply: u16,
    pub players: Vec<PlayerView>,
    pub turn: Seat,
    pub vote: Option<Vote>,
    pub pending: Vec<Seat>,
    pub log: Vec<LogEntry>,
    /// Position of `log[0]` in the full log.
    pub log_start: u32,
    pub over: bool,
    pub winners: Vec<Seat>,
}
