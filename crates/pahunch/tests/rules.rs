//! The rules, move by move, on the board (id `full`):
//!
//! ```text
//! rooms  0:1 1:5 2:1 3:3 (bottom)  4:1 5:1 6:1 7:1  8:3 9:3 10:3  11:1 12:3 13:5  14: top
//! paths  0:0→4  1:0→8b  2:0→5b  3:4→8  4:8→10  5:8→13b  6:10→14  7:1→8  8:1→5  9:1→9b  10:2→9
//!        11:3→9  12:3→6  13:3→7b  14:9→13  15:9→11  16:9→12b  17:5→13  18:6→7  19:7→12
//!        20:13→14  21:11→12  22:11→14b  23:12→14          (b = back path)
//! token paths 4 6 7 8 11 12 14 15 20 23; the blocker starts on 20
//! ```

#![allow(
    clippy::unwrap_used,
    clippy::indexing_slicing,
    clippy::panic,
    clippy::needless_pass_by_value,
    clippy::assert_is_empty
)]

use pahunch::{
    Action, Bonus, Coin, LogEntry, Pahunch, State, apply_action, apply_skip, boards, end_early, reseat, view_for,
};

use game::Game;

const BACK: [usize; 7] = [1, 2, 5, 9, 13, 16, 22];
const SLOTS: [usize; 10] = [4, 6, 7, 8, 11, 12, 14, 15, 20, 23];

/// A game for `n` with an empty board (no neutrals), seat 0 to move, two 1s each, and no special
/// coins (a test that wants one lays it).
fn fresh(n: u8) -> State {
    let mut s = pahunch::new_game(n, 7, 0).unwrap();
    for r in &mut s.rooms {
        r.clear();
    }
    for c in s.tokens_on.iter_mut().flatten().chain(s.bag.iter_mut()) {
        c.bonus = None;
    }
    s.turn = 0;
    s
}

fn act(s: &State, seat: u8, a: Action) -> State {
    apply_action(s, seat, &a).unwrap_or_else(|e| panic!("{a:?} by {seat}: {e}"))
}

fn refused(s: &State, seat: u8, a: Action) -> String {
    apply_action(s, seat, &a).unwrap_err().0
}

#[test]
fn the_board_is_sound() {
    for b in boards() {
        assert_eq!(b.check(), Ok(()), "board {}", b.id);
        let seats: Vec<u8> = b.players.keys().copied().collect();
        assert_eq!(seats, Pahunch::players().collect::<Vec<_>>(), "board {}", b.id);
    }
    assert_eq!(Pahunch::variants().len(), boards().len());
    assert_eq!(boards()[0].id, "full");
}

#[test]
fn a_new_game_deals_tokens_on_the_token_paths_only() {
    for (n, neutrals) in [(3, 6), (4, 4), (5, 2)] {
        let s = pahunch::new_game(n, 1, 0).unwrap();
        assert_eq!(s.layout.board, "full");
        assert_eq!(s.layout.cap(s.layout.summit), 5);
        assert_eq!(s.rooms.iter().flatten().filter(|x| x.is_none()).count(), neutrals);
        assert!(s.players.iter().all(|p| p.hand == 6 && p.tokens == vec![1, 1]));
        assert_eq!(s.supply, 60 - 2 * u16::from(n));
        assert_eq!(s.blocker, 20);
        let on: Vec<usize> = (0..s.tokens_on.len()).filter(|&i| s.tokens_on[i].is_some()).collect();
        assert_eq!(on, SLOTS);
        assert_eq!(BACK.map(|i| s.layout.paths[i].back), [true; 7]);
        assert_eq!(s.layout.paths.iter().filter(|p| p.back).count(), 7);
        let coins: Vec<Coin> = s.bag.iter().chain(s.tokens_on.iter().flatten()).copied().collect();
        assert_eq!(coins.len(), 42);
        let special = |b| coins.iter().filter(|c| c.bonus == Some(b)).count();
        assert_eq!(
            [special(Bonus::Block), special(Bonus::Nudge), special(Bonus::Favour)],
            [4, 3, 4]
        );
        assert!(coins.iter().all(|c| c.bonus.is_none() || c.value == 2));
    }
    let s = pahunch::new_game(4, 1, 0).unwrap();
    assert_eq!(s.rooms[8], vec![None]);
    assert_eq!(s.rooms[1], vec![None]);
    assert!(pahunch::new_game(3, 1, 9).is_err());
    assert!(pahunch::new_game(6, 1, 0).is_err());
}

