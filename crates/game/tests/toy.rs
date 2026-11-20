//! The smallest game the server could host, as a template for a new one, and a check that
//! `game::check` catches a game that breaks the rules.
//!
//! Counting race: seats take turns adding 1 or 2 to a shared count; whoever brings it to `GOAL`
//! wins. No hidden information, so the view is the state.

#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

use std::ops::RangeInclusive;

use game::{Game, RuleError, Seat, check, permuted};
use rand::{Rng, RngExt};
use serde::{Deserialize, Serialize};

const GOAL: u32 = 21;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Race {
    n: u8,
    turn: Seat,
    count: u32,
    /// Additions per seat, so reseating has something to move.
    added: Vec<u32>,
    winners: Vec<Seat>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Move {
    Add { by: u32 },
}

struct Counting;

impl Game for Counting {
    type State = Race;
    type Action = Move;
    type View = Race;

    fn players() -> RangeInclusive<u8> {
        2..=6
    }

    fn cast_slots() -> u8 {
        0
    }

    fn new_game(n: u8, seed: u32) -> Result<Race, RuleError> {
        if !Self::players().contains(&n) {
            return Err(RuleError::new(format!("Cannot play with {n} players")));
        }
        let turn = u8::try_from(game::index(game::rng(seed)(), n.into())).unwrap();
        Ok(Race {
            n,
            turn,
            count: 0,
            added: vec![0; n.into()],
            winners: Vec::new(),
        })
    }

    fn seats(s: &Race) -> u8 {
        s.n
    }

    fn round(_: &Race) -> u8 {
        0
    }

    fn over(s: &Race) -> bool {
        !s.winners.is_empty()
    }

    fn winners(s: &Race) -> Vec<Seat> {
        s.winners.clone()
    }

    fn pending(s: &Race) -> Vec<Seat> {
        if Self::over(s) { Vec::new() } else { vec![s.turn] }
    }

    fn act(s: &Race, seat: Seat, action: &Move) -> Result<Race, RuleError> {
        if Self::over(s) {
            return Err(RuleError::new("The game is over"));
        }
        if seat != s.turn {
            return Err(RuleError::new("It is not your turn"));
        }
        let Move::Add { by } = *action;
        if !(1..=2).contains(&by) {
            return Err(RuleError::new("Add 1 or 2"));
        }
        let mut s = s.clone();
        s.count = (s.count + by).min(GOAL);
        s.added[usize::from(seat)] += by;
        if s.count == GOAL {
            s.winners = vec![seat];
        } else {
            s.turn = (s.turn + 1) % s.n;
        }
        Ok(s)
    }

    fn skip(s: &Race, seat: Seat) -> Result<Race, RuleError> {
        if !Self::pending(s).contains(&seat) {
            return Err(RuleError::new("That player does not owe a move"));
        }
        let mut s = s.clone();
        s.turn = (s.turn + 1) % s.n;
        Ok(s)
    }

    fn end_early(s: &Race, _by: Seat) -> Result<Race, RuleError> {
        if Self::over(s) {
            return Err(RuleError::new("The game is over"));
        }
        let mut s = s.clone();
        let best = s.added.iter().copied().max().unwrap_or(0);
        s.winners = (0..s.n).filter(|&i| s.added[usize::from(i)] == best).collect();
        Ok(s)
    }

    fn reseat(s: &Race, to: &[Seat]) -> Result<Race, RuleError> {
        let mut sorted = to.to_vec();
        sorted.sort_unstable();
        if !sorted.iter().copied().eq(0..s.n) {
            return Err(RuleError::new("Not an order of the seats"));
        }
        let mut s = s.clone();
        s.added = permuted(&s.added, to);
        s.turn = to[usize::from(s.turn)];
        s.winners = s.winners.iter().map(|&w| to[usize::from(w)]).collect();
        s.winners.sort_unstable();
        Ok(s)
    }

    fn view(s: &Race, _seat: Option<Seat>) -> Race {
        s.clone()
    }

    fn bot<R: Rng + ?Sized>(v: &Race, rng: &mut R) -> Option<Move> {
        (!Self::over(v)).then(|| Move::Add {
            by: rng.random_range(1..=2),
        })
    }
}

#[test]
fn a_game_that_keeps_the_rules_passes() {
    assert_eq!(check::random_games::<Counting>(10), Ok(()));
}

/// Takes a skip from any seat: absent players' moves would come from the wrong seats.
struct SkipsAnyone;

impl Game for SkipsAnyone {
    type State = Race;
    type Action = Move;
    type View = Race;

    fn players() -> RangeInclusive<u8> {
        Counting::players()
    }
    fn cast_slots() -> u8 {
        0
    }
    fn new_game(n: u8, seed: u32) -> Result<Race, RuleError> {
        Counting::new_game(n, seed)
    }
    fn seats(s: &Race) -> u8 {
        s.n
    }
    fn round(_: &Race) -> u8 {
        0
    }
    fn over(s: &Race) -> bool {
        Counting::over(s)
    }
    fn winners(s: &Race) -> Vec<Seat> {
        Counting::winners(s)
    }
    fn pending(s: &Race) -> Vec<Seat> {
        Counting::pending(s)
    }
    fn act(s: &Race, seat: Seat, a: &Move) -> Result<Race, RuleError> {
        Counting::act(s, seat, a)
    }
    fn skip(s: &Race, _seat: Seat) -> Result<Race, RuleError> {
        let mut s = s.clone();
        s.turn = (s.turn + 1) % s.n;
        Ok(s)
    }
    fn end_early(s: &Race, by: Seat) -> Result<Race, RuleError> {
        Counting::end_early(s, by)
    }
    fn reseat(s: &Race, to: &[Seat]) -> Result<Race, RuleError> {
        Counting::reseat(s, to)
    }
    fn view(s: &Race, seat: Option<Seat>) -> Race {
        Counting::view(s, seat)
    }
    fn bot<R: Rng + ?Sized>(v: &Race, rng: &mut R) -> Option<Move> {
        Counting::bot(v, rng)
    }
}

#[test]
fn a_game_that_breaks_a_rule_fails_with_where() {
    let e = check::random_games::<SkipsAnyone>(3).unwrap_err();
    assert!(e.contains("could be skipped without owing a move"), "{e}");
    assert!(e.contains("seats, variant 0, game 0"), "{e}");
}
