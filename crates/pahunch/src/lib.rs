//! Pahunch: climb a board of committees to the top room, one vote at a time. No I/O, no async, no
//! clock. [`Pahunch`] is the game as the server hosts it; the boards are data (`boards.json`).

mod board;
mod bot;
mod rules;
mod types;
mod view;

use std::ops::RangeInclusive;

use game::Game;
use rand::Rng;

pub use board::{Board, Layout, PathDef, RoomDef, Rooms, Seating, boards};
pub use bot::choose_action;
pub use rules::{apply_action, apply_skip, end_early, new_game, pending, reseat, score};
pub use types::*;
pub use view::view_for;

pub struct Pahunch;

impl Game for Pahunch {
    type State = State;
    type Action = Action;
    type View = View;

    /// The seat counts of the default board; every board seats the same (the boards test).
    fn players() -> RangeInclusive<u8> {
        let seats = boards().first().map(|b| &b.players);
        let min = seats.and_then(|p| p.keys().next().copied()).unwrap_or(0);
        let max = seats.and_then(|p| p.keys().next_back().copied()).unwrap_or(0);
        min..=max
    }

    fn cast_slots() -> u8 {
        0
    }

    fn variants() -> Vec<String> {
        boards().iter().map(|b| b.name.clone()).collect()
    }

    fn new_game(n: u8, seed: u32) -> Result<State, RuleError> {
        new_game(n, seed, 0)
    }

    fn new_game_on(n: u8, seed: u32, variant: u8) -> Result<State, RuleError> {
        new_game(n, seed, variant)
    }

    fn seats(s: &State) -> u8 {
        s.n
    }

    fn round(_: &State) -> u8 {
        0
    }

    fn over(s: &State) -> bool {
        s.over
    }

    fn winners(s: &State) -> Vec<Seat> {
        s.winners.clone()
    }

    fn pending(s: &State) -> Vec<Seat> {
        pending(s)
    }

    fn act(s: &State, seat: Seat, action: &Action) -> Result<State, RuleError> {
        apply_action(s, seat, action)
    }

    fn unknown(action: &Action) -> bool {
        *action == Action::Unknown
    }

    fn skip(s: &State, seat: Seat) -> Result<State, RuleError> {
        apply_skip(s, seat)
    }

    fn end_early(s: &State, by: Seat) -> Result<State, RuleError> {
        end_early(s, by)
    }

    fn reseat(s: &State, to: &[Seat]) -> Result<State, RuleError> {
        reseat(s, to)
    }

    fn view(s: &State, seat: Option<Seat>) -> View {
        view_for(s, seat)
    }

    fn bot<R: Rng + ?Sized>(v: &View, rng: &mut R) -> Option<Action> {
        choose_action(v, rng)
    }

    fn clock(s: &State) -> Option<(usize, usize)> {
        rules::clock(s)
    }

    fn time_up(s: &State) -> Result<State, RuleError> {
        rules::time_up(s)
    }
}
