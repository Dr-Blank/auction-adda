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

/// A player's favour: a one-off help they lend to the mover, twice a game.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "PahunchFavour")]
pub enum FavourKind {
    /// The mover also moves the blocker once, before or after the main move.
    ExtraBlock,
    /// A climb along the blocker's path takes the token under it anyway.
    CoveredToken,
    /// A climb takes another uncovered board token instead of its own.
    SwapToken,
    /// A climber the mover put into a 1-room climbs on, the same turn.
    ClimbAgain,
    /// One extra into a full room (not the top).
    SqueezeIn,
    /// Climbs and nudges along back paths, with no vote.
    BackStairs,
    /// A climb takes one more piece from the same room along.
    Carry,
}

impl FavourKind {
    pub const ALL: [Self; 7] = [
        Self::ExtraBlock,
        Self::CoveredToken,
        Self::SwapToken,
        Self::ClimbAgain,
        Self::SqueezeIn,
        Self::BackStairs,
        Self::Carry,
    ];
}

/// Uses a favour starts with, and the most it can hold.
pub const USES: u8 = 2;

/// The piece a [`FavourKind::Carry`] climb takes along.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "lowercase")]
#[ts(rename = "PahunchCarry")]
pub enum Carry {
    Seat { seat: Seat },
    Neutral,
}

impl Carry {
    /// Who the piece belongs to, as the rooms list it (`None` = a neutral).
    #[must_use]
    pub const fn who(self) -> Option<Seat> {
        match self {
            Self::Seat { seat } => Some(seat),
            Self::Neutral => None,
        }
    }
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

/// Extra moves the mover has from special coins this turn, after the main move.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "PahunchBonuses")]
pub struct Bonuses {
    /// Blocker moves left.
    pub block: u8,
    /// Neutral nudges left.
    pub nudge: u8,
    /// The room a climber of the mover's just reached, when a lent climb-again favour lets it
    /// climb on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub climb_again: Option<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Player {
    /// Climbers not yet on the board.
    pub hand: u8,
    /// Point tokens by value; hidden from the others until the end.
    pub tokens: Vec<u8>,
    /// Dealt at the start when favours are on; public.
    #[serde(default)]
    pub favour: Option<FavourKind>,
    /// Uses left of the favour.
    #[serde(default)]
    pub uses: u8,
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
    /// Favour parts of the climb, made once the vote passes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub swap: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub carry: Option<Carry>,
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
    /// The mover `p` asked `owner` for their favour.
    Request {
        p: Seat,
        owner: Seat,
    },
    /// `p` said no to the mover's request for their favour.
    Decline {
        p: Seat,
    },
    /// `user`, the mover, used `owner`'s favour.
    Favour {
        owner: Seat,
        user: Seat,
        kind: FavourKind,
    },
    /// The climb up `path` took `who`'s piece along (`null` = a neutral); it takes no token.
    Carry {
        p: Seat,
        who: Option<Seat>,
        path: u8,
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
    /// Strict: a room that voted the mover down holds no second vote that turn. Off, the mover
    /// may ask again. Games saved before this switch kept one vote per room.
    #[serde(default = "Options::strict_before")]
    pub one_vote_per_room: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            fail_ends_turn: false,
            favours: true,
            one_vote_per_room: false,
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
            one_vote_per_room: true,
        }
    }

    const fn strict_before() -> bool {
        true
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
    /// The mover made the main move; the turn stays for extra moves (bonuses or lent favours)
    /// until they end it.
    #[serde(default)]
    pub moved: bool,
    /// Favours on offer to the mover this turn, by owner.
    #[serde(default)]
    pub lent: Vec<Seat>,
    /// Favours the mover used this turn, by owner: not lent again until the turn passes.
    #[serde(default)]
    pub used: Vec<Seat>,
    /// Owners the mover asked for their favour this turn, who have not answered yet.
    #[serde(default)]
    pub asked: Vec<Seat>,
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
    /// One of your climbers up `path`. With lent favours: `swap` takes the token on that path
    /// instead, `carry` takes one more piece along.
    Climb {
        path: u8,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        swap: Option<u8>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        carry: Option<Carry>,
    },
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
    /// The mover ends the turn with extra moves left.
    Done,
    /// Offer your favour to the mover (`on`), or take back an unused offer. Any time, like a gift.
    /// It also answers yes to the mover's request for it.
    Lend { on: bool },
    /// The mover asks `owner` for their favour (`on`), or takes the request back.
    Request { owner: Seat, on: bool },
    /// Say no to the mover's request for your favour.
    Decline,
    /// Tokens (by value) to another player, at any time.
    Give { to: Seat, tokens: Vec<u8> },
    /// Any other `type`: answered with "Unknown move".
    #[serde(other)]
    #[ts(skip)]
    Unknown,
}

impl Action {
    /// A plain climb.
    #[must_use]
    pub const fn climb(path: u8) -> Self {
        Self::Climb {
            path,
            swap: None,
            carry: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "PahunchPlayer")]
pub struct PlayerView {
    pub hand: u8,
    /// `null` = hidden: own tokens always show; everyone's show at the end.
    pub tokens: Option<Vec<u8>>,
    pub favour: Option<FavourKind>,
    pub uses: u8,
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
    /// The mover made the main move and has extra moves left.
    pub moved: bool,
    /// Favours on offer to the mover, by owner.
    pub lent: Vec<Seat>,
    /// Favours the mover used this turn, by owner.
    pub used: Vec<Seat>,
    /// Owners the mover asked for their favour, who have not answered yet.
    pub asked: Vec<Seat>,
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
