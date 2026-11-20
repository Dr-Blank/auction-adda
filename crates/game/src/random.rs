/// Small seeded generator (mulberry32) so a game can be replayed from its seed. Bit for bit the
/// same as the TypeScript version the client and the bot script use (`src/rng.ts`).
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
#[must_use]
pub fn index(random: f64, len: usize) -> usize {
    (random * len as f64).floor() as usize
}

/// Fisher-Yates, in the same order as the TypeScript version so a seed deals the same cards.
pub fn shuffle<T>(mut items: Vec<T>, random: &mut impl FnMut() -> f64) -> Vec<T> {
    for i in (1..items.len()).rev() {
        items.swap(i, index(random(), i + 1));
    }
    items
}
