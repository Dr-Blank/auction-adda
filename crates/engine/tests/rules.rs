//! The rules, move by move. Ported from the TypeScript engine tests; same cases, same order.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::panic,
    clippy::needless_pass_by_value
)]

use engine::{
    Action, AuctionKind, AuctionType, Card, GameState, LogEntry, Money, Sale, apply_action, apply_ruling, apply_skip,
    build_deck, config, new_game, pending, undo_ruling, view_for,
};

use AuctionType::{Double, Fixed, Once, Open, Sealed};

/// The k-th card of a suit and auction type.
fn c(suit: u8, kind: AuctionType, k: usize) -> Card {
    build_deck()
        .into_iter()
        .filter(|x| x.suit == suit && x.kind == kind)
        .nth(k)
        .unwrap_or_else(|| panic!("no card {suit}/{kind:?}/{k}"))
}

/// Fillers keep hands non-empty without interfering (suit 4, never reaches the limit in these tests).
fn f(k: usize) -> Card {
    c(4, Open, k)
}

/// A game with chosen hands; seat 0 is to play.
fn table(hands: &[&[Card]], money: Option<&[Money]>) -> GameState {
    let mut s = new_game(u8::try_from(hands.len()).unwrap(), 1).unwrap();
    s.turn = 0;
    s.log.clear();
    for (p, h) in s.players.iter_mut().zip(hands) {
        p.hand = h.to_vec();
    }
    for (p, &m) in s.players.iter_mut().zip(money.unwrap_or_default()) {
        p.money = m;
    }
    s
}

fn run(mut s: GameState, moves: &[(u8, Action)]) -> GameState {
    for (seat, action) in moves {
        s = apply_action(&s, *seat, action).unwrap_or_else(|e| panic!("seat {seat} {action:?}: {e}"));
    }
    s
}

fn illegal(s: &GameState, seat: u8, action: Action) {
    assert!(
        apply_action(s, seat, &action).is_err(),
        "seat {seat} {action:?} should be rejected"
    );
}

fn money(s: &GameState) -> Vec<Money> {
    s.players.iter().map(|p| p.money).collect()
}

fn bought(s: &GameState) -> Vec<Vec<u8>> {
    s.players
        .iter()
        .map(|p| p.bought.iter().map(|x| x.id).collect())
        .collect()
}

fn play(card: Card) -> Action {
    Action::Play {
        card: card.id,
        second: None,
    }
}
fn play2(card: Card, second: Card) -> Action {
    Action::Play {
        card: card.id,
        second: Some(second.id),
    }
}
/// Open auction bid.
fn bid(amount: Money, seen_high: Money) -> Action {
    Action::Bid {
        amount,
        seen_high: Some(seen_high),
    }
}
/// Once-around bid.
fn bid1(amount: Money) -> Action {
    Action::Bid {
        amount,
        seen_high: None,
    }
}
fn done(seen_high: Money) -> Action {
    Action::Done { seen_high }
}
fn sealed(amount: Money) -> Action {
    Action::Sealed { amount }
}
fn price(amount: Money) -> Action {
    Action::Price { amount }
}
fn add(card: Card) -> Action {
    Action::Add { card: card.id }
}
const PASS: Action = Action::Pass;
const ACCEPT: Action = Action::Accept;
const DECLINE: Action = Action::Decline;

mod deck_and_deal {
    use super::*;

    #[test]
    fn has_70_cards_matching_the_table() {
        let deck = build_deck();
        assert_eq!(deck.len(), 70);
        let ids: std::collections::HashSet<u8> = deck.iter().map(|x| x.id).collect();
        assert_eq!(ids.len(), 70);
        for (suit, row) in (0..).zip(&config().card_table) {
            for (&kind, &count) in row {
                assert_eq!(
                    deck.iter().filter(|x| x.suit == suit && x.kind == kind).count(),
                    usize::from(count)
                );
            }
        }
        let sizes: Vec<usize> = (0..5)
            .map(|suit| deck.iter().filter(|x| x.suit == suit).count())
            .collect();
        assert_eq!(sizes, [12, 13, 14, 15, 16]);
    }

    #[test]
    fn deals_the_first_round_per_player_count() {
        for (&n, cfg) in &config().players {
            let s = new_game(n, 7).unwrap();
            assert!(s.players.iter().all(|p| p.hand.len() == usize::from(cfg.deal[0])));
            assert_eq!(s.deck.len(), 70 - usize::from(n) * usize::from(cfg.deal[0]));
            assert!(money(&s).iter().all(|&m| m == cfg.start_money));
        }
    }

