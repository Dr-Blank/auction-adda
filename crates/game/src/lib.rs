//! What every game on the table shares. A game is a crate of pure rules (no I/O, no async, no
//! clock) that implements [`Game`]; the server keeps the rooms, seats, bots and clocks for any of
//! them, and [`check`] tests any of them against the rules every game must keep.

pub mod check;
mod random;

use std::collections::BTreeMap;
use std::fmt::Debug;
use std::ops::RangeInclusive;

use rand::Rng;
use serde::Serialize;
use serde::de::DeserializeOwned;

pub use random::{index, rng, shuffle};

/// Seat index, 0-based, in clockwise order.
pub type Seat = u8;

/// A move that breaks the rules. The message goes back to the player as it is.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct RuleError(pub String);

impl RuleError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

/// A switch the admin can set before a game (a house rule, an expansion). The room keeps the
/// admin's choices by `id`; a missing one takes `default`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct GameOption {
    pub id: &'static str,
    pub label: &'static str,
    pub default: bool,
}

/// The admin's choices, by option id.
pub type Options = BTreeMap<String, bool>;

/// The value of option `id` among `options`: the admin's choice, else its default.
#[must_use]
pub fn option(all: &[GameOption], options: &Options, id: &str) -> bool {
    options
        .get(id)
        .copied()
        .unwrap_or_else(|| all.iter().find(|o| o.id == id).is_some_and(|o| o.default))
}

/// `items` (one per seat) in a new seat order: the item of seat `i` goes to `to[i]`.
#[must_use]
pub fn permuted<T: Clone>(items: &[T], to: &[Seat]) -> Vec<T> {
    let mut placed: Vec<(Seat, T)> = to.iter().copied().zip(items.iter().cloned()).collect();
    placed.sort_by_key(|&(t, _)| t);
    placed.into_iter().map(|(_, x)| x).collect()
}

/// The rules of one game, as the server drives them. Every function takes a state and returns a
/// new one, so a refused move never leaves a half-changed game. The state is what the room file
/// keeps; the view is what one seat (or a spectator) may see, and the only part that goes to a
/// browser.
///
/// The server never looks inside a state: it asks who owes a move ([`pending`](Game::pending)),
/// applies moves, makes moves for bots and absent players, and shows each seat its view. The
/// `call`, `clock` and `time_up` functions are for games that have those features; their
/// defaults say the game has none.
pub trait Game {
    /// Everything about one game in progress. Saved in the room file as JSON, so a change to it
    /// must still read the files written before.
    type State: Clone + Debug + PartialEq + Serialize + DeserializeOwned + Send + Sync + 'static;
    /// One move by one seat, as the browser sends it: a JSON object with a `type`.
    type Action: Clone + Debug + PartialEq + Serialize + DeserializeOwned + Send + 'static;
    /// What one seat may know. Never put a hidden fact in it for the wrong seat.
    type View: Clone + Debug + PartialEq + Serialize + Send + 'static;

    /// The seat counts the game supports.
    fn players() -> RangeInclusive<u8>;

    /// How many genres an admin picks for the cast (one per suit, species…); 0 = no picks.
    fn cast_slots() -> u8;

    /// A new game for `n` seats, dealt from `seed`, on the default variant.
    ///
    /// # Errors
    /// When the game does not support `n` seats.
    fn new_game(n: u8, seed: u32) -> Result<Self::State, RuleError>;

    /// Names of the setups an admin can pick from (boards, decks…), the default first. Empty (the
    /// default) = the game has one setup.
    #[must_use]
    fn variants() -> Vec<String> {
        Vec::new()
    }

    /// A new game on `variant`, an index into [`variants`](Game::variants).
    ///
    /// # Errors
    /// When the variant does not exist or does not seat `n`.
    fn new_game_on(n: u8, seed: u32, variant: u8) -> Result<Self::State, RuleError> {
        if variant == 0 {
            Self::new_game(n, seed)
        } else {
            Err(RuleError::new("No such setup"))
        }
    }

    /// The switches an admin can set for this game; empty (the default) = none.
    #[must_use]
    fn options() -> Vec<GameOption> {
        Vec::new()
    }

