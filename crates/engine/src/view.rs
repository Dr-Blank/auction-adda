use crate::game::pending;
use crate::types::{AuctionView, GameState, PlayerView, Seat, View};

const LOG_LIMIT: usize = 150;

/// The part of the state one seat may see. `seat` `None` = spectator. Never send [`GameState`]
/// itself to a client.
#[must_use]
pub fn view_for(s: &GameState, seat: Option<Seat>) -> View {
    let mine = |i: usize| seat.is_some_and(|seat| usize::from(seat) == i);
    let log_start = s.log.len().saturating_sub(LOG_LIMIT);
    View {
        n: s.n,
        you: seat,
        round: s.round,
        turn: s.turn,
        played: s.played.clone(),
        tokens: s.tokens.clone(),
        players: s
            .players
            .iter()
            .enumerate()
            .map(|(i, p)| PlayerView {
                hand_count: u8::try_from(p.hand.len()).unwrap_or(u8::MAX),
                money: (s.over || mine(i)).then_some(p.money),
                bought: p.bought.clone(),
            })
            .collect(),
        hand: seat
            .and_then(|seat| s.players.get(usize::from(seat)))
            .map_or_default(|p| p.hand.clone()),
        auction: s.auction.as_ref().map(|a| AuctionView {
            kind: a.kind,
            cards: a.cards.clone(),
            auctioneer: a.auctioneer,
            high: a.high,
            high_bidder: a.high_bidder,
            done: a.done.clone(),
            to_act: a.to_act,
            price: a.price,
            bids_in: a.bids.iter().map(Option::is_some).collect(),
            your_bid: seat.and_then(|seat| a.bids.get(usize::from(seat)).copied().flatten()),
        }),
        pending: pending(s),
        log: s.log.get(log_start..).unwrap_or_default().to_vec(),
        log_start: u32::try_from(log_start).unwrap_or(u32::MAX),
        summaries: s.summaries.clone(),
        over: s.over,
        winners: s.winners.clone(),
        deck_count: u8::try_from(s.deck.len()).unwrap_or(u8::MAX),
    }
}
