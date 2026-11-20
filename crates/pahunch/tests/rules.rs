//! The rules, move by move, on the quick board (id `classic`):
//!
//! ```text
//! rooms  0:7 1:3 2:3 3:5 (bottom)  4:5 5:1 6:3  7:3 8:1  9: top
//! paths  0:0→4 1:1→4 2:1→5 3:2→5 4:2→6 5:3→6 6:4→7 7:5→7 8:5→8 9:6→8 10:7→9 11:8→9
//! ```

#![allow(
    clippy::unwrap_used,
    clippy::indexing_slicing,
    clippy::panic,
    clippy::needless_pass_by_value,
    clippy::assert_is_empty
)]

use pahunch::{Action, LogEntry, Pahunch, State, apply_action, apply_skip, boards, end_early, reseat, view_for};

use game::Game;

/// The variant index of a board.
fn board(id: &str) -> u8 {
    u8::try_from(boards().iter().position(|b| b.id == id).unwrap()).unwrap()
}

/// A game for `n` with an empty board (no neutrals), seat 0 to move, two 1s each.
fn fresh(n: u8) -> State {
    fresh_on("classic", n)
}

fn fresh_on(id: &str, n: u8) -> State {
    let mut s = pahunch::new_game(n, 7, board(id)).unwrap();
    for r in &mut s.rooms {
        r.clear();
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
fn every_board_is_sound_and_seats_the_same_players() {
    for b in boards() {
        assert_eq!(b.check(), Ok(()), "board {}", b.id);
        let seats: Vec<u8> = b.players.keys().copied().collect();
        assert_eq!(seats, Pahunch::players().collect::<Vec<_>>(), "board {}", b.id);
    }
    assert_eq!(Pahunch::variants().len(), boards().len());
    assert_eq!(boards()[0].id, "full", "the full board is the default");
}

#[test]
fn a_new_game_follows_the_board() {
    let s = pahunch::new_game(3, 1, board("classic")).unwrap();
    assert_eq!(s.layout.cap(s.layout.summit), 5);
    assert_eq!(s.rooms[0], vec![None]);
    assert_eq!(s.rooms[3], vec![None]);
    assert!(s.players.iter().all(|p| p.hand == 6 && p.tokens == vec![1, 1]));
    assert_eq!(s.supply, 40 - 6);
    // Tokens lie on the paths that leave rooms of 3 or more, and nowhere else.
    for (i, p) in s.layout.paths.iter().enumerate() {
        assert_eq!(s.tokens_on[i].is_some(), s.layout.cap(p.from) > 1, "path {i}");
    }
    assert_eq!(s.bag.len() + s.tokens_on.iter().flatten().count(), 30);
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
    assert_eq!(t.players[0].hand, 4);
    assert_eq!(t.turn, 1);
    let mut full = fresh(5);
    full.rooms[1] = vec![Some(1), Some(2), Some(3)];
    assert_eq!(refused(&full, 0, Action::Enter { room: 1 }), "That room is full");
}

#[test]
fn enough_own_climbers_leave_without_a_vote_and_take_the_token() {
    let mut s = fresh(5);
    s.rooms[1] = vec![Some(0), Some(0), Some(1)];
    let token = s.tokens_on[1].unwrap();
    let t = act(&s, 0, Action::Climb { path: 1 });
    assert_eq!(t.rooms[1], vec![Some(0), Some(1)]);
    assert_eq!(t.rooms[4], vec![Some(0)]);
    assert!(t.players[0].tokens.contains(&token));
    assert_eq!(
        t.tokens_on[1],
        s.bag.last().copied(),
        "the path is refilled from the bag"
    );
    assert!(t.vote.is_none());
    assert_eq!(t.turn, 1);
}

#[test]
fn a_vote_passes_and_pays_the_needed_yes() {
    let mut s = fresh(5);
    s.rooms[1] = vec![Some(0), Some(1)];
    let t = act(&s, 0, Action::Climb { path: 1 });
    let v = t.vote.clone().unwrap();
    assert_eq!((v.room, v.need, v.answers[0]), (1, 2, Some(1)));
    assert_eq!(Pahunch::pending(&t), vec![1]);
    assert_eq!(refused(&t, 0, Action::Enter { room: 0 }), "Wait for the vote to finish");
    assert_eq!(
        refused(&t, 2, Action::Vote { yes: 1 }),
        "You have no vote to give in this climb"
    );
    assert_eq!(refused(&t, 1, Action::Vote { yes: 2 }), "You have 1 votes here");
    let u = act(&t, 1, Action::Vote { yes: 1 });
    assert_eq!(u.rooms[4], vec![Some(0)]);
    assert_eq!(u.players[1].tokens, vec![1, 1, 1]);
    assert_eq!(u.supply, t.supply - 1);
    assert!(u.log.contains(&LogEntry::Reward { p: 1, ones: 1 }));
    assert_eq!(u.turn, 1);
}

#[test]
fn a_no_keeps_the_climber_and_the_mover_moves_again() {
    let mut s = fresh(5);
    s.rooms[1] = vec![Some(0), Some(1)];
    s.rooms[2] = vec![Some(0), Some(0)];
    let t = act(&act(&s, 0, Action::Climb { path: 1 }), 1, Action::Vote { yes: 0 });
    assert_eq!(t.rooms[1], vec![Some(0), Some(1)]);
    assert!(t.vote.is_none());
    assert_eq!(t.log.last(), Some(&LogEntry::Fail { p: 0 }));
    assert_eq!((t.turn, t.tried.clone()), (0, vec![1]));
    assert_eq!(Pahunch::pending(&t), vec![0]);
    assert_eq!(
        refused(&t, 0, Action::Climb { path: 2 }),
        "That room already said no this turn"
    );
    // Another room, or a climb that needs no vote, is fine; the next turn forgets.
    let u = act(&t, 0, Action::Climb { path: 3 });
    assert_eq!((u.turn, u.tried.clone()), (1, vec![]));
}

#[test]
fn with_the_setting_on_a_no_ends_the_turn() {
    let mut s = fresh(5);
    s.options.fail_ends_turn = true;
    s.rooms[1] = vec![Some(0), Some(1)];
    let t = act(&act(&s, 0, Action::Climb { path: 1 }), 1, Action::Vote { yes: 0 });
    assert_eq!((t.turn, t.tried.clone()), (1, vec![]));
}

#[test]
fn a_bribe_stays_spent_when_the_vote_fails() {
    // Room 3 seats 5: leaving takes 3.
    let mut s = fresh(5);
    s.rooms[3] = vec![None, Some(0), Some(1), Some(2)];
    s.players[0].tokens = vec![3];
    let t = act(&s, 0, Action::Climb { path: 5 });
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
    // Room 0 seats 7: leaving takes 4.
    s.rooms[0] = vec![Some(0), Some(1), Some(1), Some(1), Some(2)];
    let t = act(&s, 0, Action::Climb { path: 0 });
    let t = act(&t, 2, Action::Vote { yes: 1 });
    assert!(t.vote.is_some());
    let u = act(&t, 1, Action::Vote { yes: 3 });
    assert_eq!(u.rooms[4], vec![Some(0)]);
    assert!(u.log.contains(&LogEntry::Reward { p: 1, ones: 2 }));
    assert!(u.log.contains(&LogEntry::Reward { p: 2, ones: 1 }));
}

#[test]
fn a_climb_without_enough_voters_is_refused() {
    let mut s = fresh(5);
    s.rooms[0] = vec![Some(0), Some(1)];
    assert_eq!(
        refused(&s, 0, Action::Climb { path: 0 }),
        "Leaving takes 4 yes votes; there are not enough voters in the room"
    );
    s.rooms[4] = vec![Some(1); 5];
    s.rooms[1] = vec![Some(0), Some(0)];
    assert_eq!(refused(&s, 0, Action::Climb { path: 1 }), "The room above is full");
}

#[test]
fn a_paid_neutral_votes_yes_and_the_token_leaves_the_game() {
    let mut s = fresh(3);
    s.rooms[0] = vec![None, Some(0), Some(0), Some(0)];
    // Only 1s: a neutral will not take them, so the climb cannot pass.
    assert!(apply_action(&s, 0, &Action::Climb { path: 0 }).is_err());
    s.players[0].tokens = vec![1, 3];
    let t = act(&s, 0, Action::Climb { path: 0 });
    assert_eq!(Pahunch::pending(&t), vec![0], "only the neutral is left to ask");
    assert_eq!(
        refused(&t, 0, Action::Bribe { token: 1 }),
        "A neutral takes a token of 2 or more"
    );
    let u = act(&t, 0, Action::Bribe { token: 3 });
    assert_eq!(u.players[0].tokens[..1], [1]);
    assert_eq!(u.rooms[4], vec![Some(0)]);
    assert!(u.log.contains(&LogEntry::Bribe { p: 0 }));
}

#[test]
fn the_mover_can_give_up_the_climb() {
    let mut s = fresh(5);
    s.rooms[1] = vec![Some(0), Some(1)];
    let t = act(&s, 0, Action::Climb { path: 1 });
    assert_eq!(
        refused(&t, 1, Action::Withdraw),
        "Only the climber can give up the climb"
    );
    let u = act(&t, 0, Action::Withdraw);
    assert!(u.vote.is_none());
    assert_eq!((u.turn, u.tried.clone()), (0, vec![1]));
}

#[test]
fn the_blockers_path_needs_no_vote_and_pays_nothing() {
    let mut s = fresh(5);
    s.rooms[7] = vec![Some(0), Some(1)];
    assert_eq!(s.blocker, 10);
    let token = s.tokens_on[10];
    let t = act(&s, 0, Action::Climb { path: 10 });
    assert_eq!(t.rooms[9], vec![Some(0)]);
    assert_eq!(t.tokens_on[10], token);
    assert_eq!(t.players[0].tokens, vec![1, 1]);
    assert_eq!(
        refused(&t, 1, Action::Block { path: 10 }),
        "The blocker is already there"
    );
    let u = act(&t, 1, Action::Block { path: 3 });
    assert_eq!(u.blocker, 3);
}

#[test]
fn a_nudged_neutral_climbs_free_even_to_the_top() {
    let mut s = fresh(3);
    s.rooms[0] = vec![None];
    let t = act(&s, 0, Action::Nudge { path: 0 });
    assert_eq!((t.rooms[0].len(), t.rooms[4].clone()), (0, vec![None]));
    assert_eq!(t.players[0].tokens, vec![1, 1, 1]);
    s.rooms[7] = vec![None];
    let u = act(&s, 0, Action::Nudge { path: 10 });
    assert_eq!(u.rooms[9], vec![None]);
    assert!(!u.over);
}

#[test]
fn a_neutral_can_fill_the_top_but_never_wins() {
    let mut s = fresh(5);
    s.rooms[9] = vec![Some(1), None, Some(2), Some(1), Some(2)];
    s.rooms[7] = vec![None];
    s.players[1].tokens = vec![3];
    s.players[2].tokens = vec![3];
    let t = act(&s, 0, Action::Nudge { path: 10 });
    assert!(t.over);
    assert_eq!(t.winners, vec![1], "a tie goes to the first seat to arrive");
    s.rooms[9] = vec![None; 5];
    let u = act(&s, 0, Action::Nudge { path: 10 });
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
fn giving_away_the_bribe_ends_a_vote_that_cannot_pass() {
    let mut s = fresh(3);
    s.rooms[0] = vec![None, Some(0), Some(0), Some(0)];
    s.players[0].tokens = vec![3];
    let t = act(&s, 0, Action::Climb { path: 0 });
    let u = act(&t, 0, Action::Give { to: 1, tokens: vec![3] });
    assert!(u.vote.is_none());
    assert_eq!(u.log.last(), Some(&LogEntry::Fail { p: 0 }));
}

#[test]
fn the_full_top_room_ends_the_game_and_the_first_of_the_best_wins() {
    let mut s = fresh(5);
    s.rooms[9] = vec![Some(1), Some(2), Some(1), Some(3), Some(2)];
    s.rooms[7] = vec![Some(0)];
    s.players[1].tokens = vec![5];
    s.players[2].tokens = vec![2, 3];
    s.players[4].tokens = vec![50]; // not at the top: cannot win
    let t = act(&s, 0, Action::Climb { path: 10 });
    assert!(t.over);
    assert_eq!(t.winners, vec![1]);
    assert!(Pahunch::pending(&t).is_empty());
    assert_eq!(refused(&t, 1, Action::Block { path: 1 }), "The game is over");
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
    s.rooms[1] = vec![Some(0), Some(0)];
    let t = act(&s, 0, Action::Climb { path: 1 });
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
    s.rooms[0] = vec![Some(0), Some(1), Some(2), Some(2), Some(3)];
    assert_eq!(Pahunch::clock(&s), None);
    let t = act(&s, 0, Action::Climb { path: 0 });
    let (start, last) = Pahunch::clock(&t).unwrap();
    assert_eq!(start, last);
    let u = act(&t, 2, Action::Vote { yes: 2 });
    assert_eq!(
        Pahunch::clock(&u),
        Some((start, u.log.len() - 1)),
        "an answer tops the clock up"
    );
    let w = Pahunch::time_up(&u).unwrap();
    assert!(w.vote.is_none());
    assert_eq!(w.rooms[0].len(), 5);
    assert_eq!((w.turn, w.tried.clone()), (0, vec![0]));
    assert!(Pahunch::time_up(&w).is_err());
}

#[test]
fn skipping_an_absent_player_makes_a_random_legal_move_for_them() {
    let s = pahunch::new_game(4, 3, 0).unwrap();
    let seat = s.turn;
    assert!(apply_skip(&s, (seat + 1) % 4).is_err());
    let t = apply_skip(&s, seat).unwrap();
    assert_eq!(t.log[1], LogEntry::Skip { p: seat });
    assert_eq!(t.log.len(), 3);
    assert_eq!(t.skips, 1);
    assert_eq!(apply_skip(&s, seat).unwrap(), t, "the same game skips the same way");
}

#[test]
fn reseating_moves_climbers_tokens_and_votes() {
    let mut s = fresh(3);
    s.rooms[1] = vec![Some(0), Some(1)];
    s.players[1].tokens = vec![4];
    let t = act(&s, 0, Action::Climb { path: 1 });
    let r = reseat(&t, &[2, 0, 1]).unwrap();
    assert_eq!(r.rooms[1], vec![Some(2), Some(0)]);
    assert_eq!(r.players[0].tokens, vec![4]);
    assert_eq!(r.turn, 2);
    assert_eq!(r.vote.as_ref().unwrap().answers, vec![None, None, Some(1)]);
    assert_eq!(Pahunch::pending(&r), vec![0]);
}

// ---- the full board ----
//
// rooms  A0:1 E1:5 F2:1 G3:3 (bottom)  B4:1 I5:1 J6:1 K7:1  C8:3 H9:3 D10:3  M11:1 N12:3 L13:5  Z14: top
// back paths 1:A→C 2:A→I 5:C→L 9:E→H 13:G→K 16:H→N 22:M→Z; token paths 4 6 7 8 11 12 14 15 20 23

const BACK: [usize; 7] = [1, 2, 5, 9, 13, 16, 22];
const SLOTS: [usize; 10] = [4, 6, 7, 8, 11, 12, 14, 15, 20, 23];

#[test]
fn the_full_board_deals_tokens_on_its_token_paths_only() {
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
    }
    let s = pahunch::new_game(4, 1, 0).unwrap();
    assert_eq!(s.rooms[8], vec![None]);
    assert_eq!(s.rooms[1], vec![None]);
}

#[test]
fn back_paths_are_locked() {
    let mut s = fresh_on("full", 4);
    s.rooms[0] = vec![Some(0)];
    assert_eq!(refused(&s, 0, Action::Climb { path: 1 }), "The back stairs are locked");
    assert_eq!(refused(&s, 0, Action::Climb { path: 2 }), "The back stairs are locked");
    act(&s, 0, Action::Climb { path: 0 });
    s.rooms[8] = vec![None];
    assert_eq!(refused(&s, 0, Action::Nudge { path: 5 }), "The back stairs are locked");
}

#[test]
fn the_blocker_sits_only_on_a_token_path() {
    let s = fresh_on("full", 4);
    assert_eq!(
        refused(&s, 0, Action::Block { path: 0 }),
        "The blocker sits only on a path with a token"
    );
    assert_eq!(
        refused(&s, 0, Action::Block { path: 22 }),
        "The blocker sits only on a path with a token"
    );
    assert_eq!(act(&s, 0, Action::Block { path: 4 }).blocker, 4);
    let q = fresh(4);
    assert_eq!(
        refused(&q, 0, Action::Block { path: 7 }),
        "The blocker sits only on a path with a token"
    );
}
