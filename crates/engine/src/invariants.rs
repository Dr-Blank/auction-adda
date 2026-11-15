//! What every move must keep true. Checked through `debug_assert!` after every move, so every test
//! and every bot game against a debug build exercises it.

use std::collections::HashSet;

use crate::types::{GameState, LogEntry};

/// No card is in two places at once.
fn cards_unique(s: &GameState) -> bool {
    let mut seen = HashSet::new();
    let held = s
        .deck
        .iter()
        .chain(s.players.iter().flat_map(|p| p.hand.iter().chain(&p.bought)));
    let in_auction = s.auction.iter().flat_map(|a| &a.cards);
    held.chain(in_auction).all(|c| seen.insert(c.id))
}

fn total_money(s: &GameState) -> i64 {
    s.players.iter().map(|p| i64::from(p.money)).sum()
}

/// Checks one move from `before` to `after`.
///
/// Money only enters through round payouts and only leaves when an auctioneer buys their own lot
/// (they pay the bank). A move must not put a card in two places when none was before.
///
/// # Errors
/// What was broken.
pub fn check_step(before: &GameState, after: &GameState) -> Result<(), String> {
    if cards_unique(before) && !cards_unique(after) {
        return Err("a card is in two places".into());
    }
    let paid: i64 = after
        .summaries
        .iter()
        .skip(before.summaries.len())
        .flat_map(|r| &r.payouts)
        .map(|&x| i64::from(x))
        .sum();
    let own_buys: i64 = after
        .log
        .iter()
        .skip(before.log.len())
        .map(|e| match e {
            LogEntry::Sold { to, from, price, .. } if to == from => i64::from(*price),
            _ => 0,
        })
        .sum();
    if total_money(after) - total_money(before) != paid - own_buys {
        return Err("money appeared or vanished".into());
    }
    Ok(())
}