    /// A new game on `variant` with the admin's `options` (missing ones take their default).
    ///
    /// # Errors
    /// As [`new_game_on`](Game::new_game_on).
    fn new_game_with(n: u8, seed: u32, variant: u8, _options: &Options) -> Result<Self::State, RuleError> {
        Self::new_game_on(n, seed, variant)
    }

    /// How many seats the game was dealt for.
    fn seats(s: &Self::State) -> u8;

    /// The round being played, from 0; games without rounds stay at 0. A new round can reseat
    /// the players when the room wants that.
    fn round(s: &Self::State) -> u8;

    fn over(s: &Self::State) -> bool;

    /// The seats that won; empty until the game is over. A game the admin ended early may have
    /// none (then the client shows no podium).
    fn winners(s: &Self::State) -> Vec<Seat>;

    /// A game that can finish on its own with nobody winning (not only when the admin ends it).
    #[must_use]
    fn may_end_without_winner() -> bool {
        false
    }

    /// Seats that owe a move right now. Empty once the game is over.
    fn pending(s: &Self::State) -> Vec<Seat>;

    /// Applies one move for a seat.
    ///
    /// # Errors
    /// When the move breaks the rules; the message says which.
    fn act(s: &Self::State, seat: Seat, action: &Self::Action) -> Result<Self::State, RuleError>;

    /// A move type this game does not have, which parsed into a catch-all variant. The server
    /// answers it with "Unknown move" before anything else.
    fn unknown(_action: &Self::Action) -> bool {
        false
    }

    /// The neutral move for a seat that owes one and is not here (pass, decline…). Must never
    /// tell the table something only that seat knows.
    ///
    /// # Errors
    /// When the seat does not owe a move.
    fn skip(s: &Self::State, seat: Seat) -> Result<Self::State, RuleError>;

    /// The admin ends the game now; the standings as they are decide, or nobody wins.
    ///
    /// # Errors
    /// When the game is already over.
    fn end_early(s: &Self::State, by: Seat) -> Result<Self::State, RuleError>;

    /// Moves every player to a new seat, `to[old] = new`, with everything that names a seat
    /// following them. May refuse at moments when the order round the table matters.
    ///
    /// # Errors
    /// When `to` is not an order of the seats, or the game cannot reseat now.
    fn reseat(s: &Self::State, to: &[Seat]) -> Result<Self::State, RuleError>;

    /// What `seat` may see; `None` = a spectator.
    fn view(s: &Self::State, seat: Option<Seat>) -> Self::View;

    /// A legal move for the viewer of `v`, picked at random; `None` when it owes none. Bots stand
    /// in for missing players; they see only their own view, like any player.
    fn bot<R: Rng + ?Sized>(v: &Self::View, rng: &mut R) -> Option<Self::Action>;

    /// Ends what is running with a result the admin called (for tables that play by voice):
    /// `winner` `None` = nobody. Only some games have calls.
    ///
    /// # Errors
    /// When the game has no calls, or this one breaks the rules.
    fn call(_s: &Self::State, _by: Seat, _winner: Option<Seat>, _amount: u32) -> Result<Self::State, RuleError> {
        Err(RuleError::new("This game has no calls"))
    }

    /// Takes back a call: `before` is the state the call was applied to, `after` the state it
    /// made. The server checks that nothing happened since.
    ///
    /// # Errors
    /// When there is nothing to undo.
    fn undo_call(_before: &Self::State, _after: &Self::State, _by: Seat) -> Result<Self::State, RuleError> {
        Err(RuleError::new("Nothing to undo"))
    }

    /// The running clock, if the game has one now: two marks the server watches (usually log
    /// positions). A new first mark starts the clock afresh; a new second mark tops it up.
    fn clock(_s: &Self::State) -> Option<(usize, usize)> {
        None
    }

    /// The clock ran out: what happens then.
    ///
    /// # Errors
    /// When the game has no clock running.
    fn time_up(_s: &Self::State) -> Result<Self::State, RuleError> {
        Err(RuleError::new("No clock is running"))
    }
}
