//! Auction Adda as a [`Game`] the server can host.

use std::ops::RangeInclusive;

use game::{Game, RuleError, Seat};
use rand::Rng;

use crate::bot::choose_action;
use crate::config::config;
use crate::rules::{apply_action, apply_ruling, apply_skip, end_early, new_game, pending, reseat, undo_ruling};
use crate::types::{Action, AuctionKind, GameState, LogEntry, Money, View};
use crate::view::view_for;

/// The auction card game: lots of cards go up for one of five kinds of auction; four rounds rank
/// the suits; the richest player wins.
pub struct Auction;

impl Game for Auction {
    type State = GameState;
    type Action = Action;
    type View = View;

    fn players() -> RangeInclusive<u8> {
        let cfg = config();
        cfg.min_players()..=cfg.max_players()
    }

    fn cast_slots() -> u8 {
        config().suits
    }

    fn new_game(n: u8, seed: u32) -> Result<GameState, RuleError> {
        new_game(n, seed)
    }

    fn seats(s: &GameState) -> u8 {
        s.n
    }

    fn round(s: &GameState) -> u8 {
        s.round
    }

    fn over(s: &GameState) -> bool {
        s.over
    }

    fn winners(s: &GameState) -> Vec<Seat> {
        s.winners.clone()
    }

    fn pending(s: &GameState) -> Vec<Seat> {
        pending(s)
    }

    fn act(s: &GameState, seat: Seat, action: &Action) -> Result<GameState, RuleError> {
        apply_action(s, seat, action)
    }

    fn unknown(action: &Action) -> bool {
        *action == Action::Unknown
    }

    fn skip(s: &GameState, seat: Seat) -> Result<GameState, RuleError> {
        apply_skip(s, seat)
    }

    fn end_early(s: &GameState, by: Seat) -> Result<GameState, RuleError> {
        end_early(s, by)
    }

    fn reseat(s: &GameState, to: &[Seat]) -> Result<GameState, RuleError> {
        reseat(s, to)
    }

    fn view(s: &GameState, seat: Option<Seat>) -> View {
        view_for(s, seat)
    }

    fn bot<R: Rng + ?Sized>(v: &View, rng: &mut R) -> Option<Action> {
        choose_action(v, rng)
    }

    fn call(s: &GameState, by: Seat, winner: Option<Seat>, price: Money) -> Result<GameState, RuleError> {
        apply_ruling(s, by, winner, price)
    }

    fn undo_call(before: &GameState, after: &GameState, by: Seat) -> Result<GameState, RuleError> {
        undo_ruling(before, after, by)
    }

    /// The open-auction clock: the log line that put the lot up (or undid a call on it), and the
    /// last line that moved the clock (that one or a later bid). None when no open auction runs.
    fn clock(s: &GameState) -> Option<(usize, usize)> {
        s.auction.as_ref().filter(|a| a.kind == AuctionKind::Open)?;
        let lot = s
            .log
            .iter()
            .rposition(|e| matches!(e, LogEntry::Play { .. } | LogEntry::Undo { .. }))?;
        let last = s
            .log
            .iter()
            .rposition(|e| matches!(e, LogEntry::Bid { .. }))
            .filter(|&i| i > lot)
            .unwrap_or(lot);
        Some((lot, last))
    }

    /// The open-auction clock ran out: everyone still in is done, which closes the auction.
    fn time_up(s: &GameState) -> Result<GameState, RuleError> {
        let high = s.auction.as_ref().map_or(0, |a| a.high);
        pending(s).into_iter().try_fold(s.clone(), |g, seat| {
            apply_action(&g, seat, &Action::Done { seen_high: high })
        })
    }
}
