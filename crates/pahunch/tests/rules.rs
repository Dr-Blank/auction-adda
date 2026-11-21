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
    Action, Bonus, Carry, Coin, Deal, FavourKind, LogEntry, Options, Pahunch, Plea, State, apply_action, apply_skip,
    boards, end_early, favour_pay, reseat, view_for,
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
        assert_eq!(b.check(), Ok(()), "board {}", b.name);
        assert_eq!(b.seats(), Pahunch::players().collect::<Vec<_>>(), "board {}", b.name);
    }
    assert_eq!(Pahunch::variants().len(), boards().len());
    let sides: Vec<&str> = boards()[0].sides.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(sides, ["full", "big"]);
    assert_eq!(fresh(5).layout.board, "full");
    assert_eq!(fresh(6).layout.board, "big");
    assert_eq!(fresh(7).layout.cap(fresh(7).layout.summit), 7);
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
    assert!(pahunch::new_game(8, 1, 0).is_err());
    assert!(pahunch::new_game(2, 1, 0).is_err());
}

#[test]
fn six_or_seven_players_play_the_other_side() {
    for (n, neutrals) in [(6, vec![(1, 2), (2, 1), (3, 1), (8, 1)]), (7, vec![(1, 1), (3, 1)])] {
        let s = pahunch::new_game(n, 1, 0).unwrap();
        assert_eq!(s.layout.board, "big");
        assert_eq!(s.layout.cap(s.layout.summit), 7);
        let held: Vec<(usize, usize)> = (0..s.rooms.len())
            .map(|r| (r, s.rooms[r].iter().filter(|x| x.is_none()).count()))
            .filter(|&(_, k)| k > 0)
            .collect();
        assert_eq!(held, neutrals, "{n} players");
        assert!(s.players.iter().all(|p| p.hand == 6 && p.tokens == vec![1, 1]));
        assert_eq!(s.supply, 60 - 2 * u16::from(n));
        assert_eq!(s.blocker, 20);
        let on: Vec<usize> = (0..s.tokens_on.len()).filter(|&i| s.tokens_on[i].is_some()).collect();
        assert_eq!(on, [4, 6, 7, 8, 10, 11, 12, 14, 15, 20, 23]);
        assert_eq!(s.layout.paths.iter().filter(|p| p.back).count(), 7);
        let entries: Vec<u8> = (0..15).filter(|&r| s.layout.entry(r)).collect();
        assert_eq!(entries, [0, 1, 2, 3]);
    }
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
    let t = act(&s, 0, Action::climb(11));
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
    let t = act(&s, 0, Action::climb(11));
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
    let t = act(&act(&s, 0, Action::climb(11)), 1, Action::Vote { yes: 0 });
    assert_eq!(t.rooms[3], vec![Some(0), Some(1)]);
    assert!(t.vote.is_none());
    assert_eq!(t.log.last(), Some(&LogEntry::Fail { p: 0 }));
    assert_eq!((t.turn, t.tried.clone()), (0, vec![3]));
    assert_eq!(Pahunch::pending(&t), vec![0]);
    // The same room may be asked again, as often as the mover likes.
    let again = act(&t, 0, Action::climb(12));
    assert_eq!(again.vote.as_ref().map(|v| v.room), Some(3));
    let u = act(&t, 0, Action::climb(4));
    assert_eq!((u.turn, u.tried.clone()), (1, vec![]));
}

#[test]
fn in_a_strict_game_a_room_votes_once_a_turn() {
    let mut s = fresh(5);
    s.options.one_vote_per_room = true;
    s.rooms[3] = vec![Some(0), Some(1)];
    s.rooms[8] = vec![Some(0), Some(0)];
    let t = act(&act(&s, 0, Action::climb(11)), 1, Action::Vote { yes: 0 });
    assert_eq!(refused(&t, 0, Action::climb(12)), "That room already said no this turn");
    // Another room, or a climb that needs no vote, is fine; the next turn forgets.
    let u = act(&t, 0, Action::climb(4));
    assert_eq!((u.turn, u.tried.clone()), (1, vec![]));
}

#[test]
fn with_the_setting_on_a_no_ends_the_turn() {
    let mut s = fresh(5);
    s.options.fail_ends_turn = true;
    s.rooms[3] = vec![Some(0), Some(1)];
    let t = act(&act(&s, 0, Action::climb(11)), 1, Action::Vote { yes: 0 });
    assert_eq!((t.turn, t.tried.clone()), (1, vec![]));
}

#[test]
fn a_bribe_stays_spent_when_the_vote_fails() {
    // Room 1 seats 5: leaving takes 3.
    let mut s = fresh(5);
    s.rooms[1] = vec![None, Some(0), Some(1), Some(2)];
    s.players[0].tokens = vec![3];
    let t = act(&s, 0, Action::climb(7));
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
    let old: State = serde_json::from_value(json.clone()).unwrap();
    assert!(old.options.fail_ends_turn);
    assert!(!old.options.favours);
    assert!(old.options.one_vote_per_room);
    assert!(old.tried.is_empty());
    // Saved with options, before the strict switch: one vote per room, as then.
    let mut json = serde_json::to_value(&s).unwrap();
    let o = json.as_object_mut().unwrap();
    o["options"].as_object_mut().unwrap().remove("oneVotePerRoom");
    o.remove("asked");
    let older: State = serde_json::from_value(json).unwrap();
    assert!(older.options.one_vote_per_room && !older.options.fail_ends_turn);
    assert!(older.asked.is_empty());
}

#[test]
fn the_admins_options_reach_the_game() {
    let none = game::Options::new();
    let s = Pahunch::new_game_with(3, 1, 0, &none).unwrap();
    assert_eq!(s.options, pahunch::Options::default());
    let on: game::Options = [
        ("failEndsTurn".to_owned(), true),
        ("favours".to_owned(), false),
        ("oneVotePerRoom".to_owned(), true),
        ("favourUsesOpen".to_owned(), true),
    ]
    .into();
    let t = Pahunch::new_game_with(3, 1, 0, &on).unwrap();
    assert!(t.options.fail_ends_turn && !t.options.favours && t.options.one_vote_per_room);
    assert!(t.options.favour_uses_open);
    assert_eq!(Pahunch::options().len(), 5);
}

#[test]
fn only_the_needed_yes_earn_a_token() {
    let mut s = fresh(5);
    // Room 1 seats 5: leaving takes 3.
    s.rooms[1] = vec![Some(0), Some(1), Some(1), Some(1), Some(2)];
    let t = act(&s, 0, Action::climb(7));
    let t = act(&t, 2, Action::Vote { yes: 0 });
    assert!(t.vote.is_some());
    let u = act(&t, 1, Action::Vote { yes: 3 });
    assert_eq!(u.rooms[8], vec![Some(0)]);
    assert!(u.log.contains(&LogEntry::Reward { p: 1, ones: 2 }));
    assert!(!u.log.iter().any(|e| matches!(e, LogEntry::Reward { p: 2, .. })));
}