#[test]
fn a_new_climber_goes_into_a_bottom_room() {
    let s = fresh(5);
    assert_eq!(
        refused(&s, 0, Action::Enter { room: 4 }),
        "New climbers go into a bottom room"
    );
    assert_eq!(refused(&s, 1, Action::Enter { room: 0 }), "It is not your turn");
    let t = act(&s, 0, Action::Enter { room: 1 });
    assert_eq!(t.rooms[1], vec![Some(0)]);
    assert_eq!(t.players[0].hand, 5);
    assert_eq!(t.turn, 1);
    let mut full = fresh(5);
    full.rooms[3] = vec![Some(1), Some(2), Some(3)];
    assert_eq!(refused(&full, 0, Action::Enter { room: 3 }), "That room is full");
}

#[test]
fn enough_own_climbers_leave_without_a_vote_and_take_the_token() {
    let mut s = fresh(5);
    s.rooms[3] = vec![Some(0), Some(0), Some(1)];
    let token = s.tokens_on[11].unwrap();
    let t = act(&s, 0, Action::Climb { path: 11 });
    assert_eq!(t.rooms[3], vec![Some(0), Some(1)]);
    assert_eq!(t.rooms[9], vec![Some(0)]);
    assert!(t.players[0].tokens.contains(&token.value));
    assert_eq!(
        t.tokens_on[11],
        s.bag.last().copied(),
        "the path is refilled from the bag"
    );
    assert!(t.vote.is_none());
    assert_eq!(t.turn, 1);
}

#[test]
fn a_vote_passes_and_pays_the_needed_yes() {
    let mut s = fresh(5);
    s.rooms[3] = vec![Some(0), Some(1)];
    let t = act(&s, 0, Action::Climb { path: 11 });
    let v = t.vote.clone().unwrap();
    assert_eq!((v.room, v.need, v.answers[0]), (3, 2, Some(1)));
    assert_eq!(Pahunch::pending(&t), vec![1]);
    assert_eq!(refused(&t, 0, Action::Enter { room: 0 }), "Wait for the vote to finish");
    assert_eq!(
        refused(&t, 2, Action::Vote { yes: 1 }),
        "You have no vote to give in this climb"
    );
    assert_eq!(refused(&t, 1, Action::Vote { yes: 2 }), "You have 1 votes here");
    let u = act(&t, 1, Action::Vote { yes: 1 });
    assert_eq!(u.rooms[9], vec![Some(0)]);
    assert_eq!(u.players[1].tokens, vec![1, 1, 1]);
    assert_eq!(u.supply, t.supply - 1);
    assert!(u.log.contains(&LogEntry::Reward { p: 1, ones: 1 }));
    assert_eq!(u.turn, 1);
}

#[test]
fn a_no_keeps_the_climber_and_the_mover_moves_again() {
    let mut s = fresh(5);
    s.rooms[3] = vec![Some(0), Some(1)];
    s.rooms[8] = vec![Some(0), Some(0)];
    let t = act(&act(&s, 0, Action::Climb { path: 11 }), 1, Action::Vote { yes: 0 });
    assert_eq!(t.rooms[3], vec![Some(0), Some(1)]);
    assert!(t.vote.is_none());
    assert_eq!(t.log.last(), Some(&LogEntry::Fail { p: 0 }));
    assert_eq!((t.turn, t.tried.clone()), (0, vec![3]));
    assert_eq!(Pahunch::pending(&t), vec![0]);
    assert_eq!(
        refused(&t, 0, Action::Climb { path: 12 }),
        "That room already said no this turn"
    );
    // Another room, or a climb that needs no vote, is fine; the next turn forgets.
    let u = act(&t, 0, Action::Climb { path: 4 });
    assert_eq!((u.turn, u.tried.clone()), (1, vec![]));
}

