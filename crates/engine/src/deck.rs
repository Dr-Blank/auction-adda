use crate::config::config;
use crate::types::Card;

/// Small seeded generator (mulberry32) so a game can be replayed from its seed. Bit for bit the
/// same as the TypeScript version the client and the bot script use.
#[expect(
    clippy::decimal_bitwise_operands,
    reason = "the constants as published for mulberry32"
)]
pub fn rng(seed: u32) -> impl FnMut() -> f64 {
    let mut a = seed;
    move || {
        a = a.wrapping_add(0x6d2b_79f5);
        let mut t = a;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
}

/// `Math.floor(random * len)`: an index below `len` from a value in [0, 1).
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss,
    reason = "random is in [0, 1), so the product is in [0, len)"
)]
pub(crate) fn index(random: f64, len: usize) -> usize {
    (random * len as f64).floor() as usize
}

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

/// Fisher-Yates, in the same order as the TypeScript version so a seed deals the same cards.
pub fn shuffle<T>(mut items: Vec<T>, random: &mut impl FnMut() -> f64) -> Vec<T> {
    for i in (1..items.len()).rev() {
        items.swap(i, index(random(), i + 1));
    }
    items
}

/// By suit, then auction type, then id.
pub fn sort_hand(hand: &mut [Card]) {
    hand.sort_by_key(|c| (c.suit, c.kind, c.id));
}