/// Room 1 seats 5 (leaving takes 3, so 2 from the others): the mover has 1 there, seat 1 has 2,
/// seats 2 and 3 one each.
fn crowded_vote() -> State {
    let mut s = fresh(5);
    s.rooms[1] = vec![Some(0), Some(1), Some(1), Some(2), Some(3)];
    act(&s, 0, Action::climb(7))
}

#[test]
fn with_enough_yes_the_mover_takes_the_needed_ones_without_waiting() {
    let t = crowded_vote();
    let u = act(&t, 1, Action::Vote { yes: 2 });
    // Enough: the climb waits for the mover, who may take them now; seats 2 and 3 may still answer.
    assert!(u.vote.is_some());
    assert_eq!(Pahunch::pending(&u), vec![2, 3, 0]);
    assert_eq!(
        refused(
            &u,
            0,
            Action::Take {
                votes: vec![0, 1, 0, 0, 0]
            }
        ),
        "Take exactly the 2 yes votes the climb still needs"
    );
    assert_eq!(
        refused(
            &u,
            0,
            Action::Take {
                votes: vec![0, 0, 1, 1, 0]
            }
        ),
        "Take only yes votes that were given"
    );
    assert_eq!(
        refused(
            &u,
            1,
            Action::Take {
                votes: vec![0, 2, 0, 0, 0]
            }
        ),
        "Only the climber picks whose votes count"
    );
    let w = act(
        &u,
        0,
        Action::Take {
            votes: vec![0, 2, 0, 0, 0],
        },
    );
    assert_eq!(w.rooms[8], vec![Some(0)]);
    assert!(w.log.contains(&LogEntry::Reward { p: 1, ones: 2 }));
    assert_eq!(w.turn, 1);
}

#[test]
fn the_mover_decides_who_is_paid_when_more_yes_came_in() {
    let t = crowded_vote();
    let u = act(&act(&t, 1, Action::Vote { yes: 2 }), 2, Action::Vote { yes: 1 });
    let u = act(&u, 3, Action::Vote { yes: 1 });
    // Four yes for two needed, from three players: the mover picks.
    assert!(u.vote.is_some());
    assert_eq!(Pahunch::pending(&u), vec![0]);
    let w = act(
        &u,
        0,
        Action::Take {
            votes: vec![0, 0, 1, 1, 0],
        },
    );
    assert!(w.log.contains(&LogEntry::Reward { p: 2, ones: 1 }));
    assert!(w.log.contains(&LogEntry::Reward { p: 3, ones: 1 }));
    assert!(!w.log.iter().any(|e| matches!(e, LogEntry::Reward { p: 1, .. })));
}

#[test]
fn without_a_choice_the_vote_passes_by_itself() {
    let t = crowded_vote();
    // Exactly the needed yes from two players, everyone answered.
    let u = act(
        &act(&act(&t, 1, Action::Vote { yes: 1 }), 2, Action::Vote { yes: 1 }),
        3,
        Action::Vote { yes: 0 },
    );
    assert!(u.vote.is_none());
    assert!(u.log.contains(&LogEntry::Reward { p: 1, ones: 1 }));
    assert!(u.log.contains(&LogEntry::Reward { p: 2, ones: 1 }));
    // Spare yes from one player only: they are paid for the needed ones.
    let u = act(
        &act(&act(&t, 2, Action::Vote { yes: 0 }), 3, Action::Vote { yes: 0 }),
        1,
        Action::Vote { yes: 2 },
    );
    assert!(u.vote.is_none());
    assert!(u.log.contains(&LogEntry::Reward { p: 1, ones: 2 }));
}

#[test]
fn the_clock_takes_the_needed_yes_in_seat_order() {
    let t = crowded_vote();
    let u = act(&act(&t, 1, Action::Vote { yes: 2 }), 2, Action::Vote { yes: 1 });
    let w = Pahunch::time_up(&u).unwrap();
    assert!(w.vote.is_none());
    assert!(w.log.contains(&LogEntry::Vote { p: 3, yes: 0, of: 1 }));
    assert!(w.log.contains(&LogEntry::Reward { p: 1, ones: 2 }));
    assert!(!w.log.iter().any(|e| matches!(e, LogEntry::Reward { p: 2, .. })));
}

#[test]
fn a_bot_mover_takes_the_needed_yes() {
    use rand::SeedableRng;
    let u = act(&crowded_vote(), 1, Action::Vote { yes: 2 });
    let mut rng = rand::rngs::StdRng::seed_from_u64(1);
    let a = pahunch::choose_action(&view_for(&u, Some(0)), &mut rng).unwrap();
    assert!(act(&u, 0, a).vote.is_none());
}

#[test]
fn a_climb_without_enough_voters_is_refused() {
    let mut s = fresh(5);
    s.rooms[1] = vec![Some(0), Some(1)];
    assert_eq!(
        refused(&s, 0, Action::climb(7)),
        "Leaving takes 3 yes votes; there are not enough voters in the room"
    );
    s.rooms[9] = vec![Some(1); 3];
    s.rooms[3] = vec![Some(0), Some(0)];
    assert_eq!(refused(&s, 0, Action::climb(11)), "The room above is full");
}

#[test]
fn a_neutral_takes_one_token_of_two_or_more_and_it_leaves_the_game() {
    let mut s = fresh(3);
    s.rooms[1] = vec![None, Some(0), Some(0)];
    // Only 1s: a neutral will not take them, two or more of them neither, so the climb cannot
    // pass.
    s.players[0].tokens = vec![1, 1, 1, 1];
    assert!(apply_action(&s, 0, &Action::climb(7)).is_err());
    s.players[0].tokens = vec![1, 3];
    let t = act(&s, 0, Action::climb(7));
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
    let t = act(&s, 0, Action::climb(11));
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
    let t = act(&s, 0, Action::climb(20));
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
    assert_eq!(refused(&s, 0, Action::climb(1)), "The back stairs are locked");
    assert_eq!(refused(&s, 0, Action::climb(2)), "The back stairs are locked");
    act(&s, 0, Action::climb(0));
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
    let t = act(&s, 0, Action::climb(7));
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
    let t = act(&s, 0, Action::climb(20));
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
    let t = act(&s, 0, Action::climb(11));
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
    let t = act(&s, 0, Action::climb(7));
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
    let t = act(&s, 0, Action::climb(11));
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
    let t = act(&s, 0, Action::climb(11));
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
        "Use an extra move or end the turn"
    );
    assert_eq!(
        refused(&t, 0, Action::Nudge { path: 7 }),
        "Use an extra move or end the turn"
    );
    assert_eq!(
        refused(&t, 0, Action::Block { path: 0 }),
        "The blocker sits only on a path with a token"
    );
    assert_eq!(refused(&t, 1, Action::Done), "It is not your turn");
    let u = act(&t, 0, Action::Block { path: 4 });
    assert_eq!((u.blocker, u.turn), (4, 1));
    assert!(!u.moved);
}