#[test]
fn with_the_setting_on_a_no_ends_the_turn() {
    let mut s = fresh(5);
    s.options.fail_ends_turn = true;
    s.rooms[3] = vec![Some(0), Some(1)];
    let t = act(&act(&s, 0, Action::Climb { path: 11 }), 1, Action::Vote { yes: 0 });
    assert_eq!((t.turn, t.tried.clone()), (1, vec![]));
}

#[test]
fn a_bribe_stays_spent_when_the_vote_fails() {
    // Room 1 seats 5: leaving takes 3.
    let mut s = fresh(5);
    s.rooms[1] = vec![None, Some(0), Some(1), Some(2)];
    s.players[0].tokens = vec![3];
    let t = act(&s, 0, Action::Climb { path: 7 });
    let t = act(&t, 0, Action::Bribe { token: 3 });
    let t = act(&act(&t, 1, Action::Vote { yes: 0 }), 2, Action::Vote { yes: 0 });
    assert!(t.vote.is_none());
    assert!(t.players[0].tokens.is_empty());
    assert_eq!(t.turn, 0);
}

#[test]
fn a_game_saved_before_options_keeps_its_old_rules() {
    let s = fresh(3);
    let mut json = serde_json::to_value(&s).unwrap();
    let o = json.as_object_mut().unwrap();
    o.remove("options");
    o.remove("tried");
    let old: State = serde_json::from_value(json).unwrap();
    assert!(old.options.fail_ends_turn);
    assert!(!old.options.favours);
    assert!(old.tried.is_empty());
}

#[test]
fn the_admins_options_reach_the_game() {
    let none = game::Options::new();
    let s = Pahunch::new_game_with(3, 1, 0, &none).unwrap();
    assert_eq!(s.options, pahunch::Options::default());
    let on: game::Options = [("failEndsTurn".to_owned(), true), ("favours".to_owned(), false)].into();
    let t = Pahunch::new_game_with(3, 1, 0, &on).unwrap();
    assert!(t.options.fail_ends_turn && !t.options.favours);
    assert_eq!(Pahunch::options().len(), 2);
}

#[test]
fn only_the_needed_yes_earn_a_token() {
    let mut s = fresh(5);
    // Room 1 seats 5: leaving takes 3.
    s.rooms[1] = vec![Some(0), Some(1), Some(1), Some(1), Some(2)];
    let t = act(&s, 0, Action::Climb { path: 7 });
    let t = act(&t, 2, Action::Vote { yes: 0 });
    assert!(t.vote.is_some());
    let u = act(&t, 1, Action::Vote { yes: 3 });
    assert_eq!(u.rooms[8], vec![Some(0)]);
    assert!(u.log.contains(&LogEntry::Reward { p: 1, ones: 2 }));
    assert!(!u.log.iter().any(|e| matches!(e, LogEntry::Reward { p: 2, .. })));
}

#[test]
fn a_climb_without_enough_voters_is_refused() {
    let mut s = fresh(5);
    s.rooms[1] = vec![Some(0), Some(1)];
    assert_eq!(
        refused(&s, 0, Action::Climb { path: 7 }),
        "Leaving takes 3 yes votes; there are not enough voters in the room"
    );
    s.rooms[9] = vec![Some(1); 3];
    s.rooms[3] = vec![Some(0), Some(0)];
    assert_eq!(refused(&s, 0, Action::Climb { path: 11 }), "The room above is full");
}

#[test]
fn a_neutral_takes_one_token_of_two_or_more_and_it_leaves_the_game() {
    let mut s = fresh(3);
    s.rooms[1] = vec![None, Some(0), Some(0)];
    // Only 1s: a neutral will not take them, two or more of them neither, so the climb cannot
    // pass.
    s.players[0].tokens = vec![1, 1, 1, 1];
    assert!(apply_action(&s, 0, &Action::Climb { path: 7 }).is_err());
    s.players[0].tokens = vec![1, 3];
    let t = act(&s, 0, Action::Climb { path: 7 });
    assert_eq!(Pahunch::pending(&t), vec![0], "only the neutral is left to ask");
    assert_eq!(
        refused(&t, 0, Action::Bribe { token: 1 }),
        "A neutral takes a token of 2 or more"
    );
    let u = act(&t, 0, Action::Bribe { token: 3 });
    let coin = t.tokens_on[7].unwrap().value;
    let mut left = vec![1, coin];
    left.sort_unstable();
    assert_eq!(u.players[0].tokens, left, "the 1 and the path's coin; no change back");
    assert_eq!(u.supply, t.supply, "the token leaves the game, not into the supply");
    assert_eq!(u.rooms[8], vec![Some(0)]);
    assert!(u.log.contains(&LogEntry::Bribe { p: 0 }));
}