    #[test]
    fn rejects_unsupported_player_counts() {
        assert!(new_game(2, 1).is_err());
        assert!(new_game(6, 1).is_err());
    }
}

mod open_auction {
    use super::*;

    fn start() -> GameState {
        run(
            table(&[&[c(0, Open, 0), f(0)], &[f(1)], &[f(2)]], None),
            &[(0, play(c(0, Open, 0)))],
        )
    }

    #[test]
    fn sells_to_the_high_bidder_once_everyone_else_is_done_winner_pays_the_auctioneer() {
        let mut s = start();
        assert_eq!(pending(&s), [0, 1, 2]);
        s = run(s, &[(1, bid(10, 0)), (2, bid(15, 10)), (0, done(15))]);
        assert!(s.auction.is_some());
        s = run(s, &[(1, done(15))]);
        assert!(s.auction.is_none());
        assert_eq!(money(&s), [115, 100, 85]);
        assert_eq!(bought(&s)[2], [c(0, Open, 0).id]);
        assert_eq!(s.turn, 1);
    }

    #[test]
    fn rejects_a_bid_or_done_made_against_a_stale_high_bid() {
        let s = run(start(), &[(1, bid(10, 0))]);
        illegal(&s, 2, bid(10, 0));
        illegal(&s, 2, bid(12, 0));
        illegal(&s, 2, done(0));
        illegal(&s, 1, done(10));
        illegal(&s, 1, bid(20, 10));
    }

    #[test]
    fn done_stays_done_when_others_raise() {
        let mut s = run(start(), &[(0, done(0)), (1, bid(5, 0))]);
        assert_eq!(s.auction.as_ref().unwrap().done, [true, false, false]);
        assert_eq!(pending(&s), [2]);
        s = run(s, &[(2, done(5))]);
        assert_eq!(money(&s), [105, 95, 100]);
    }

    #[test]
    fn bidding_again_brings_a_done_player_back_in() {
        let mut s = run(start(), &[(0, done(0)), (1, bid(5, 0)), (0, bid(6, 5))]);
        assert_eq!(s.auction.as_ref().unwrap().done, [false, false, false]);
        assert_eq!(pending(&s), [1, 2]);
        s = run(s, &[(1, done(6)), (2, done(6))]);
        assert_eq!(money(&s), [94, 100, 100]);
    }

    #[test]
    fn auctioneer_who_wins_pays_the_bank() {
        let s = run(start(), &[(0, bid(20, 0)), (1, done(20)), (2, done(20))]);
        assert_eq!(money(&s), [80, 100, 100]);
        assert_eq!(bought(&s)[0], [c(0, Open, 0).id]);
    }

    #[test]
    fn no_bids_auctioneer_takes_it_free() {
        let s = run(start(), &[(0, done(0)), (1, done(0)), (2, done(0))]);
        assert_eq!(money(&s), [100, 100, 100]);
        assert_eq!(bought(&s)[0], [c(0, Open, 0).id]);
    }

    #[test]
    fn nobody_is_marked_done_automatically_bids_above_own_money_are_rejected() {
        let mut s = table(&[&[c(0, Open, 0), f(0)], &[f(1)], &[f(2)]], Some(&[100, 8, 0]));
        s = run(s, &[(0, play(c(0, Open, 0)))]);
        assert_eq!(s.auction.as_ref().unwrap().done, [false, false, false]);
        illegal(&s, 1, bid(9, 0));
        s = run(s, &[(0, bid(8, 0))]);
        // seats 1 and 2 cannot beat 8, but the table must not learn that from the server
        assert_eq!(pending(&s), [1, 2]);
        assert_eq!(view_for(&s, Some(0)).auction.unwrap().done, [false, false, false]);
        s = run(s, &[(1, done(8)), (2, done(8))]);
        assert_eq!(money(&s), [92, 8, 0]);
    }
}

mod once_around_auction {
    use super::*;

    fn start() -> GameState {
        run(
            table(&[&[c(0, Once, 0), f(0)], &[f(1)], &[f(2)]], None),
            &[(0, play(c(0, Once, 0)))],
        )
    }

