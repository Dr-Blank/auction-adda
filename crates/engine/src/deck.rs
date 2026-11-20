use crate::config::config;
use crate::types::Card;

#[must_use]
pub fn build_deck() -> Vec<Card> {
    let mut deck = Vec::new();
    for (suit, row) in (0..).zip(&config().card_table) {
        let mut n = 0;
        for (&kind, &count) in row {
            for _ in 0..count {
                let id = u8::try_from(deck.len()).unwrap_or(u8::MAX);
                deck.push(Card { id, suit, n, kind });
                n += 1;
            }
        }
    }
    deck
}

/// By suit, then auction type, then id.
pub fn sort_hand(hand: &mut [Card]) {
    hand.sort_by_key(|c| (c.suit, c.kind, c.id));
}