#[test]
fn the_mover_can_give_up_the_climb() {
    let mut s = fresh(5);
    s.rooms[3] = vec![Some(0), Some(1)];
    let t = act(&s, 0, Action::Climb { path: 11 });
    assert_eq!(
        refused(&t, 1, Action::Withdraw),
        "Only the climber can give up the climb"
    );
    let u = act(&t, 0, Action::Withdraw);
    assert!(u.vote.is_none());
    assert_eq!((u.turn, u.tried.clone()), (0, vec![3]));
}

#[test]
fn the_blockers_path_needs_no_vote_and_pays_nothing() {
    let mut s = fresh(5);
    s.rooms[13] = vec![Some(0), Some(1)];
    assert_eq!(s.blocker, 20);
    let token = s.tokens_on[20];
    let t = act(&s, 0, Action::Climb { path: 20 });
    assert_eq!(t.rooms[14], vec![Some(0)]);
    assert_eq!(t.tokens_on[20], token);
    assert_eq!(t.players[0].tokens, vec![1, 1]);
    assert_eq!(
        refused(&t, 1, Action::Block { path: 20 }),
        "The blocker is already there"
    );
    let u = act(&t, 1, Action::Block { path: 4 });
    assert_eq!(u.blocker, 4);
}

#[test]
fn the_blocker_sits_only_on_a_token_path() {
    let s = fresh(4);
    for path in [0, 22, 10] {
        assert_eq!(
            refused(&s, 0, Action::Block { path }),
            "The blocker sits only on a path with a token"
        );
    }
    assert_eq!(act(&s, 0, Action::Block { path: 4 }).blocker, 4);
}

#[test]
fn back_paths_are_locked() {
    let mut s = fresh(4);
    s.rooms[0] = vec![Some(0)];
    assert_eq!(refused(&s, 0, Action::Climb { path: 1 }), "The back stairs are locked");
    assert_eq!(refused(&s, 0, Action::Climb { path: 2 }), "The back stairs are locked");
    act(&s, 0, Action::Climb { path: 0 });
    s.rooms[8] = vec![None];
    assert_eq!(refused(&s, 0, Action::Nudge { path: 5 }), "The back stairs are locked");
}

#[test]
fn a_nudged_neutral_climbs_free_even_to_the_top() {
    let mut s = fresh(3);
    s.rooms[1] = vec![None];
    let t = act(&s, 0, Action::Nudge { path: 7 });
    assert_eq!((t.rooms[1].len(), t.rooms[8].clone()), (0, vec![None]));
    assert_eq!(t.players[0].tokens, vec![1, 1, 1]);
    s.rooms[13] = vec![None];
    let u = act(&s, 0, Action::Nudge { path: 20 });
    assert_eq!(u.rooms[14], vec![None]);
    assert!(!u.over);
}

#[test]
fn a_neutral_can_fill_the_top_but_never_wins() {
    let mut s = fresh(5);
    s.rooms[14] = vec![Some(1), None, Some(2), Some(1)];
    s.rooms[13] = vec![None];
    s.players[1].tokens = vec![3];
    s.players[2].tokens = vec![3];
    let t = act(&s, 0, Action::Nudge { path: 20 });
    assert!(t.over);
    assert_eq!(t.winners, vec![1], "a tie goes to the first seat to arrive");
    s.rooms[14] = vec![None; 4];
    let u = act(&s, 0, Action::Nudge { path: 20 });
    assert!(u.over);
    assert!(u.winners.is_empty(), "no player at the top: nobody wins");
}

