//! Game state, moves and views. Every type here is part of the wire protocol or the save file;
//! the TypeScript client gets them from `src/generated/` (written by the `export` test).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Seat index, 0-based.
pub type Seat = u8;
/// Money and prices.
pub type Money = u32;

/// Declaration order is the order cards sort in within a suit.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum AuctionType {
    Open,
    Once,
    Sealed,
    Fixed,
    Double,
}

/// Auction types that actually sell a lot (a double takes the type of its second card).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum SellType {
    Open,
    Once,
    Sealed,
    Fixed,
}

/// What a running auction is: a sale, or `offer` = a double card is on the table and players are
/// asked for a second card.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum AuctionKind {
    Open,
    Once,
    Sealed,
    Fixed,
    Offer,
}

impl AuctionType {
    /// The sale this card starts on its own; `None` for a double.
    #[must_use]
    pub fn sell_type(self) -> Option<SellType> {
        match self {
            Self::Open => Some(SellType::Open),
            Self::Once => Some(SellType::Once),
            Self::Sealed => Some(SellType::Sealed),
            Self::Fixed => Some(SellType::Fixed),
            Self::Double => None,
        }
    }
}

impl From<SellType> for AuctionKind {
    fn from(t: SellType) -> Self {
        match t {
            SellType::Open => Self::Open,
            SellType::Once => Self::Once,
            SellType::Sealed => Self::Sealed,
            SellType::Fixed => Self::Fixed,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Card {
    /// Unique 0–69.
    pub id: u8,
    pub suit: u8,
    /// Index of the card within its suit (stable, used by themes to pick art).
    pub n: u8,
    #[serde(rename = "type")]
    pub kind: AuctionType,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Player {
    pub hand: Vec<Card>,
    pub money: Money,
    /// Cards bought in the current round.
    pub bought: Vec<Card>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Auction {
    pub kind: AuctionKind,
    pub cards: Vec<Card>,
    /// Receives the payment. During an offer this is the player who played the double card.
    pub auctioneer: Seat,
    pub high: Money,
    pub high_bidder: Option<Seat>,
    /// Open auction: who has said they are done at the current high bid.
    pub done: Vec<bool>,
    /// Once-around, fixed-price and offer: how many players have had their turn.
    pub step: u8,
    /// Once-around, fixed-price (after the price is set) and offer: the seat that must act now.
    pub to_act: Option<Seat>,
    /// Sealed auction.
    pub bids: Vec<Option<Money>>,
    /// Fixed-price auction.
    pub price: Option<Money>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum LogEntry {
    Round {
        round: u8,
        first: Seat,
    },
    Play {
        p: Seat,
        cards: Vec<Card>,
        kind: SellType,
    },
    Offer {
        p: Seat,
        cards: Vec<Card>,
    },
    Bid {
        p: Seat,
        amount: Money,
    },
    Pass {
        p: Seat,
    },
    Decline {
        p: Seat,
    },
    Price {
        p: Seat,
        amount: Money,
    },
    Sealed {
        bids: Vec<Money>,
    },
    /// `by`: set when the room admin called the result (voice bidding) instead of the auction
    /// running its course.
    Sold {
        to: Seat,
        from: Seat,
        price: Money,
        cards: Vec<Card>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        by: Option<Seat>,
    },
    Free {
        p: Seat,
        cards: Vec<Card>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        by: Option<Seat>,
    },
    Shelved {
        p: Seat,
        cards: Vec<Card>,
        suit: u8,
    },
    /// The admin took back the result they called for `cards`; the auction is running again.
    Undo {
        by: Seat,
        cards: Vec<Card>,
    },
    Skip {
        p: Seat,
    },
    Score {
        round: u8,
    },
    End {
        winners: Vec<Seat>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RoundSummary {
    pub round: u8,
    /// Cards played per suit this round.
    pub counts: Vec<u8>,
    /// Suits that received the 30 / 20 / 10 tokens, best first.
    pub ranked: Vec<u8>,
    /// Value of one card of each suit this round (0 when the suit did not rank).
    pub values: Vec<Money>,
    /// Cards each player sold to the bank.
    pub sold: Vec<Vec<Card>>,
    pub payouts: Vec<Money>,
    /// Every lot that changed hands this round, in order. Missing in summaries saved before it
    /// existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sales: Option<Vec<Sale>>,
}

/// One lot bought in a round. `from` = the auctioneer, paid unless it is the buyer (then the bank
/// was paid). Price 0 = taken free.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Sale {
    pub to: Seat,
    pub from: Seat,
    pub price: Money,
    pub cards: Vec<Card>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct GameState {
    pub n: u8,
    pub players: Vec<Player>,
    pub deck: Vec<Card>,
    /// 0–3 while playing, 4 when over.
    pub round: u8,
    /// Seat that must play a card when no auction is running.
    pub turn: Seat,
    /// Cards played per suit in the current round.
    pub played: Vec<u8>,
    /// `tokens[round][suit]` = 30 / 20 / 10 / 0.
    pub tokens: Vec<Vec<Money>>,
    pub auction: Option<Auction>,
    pub log: Vec<LogEntry>,
    pub summaries: Vec<RoundSummary>,
    pub over: bool,
    pub winners: Vec<Seat>,
    pub seed: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum Action {
    Play {
        card: u8,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        second: Option<u8>,
    },
    Bid {
        amount: Money,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        seen_high: Option<Money>,
    },
    Done {
        seen_high: Money,
    },
    Pass,
    Sealed {
        amount: Money,
    },
    Price {
        amount: Money,
    },
    Accept,
    Add {
        card: u8,
    },
    Decline,
    /// Any other `type`: answered with "Unknown move".
    #[serde(other)]
    #[ts(skip)]
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AuctionView {
    pub kind: AuctionKind,
    pub cards: Vec<Card>,
    pub auctioneer: Seat,
    pub high: Money,
    pub high_bidder: Option<Seat>,
    pub done: Vec<bool>,
    pub to_act: Option<Seat>,
    pub price: Option<Money>,
    /// Sealed: who has submitted. Amounts stay hidden until the reveal.
    pub bids_in: Vec<bool>,
    /// Sealed: the viewer's own bid.
    pub your_bid: Option<Money>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PlayerView {
    pub hand_count: u8,
    /// `null` = hidden. Own money is always visible; everyone's is revealed at game end.
    pub money: Option<Money>,
    pub bought: Vec<Card>,
}

/// What one seat (or a spectator, `you: null`) is allowed to know.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub n: u8,
    pub you: Option<Seat>,
    pub round: u8,
    pub turn: Seat,
    pub played: Vec<u8>,
    pub tokens: Vec<Vec<Money>>,
    pub players: Vec<PlayerView>,
    pub hand: Vec<Card>,
    pub auction: Option<AuctionView>,
    /// Seats that owe an action right now.
    pub pending: Vec<Seat>,
    pub log: Vec<LogEntry>,
    /// Position of `log[0]` in the full log (the view carries only the latest entries).
    pub log_start: u32,
    pub summaries: Vec<RoundSummary>,
    pub over: bool,
    pub winners: Vec<Seat>,
    pub deck_count: u8,
}

/// A move that breaks the rules. The message goes back to the player as it is.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct RuleError(pub String);

impl RuleError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}