    #[test]
    fn goes_left_of_the_auctioneer_and_ends_with_the_auctioneer() {
        let mut s = start();
        assert_eq!(pending(&s), [1]);
        illegal(&s, 2, bid1(5));
        s = run(s, &[(1, bid1(5))]);
        illegal(&s, 2, bid1(5));
        s = run(s, &[(2, PASS)]);
        assert_eq!(pending(&s), [0]);
        s = run(s, &[(0, bid1(6))]);
        assert_eq!(money(&s), [94, 100, 100]);
        assert_eq!(bought(&s)[0].len(), 1);
    }

    #[test]
    fn auctioneer_takes_it_free_without_bidding_when_nobody_bid() {
        let s = run(start(), &[(1, PASS), (2, PASS)]);
        assert!(s.auction.is_none());
        assert_eq!(money(&s), [100, 100, 100]);
        assert_eq!(bought(&s)[0].len(), 1);
    }

    #[test]
    fn players_who_cannot_outbid_still_pass_themselves() {
        let mut s = table(&[&[c(0, Once, 0), f(0)], &[f(1)], &[f(2)]], Some(&[3, 100, 0]));
        s = run(s, &[(0, play(c(0, Once, 0)))]);
        s = run(s, &[(1, bid1(3))]);
        // seat 2 has no money and seat 0 cannot beat 3; neither is passed for them
        assert_eq!(pending(&s), [2]);
        illegal(&s, 2, bid1(4));
        s = run(s, &[(2, PASS)]);
        assert_eq!(pending(&s), [0]);
        s = run(s, &[(0, PASS)]);
        assert_eq!(money(&s), [6, 97, 0]);
    }
}

mod sealed_auction {
    use super::*;

    fn start(m: Option<&[Money]>) -> GameState {
        let mut s = table(&[&[f(0)], &[c(0, Sealed, 0), f(1)], &[f(2)], &[f(3)]], m);
        s.turn = 1;
        run(s, &[(1, play(c(0, Sealed, 0)))])
    }

    #[test]
    fn hides_bids_until_all_are_in_then_the_highest_wins() {
        let mut s = run(start(None), &[(0, sealed(12)), (2, sealed(30))]);
        let v = view_for(&s, Some(3));
        assert_eq!(v.auction.as_ref().unwrap().bids_in, [true, false, true, false]);
        assert_eq!(v.auction.as_ref().unwrap().your_bid, None);
        assert!(!serde_json::to_string(&v).unwrap().contains("\"bids\""));
        assert_eq!(view_for(&s, Some(2)).auction.unwrap().your_bid, Some(30));
        illegal(&s, 2, sealed(31));
        s = run(s, &[(1, sealed(0)), (3, sealed(29))]);
        assert_eq!(money(&s), [100, 130, 70, 100]);
        assert!(
            s.log
                .iter()
                .any(|e| matches!(e, LogEntry::Sealed { bids } if *bids == [12, 0, 30, 29]))
        );
    }

    #[test]
    fn tie_goes_to_the_auctioneer() {
        let s = run(
            start(None),
            &[(0, sealed(20)), (1, sealed(20)), (2, sealed(20)), (3, sealed(5))],
        );
        assert_eq!(money(&s), [100, 80, 100, 100]);
    }

    #[test]
    fn tie_without_the_auctioneer_goes_to_the_nearest_clockwise() {
        let s = run(
            start(None),
            &[(0, sealed(20)), (1, sealed(1)), (2, sealed(5)), (3, sealed(20))],
        );
        // clockwise from auctioneer 1: 2, 3, 0 → seat 3 wins
        assert_eq!(money(&s), [100, 120, 100, 80]);
    }

    #[test]
    fn all_zero_auctioneer_takes_it_free_broke_players_still_seal_their_own_0() {
        let mut s = start(Some(&[0, 100, 100, 0]));
        assert_eq!(pending(&s), [0, 1, 2, 3]);
        illegal(&s, 0, sealed(1));
        s = run(s, &[(0, sealed(0)), (1, sealed(0)), (2, sealed(0)), (3, sealed(0))]);
        assert_eq!(bought(&s)[1].len(), 1);
        assert_eq!(money(&s), [0, 100, 100, 0]);
    }
}

mod fixed_price_auction {
    use super::*;

