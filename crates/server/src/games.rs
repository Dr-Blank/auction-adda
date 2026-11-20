//! The games this server hosts, behind one type each for a game's id, its state, its moves and its
//! views, so rooms never name a game.
//!
//! To add a game (its rules crate implements `game::Game`):
//! - a variant in `GameId`, `Match`, `AnyView` and `AnyAction`, and in `GameId::ALL`;
//! - an arm in `with_game!` and in `each!`, and the `From` impls for its state, view and move;
//! - arms in `Match::id`, `Match::unknown`, `Match::act` and `Match::undo_call`;
//! - its themes in `ThemeId` (and `ThemeId::ALL`), with `ThemeId::game` naming the game.
//!
//! The compiler points at every match that misses the new variant; the export test checks the
//! lists.

use game::{Game, RuleError, Seat};
use rand::Rng;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Which game a room plays. The theme decides it (`ThemeId::game`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum GameId {
    #[default]
    Auction,
    Pahunch,
}

/// A game in progress. Saved as the game's own state; the room's theme says which game it is.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Match {
    Auction(engine::GameState),
    Pahunch(pahunch::State),
}

/// One seat's view of a game, sent as the game's own view.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum AnyView {
    Auction(engine::View),
    Pahunch(pahunch::View),
}

/// A move of any game, as the client sends it. Read for the room's game (`GameId::action`);
/// the TypeScript type is the union of every game's moves.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum AnyAction {
    Auction(engine::Action),
    Pahunch(pahunch::Action),
}

/// Runs `$body` with `$G` as the game type of `$id` (a `GameId`).
macro_rules! with_game {
    ($id:expr, $G:ident => $body:expr) => {
        match $id {
            GameId::Auction => {
                type $G = engine::Auction;
                $body
            }
            GameId::Pahunch => {
                type $G = pahunch::Pahunch;
                $body
            }
        }
    };
}

/// Runs `$body` with `$s` bound to the state inside `$m` (a `Match`) and `$G` to its game type.
/// The body is the same for every game: it names no variant, it converts with `From`.
macro_rules! each {
    ($m:expr, $G:ident, $s:ident => $body:expr) => {
        match $m {
            Match::Auction($s) => {
                type $G = engine::Auction;
                $body
            }
            Match::Pahunch($s) => {
                type $G = pahunch::Pahunch;
                $body
            }
        }
    };
}

impl GameId {
    /// Every game, for checks that must hold for each.
    pub const ALL: [Self; 2] = [Self::Auction, Self::Pahunch];

    /// The setups an admin can pick from (boards…); empty = one setup.
    #[must_use]
    pub fn variants(self) -> Vec<String> {
        with_game!(self, G => G::variants())
    }

    /// # Errors
    /// When the variant does not exist or does not seat `n`.
    pub fn new_game_on(self, n: u8, seed: u32, variant: u8) -> Result<Match, RuleError> {
        with_game!(self, G => G::new_game_on(n, seed, variant).map(Match::from))
    }

    /// The switches an admin can set for this game.
    #[must_use]
    pub fn options(self) -> Vec<game::GameOption> {
        with_game!(self, G => G::options())
    }

    /// # Errors
    /// When the variant does not exist or does not seat `n`.
    pub fn new_game_with(self, n: u8, seed: u32, variant: u8, options: &game::Options) -> Result<Match, RuleError> {
        with_game!(self, G => G::new_game_with(n, seed, variant, options).map(Match::from))
    }

    #[must_use]
    pub fn min_players(self) -> u8 {
        with_game!(self, G => *G::players().start())
    }

    #[must_use]
    pub fn max_players(self) -> u8 {
        with_game!(self, G => *G::players().end())
    }

    #[must_use]
    pub fn cast_slots(self) -> u8 {
        with_game!(self, G => G::cast_slots())
    }

    /// # Errors
    /// When the game does not support `n` seats.
    pub fn new_game(self, n: u8, seed: u32) -> Result<Match, RuleError> {
        with_game!(self, G => G::new_game(n, seed).map(Match::from))
    }

