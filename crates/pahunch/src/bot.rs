//! Random legal moves, for bot seats and for absent players the admin skips. A bot sees only its
//! own seat's view. It never gives tokens away, offers its favour unasked or asks for one; asked,
//! it says yes or no at random. Favours lent to it work where they apply by themselves (an open
//! back path, a full room, a covered token).

use rand::seq::IndexedRandom;
use rand::{Rng, RngExt};

use crate::rules::{
    Ask, Board, Climb, can_bribe, check_block, check_climb, check_enter, check_nudge, count, offered, refused_rooms,
    voters_left,
};
use crate::types::{Action, FavourKind, Seat, View, Vote};

/// The move for the viewer of `v`, or `None` when it owes none.
pub fn choose_action<R: Rng + ?Sized>(v: &View, rng: &mut R) -> Option<Action> {
    let me = v.you?;
    if v.over || !v.pending.contains(&me) {
        return None;
    }
    if v.asked.contains(&me) {
        return Some(if rng.random_bool(0.5) {
            Action::Lend { on: true }
        } else {
            Action::Decline
        });
    }
    let tokens = v.players.get(usize::from(me))?.tokens.clone().unwrap_or_default();

    if let Some(vote) = &v.vote {
        return Some(in_vote(v, vote, me, &tokens, rng));
    }

    let paths = || 0..u8::try_from(v.layout.paths.len()).unwrap_or(0);
    let pick = |xs: &[u8], rng: &mut R| xs.choose(rng).copied();
    // A favour is only put on offer with a use left, so a hidden count on one is at least 1.
    let lent = offered(&v.lent, |o| {
        v.players
            .get(usize::from(o))
            .and_then(|p| p.favour.map(|k| (k, p.uses.unwrap_or(1))))
    });
    let board = Board {
        layout: &v.layout,
        rooms: &v.rooms,
        tokens_on: &v.tokens_on,
        blocker: v.blocker,
        tried: refused_rooms(v.options, &v.tried),
        lent: &lent,
    };
    let plain = |path| Ask {
        path,
        swap: None,
        carry: None,
    };
    let climbs: Vec<(u8, Climb)> = paths()
        .filter_map(|p| Some((p, check_climb(&board, me, &tokens, plain(p)).ok()?)))
        .collect();
    let nudges: Vec<u8> = paths()
        .filter(|&p| check_nudge(&v.layout, &v.rooms, p, &lent).is_ok())
        .collect();
    let blocks: Vec<u8> = paths()
        .filter(|&p| check_block(&v.layout, v.blocker, p).is_ok())
        .collect();

    // Extra moves: mostly end the turn, now and then use one.
    if v.moved {
        let has = |k| lent.contains(&k);
        let again: Vec<u8> = match v.bonuses.climb_again {
            Some(room) if has(FavourKind::ClimbAgain) => climbs
                .iter()
                .filter(|(p, c)| !matches!(c, Climb::Ask { .. }) && v.layout.path(*p).is_some_and(|d| d.from == room))
                .map(|&(p, _)| p)
                .collect(),
            _ => Vec::new(),
        };
        let block = v.bonuses.block > 0 || has(FavourKind::ExtraBlock);
        let action = match rng.random_range(0..10) {
            0..3 if v.bonuses.nudge > 0 => pick(&nudges, rng).map(|path| Action::Nudge { path }),
            3..5 if block => pick(&blocks, rng).map(|path| Action::Block { path }),
            5..8 => pick(&again, rng).map(Action::climb),
            _ => None,
        };
        return Some(action.unwrap_or(Action::Done));
    }

    let rooms = 0..u8::try_from(v.layout.rooms.len()).unwrap_or(0);
    let hand = v.players.get(usize::from(me))?.hand;
    let enters: Vec<u8> = rooms
        .filter(|&r| check_enter(&v.layout, &v.rooms, hand, r, &lent).is_ok())
        .collect();

    // Climbs that need no vote first, then any climb; new climbers; now and then something else.
    let roll = rng.random_range(0..100);
    let free: Vec<u8> = climbs
        .iter()
        .filter(|(_, c)| !matches!(c, Climb::Ask { .. }))
        .map(|&(p, _)| p)
        .collect();
    let any: Vec<u8> = climbs.iter().map(|&(p, _)| p).collect();
    let action = match roll {
        0..30 => pick(&free, rng).map(Action::climb),
        30..60 => pick(&any, rng).map(Action::climb),
        60..90 => pick(&enters, rng).map(|room| Action::Enter { room }),
        90..96 => pick(&nudges, rng).map(|path| Action::Nudge { path }),
        _ => None,
    };
    action
        .or_else(|| pick(&any, rng).map(Action::climb))
        .or_else(|| pick(&enters, rng).map(|room| Action::Enter { room }))
        .or_else(|| pick(&nudges, rng).map(|path| Action::Nudge { path }))
        .or_else(|| pick(&blocks, rng).map(|path| Action::Block { path }))
}

/// While a vote runs: a voter's answer, or the mover's bribe or giving up.
fn in_vote<R: Rng + ?Sized>(v: &View, vote: &Vote, me: Seat, tokens: &[u8], rng: &mut R) -> Action {
    if voters_left(&v.rooms, vote, v.turn).contains(&me) {
        let of = count(&v.rooms, vote.room, Some(me));
        let yes = match rng.random_range(0..10) {
            0..5 => of,
            5..7 => rng.random_range(0..=of),
            _ => 0,
        };
        return Action::Vote { yes };
    }
    // The mover, with only neutrals left to ask.
    let bribe = tokens.iter().copied().filter(|&t| t >= v.layout.min_bribe).min();
    match bribe {
        Some(token) if can_bribe(&v.layout, &v.rooms, vote, tokens) && rng.random_bool(0.7) => Action::Bribe { token },
        _ => Action::Withdraw,
    }
}