    fn start(m: Option<&[Money]>) -> GameState {
        run(
            table(&[&[c(0, Fixed, 0), f(0)], &[f(1)], &[f(2)]], m),
            &[(0, play(c(0, Fixed, 0)))],
        )
    }

    #[test]
    fn first_to_accept_buys() {
        let mut s = start(None);
        assert_eq!(pending(&s), [0]);
        illegal(&s, 0, price(101));
        illegal(&s, 1, price(10));
        illegal(&s, 1, PASS);
        s = run(s, &[(0, price(25)), (1, PASS), (2, ACCEPT)]);
        assert_eq!(money(&s), [125, 100, 75]);
    }

    #[test]
    fn nobody_accepts_auctioneer_pays_the_bank() {
        let s = run(start(None), &[(0, price(25)), (1, PASS), (2, PASS)]);
        assert_eq!(money(&s), [75, 100, 100]);
        assert_eq!(bought(&s)[0].len(), 1);
    }

    #[test]
    fn a_player_who_cannot_afford_the_price_passes_themselves_price_0_is_offered_around() {
        let mut s = run(start(Some(&[100, 10, 100])), &[(0, price(25))]);
        assert_eq!(pending(&s), [1]);
        illegal(&s, 1, ACCEPT);
        s = run(s, &[(1, PASS)]);
        assert_eq!(pending(&s), [2]);
        s = run(start(None), &[(0, price(0))]);
        assert_eq!(pending(&s), [1]);
        s = run(s, &[(1, ACCEPT)]);
        assert_eq!(money(&s), [100, 100, 100]);
        assert_eq!(bought(&s)[1].len(), 1);
    }
}

mod double {
    use super::*;

    fn d() -> Card {
        c(1, Double, 0)
    }

    #[test]
    fn second_card_from_the_same_player_sets_the_auction_type_both_sell_as_one_lot() {
        let mut s = table(&[&[d(), c(1, Fixed, 0), f(0)], &[f(1)], &[f(2)]], None);
        illegal(&s, 0, play2(d(), f(0)));
        illegal(&s, 0, play2(d(), d()));
        illegal(&s, 0, play2(c(1, Fixed, 0), d()));
        s = run(s, &[(0, play2(d(), c(1, Fixed, 0)))]);
        assert_eq!(s.auction.as_ref().unwrap().kind, AuctionKind::Fixed);
        assert_eq!(s.played[1], 2);
        s = run(s, &[(0, price(40)), (1, ACCEPT)]);
        assert_eq!(bought(&s)[1], [d().id, c(1, Fixed, 0).id]);
        assert_eq!(money(&s), [140, 60, 100]);
    }

    #[test]
    fn a_second_double_cannot_be_paired() {
        let s = table(&[&[d(), c(1, Double, 1), f(0)], &[f(1)], &[f(2)]], None);
        illegal(&s, 0, play2(d(), c(1, Double, 1)));
    }

    #[test]
    fn another_player_may_add_the_second_card_and_becomes_the_auctioneer() {
        let mut s = table(
            &[&[d(), f(0)], &[f(1)], &[c(1, Once, 0), f(2)], &[c(1, Open, 0), f(3)]],
            None,
        );
        s = run(s, &[(0, play(d()))]);
        // seat 1 has no matching card but is still asked, so the table learns nothing about their hand
        assert_eq!(pending(&s), [1]);
        illegal(&s, 1, add(f(1)));
        s = run(s, &[(1, DECLINE)]);
        assert_eq!(pending(&s), [2]);
        illegal(&s, 3, add(c(1, Open, 0)));
        s = run(s, &[(2, add(c(1, Once, 0)))]);
        assert_eq!(s.auction.as_ref().unwrap().kind, AuctionKind::Once);
        assert_eq!(s.auction.as_ref().unwrap().auctioneer, 2);
        assert_eq!(pending(&s), [3]);
        s = run(s, &[(3, bid1(10)), (0, bid1(11)), (1, PASS), (2, PASS)]);
        // seat 0 (who played the double) pays seat 2 and gets nothing for the double
        assert_eq!(money(&s), [89, 100, 111, 100]);
        assert_eq!(bought(&s)[0].len(), 2);
        assert_eq!(s.turn, 3);
    }