    /// A saved game of this kind, from the room file.
    ///
    /// # Errors
    /// When the JSON is not a state of this game.
    pub fn load(self, state: serde_json::Value) -> serde_json::Result<Match> {
        with_game!(self, G => serde_json::from_value::<<G as Game>::State>(state).map(Match::from))
    }

    /// A move for this game, as the client sent it.
    ///
    /// # Errors
    /// When the JSON is not a move of this game.
    pub fn action(self, action: &serde_json::Value) -> serde_json::Result<AnyAction> {
        with_game!(self, G => <<G as Game>::Action as Deserialize>::deserialize(action).map(AnyAction::from))
    }
}

impl From<engine::GameState> for Match {
    fn from(s: engine::GameState) -> Self {
        Self::Auction(s)
    }
}

impl From<engine::Action> for AnyAction {
    fn from(a: engine::Action) -> Self {
        Self::Auction(a)
    }
}

impl From<engine::View> for AnyView {
    fn from(v: engine::View) -> Self {
        Self::Auction(v)
    }
}

impl From<pahunch::State> for Match {
    fn from(s: pahunch::State) -> Self {
        Self::Pahunch(s)
    }
}

impl From<pahunch::Action> for AnyAction {
    fn from(a: pahunch::Action) -> Self {
        Self::Pahunch(a)
    }
}

impl From<pahunch::View> for AnyView {
    fn from(v: pahunch::View) -> Self {
        Self::Pahunch(v)
    }
}

impl AnyAction {
    /// The move's `type` is not one of its game's (it parsed into the catch-all).
    #[must_use]
    pub fn unknown(&self) -> bool {
        match self {
            Self::Auction(a) => engine::Auction::unknown(a),
            Self::Pahunch(a) => pahunch::Pahunch::unknown(a),
        }
    }
}

impl AnyView {
    /// The view of an Auction Adda game; `None` for another game.
    #[must_use]
    pub fn into_auction(self) -> Option<engine::View> {
        match self {
            Self::Auction(v) => Some(v),
            Self::Pahunch(_) => None,
        }
    }

    /// The view of a Pahunch game; `None` for another game.
    #[must_use]
    pub fn into_pahunch(self) -> Option<pahunch::View> {
        match self {
            Self::Pahunch(v) => Some(v),
            Self::Auction(_) => None,
        }
    }
}

fn other_game<T>() -> Result<T, RuleError> {
    Err(RuleError::new("That move belongs to another game"))
}

impl Match {
    #[must_use]
    pub fn id(&self) -> GameId {
        match self {
            Self::Auction(_) => GameId::Auction,
            Self::Pahunch(_) => GameId::Pahunch,
        }
    }

    #[must_use]
    pub fn seats(&self) -> u8 {
        each!(self, G, s => G::seats(s))
    }

    #[must_use]
    pub fn round(&self) -> u8 {
        each!(self, G, s => G::round(s))
    }

    #[must_use]
    pub fn over(&self) -> bool {
        each!(self, G, s => G::over(s))
    }

    #[must_use]
    pub fn winners(&self) -> Vec<Seat> {
        each!(self, G, s => G::winners(s))
    }

    #[must_use]
    pub fn pending(&self) -> Vec<Seat> {
        each!(self, G, s => G::pending(s))
    }

    #[must_use]
    pub fn view(&self, seat: Option<Seat>) -> AnyView {
        each!(self, G, s => AnyView::from(G::view(s, seat)))
    }

    /// The move is one the game does not know (its `type` is not a move of this game).
    #[must_use]
    pub fn unknown(&self, action: &AnyAction) -> bool {
        #[allow(unreachable_patterns, clippy::match_wildcard_for_single_variants)]
        match (self, action) {
            (Self::Auction(_), AnyAction::Auction(a)) => engine::Auction::unknown(a),
            (Self::Pahunch(_), AnyAction::Pahunch(a)) => pahunch::Pahunch::unknown(a),
            _ => false,
        }
    }