#[test]
fn tokens_can_be_given_at_any_time() {
    let mut s = fresh(5);
    s.players[3].tokens = vec![1, 4, 5];
    let t = act(
        &s,
        3,
        Action::Give {
            to: 2,
            tokens: vec![5, 1],
        },
    );
    assert_eq!(t.players[3].tokens, vec![4]);
    assert_eq!(t.players[2].tokens, vec![1, 1, 1, 5]);
    assert_eq!(
        t.log.last(),
        Some(&LogEntry::Gift {
            from: 3,
            to: 2,
            count: 2
        })
    );
    assert_eq!(t.turn, 0, "a gift is not a turn");
    assert_eq!(
        refused(&t, 3, Action::Give { to: 2, tokens: vec![5] }),
        "You do not have those tokens"
    );
    assert_eq!(
        refused(&t, 3, Action::Give { to: 3, tokens: vec![4] }),
        "Give to another player"
    );
}

#[test]
fn change_is_made_between_players_never_with_the_supply() {
    // Seat 0 wants a 2 for a bribe and has 1s: seat 1 gives a 2, seat 0 pays two 1s back.
    let mut s = fresh(3);
    s.players[1].tokens = vec![2];
    let supply = s.supply;
    let t = act(&s, 1, Action::Give { to: 0, tokens: vec![2] });
    let u = act(
        &t,
        0,
        Action::Give {
            to: 1,
            tokens: vec![1, 1],
        },
    );
    assert_eq!(
        (u.players[0].tokens.clone(), u.players[1].tokens.clone()),
        (vec![2], vec![1, 1])
    );
    assert_eq!(u.supply, supply, "the supply only pays rewards");
    assert_eq!(
        refused(&u, 0, Action::Give { to: 3, tokens: vec![2] }),
        "Give to another player"
    );
}

#[test]
fn giving_away_the_bribe_ends_a_vote_that_cannot_pass() {
    let mut s = fresh(3);
    s.rooms[1] = vec![None, Some(0), Some(0)];
    s.players[0].tokens = vec![3];
    let t = act(&s, 0, Action::Climb { path: 7 });
    let u = act(&t, 0, Action::Give { to: 1, tokens: vec![3] });
    assert!(u.vote.is_none());
    assert_eq!(u.log.last(), Some(&LogEntry::Fail { p: 0 }));
}

#[test]
fn the_full_top_room_ends_the_game_and_the_first_of_the_best_wins() {
    let mut s = fresh(5);
    s.rooms[14] = vec![Some(1), Some(2), Some(1), Some(3)];
    s.rooms[13] = vec![Some(0)];
    s.players[1].tokens = vec![5];
    s.players[2].tokens = vec![2, 3];
    s.players[4].tokens = vec![50]; // not at the top: cannot win
    let t = act(&s, 0, Action::Climb { path: 20 });
    assert!(t.over);
    assert_eq!(t.winners, vec![1]);
    assert!(Pahunch::pending(&t).is_empty());
    assert_eq!(refused(&t, 1, Action::Block { path: 4 }), "The game is over");
}

#[test]
fn ending_early_has_no_winner() {
    let t = end_early(&fresh(4), 2).unwrap();
    assert!(t.over);
    assert!(t.winners.is_empty());
    assert_eq!(
        t.log.last(),
        Some(&LogEntry::End {
            winners: vec![],
            by: Some(2)
        })
    );
}

#[test]
fn others_see_neither_tokens_nor_what_was_taken() {
    let mut s = fresh(5);
    s.rooms[3] = vec![Some(0), Some(0)];
    let t = act(&s, 0, Action::Climb { path: 11 });
    let took = |v: &pahunch::View| match v.log.last() {
        Some(LogEntry::Climb { took, token, .. }) => (*took, *token),
        e => panic!("{e:?}"),
    };
    let mine = view_for(&t, Some(0));
    assert!(mine.players[0].tokens.is_some());
    assert!(mine.players[1].tokens.is_none());
    assert!(took(&mine).0.is_some());
    for seat in [Some(1), None] {
        let theirs = view_for(&t, seat);
        assert!(theirs.players[0].tokens.is_none());
        assert_eq!(took(&theirs), (None, true));
    }
    let end = view_for(&end_early(&t, 0).unwrap(), Some(1));
    assert!(end.players.iter().all(|p| p.tokens.is_some()));
}