    #[test]
    fn a_player_with_a_matching_card_may_decline_nobody_adds_the_double_is_free() {
        let mut s = table(&[&[d(), f(0)], &[c(1, Once, 0), f(1)], &[f(2)]], None);
        s = run(s, &[(0, play(d()))]);
        assert_eq!(pending(&s), [1]);
        s = run(s, &[(1, DECLINE), (2, DECLINE)]);
        assert!(s.auction.is_none());
        assert_eq!(bought(&s)[0], [d().id]);
        assert_eq!(money(&s), [100, 100, 100]);
        assert_eq!(s.turn, 1);
    }

    #[test]
    fn double_as_4th_with_the_5th_as_second_card_round_ends_neither_is_sold_both_count() {
        let mut s = table(&[&[d(), c(1, Open, 0), f(0)], &[f(1)], &[f(2)]], None);
        s.played[1] = 3;
        s = run(s, &[(0, play2(d(), c(1, Open, 0)))]);
        assert_eq!(s.round, 1);
        assert_eq!(s.summaries[0].counts[1], 5);
        assert!(s.summaries[0].sold.iter().all(Vec::is_empty));
        assert!(!s.players[0].hand.iter().any(|x| x.id == c(1, Open, 0).id));
    }

    #[test]
    fn same_when_another_player_adds_the_5th_next_round_starts_left_of_that_player() {
        let mut s = table(&[&[d(), f(0)], &[c(1, Open, 0), f(1)], &[f(2)]], None);
        s.played[1] = 3;
        s = run(s, &[(0, play(d())), (1, add(c(1, Open, 0)))]);
        assert_eq!(s.round, 1);
        assert_eq!(s.summaries[0].counts[1], 5);
        assert_eq!(s.turn, 2);
    }

    #[test]
    fn double_that_is_itself_the_5th_round_ends_and_the_second_card_stays_in_hand() {
        let mut s = table(&[&[d(), c(1, Open, 0), f(0)], &[f(1)], &[f(2)]], None);
        s.played[1] = 4;
        s = run(s, &[(0, play2(d(), c(1, Open, 0)))]);
        assert_eq!(s.round, 1);
        assert_eq!(s.summaries[0].counts[1], 5);
        assert!(s.players[0].hand.iter().any(|x| x.id == c(1, Open, 0).id));
    }
}

mod round_end_and_scoring {
    use super::*;

    #[test]
    fn fifth_card_is_not_sold_top_three_suits_score_ties_go_to_the_lower_suit() {
        let mut s = table(&[&[c(2, Open, 0), f(0)], &[f(1)], &[f(2)]], None);
        s.played = vec![2, 2, 4, 0, 1];
        s.players[1].bought = vec![c(2, Once, 0), c(0, Once, 0), c(1, Once, 0), c(4, Once, 0)];
        s.players[2].bought = vec![c(2, Sealed, 0), c(2, Fixed, 0)];
        s = run(s, &[(0, play(c(2, Open, 0)))]);
        let sum = &s.summaries[0];
        assert_eq!(sum.counts, [2, 2, 5, 0, 1]);
        assert_eq!(sum.ranked, [2, 0, 1]);
        assert_eq!(sum.values, [20, 10, 30, 0, 0]);
        assert_eq!(sum.payouts, [0, 60, 60]);
        assert_eq!(money(&s), [100, 160, 160]);
        assert!(s.players.iter().all(|p| p.bought.is_empty()));
        assert_eq!(s.played, [0, 0, 0, 0, 0]);
        assert_eq!(s.round, 1);
        // next round: dealt 6 more, starts left of the player who ended the round
        assert!(s.players.iter().all(|p| p.hand.len() == 7));
        assert_eq!(s.turn, 1);
    }

    #[test]
    fn values_accumulate_across_rounds_but_only_for_suits_that_rank_this_round() {
        let mut s = table(&[&[c(3, Open, 0), f(0)], &[f(1)], &[f(2)]], None);
        s.round = 1;
        s.tokens[0] = vec![30, 20, 10, 0, 0];
        s.played = vec![1, 0, 2, 4, 3];
        s.players[1].bought = vec![c(0, Once, 0), c(2, Once, 0), c(3, Once, 0), c(4, Once, 0)];
        s = run(s, &[(0, play(c(3, Open, 0)))]);
        let sum = &s.summaries[0];
        assert_eq!(sum.ranked, [3, 4, 2]);
        // suit 0 has 30 from round 1 but did not rank now → 0; suit 2: 10 + 10
        assert_eq!(sum.values, [0, 0, 20, 30, 20]);
        assert_eq!(sum.payouts[1], 70);
    }