    /// # Errors
    /// When the move breaks the rules or belongs to another game.
    pub fn act(&self, seat: Seat, action: &AnyAction) -> Result<Self, RuleError> {
        #[allow(unreachable_patterns, clippy::match_wildcard_for_single_variants)]
        match (self, action) {
            (Self::Auction(s), AnyAction::Auction(a)) => engine::Auction::act(s, seat, a).map(Self::Auction),
            (Self::Pahunch(s), AnyAction::Pahunch(a)) => pahunch::Pahunch::act(s, seat, a).map(Self::Pahunch),
            _ => other_game(),
        }
    }

    /// A bot's move for `seat`, and the game after it; `None` when the bot found none.
    ///
    /// # Errors
    /// When the bot's move breaks the rules.
    pub fn bot<R: Rng + ?Sized>(&self, seat: Seat, rng: &mut R) -> Option<(AnyAction, Result<Self, RuleError>)> {
        each!(self, G, s => {
            let action = G::bot(&G::view(s, Some(seat)), rng)?;
            let next = G::act(s, seat, &action).map(Self::from);
            Some((AnyAction::from(action), next))
        })
    }

    /// # Errors
    /// When the seat does not owe a move.
    pub fn skip(&self, seat: Seat) -> Result<Self, RuleError> {
        each!(self, G, s => G::skip(s, seat).map(Self::from))
    }

    /// # Errors
    /// When the game is over.
    pub fn end_early(&self, by: Seat) -> Result<Self, RuleError> {
        each!(self, G, s => G::end_early(s, by).map(Self::from))
    }

    /// # Errors
    /// When `to` is not an order of the seats or the game cannot reseat now.
    pub fn reseat(&self, to: &[Seat]) -> Result<Self, RuleError> {
        each!(self, G, s => G::reseat(s, to).map(Self::from))
    }

    /// # Errors
    /// When the game has no calls or the call breaks the rules.
    pub fn call(&self, by: Seat, winner: Option<Seat>, amount: u32) -> Result<Self, RuleError> {
        each!(self, G, s => G::call(s, by, winner, amount).map(Self::from))
    }

    /// Takes back a call; `self` is the state the call was applied to.
    ///
    /// # Errors
    /// When there is nothing to undo.
    pub fn undo_call(&self, after: &Self, by: Seat) -> Result<Self, RuleError> {
        #[allow(unreachable_patterns, clippy::match_wildcard_for_single_variants)]
        match (self, after) {
            (Self::Auction(before), Self::Auction(after)) => {
                engine::Auction::undo_call(before, after, by).map(Self::Auction)
            }
            (Self::Pahunch(before), Self::Pahunch(after)) => {
                pahunch::Pahunch::undo_call(before, after, by).map(Self::Pahunch)
            }
            _ => other_game(),
        }
    }

    #[must_use]
    pub fn clock(&self) -> Option<(usize, usize)> {
        each!(self, G, s => G::clock(s))
    }

    /// # Errors
    /// When no clock runs.
    pub fn time_up(&self) -> Result<Self, RuleError> {
        each!(self, G, s => G::time_up(s).map(Self::from))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A move parses for the game it belongs to; the TypeScript union and the parser agree.
    #[test]
    fn moves_parse_for_their_game() {
        let pass = serde_json::json!({ "type": "pass" });
        assert_eq!(
            GameId::Auction.action(&pass).ok(),
            Some(AnyAction::Auction(engine::Action::Pass))
        );
        assert!(GameId::Auction.action(&serde_json::json!({ "type": "bid" })).is_err());
        let climb = serde_json::json!({ "type": "climb", "path": 3 });
        assert_eq!(
            GameId::Pahunch.action(&climb).ok(),
            Some(AnyAction::Pahunch(pahunch::Action::Climb { path: 3 }))
        );
        // Another game's move is not one of this game's.
        assert_eq!(
            GameId::Pahunch.action(&pass).ok(),
            Some(AnyAction::Pahunch(pahunch::Action::Unknown))
        );
    }
}