#[test]
fn the_vote_clock_runs_during_a_vote_and_silence_says_no() {
    let mut s = fresh(5);
    s.rooms[1] = vec![Some(0), Some(1), Some(2), Some(2), Some(3)];
    assert_eq!(Pahunch::clock(&s), None);
    let t = act(&s, 0, Action::Climb { path: 7 });
    let (start, last) = Pahunch::clock(&t).unwrap();
    assert_eq!(start, last);
    let u = act(&t, 2, Action::Vote { yes: 1 });
    assert_eq!(
        Pahunch::clock(&u),
        Some((start, u.log.len() - 1)),
        "an answer tops the clock up"
    );
    let w = Pahunch::time_up(&u).unwrap();
    assert!(w.vote.is_none());
    assert_eq!(w.rooms[1].len(), 5);
    assert_eq!((w.turn, w.tried.clone()), (0, vec![1]));
    assert!(Pahunch::time_up(&w).is_err());
}

#[test]
fn skipping_an_absent_player_makes_a_random_legal_move_for_them() {
    let s = pahunch::new_game(4, 3, 0).unwrap();
    let seat = s.turn;
    assert!(apply_skip(&s, (seat + 1) % 4).is_err());
    let t = apply_skip(&s, seat).unwrap();
    assert_eq!(t.log[1], LogEntry::Skip { p: seat });
    assert!(t.log.len() > 2);
    assert_eq!(t.skips, 1);
    assert_eq!(apply_skip(&s, seat).unwrap(), t, "the same game skips the same way");
}

#[test]
fn reseating_moves_climbers_tokens_and_votes() {
    let mut s = fresh(3);
    s.rooms[3] = vec![Some(0), Some(1)];
    s.players[1].tokens = vec![4];
    let t = act(&s, 0, Action::Climb { path: 11 });
    let r = reseat(&t, &[2, 0, 1]).unwrap();
    assert_eq!(r.rooms[3], vec![Some(2), Some(0)]);
    assert_eq!(r.players[0].tokens, vec![4]);
    assert_eq!(r.turn, 2);
    assert_eq!(r.vote.as_ref().unwrap().answers, vec![None, None, Some(1)]);
    assert_eq!(Pahunch::pending(&r), vec![0]);
}

// ---- special coins and the bonus moves ----

/// Seat 0 can climb path 11 (room 3 → 9) without a vote, onto a coin with `bonus`.
fn on_a_special(bonus: Bonus) -> State {
    let mut s = fresh(5);
    s.rooms[3] = vec![Some(0), Some(0)];
    s.tokens_on[11] = Some(Coin {
        value: 2,
        bonus: Some(bonus),
    });
    s
}

#[test]
fn a_block_coin_gives_one_more_blocker_move() {
    let s = on_a_special(Bonus::Block);
    let t = act(&s, 0, Action::Climb { path: 11 });
    assert_eq!(
        t.log.last(),
        Some(&LogEntry::Bonus {
            p: 0,
            kind: Bonus::Block
        })
    );
    assert!(t.players[0].tokens.contains(&2), "in the hand it is a plain 2");
    assert_eq!((t.turn, Pahunch::pending(&t)), (0, vec![0]), "the turn stays");
    assert_eq!(t.bonuses.block, 1);
    assert_eq!(
        refused(&t, 0, Action::Enter { room: 0 }),
        "Use a bonus move or end the turn"
    );
    assert_eq!(
        refused(&t, 0, Action::Nudge { path: 7 }),
        "Use a bonus move or end the turn"
    );
    assert_eq!(
        refused(&t, 0, Action::Block { path: 0 }),
        "The blocker sits only on a path with a token"
    );
    assert_eq!(refused(&t, 1, Action::Done), "It is not your turn");
    let u = act(&t, 0, Action::Block { path: 4 });
    assert_eq!((u.blocker, u.turn), (4, 1));
    assert!(!u.bonuses.any());
}

#[test]
fn a_nudge_coin_gives_one_free_nudge_or_the_turn_ends_on_done() {
    let mut s = on_a_special(Bonus::Nudge);
    s.rooms[1] = vec![None];
    let t = act(&s, 0, Action::Climb { path: 11 });
    assert_eq!(t.bonuses.nudge, 1);
    assert_eq!(
        refused(&t, 0, Action::Block { path: 4 }),
        "Use a bonus move or end the turn"
    );
    let u = act(&t, 0, Action::Nudge { path: 7 });
    assert_eq!((u.rooms[8].clone(), u.turn), (vec![None], 1));
    assert!(u.log.contains(&LogEntry::Reward { p: 0, ones: 1 }));
    let d = act(&t, 0, Action::Done);
    assert_eq!((d.turn, d.log.last()), (1, Some(&LogEntry::Done { p: 0 })));
    assert_eq!(refused(&d, 1, Action::Done), "Make your move first");
}