    #[test]
    fn summary_lists_the_rounds_sales_without_an_undone_call() {
        let mut s = table(&[&[c(0, Once, 0)], &[f(1), c(2, Open, 0)], &[]], None);
        s.played[2] = 4;
        s = run(
            s,
            &[
                (0, play(c(0, Once, 0))),
                (1, bid1(5)),
                (2, PASS),
                (0, PASS),
                (1, play(f(1))),
            ],
        );
        // The admin calls the open auction for seat 2, then takes it back; everyone is done: seat 1 keeps it free.
        s = undo_ruling(&s, &apply_ruling(&s, 0, Some(2), 9).unwrap(), 0).unwrap();
        s = run(s, &[(0, done(0)), (2, done(0)), (1, done(0)), (1, play(c(2, Open, 0)))]);
        assert_eq!(s.round, 1);
        assert_eq!(
            s.summaries[0].sales.as_deref().unwrap(),
            [
                Sale {
                    to: 1,
                    from: 0,
                    price: 5,
                    cards: vec![c(0, Once, 0)]
                },
                Sale {
                    to: 1,
                    from: 1,
                    price: 0,
                    cards: vec![f(1)]
                },
            ]
        );
    }

    #[test]
    fn fewer_than_three_suits_played_only_those_get_tokens() {
        let mut s = table(&[&[c(0, Open, 0), f(0)], &[f(1)], &[f(2)]], None);
        s.played = vec![4, 0, 0, 0, 0];
        s = run(s, &[(0, play(c(0, Open, 0)))]);
        assert_eq!(s.summaries[0].ranked, [0]);
        assert_eq!(s.tokens[0], [30, 0, 0, 0, 0]);
    }

    #[test]
    fn round_ends_when_all_hands_are_empty_game_ends_after_round_4_with_shared_wins_on_ties() {
        let mut s = table(&[&[c(0, Open, 0)], &[], &[]], None);
        s.round = 3;
        s = run(
            s,
            &[(0, play(c(0, Open, 0))), (1, bid(10, 0)), (0, done(10)), (2, done(10))],
        );
        assert!(s.over);
        // seat 1 paid 10 and got 30 back; seat 0 received 10
        assert_eq!(money(&s), [110, 120, 100]);
        assert_eq!(s.winners, [1]);
        illegal(&s, 0, PASS);

        let mut t = table(&[&[c(0, Open, 0)], &[], &[]], Some(&[100, 130, 100]));
        t.round = 3;
        t = run(t, &[(0, play(c(0, Open, 0))), (0, done(0)), (1, done(0)), (2, done(0))]);
        assert_eq!(money(&t), [130, 130, 100]);
        assert_eq!(t.winners, [0, 1]);
    }

    #[test]
    fn a_player_with_no_cards_is_skipped_as_auctioneer() {
        let mut s = table(&[&[c(0, Fixed, 0), f(0)], &[], &[f(2)]], None);
        s = run(s, &[(0, play(c(0, Fixed, 0))), (0, price(5)), (1, ACCEPT)]);
        assert_eq!(s.turn, 2);
    }
}

mod skipping_absent_players {
    use super::*;

    fn skip(s: &GameState, seat: u8) -> GameState {
        apply_skip(s, seat).unwrap()
    }

    #[test]
    fn only_a_seat_that_owes_a_move_can_be_skipped() {
        let s = table(&[&[f(0)], &[f(1)], &[f(2)]], None);
        assert!(apply_skip(&s, 1).is_err());
    }

    #[test]
    fn auctioneer_who_owes_a_card_turn_passes_hand_untouched() {
        let s = skip(&table(&[&[f(0)], &[f(1)], &[f(2)]], None), 0);
        assert_eq!(s.turn, 1);
        assert_eq!(s.players[0].hand.len(), 1);
    }

    #[test]
    fn auctioneer_who_is_the_only_one_with_cards_the_round_ends() {
        let s = skip(&table(&[&[f(0)], &[], &[]], None), 0);
        assert_eq!(s.round, 1);
    }