#[test]
fn a_nudge_coin_gives_one_free_nudge_or_the_turn_ends_on_done() {
    let mut s = on_a_special(Bonus::Nudge);
    s.rooms[1] = vec![None];
    let t = act(&s, 0, Action::climb(11));
    assert_eq!(t.bonuses.nudge, 1);
    assert_eq!(
        refused(&t, 0, Action::Block { path: 4 }),
        "Use an extra move or end the turn"
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
    let t = act(&s, 0, Action::climb(11));
    assert_eq!((t.turn, t.moved), (1, false));
    assert_eq!(t.tokens_on[11], s.tokens_on[11]);
    // Taken after a vote, it fires as well.
    let mut s = on_a_special(Bonus::Block);
    s.rooms[3] = vec![Some(0), Some(1)];
    let t = act(&act(&s, 0, Action::climb(11)), 1, Action::Vote { yes: 1 });
    assert_eq!((t.turn, t.bonuses.block), (0, 1));
    // Given away, it is a plain 2.
    let u = act(&act(&t, 0, Action::Done), 0, Action::Give { to: 2, tokens: vec![2] });
    assert_eq!(u.players[2].tokens, vec![1, 1, 2]);
    assert_eq!((u.turn, u.moved), (1, false));
}

#[test]
fn a_favour_coin_without_favours_is_a_plain_two() {
    let mut s = on_a_special(Bonus::Favour);
    s.options.favours = false;
    let t = act(&s, 0, Action::climb(11));
    assert!(!t.log.iter().any(|e| matches!(e, LogEntry::Bonus { .. })));
    assert_eq!(t.turn, 1);
}

#[test]
fn a_full_top_ends_the_game_even_with_a_bonus_left() {
    let mut s = on_a_special(Bonus::Nudge);
    s.rooms[14] = vec![Some(1), Some(1), Some(2), Some(2)];
    s.rooms[13] = vec![None, None];
    let t = act(&s, 0, Action::climb(11));
    assert_eq!(t.bonuses.nudge, 1);
    let u = act(&t, 0, Action::Nudge { path: 20 });
    assert!(u.over);
    assert!(Pahunch::pending(&u).is_empty());
}

#[test]
fn a_skipped_mover_with_a_bonus_makes_a_legal_bonus_move() {
    let t = act(&on_a_special(Bonus::Block), 0, Action::climb(11));
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
    for key in ["bonuses", "moved", "lent", "used"] {
        o.remove(key);
    }
    for p in o["players"].as_array_mut().unwrap() {
        let p = p.as_object_mut().unwrap();
        p.remove("favour");
        p.remove("uses");
    }
    let old: State = serde_json::from_value(json).unwrap();
    assert_eq!(old.bag, vec![Coin::plain(2), Coin::plain(3), Coin::plain(5)]);
    assert_eq!(old.tokens_on, s.tokens_on);
    assert!(!old.moved && old.lent.is_empty());
    assert!(old.players.iter().all(|p| p.favour.is_none() && p.uses == 0));
}

#[test]
fn reseating_moves_bonus_lines() {
    let t = act(&on_a_special(Bonus::Block), 0, Action::climb(11));
    let r = reseat(&act(&t, 0, Action::Done), &[1, 2, 3, 4, 0]).unwrap();
    assert!(r.log.contains(&LogEntry::Bonus {
        p: 1,
        kind: Bonus::Block
    }));
    assert!(r.log.contains(&LogEntry::Done { p: 1 }));
}

// ---- favours ----

/// `owner` holds the one favour in the game, `kind` with both uses, and offers it to the mover.
fn lent(s: &State, owner: u8, kind: FavourKind) -> State {
    let mut s = s.clone();
    for p in &mut s.players {
        p.favour = None;
        p.uses = 0;
    }
    s.players[usize::from(owner)].favour = Some(kind);
    s.players[usize::from(owner)].uses = 2;
    act(&s, owner, Action::Lend { on: true })
}

fn used(owner: u8, kind: FavourKind) -> LogEntry {
    LogEntry::Favour { owner, user: 0, kind }
}

#[test]
fn every_player_is_dealt_a_different_favour_with_two_uses() {
    for n in [3, 4, 5] {
        let s = pahunch::new_game(n, 11, 0).unwrap();
        let mut kinds: Vec<FavourKind> = s.players.iter().map(|p| p.favour.unwrap()).collect();
        kinds.sort_unstable();
        kinds.dedup();
        assert_eq!(kinds.len(), usize::from(n));
        assert!(s.players.iter().all(|p| p.uses == 2));
        let off = Options {
            favours: false,
            ..Options::default()
        };
        let plain = pahunch::new_game_with(n, 11, 0, off).unwrap();
        assert!(plain.players.iter().all(|p| p.favour.is_none() && p.uses == 0));
        assert_eq!(
            (plain.turn, &plain.tokens_on),
            (s.turn, &s.tokens_on),
            "favours draw last"
        );
    }
    for kind in FavourKind::ALL {
        assert!(favour_pay().contains_key(&kind), "{kind:?} has a pay");
    }
    let s = pahunch::new_game(3, 11, 0).unwrap();
    let view = view_for(&s, None);
    assert!(
        view.players.iter().all(|p| p.favour.is_some() && p.uses.is_none()),
        "favours are public, their uses left hidden"
    );
    let own = view_for(&s, Some(1));
    let uses: Vec<_> = own.players.iter().map(|p| p.uses).collect();
    assert_eq!(uses, vec![None, Some(2), None], "a player sees their own uses");
    let mut open = s.clone();
    open.options.favour_uses_open = true;
    assert!(
        view_for(&open, None).players.iter().all(|p| p.uses == Some(2)),
        "the room may show everyone's"
    );
    let mut over = s;
    over.over = true;
    assert!(
        view_for(&over, None).players.iter().all(|p| p.uses == Some(2)),
        "all show at the end"
    );
}

#[test]
fn a_favour_is_offered_on_another_players_turn_and_can_be_taken_back() {
    let s = fresh(4);
    let mut mine = s.clone();
    mine.players[0].favour = Some(FavourKind::BackStairs);
    assert_eq!(
        refused(&mine, 0, Action::Lend { on: true }),
        "A favour helps another player's move"
    );
    let t = lent(&s, 2, FavourKind::BackStairs);
    assert_eq!(t.lent, vec![2]);
    assert_eq!(view_for(&t, Some(1)).lent, vec![2], "offers are public");
    assert_eq!(
        refused(&t, 2, Action::Lend { on: true }),
        "Your favour is on offer already"
    );
    let back = act(&t, 2, Action::Lend { on: false });
    assert!(back.lent.is_empty());
    assert_eq!(
        refused(&back, 2, Action::Lend { on: false }),
        "Your favour is not on offer"
    );
    // An offer the mover does not use costs nothing and ends with the turn.
    let u = act(&t, 0, Action::Enter { room: 1 });
    assert_eq!((u.turn, u.lent.clone(), u.players[2].uses), (1, vec![], 2));
    let mut spent = t.clone();
    spent.lent.clear();
    spent.players[2].uses = 0;
    assert_eq!(refused(&spent, 2, Action::Lend { on: true }), "Your favour is used up");
    let mut off = s.clone();
    off.options.favours = false;
    assert_eq!(refused(&off, 2, Action::Lend { on: true }), "Favours are off this game");
}

#[test]
fn the_back_gate_key_opens_back_paths_for_climbs_and_nudges() {
    let mut s = fresh(4);
    s.rooms[0] = vec![Some(0)];
    s.rooms[1] = vec![None];
    assert_eq!(refused(&s, 0, Action::climb(1)), "The back stairs are locked");
    let t = lent(&s, 3, FavourKind::BackStairs);
    let u = act(&t, 0, Action::climb(1));
    assert_eq!((u.rooms[8].clone(), u.turn), (vec![Some(0)], 1));
    assert!(u.log.contains(&used(3, FavourKind::BackStairs)));
    assert_eq!(u.players[3].uses, 1);
    assert_eq!(u.players[3].tokens, vec![1, 1], "it pays nothing");
    let n = act(&t, 0, Action::Nudge { path: 9 });
    assert_eq!(n.rooms[9], vec![None]);
    assert_eq!(n.players[3].uses, 1);
}

#[test]
fn the_extra_block_moves_the_blocker_before_or_after_the_main_move() {
    let s = lent(&fresh(4), 1, FavourKind::ExtraBlock);
    // Before: the blocker moves and the turn stays for the main move.
    let t = act(&s, 0, Action::Block { path: 4 });
    assert_eq!((t.blocker, t.turn, t.moved), (4, 0, false));
    assert_eq!(t.players[1].uses, 1);
    assert!(t.log.contains(&LogEntry::Reward { p: 1, ones: 1 }));
    assert_eq!(
        refused(&t, 1, Action::Lend { on: true }),
        "Your favour was used this turn"
    );
    assert_eq!(act(&t, 0, Action::Enter { room: 1 }).turn, 1);
    // After: the turn stays for it, until it is used or the turn ends.
    let after = act(&s, 0, Action::Enter { room: 1 });
    assert_eq!((after.turn, after.moved, Pahunch::pending(&after)), (0, true, vec![0]));
    assert_eq!(
        refused(&after, 0, Action::Nudge { path: 7 }),
        "Use an extra move or end the turn"
    );
    let block = act(&after, 0, Action::Block { path: 6 });
    assert_eq!((block.blocker, block.turn, block.players[1].uses), (6, 1, 1));
    let d = act(&after, 0, Action::Done);
    assert_eq!((d.turn, d.players[1].uses), (1, 2));
    // Taken back before the main move, the turn passes on that move.
    let back = act(&act(&s, 1, Action::Lend { on: false }), 0, Action::Enter { room: 1 });
    assert_eq!(back.turn, 1);
}

#[test]
fn the_covered_token_is_taken_from_under_the_blocker() {
    let mut s = fresh(4);
    s.rooms[3] = vec![Some(0), Some(0)];
    s.blocker = 11;
    let coin = s.tokens_on[11].unwrap();
    let refill = *s.bag.last().unwrap();
    let t = act(&lent(&s, 2, FavourKind::CoveredToken), 0, Action::climb(11));
    assert_eq!((t.blocker, t.tokens_on[11]), (11, Some(refill)));
    assert!(t.players[0].tokens.contains(&coin.value));
    assert!(t.log.contains(&LogEntry::Reward { p: 2, ones: 2 }));
    // Off the blocker's path it is not used.
    let u = act(&lent(&s, 2, FavourKind::CoveredToken), 0, Action::climb(12));
    assert_eq!(u.players[2].uses, 2);
}

#[test]
fn the_token_swap_takes_another_board_token_instead() {
    let mut s = fresh(4);
    s.rooms[3] = vec![Some(0), Some(0)];
    s.rooms[0] = vec![Some(0)];
    let swap = |path, to| Action::Climb {
        path,
        swap: Some(to),
        carry: None,
    };
    assert_eq!(refused(&s, 0, swap(11, 4)), "Nobody offers a token swap");
    let s = lent(&s, 1, FavourKind::SwapToken);
    assert_eq!(refused(&s, 0, swap(0, 4)), "That climb takes no token to swap");
    assert_eq!(
        refused(&s, 0, swap(11, 20)),
        "Swap for another uncovered token on the board"
    );
    assert_eq!(
        refused(&s, 0, swap(11, 11)),
        "Swap for another uncovered token on the board"
    );
    let (own, other, refill) = (s.tokens_on[11], s.tokens_on[4].unwrap(), *s.bag.last().unwrap());
    let t = act(&s, 0, swap(11, 4));
    assert_eq!((t.tokens_on[11], t.tokens_on[4]), (own, Some(refill)));
    assert!(t.players[0].tokens.contains(&other.value));
    assert!(t.log.contains(&used(1, FavourKind::SwapToken)));
}

#[test]
fn climb_again_lets_a_climber_in_a_one_room_go_on() {
    let s = lent(&fresh(4), 1, FavourKind::ClimbAgain);
    let t = act(&s, 0, Action::Enter { room: 2 });
    assert_eq!((t.turn, t.bonuses.climb_again), (0, Some(2)));
    assert_eq!(t.players[1].uses, 2, "used only when the climber goes on");
    assert_eq!(
        refused(&t, 0, Action::climb(11)),
        "Climb on with the climber that just arrived"
    );
    let u = act(&t, 0, Action::climb(10));
    assert_eq!((u.rooms[9].clone(), u.turn, u.players[1].uses), (vec![Some(0)], 1, 1));
    assert!(u.log.contains(&used(1, FavourKind::ClimbAgain)));
    let d = act(&t, 0, Action::Done);
    assert_eq!((d.turn, d.players[1].uses), (1, 2));
    // Into a room of 3 there is nothing to offer.
    assert_eq!(act(&s, 0, Action::Enter { room: 3 }).turn, 1);
}

#[test]
fn squeezing_in_puts_one_extra_into_a_full_room_but_never_the_top() {
    let mut s = fresh(4);
    s.rooms[3] = vec![Some(1), Some(2), Some(3)];
    assert_eq!(refused(&s, 0, Action::Enter { room: 3 }), "That room is full");
    let t = act(&lent(&s, 1, FavourKind::SqueezeIn), 0, Action::Enter { room: 3 });
    assert_eq!(t.rooms[3].len(), 4);
    assert!(t.log.contains(&LogEntry::Reward { p: 1, ones: 2 }));
    // One extra at most.
    let mut u = lent(&t, 2, FavourKind::SqueezeIn);
    u.turn = 1;
    u.lent = vec![2];
    u.used.clear();
    assert_eq!(refused(&u, 1, Action::Enter { room: 3 }), "That room is full");
    // Leaving still takes the votes of a room of 3.
    let mut v = fresh(4);
    v.rooms[3] = vec![Some(0), Some(0), Some(1), Some(2)];
    assert_eq!(act(&v, 0, Action::climb(11)).turn, 1, "2 own climbers are enough");
}

#[test]
fn a_carry_takes_one_more_piece_along_without_a_token() {
    let mut s = fresh(4);
    s.rooms[3] = vec![Some(0), Some(0), Some(1)];
    let carry = |c| Action::Climb {
        path: 11,
        swap: None,
        carry: Some(c),
    };
    assert_eq!(
        refused(&s, 0, carry(Carry::Seat { seat: 1 })),
        "Nobody offers to take a piece along"
    );
    let s = lent(&s, 2, FavourKind::Carry);
    assert_eq!(refused(&s, 0, carry(Carry::Neutral)), "That piece is not in the room");
    let t = act(&s, 0, carry(Carry::Seat { seat: 1 }));
    assert_eq!(t.rooms[9], vec![Some(0), Some(1)]);
    assert_eq!(t.rooms[3], vec![Some(0)]);
    assert_eq!(t.players[1].tokens, vec![1, 1], "the carried piece takes no token");
    assert!(t.log.contains(&LogEntry::Carry {
        p: 0,
        who: Some(1),
        path: 11
    }));
    let own = act(&s, 0, carry(Carry::Seat { seat: 0 }));
    assert_eq!(own.rooms[9], vec![Some(0), Some(0)]);
    // It needs two places above; a squeeze can give one.
    let mut full = s.clone();
    full.rooms[9] = vec![Some(3), Some(3)];
    assert_eq!(
        refused(&full, 0, carry(Carry::Seat { seat: 1 })),
        "The room above is full"
    );
    let mut both = full.clone();
    both.players[3].favour = Some(FavourKind::SqueezeIn);
    both.players[3].uses = 2;
    let both = act(&both, 3, Action::Lend { on: true });
    let u = act(&both, 0, carry(Carry::Seat { seat: 1 }));
    assert_eq!(u.rooms[9].len(), 4);
    assert_eq!((u.players[2].uses, u.players[3].uses), (1, 1));
}

#[test]
fn a_carry_after_a_vote_waits_for_the_vote() {
    let mut s = fresh(4);
    s.rooms[3] = vec![Some(0), Some(1), Some(2)];
    let s = lent(&s, 3, FavourKind::Carry);
    let t = act(
        &s,
        0,
        Action::Climb {
            path: 11,
            swap: None,
            carry: Some(Carry::Seat { seat: 2 }),
        },
    );
    assert!(t.vote.is_some());
    assert_eq!(
        refused(&t, 3, Action::Lend { on: false }),
        "Wait for the vote to finish"
    );
    let failed = act(&act(&t, 1, Action::Vote { yes: 0 }), 2, Action::Vote { yes: 0 });
    assert_eq!((failed.players[3].uses, failed.rooms[3].len()), (2, 3));
    // Enough yes with seat 2 still to answer: the mover takes seat 1's without waiting.
    let enough = act(&t, 1, Action::Vote { yes: 1 });
    assert!(enough.vote.is_some());
    let passed = act(
        &enough,
        0,
        Action::Take {
            votes: vec![0, 1, 0, 0],
        },
    );
    assert_eq!(passed.rooms[9], vec![Some(0), Some(2)]);
    assert_eq!(passed.players[3].uses, 1);
}

#[test]
fn a_favour_coin_gives_a_use_back() {
    let mut s = on_a_special(Bonus::Favour);
    s.players[0].favour = Some(FavourKind::Carry);
    s.players[0].uses = 1;
    let t = act(&s, 0, Action::climb(11));
    assert_eq!(t.players[0].uses, 2);
    assert!(t.log.contains(&LogEntry::Bonus {
        p: 0,
        kind: Bonus::Favour
    }));
    s.players[0].uses = 2;
    let full = act(&s, 0, Action::climb(11));
    assert_eq!(full.players[0].uses, 2);
    assert!(!full.log.iter().any(|e| matches!(e, LogEntry::Bonus { .. })));
}

#[test]
fn reseating_moves_favours_offers_and_carries() {
    let mut s = fresh(3);
    s.rooms[3] = vec![Some(0), Some(1), Some(2)];
    let s = lent(&s, 1, FavourKind::Carry);
    let t = act(
        &s,
        0,
        Action::Climb {
            path: 11,
            swap: None,
            carry: Some(Carry::Seat { seat: 2 }),
        },
    );
    let r = reseat(&t, &[1, 2, 0]).unwrap();
    assert_eq!(r.lent, vec![2]);
    assert_eq!(r.players[2].favour, Some(FavourKind::Carry));
    assert_eq!(r.vote.as_ref().unwrap().carry, Some(Carry::Seat { seat: 0 }));
    let done = act(
        &act(&t, 1, Action::Vote { yes: 1 }),
        0,
        Action::Take { votes: vec![0, 1, 0] },
    );
    let r = reseat(&done, &[1, 2, 0]).unwrap();
    assert!(r.log.contains(&LogEntry::Favour {
        owner: 2,
        user: 1,
        kind: FavourKind::Carry
    }));
    assert!(r.log.contains(&LogEntry::Carry {
        p: 1,
        who: Some(0),
        path: 11
    }));
}

fn ask(owner: u8) -> Action {
    Action::Request { owner, on: true }
}

#[test]
fn the_mover_asks_for_a_favour_and_the_owner_says_yes_or_no() {
    let s = fresh(4);
    assert_eq!(refused(&s, 0, ask(0)), "A favour helps another player's move");
    assert_eq!(refused(&s, 1, ask(2)), "Ask for a favour on your own turn");
    let t = act(&s, 0, ask(2));
    assert_eq!(t.asked, vec![2]);
    assert!(t.log.contains(&LogEntry::Request { p: 0, owner: 2 }));
    assert_eq!(Pahunch::pending(&t), vec![0, 2], "the owner owes an answer");
    assert_eq!(view_for(&t, Some(1)).asked, vec![2], "requests are public");
    assert_eq!(refused(&t, 0, ask(2)), "You asked already");
    assert_eq!(refused(&t, 1, Action::Decline), "Nobody asked for your favour");
    // Yes: offering it answers.
    let yes = act(&t, 2, Action::Lend { on: true });
    assert_eq!((yes.lent.clone(), yes.asked.clone()), (vec![2], vec![]));
    assert_eq!(Pahunch::pending(&yes), vec![0]);
    // No.
    let no = act(&t, 2, Action::Decline);
    assert!(no.asked.is_empty() && no.lent.is_empty());
    assert_eq!(no.log.last(), Some(&LogEntry::Decline { p: 2 }));
    // Taken back by the mover.
    let back = act(&t, 0, Action::Request { owner: 2, on: false });
    assert!(back.asked.is_empty());
    assert_eq!(
        refused(&back, 0, Action::Request { owner: 2, on: false }),
        "You did not ask for that favour"
    );
    // The mover's move does not wait for the answer; the turn's end clears it.
    let moved = act(&t, 0, Action::Enter { room: 1 });
    assert_eq!((moved.turn, moved.asked.clone()), (1, vec![]));
}

#[test]
fn a_request_needs_a_favour_that_can_still_be_given() {
    let mut s = fresh(4);
    s.rooms[3] = vec![Some(0), Some(1)];
    let vote = act(&s, 0, Action::climb(11));
    assert_eq!(refused(&vote, 0, ask(2)), "Wait for the vote to finish");
    let mut spent = s.clone();
    spent.players[2].uses = 0;
    assert_eq!(refused(&spent, 0, ask(2)), "Their favour is used up");
    let offered = act(&s, 2, Action::Lend { on: true });
    assert_eq!(refused(&offered, 0, ask(2)), "Their favour is on offer already");
    let mut used = s.clone();
    used.used = vec![2];
    assert_eq!(refused(&used, 0, ask(2)), "Their favour was used this turn");
    let mut none = s.clone();
    none.players[2].favour = None;
    assert_eq!(refused(&none, 0, ask(2)), "They have no favour");
    let mut off = s.clone();
    off.options.favours = false;
    assert_eq!(refused(&off, 0, ask(2)), "Favours are off this game");
    // A request made before a vote can be answered while it runs.
    let during = act(&act(&s, 0, ask(2)), 0, Action::climb(11));
    assert_eq!(Pahunch::pending(&during), vec![1, 2]);
    assert!(act(&during, 2, Action::Decline).asked.is_empty());
}

#[test]
fn the_mover_turns_down_a_favour_on_offer() {
    let mut s = fresh(4);
    s.rooms[3] = vec![Some(0), Some(1)];
    let offered = act(&s, 2, Action::Lend { on: true });
    let no = Action::Request { owner: 2, on: false };
    assert_eq!(refused(&offered, 1, no.clone()), "Ask for a favour on your own turn");
    let down = act(&offered, 0, no.clone());
    assert!(down.lent.is_empty() && down.used.is_empty());
    assert_eq!(down.players[2].uses, offered.players[2].uses, "nothing is spent");
    // The owner may offer it again.
    assert_eq!(act(&down, 2, Action::Lend { on: true }).lent, vec![2]);
    // Not while a vote runs: the climb may be using it.
    let vote = act(&offered, 0, Action::climb(11));
    assert_eq!(refused(&vote, 0, no), "Wait for the vote to finish");
}

#[test]
fn a_strict_game_offers_each_favour_once_a_turn() {
    let mut s = fresh(4);
    s.options.one_vote_per_room = true;
    let offered = act(&s, 2, Action::Lend { on: true });
    // Turned down by the mover: neither offered nor asked for again this turn.
    let down = act(&offered, 0, Action::Request { owner: 2, on: false });
    assert_eq!(down.withdrawn, vec![2]);
    assert_eq!(
        refused(&down, 2, Action::Lend { on: true }),
        "Strict game: your favour was offered once this turn"
    );
    assert_eq!(
        refused(&down, 0, ask(2)),
        "Strict game: their favour was offered once this turn"
    );
    // Taken back by its owner: the same.
    let back = act(&offered, 2, Action::Lend { on: false });
    assert_eq!(
        refused(&back, 2, Action::Lend { on: true }),
        "Strict game: your favour was offered once this turn"
    );
    // The next turn starts afresh.
    let next = act(&down, 0, Action::Enter { room: 1 });
    assert!(next.withdrawn.is_empty());
    // Off (the default), it may be offered again.
    let mut loose = offered.clone();
    loose.options.one_vote_per_room = false;
    let again = act(
        &act(&loose, 0, Action::Request { owner: 2, on: false }),
        2,
        Action::Lend { on: true },
    );
    assert_eq!(again.lent, vec![2]);
}

#[test]
fn a_bot_answers_a_request_either_way_and_a_skipped_owner_says_no() {
    use rand::SeedableRng;
    let t = act(&fresh(4), 0, ask(2));
    let skipped = apply_skip(&t, 2).unwrap();
    assert!(skipped.asked.is_empty() && skipped.lent.is_empty());
    assert_eq!(skipped.log.last(), Some(&LogEntry::Decline { p: 2 }));
    let mut answers = std::collections::BTreeSet::new();
    for seed in 0..20 {
        let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
        let a = pahunch::choose_action(&view_for(&t, Some(2)), &mut rng).unwrap();
        assert!(act(&t, 2, a.clone()).asked.is_empty());
        answers.insert(format!("{a:?}"));
    }
    assert_eq!(answers.len(), 2, "yes and no: {answers:?}");
}

#[test]
fn reseating_moves_requests() {
    let t = act(&fresh(3), 0, ask(1));
    let r = reseat(&t, &[1, 2, 0]).unwrap();
    assert_eq!(r.asked, vec![2]);
    assert!(r.log.contains(&LogEntry::Request { p: 1, owner: 2 }));
    let r = reseat(&act(&t, 1, Action::Decline), &[1, 2, 0]).unwrap();
    assert!(r.log.contains(&LogEntry::Decline { p: 2 }));
}

fn plead(of: u8, count: u8) -> Action {
    Action::Plead { of, count }
}

#[test]
fn an_ask_for_tokens_is_answered_by_any_gift_or_a_no() {
    let mut s = fresh(4);
    s.players[2].tokens = vec![1, 3, 4];
    // Off turn, like a gift: seat 1 asks seat 2 for two tokens.
    let t = act(&s, 1, plead(2, 2));
    assert_eq!(t.pleas, vec![Plea { by: 1, of: 2, count: 2 }]);
    assert_eq!(t.log.last(), Some(&LogEntry::Plea { p: 1, of: 2, count: 2 }));
    assert_eq!(t.turn, 0, "an ask is not a turn");
    assert!(Pahunch::pending(&t).contains(&2), "the player asked owes an answer");
    assert_eq!(refused(&t, 1, plead(2, 1)), "You asked them already");
    // Yes: a gift of any count closes it.
    let yes = act(&t, 2, Action::Give { to: 1, tokens: vec![4] });
    assert!(yes.pleas.is_empty());
    assert!(!Pahunch::pending(&yes).contains(&2));
    // A gift to someone else leaves it open.
    let other = act(&t, 2, Action::Give { to: 3, tokens: vec![4] });
    assert_eq!(other.pleas.len(), 1);
    // No.
    let no = act(
        &t,
        2,
        Action::Refuse {
            from: 1,
            deal: Deal::Plea,
        },
    );
    assert!(no.pleas.is_empty());
    assert_eq!(
        no.log.last(),
        Some(&LogEntry::Refuse {
            p: 2,
            to: 1,
            deal: Deal::Plea
        })
    );
    // Taken back.
    let back = act(
        &t,
        1,
        Action::Recall {
            to: 2,
            deal: Deal::Plea,
        },
    );
    assert!(back.pleas.is_empty());
    assert_eq!(
        refused(
            &back,
            1,
            Action::Recall {
                to: 2,
                deal: Deal::Plea
            }
        ),
        "You opened no such deal with them"
    );
    assert_eq!(
        refused(
            &t,
            3,
            Action::Refuse {
                from: 1,
                deal: Deal::Plea
            }
        ),
        "They opened no such deal with you"
    );
}

#[test]
fn an_ask_names_a_count_for_another_player() {
    let s = fresh(3);
    assert_eq!(refused(&s, 1, plead(1, 1)), "Ask another player");
    assert_eq!(refused(&s, 1, plead(3, 1)), "Ask another player");
    assert_eq!(refused(&s, 1, plead(2, 0)), "Ask for 1 to 9 tokens");
    assert_eq!(refused(&s, 1, plead(2, 10)), "Ask for 1 to 9 tokens");
    // Each way is its own ask.
    let t = act(&act(&s, 1, plead(2, 1)), 2, plead(1, 3));
    assert_eq!(t.pleas.len(), 2);
}

fn swap(to: u8, give: &[u8], want: &[u8]) -> Action {
    Action::Offer {
        to,
        give: give.to_vec(),
        want: want.to_vec(),
    }
}

#[test]
fn a_swap_offer_is_any_deal_the_other_takes_or_refuses() {
    // Change between players: seat 1 breaks a 4 into 2 + 2 with seat 3, off turn.
    let mut s = fresh(4);
    s.players[1].tokens = vec![4];
    s.players[3].tokens = vec![1, 2, 2];
    let supply = s.supply;
    let t = act(&s, 1, swap(3, &[4], &[2, 2]));
    assert_eq!(t.offers.len(), 1);
    assert_eq!(
        t.log.last(),
        Some(&LogEntry::Offer {
            p: 1,
            to: 3,
            give: 1,
            want: 2
        })
    );
    assert!(Pahunch::pending(&t).contains(&3));
    assert_eq!(
        refused(&t, 1, swap(3, &[4], &[1])),
        "You have an offer open with them already"
    );
    let u = act(&t, 3, Action::Accept { from: 1 });
    assert_eq!(u.players[1].tokens, vec![2, 2]);
    assert_eq!(u.players[3].tokens, vec![1, 4]);
    assert!(u.offers.is_empty());
    assert_eq!(u.supply, supply, "never with the supply");
    assert_eq!(
        u.log.last(),
        Some(&LogEntry::Trade {
            from: 1,
            to: 3,
            gave: 1,
            got: 2
        })
    );
    assert_eq!(u.turn, 0, "a swap is not a turn");
    // Unequal value is fine: a 4 for a 1.
    let v = act(&act(&s, 1, swap(3, &[4], &[1])), 3, Action::Accept { from: 1 });
    assert_eq!(v.players[1].tokens, vec![1]);
    // Refused.
    let no = act(
        &t,
        3,
        Action::Refuse {
            from: 1,
            deal: Deal::Offer,
        },
    );
    assert!(no.offers.is_empty() && no.players[1].tokens == vec![4]);
}

#[test]
fn a_swap_needs_the_tokens_on_both_sides() {
    let mut s = fresh(3);
    s.players[1].tokens = vec![4];
    s.players[2].tokens = vec![1, 1];
    assert_eq!(refused(&s, 1, swap(2, &[3], &[1])), "You do not have those tokens");
    assert_eq!(refused(&s, 1, swap(2, &[], &[1])), "A swap needs tokens both ways");
    assert_eq!(refused(&s, 1, swap(2, &[4], &[])), "A swap needs tokens both ways");
    assert_eq!(refused(&s, 1, swap(2, &[4], &[0])), "No token is worth 0");
    assert_eq!(refused(&s, 1, swap(1, &[4], &[1])), "Offer to another player");
    // Seat 2 lacks a 3.
    let t = act(&s, 1, swap(2, &[4], &[3]));
    assert_eq!(
        refused(&t, 2, Action::Accept { from: 1 }),
        "You do not have the tokens they want"
    );
    // Seat 1 gave the 4 away meanwhile: the offer ends, as taken back, and nobody waits on it.
    let t = act(&s, 1, swap(2, &[4], &[1]));
    let gone = act(&t, 1, Action::Give { to: 0, tokens: vec![4] });
    assert!(gone.offers.is_empty());
    assert_eq!(
        gone.log.last(),
        Some(&LogEntry::Recall {
            p: 1,
            to: 2,
            deal: Deal::Offer
        })
    );
    assert!(!Pahunch::pending(&gone).contains(&2));
    assert_eq!(refused(&gone, 2, Action::Accept { from: 1 }), "They offer you no swap");
    assert_eq!(refused(&s, 2, Action::Accept { from: 1 }), "They offer you no swap");
}

#[test]
fn others_see_a_swap_but_not_its_values() {
    let mut s = fresh(3);
    s.players[1].tokens = vec![4];
    let t = act(&s, 1, swap(2, &[4], &[2, 2]));
    for seat in [1, 2] {
        assert_eq!(view_for(&t, Some(seat)).offers[0].give, vec![4]);
    }
    for seat in [Some(0), None] {
        let o = &view_for(&t, seat).offers[0];
        assert_eq!((o.give.clone(), o.want.clone()), (vec![0], vec![0, 0]));
    }
    assert_eq!(view_for(&t, Some(0)).pleas, t.pleas);
}

#[test]
fn deals_outlast_the_turn_but_not_the_game() {
    let mut s = fresh(3);
    s.rooms[0] = vec![Some(0)];
    let t = act(&act(&s, 1, plead(2, 1)), 1, swap(2, &[1], &[1]));
    let u = act(&t, 0, Action::climb(0));
    assert_ne!(u.turn, 0);
    assert_eq!((u.pleas.len(), u.offers.len()), (1, 1));
    let over = end_early(&t, 0).unwrap();
    assert!(over.pleas.is_empty() && over.offers.is_empty());
}

#[test]
fn a_skipped_player_refuses_deals_and_a_bot_answers_either_way() {
    use rand::SeedableRng;
    let mut s = fresh(3);
    s.players[2].tokens = vec![1, 2];
    let t = act(&act(&s, 1, plead(2, 1)), 1, swap(2, &[1], &[2]));
    let once = apply_skip(&t, 2).unwrap();
    assert!(once.pleas.is_empty() && once.offers.len() == 1);
    let twice = apply_skip(&once, 2).unwrap();
    assert!(twice.offers.is_empty());
    assert!(!Pahunch::pending(&twice).contains(&2));
    let mut answers = std::collections::HashSet::new();
    for seed in 0..30 {
        let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
        for state in [&t, &once] {
            let a = pahunch::choose_action(&view_for(state, Some(2)), &mut rng).unwrap();
            act(state, 2, a.clone());
            answers.insert(std::mem::discriminant(&a));
        }
    }
    assert_eq!(answers.len(), 3, "give, accept and refuse");
}

#[test]
fn a_swap_can_end_a_vote_that_lost_its_bribe() {
    let mut s = fresh(3);
    s.rooms[1] = vec![None, Some(0), Some(0)];
    s.players[0].tokens = vec![3];
    let t = act(&s, 0, Action::climb(7));
    let u = act(&act(&t, 0, swap(1, &[3], &[1])), 1, Action::Accept { from: 0 });
    assert!(u.vote.is_none());
    assert!(u.log.contains(&LogEntry::Fail { p: 0 }));
}

#[test]
fn reseating_moves_deals() {
    let mut s = fresh(3);
    s.players[1].tokens = vec![2];
    let t = act(&act(&s, 1, plead(2, 1)), 1, swap(0, &[2], &[1]));
    let r = reseat(&t, &[1, 2, 0]).unwrap();
    assert_eq!(r.pleas, vec![Plea { by: 2, of: 0, count: 1 }]);
    assert_eq!((r.offers[0].by, r.offers[0].to), (2, 1));
    assert!(r.log.contains(&LogEntry::Plea { p: 2, of: 0, count: 1 }));
    let done = act(&t, 0, Action::Accept { from: 1 });
    let r = reseat(&done, &[1, 2, 0]).unwrap();
    assert!(r.log.contains(&LogEntry::Trade {
        from: 2,
        to: 1,
        gave: 1,
        got: 1
    }));
}

/// Random games where the other players lend whenever they like, the mover asks for favours and
/// now and then for a swap or a carry: the board stays sound and every game ends.
#[test]
fn random_games_with_favours_lent_keep_the_board_sound() {
    use rand::rngs::StdRng;
    use rand::{RngExt, SeedableRng};
    let mut seen = std::collections::BTreeSet::new();
    for n in [3_u8, 4, 5] {
        for seed in 0..40_u32 {
            let mut rng = StdRng::seed_from_u64(u64::from(seed));
            let mut s = pahunch::new_game(n, seed, 0).unwrap();
            let pieces = s.rooms.iter().flatten().filter(|x| x.is_none()).count();
            let mut steps = 0;
            while !s.over {
                steps += 1;
                assert!(steps < 5000, "{n} seats, seed {seed}: no end");
                let other = rng.random_range(0..n);
                if let Ok(t) = apply_action(
                    &s,
                    other,
                    &Action::Lend {
                        on: rng.random_bool(0.8),
                    },
                ) {
                    s = t;
                }
                let request = Action::Request {
                    owner: rng.random_range(0..n),
                    on: rng.random_bool(0.9),
                };
                if rng.random_bool(0.3)
                    && let Ok(t) = apply_action(&s, s.turn, &request)
                {
                    s = t;
                }
                let owe = Pahunch::pending(&s);
                let seat = owe[rng.random_range(0..owe.len())];
                let mut a = pahunch::choose_action(&view_for(&s, Some(seat)), &mut rng).unwrap();
                if let Action::Climb { path, .. } = a {
                    let pick = rng.random_range(0..10_u8);
                    let tweak = match pick {
                        0..2 => Action::Climb {
                            path,
                            swap: Some(rng.random_range(0..24)),
                            carry: None,
                        },
                        2..4 => Action::Climb {
                            path,
                            swap: None,
                            carry: Some(if pick == 2 {
                                Carry::Neutral
                            } else {
                                Carry::Seat {
                                    seat: rng.random_range(0..n),
                                }
                            }),
                        },
                        _ => a.clone(),
                    };
                    if apply_action(&s, seat, &tweak).is_ok() {
                        a = tweak;
                    }
                }
                s = act(&s, seat, a);
                for (r, room) in s.rooms.iter().enumerate() {
                    let r = u8::try_from(r).unwrap();
                    let cap = usize::from(s.layout.cap(r));
                    let most = if r == s.layout.summit { cap } else { cap + 1 };
                    assert!(
                        room.len() <= most,
                        "{n} seats, seed {seed}: room {r} holds {}",
                        room.len()
                    );
                }
                for seat in 0..n {
                    let on = s.rooms.iter().flatten().filter(|&&x| x == Some(seat)).count();
                    assert_eq!(on + usize::from(s.players[usize::from(seat)].hand), 6);
                }
                assert_eq!(s.rooms.iter().flatten().filter(|x| x.is_none()).count(), pieces);
                assert!(s.players.iter().all(|p| p.uses <= 2));
                assert!(!s.lent.contains(&s.turn) || s.over);
                assert!(!s.asked.contains(&s.turn));
                assert!(s.asked.iter().all(|o| !s.lent.contains(o)));
            }
            seen.extend(s.log.iter().filter_map(|e| match e {
                LogEntry::Favour { kind, .. } => Some(*kind),
                _ => None,
            }));
        }
    }
    assert_eq!(
        seen.into_iter().collect::<Vec<_>>(),
        FavourKind::ALL,
        "every favour got used"
    );
}
