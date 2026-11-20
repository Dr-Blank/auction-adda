//! What every game must keep true, checked by playing it at random. A game's own tests call
//! these with its type:
//!
//! ```ignore
//! assert_eq!(game::check::random_games::<engine::Auction>(20), Ok(()));
//! ```
//!
//! A failure names the seat count, the game number and the step, so it can be replayed.

use rand::rngs::StdRng;
use rand::seq::IndexedRandom;
use rand::{RngExt, SeedableRng};

use crate::{Game, Seat};

/// Steps after which a game counts as never ending.
const MAX_STEPS: usize = 100_000;

/// Plays `games` games for every supported seat count. Each step a random seat that owes a move
/// makes its bot's move (now and then it is skipped instead), and every few steps the state is
/// checked: it survives the room file, every seat's view serializes, reseating and ending early
/// behave. Fails on the first broken rule.
///
/// # Errors
/// What broke, and where.
pub fn random_games<G: Game>(games: u32) -> Result<(), String> {
    let players = G::players();
    if players.is_empty() {
        return Err("the game supports no seat count".into());
    }
    for n in [players.start().saturating_sub(1), players.end().saturating_add(1)] {
        if !players.contains(&n) && n > 0 && G::new_game(n, 1).is_ok() {
            return Err(format!("a game for {n} seats started, outside {players:?}"));
        }
    }
    for n in players {
        for k in 0..games {
            let seed = k.wrapping_mul(2_654_435_761).wrapping_add(u32::from(n));
            play::<G>(n, seed).map_err(|e| format!("{n} seats, game {k} (seed {seed}): {e}"))?;
        }
    }
    Ok(())
}

fn play<G: Game>(n: u8, seed: u32) -> Result<(), String> {
    let mut rng = StdRng::seed_from_u64(u64::from(seed));
    let mut s = G::new_game(n, seed).map_err(|e| format!("new game: {e}"))?;
    if G::new_game(n, seed).ok().as_ref() != Some(&s) {
        return Err("the same seed dealt two different games".into());
    }
    if G::seats(&s) != n {
        return Err(format!("dealt for {} seats", G::seats(&s)));
    }
    for step in 0..MAX_STEPS {
        let at = |e: String| format!("step {step}: {e}");
        if step % 7 == 0 {
            every_state::<G>(&s, &mut rng).map_err(at)?;
        }
        if G::over(&s) {
            return finished::<G>(&s).map_err(at);
        }
        let pending = G::pending(&s);
        let Some(&seat) = pending.choose(&mut rng) else {
            return Err(at("nobody owes a move in a running game".into()));
        };
        if seat >= n {
            return Err(at(format!("seat {seat} owes a move")));
        }
        s = if rng.random_bool(0.05) {
            G::skip(&s, seat).map_err(|e| at(format!("skipping seat {seat}: {e}")))?
        } else {
            let Some(action) = G::bot(&G::view(&s, Some(seat)), &mut rng) else {
                return Err(at(format!("the bot of seat {seat} found no move")));
            };
            G::act(&s, seat, &action).map_err(|e| at(format!("seat {seat} played {action:?}: {e}")))?
        };
        let late = G::pending(&s);
        if let Some(other) = (0..n).find(|i| !late.contains(i))
            && G::skip(&s, other).is_ok()
        {
            return Err(at(format!("seat {other} could be skipped without owing a move")));
        }
    }
    Err(format!("not over after {MAX_STEPS} steps"))
}

/// Checks that hold at any moment of a running or finished game.
fn every_state<G: Game>(s: &G::State, rng: &mut StdRng) -> Result<(), String> {
    let json = serde_json::to_string(s).map_err(|e| format!("saving the state: {e}"))?;
    let back: G::State = serde_json::from_str(&json).map_err(|e| format!("reading the saved state: {e}"))?;
    if back != *s {
        return Err("the state changed on its way through the room file".into());
    }
    let n = G::seats(s);
    for seat in (0..n).map(Some).chain([None]) {
        serde_json::to_string(&G::view(s, seat)).map_err(|e| format!("the view of {seat:?}: {e}"))?;
    }

    let same: Vec<Seat> = (0..n).collect();
    if let Ok(t) = G::reseat(s, &same)
        && t != *s
    {
        return Err("reseating everyone where they sit changed the game".into());
    }
    let mut to = same.clone();
    to.reverse();
    to.rotate_left(rng.random_range(0..usize::from(n)));
    if let Ok(t) = G::reseat(s, &to) {
        let mut back_to = vec![0; usize::from(n)];
        for (old, &new) in to.iter().enumerate() {
            if let (Some(slot), Ok(old)) = (back_to.get_mut(usize::from(new)), Seat::try_from(old)) {
                *slot = old;
            }
        }
        if G::reseat(&t, &back_to).ok().as_ref() != Some(s) {
            return Err(format!("reseating by {to:?} and back did not give the game back"));
        }
    }
    if n > 1 && G::reseat(s, &vec![0; usize::from(n)]).is_ok() {
        return Err("reseated by an order that is not one".into());
    }

    if !G::over(s) {
        let ended = G::end_early(s, 0).map_err(|e| format!("ending early: {e}"))?;
        if !G::over(&ended) || G::winners(&ended).is_empty() {
            return Err("ending early did not finish the game with winners".into());
        }
    }
    Ok(())
}

/// Checks for a finished game.
fn finished<G: Game>(s: &G::State) -> Result<(), String> {
    let n = G::seats(s);
    if !G::pending(s).is_empty() {
        return Err("a finished game still waits for a move".into());
    }
    let winners = G::winners(s);
    if winners.is_empty() || winners.iter().any(|&w| w >= n) {
        return Err(format!("winners {winners:?} of {n} seats"));
    }
    if G::end_early(s, 0).is_ok() {
        return Err("a finished game ended again".into());
    }
    if (0..n).any(|seat| G::skip(s, seat).is_ok()) {
        return Err("a finished game took a skip".into());
    }
    Ok(())
}