    #[test]
    fn open_done_once_pass_sealed_0_offer_decline_fixed_pass() {
        let mut s = run(
            table(&[&[c(0, Open, 0), f(0)], &[f(1)], &[f(2)]], None),
            &[(0, play(c(0, Open, 0)))],
        );
        s = skip(&skip(&skip(&s, 0), 1), 2);
        assert_eq!(bought(&s)[0].len(), 1);

        s = run(
            table(&[&[c(0, Once, 0), f(0)], &[f(1)], &[f(2)]], None),
            &[(0, play(c(0, Once, 0)))],
        );
        s = skip(&s, 1);
        assert_eq!(pending(&s), [2]);

        s = run(
            table(&[&[c(0, Sealed, 0), f(0)], &[f(1)], &[f(2)]], None),
            &[(0, play(c(0, Sealed, 0)))],
        );
        s = skip(&s, 2);
        assert_eq!(s.auction.as_ref().unwrap().bids, [None, None, Some(0)]);

        s = run(
            table(&[&[c(1, Double, 0), f(0)], &[c(1, Open, 0), f(1)], &[f(2)]], None),
            &[(0, play(c(1, Double, 0)))],
        );
        s = skip(&skip(&s, 1), 2);
        assert_eq!(bought(&s)[0].len(), 1);

        s = run(
            table(&[&[c(0, Fixed, 0), f(0)], &[f(1)], &[f(2)]], None),
            &[(0, play(c(0, Fixed, 0))), (0, price(9))],
        );
        s = skip(&skip(&s, 1), 2);
        assert_eq!(money(&s), [91, 100, 100]);
    }

    #[test]
    fn auctioneer_who_owes_a_fixed_price_takes_the_lot_free() {
        let mut s = run(
            table(&[&[c(0, Fixed, 0), f(0)], &[f(1)], &[f(2)]], None),
            &[(0, play(c(0, Fixed, 0)))],
        );
        s = skip(&s, 0);
        assert_eq!(bought(&s)[0].len(), 1);
        assert_eq!(money(&s), [100, 100, 100]);
        assert_eq!(s.turn, 1);
    }
}

mod admin_ruling {
    use super::*;

    fn once() -> GameState {
        run(
            table(&[&[c(0, Once, 0), f(0)], &[f(1)], &[f(2)]], None),
            &[(0, play(c(0, Once, 0)))],
        )
    }

    fn offer() -> GameState {
        run(
            table(&[&[c(1, Double, 0), f(0)], &[f(1)], &[f(2)]], None),
            &[(0, play(c(1, Double, 0)))],
        )
    }

    #[test]
    fn sells_to_any_seat_at_any_affordable_price_mid_auction_and_marks_who_called_it() {
        let s = apply_ruling(&once(), 1, Some(2), 30).unwrap();
        assert!(s.auction.is_none());
        assert_eq!(money(&s), [130, 100, 70]);
        assert_eq!(bought(&s)[2], [c(0, Once, 0).id]);
        assert!(matches!(
            s.log.last(),
            Some(LogEntry::Sold {
                to: 2,
                from: 0,
                price: 30,
                by: Some(1),
                ..
            })
        ));
        assert_eq!(s.turn, 1);
    }

    #[test]
    fn auctioneer_as_buyer_pays_the_bank_no_sale_gives_the_lot_free() {
        assert_eq!(money(&apply_ruling(&once(), 0, Some(0), 12).unwrap()), [88, 100, 100]);
        let free = apply_ruling(&once(), 0, None, 0).unwrap();
        assert_eq!(money(&free), [100, 100, 100]);
        assert_eq!(bought(&free)[0], [c(0, Once, 0).id]);
        assert!(matches!(
            free.log.last(),
            Some(LogEntry::Free { p: 0, by: Some(0), .. })
        ));
    }

    #[test]
    fn rejects_unaffordable_prices_bad_seats_no_auction_and_a_sale_of_a_waiting_double() {
        // A negative price cannot be represented; the parse test covers it.
        assert!(apply_ruling(&once(), 0, Some(1), 101).is_err());
        assert!(apply_ruling(&once(), 0, Some(7), 1).is_err());
        assert!(apply_ruling(&table(&[&[f(0)], &[f(1)], &[f(2)]], None), 0, Some(1), 1).is_err());
        assert!(apply_ruling(&offer(), 0, Some(1), 1).is_err());
    }

    #[test]
    fn a_waiting_double_can_be_called_as_nobody_adds_the_player_keeps_it_free() {
        let s = apply_ruling(&offer(), 2, None, 0).unwrap();
        assert!(s.auction.is_none());
        assert_eq!(bought(&s)[0], [c(1, Double, 0).id]);
        assert_eq!(money(&s), [100, 100, 100]);
        assert!(matches!(s.log.last(), Some(LogEntry::Free { p: 0, by: Some(2), .. })));
    }