#[test]
fn a_bonus_fires_only_when_the_coin_is_taken() {
    // Under the blocker the coin stays, and so does its bonus.
    let mut s = on_a_special(Bonus::Block);
    s.blocker = 11;
    let t = act(&s, 0, Action::Climb { path: 11 });
    assert_eq!((t.turn, t.bonuses.any()), (1, false));
    assert_eq!(t.tokens_on[11], s.tokens_on[11]);
    // Taken after a vote, it fires as well.
    let mut s = on_a_special(Bonus::Block);
    s.rooms[3] = vec![Some(0), Some(1)];
    let t = act(&act(&s, 0, Action::Climb { path: 11 }), 1, Action::Vote { yes: 1 });
    assert_eq!((t.turn, t.bonuses.block), (0, 1));
    // Given away, it is a plain 2.
    let u = act(&act(&t, 0, Action::Done), 0, Action::Give { to: 2, tokens: vec![2] });
    assert_eq!(u.players[2].tokens, vec![1, 1, 2]);
    assert_eq!((u.turn, u.bonuses.any()), (1, false));
}

#[test]
fn a_favour_coin_without_favours_is_a_plain_two() {
    let mut s = on_a_special(Bonus::Favour);
    s.options.favours = false;
    let t = act(&s, 0, Action::Climb { path: 11 });
    assert!(!t.log.iter().any(|e| matches!(e, LogEntry::Bonus { .. })));
    assert_eq!(t.turn, 1);
}

#[test]
fn a_full_top_ends_the_game_even_with_a_bonus_left() {
    let mut s = on_a_special(Bonus::Nudge);
    s.rooms[14] = vec![Some(1), Some(1), Some(2), Some(2)];
    s.rooms[13] = vec![None, None];
    let t = act(&s, 0, Action::Climb { path: 11 });
    assert_eq!(t.bonuses.nudge, 1);
    let u = act(&t, 0, Action::Nudge { path: 20 });
    assert!(u.over);
    assert!(Pahunch::pending(&u).is_empty());
}

#[test]
fn a_skipped_mover_with_a_bonus_makes_a_legal_bonus_move() {
    let t = act(&on_a_special(Bonus::Block), 0, Action::Climb { path: 11 });
    let u = apply_skip(&t, 0).unwrap();
    assert!(matches!(
        u.log.last(),
        Some(LogEntry::Done { p: 0 } | LogEntry::Block { p: 0, .. })
    ));
    assert_eq!(u.turn, 1);
}

#[test]
fn a_game_saved_with_bare_number_tokens_loads() {
    let s = fresh(3);
    let mut json = serde_json::to_value(&s).unwrap();
    let o = json.as_object_mut().unwrap();
    o.insert("bag".into(), serde_json::json!([2, 3, 5]));
    let on: Vec<serde_json::Value> = s
        .tokens_on
        .iter()
        .map(|t| serde_json::json!(t.map(|c| c.value)))
        .collect();
    o.insert("tokensOn".into(), on.into());
    o.remove("bonuses");
    let old: State = serde_json::from_value(json).unwrap();
    assert_eq!(old.bag, vec![Coin::plain(2), Coin::plain(3), Coin::plain(5)]);
    assert_eq!(old.tokens_on, s.tokens_on);
    assert!(!old.bonuses.any());
}

#[test]
fn reseating_moves_bonus_lines() {
    let t = act(&on_a_special(Bonus::Block), 0, Action::Climb { path: 11 });
    let r = reseat(&act(&t, 0, Action::Done), &[1, 2, 3, 4, 0]).unwrap();
    assert!(r.log.contains(&LogEntry::Bonus {
        p: 1,
        kind: Bonus::Block
    }));
    assert!(r.log.contains(&LogEntry::Done { p: 1 }));
}
