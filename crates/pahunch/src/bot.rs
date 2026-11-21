//! Random legal moves, for bot seats and for absent players the admin skips. A bot sees only its
//! own seat's view. It never gives tokens away unasked, offers its favour unasked, asks for one or
//! opens a deal; asked for a favour or tokens, or offered a swap, it says yes or no at random. Favours lent to it work where they apply by themselves (an open
//! back path, a full room, a covered token).

use rand::seq::{IndexedRandom, SliceRandom};
use rand::{Rng, RngExt};

use crate::rules::{
    Ask, Board, Climb, can_bribe, check_block, check_climb, check_enter, check_nudge, count, enough, offered,
    refused_rooms, still_needed, voters_left,
};
use crate::types::{Action, Deal, FavourKind, Seat, View, Vote};

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
    if let Some(action) = answer_deal(v, me, &tokens, rng) {
        return Some(action);
    }

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

/// An answer to a deal another player opened with the bot: now and then its smallest tokens for
/// an ask, or yes to a swap it can make; else no.
fn answer_deal<R: Rng + ?Sized>(v: &View, me: Seat, tokens: &[u8], rng: &mut R) -> Option<Action> {
    if let Some(p) = v.pleas.iter().find(|p| p.of == me) {
        let give: Vec<u8> = tokens.iter().copied().take(usize::from(p.count)).collect();
        return Some(if !give.is_empty() && rng.random_bool(0.3) {
            Action::Give { to: p.by, tokens: give }
        } else {
            Action::Refuse {
                from: p.by,
                deal: Deal::Plea,
            }
        });
    }
    let o = v.offers.iter().find(|o| o.to == me)?;
    let mut hand = tokens.to_vec();
    let can = o.want.iter().all(|t| {
        hand.iter()
            .position(|x| x == t)
            .map(|at| hand.swap_remove(at))
            .is_some()
    });
    Some(if can && rng.random_bool(0.3) {
        Action::Accept { from: o.by }
    } else {
        Action::Refuse {
            from: o.by,
            deal: Deal::Offer,
        }
    })
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
    // The mover, with enough yes in: the needed ones, from voters in a random order.
    if enough(vote) {
        let mut order: Vec<usize> = (0..vote.answers.len()).filter(|&i| i != usize::from(me)).collect();
        order.shuffle(rng);
        let mut left = still_needed(vote, me);
        let mut votes = vec![0; vote.answers.len()];
        for i in order {
            let given = vote.answers.get(i).copied().flatten().unwrap_or(0).min(left);
            if let Some(t) = votes.get_mut(i) {
                *t = given;
            }
            left -= given;
        }
        return Action::Take { votes };
    }
    // The mover, with only neutrals left to ask.
    let bribe = tokens.iter().copied().filter(|&t| t >= v.layout.min_bribe).min();
    match bribe {
        Some(token) if can_bribe(&v.layout, &v.rooms, vote, tokens) && rng.random_bool(0.7) => Action::Bribe { token },
        _ => Action::Withdraw,
    }
}