    #[test]
    fn undo_restores_the_auction_as_it_was_and_logs_who_took_the_call_back() {
        let before = once();
        let after = apply_ruling(&before, 1, Some(2), 30).unwrap();
        let s = undo_ruling(&before, &after, 1).unwrap();
        assert_eq!(s.auction, before.auction);
        assert_eq!(money(&s), [100, 100, 100]);
        assert_eq!(
            s.log.last(),
            Some(&LogEntry::Undo {
                by: 1,
                cards: vec![c(0, Once, 0)]
            })
        );
        assert!(matches!(before.log.last(), Some(LogEntry::Play { .. })));
        assert!(undo_ruling(&before, &before, 1).is_err());
    }
}

mod hidden_information {
    use super::*;

    #[test]
    fn a_view_never_contains_other_hands_other_money_the_deck_or_the_seed() {
        let s = new_game(4, 99).unwrap();
        for seat in [Some(0), Some(1), Some(2), Some(3), None] {
            let v = view_for(&s, seat);
            let text = serde_json::to_string(&v).unwrap();
            assert!(!text.contains("\"deck\""));
            assert!(!text.contains("\"seed\""));
            assert_eq!(v.hand, seat.map_or_default(|i| s.players[usize::from(i)].hand.clone()));
            for (i, p) in (0..).zip(&v.players) {
                assert_eq!(p.money, (Some(i) == seat).then_some(100));
            }
            let player = serde_json::to_value(&v.players[0]).unwrap();
            let mut keys: Vec<&String> = player.as_object().unwrap().keys().collect();
            keys.sort();
            assert_eq!(keys, ["bought", "handCount", "money"]);
        }
    }
}

/// Moves that the types cannot represent are rejected when the message is parsed, before the
/// engine sees them (fractions, negative numbers, wrong types). Unknown move types parse, and the
/// engine answers them.
#[test]
fn malformed_moves_do_not_parse() {
    for bad in [
        r#"{"type":"bid","amount":-1}"#,
        r#"{"type":"bid","amount":1.5}"#,
        r#"{"type":"bid","amount":1e1}"#,
        r#"{"type":"bid","amount":"10"}"#,
        r#"{"type":"sealed","amount":4294967296}"#,
        r#"{"type":"play","card":300}"#,
        r#"{"type":"done"}"#,
        r#"{"amount":1}"#,
    ] {
        assert!(serde_json::from_str::<Action>(bad).is_err(), "{bad} should not parse");
    }
    let unknown: Action = serde_json::from_str(r#"{"type":"skipTurn"}"#).unwrap();
    assert_eq!(unknown, Action::Unknown);
    let s = table(&[&[f(0)], &[f(1)], &[f(2)]], None);
    assert_eq!(apply_action(&s, 0, &unknown).unwrap_err().to_string(), "Unknown move");
    let play: Action = serde_json::from_str(r#"{"type":"play","card":3,"second":null}"#).unwrap();
    assert_eq!(play, Action::Play { card: 3, second: None });
}

#[test]
fn the_config_parses() {
    let cfg = config();
    assert_eq!((cfg.min_players(), cfg.max_players()), (3, 5));
    assert_eq!(cfg.card_table.len(), usize::from(cfg.suits));
}

#[test]
fn the_admin_can_end_a_game_early_and_the_money_as_it_stands_decides() {
    let s = table(&[&[c(0, Open, 0), f(0)], &[f(1)], &[f(2)]], Some(&[50, 70, 70]));
    let s = run(s, &[(0, play(c(0, Open, 0)))]);
    assert!(s.auction.is_some());
    let end = engine::end_early(&s, 0).unwrap();
    assert!(end.over && end.auction.is_none());
    assert_eq!(end.winners, [1, 2]);
    assert_eq!(money(&end), [50, 70, 70], "the running round is not scored");
    assert_eq!(
        end.log.last(),
        Some(&LogEntry::End {
            winners: vec![1, 2],
            by: Some(0)
        })
    );
    assert!(view_for(&end, Some(2)).players.iter().all(|p| p.money.is_some()));
    assert!(engine::end_early(&end, 0).is_err());
}
