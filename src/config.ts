// Game constants. The numbers live in crates/engine/config.json, which the Rust engine reads too.
import config from '../crates/engine/config.json' with { type: 'json' };

export const SUITS = config.suits;
export const ROUNDS = config.rounds;
/** A round ends when this many cards of one suit have been played. */
export const SUIT_LIMIT = config.suitLimit;
/** Tokens for the first, second and third suit of a round. */
export const TOKENS = config.tokens;

const counts = Object.keys(config.players).map(Number);
export const MIN_PLAYERS = Math.min(...counts);
export const MAX_PLAYERS = Math.max(...counts);
