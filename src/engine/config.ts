import type { AuctionType } from './types.ts';

export const SUITS = 5;
export const ROUNDS = 4;
/** A round ends when this many cards of one suit have been played. */
export const SUIT_LIMIT = 5;
/** Tokens for the first, second and third suit of a round. */
export const TOKENS = [30, 20, 10];

/** Everything that depends on the number of players. Add a row to support a new count. */
export const PLAYER_CONFIG: Record<number, { deal: number[]; startMoney: number }> = {
  3: { deal: [10, 6, 6, 0], startMoney: 100 },
  4: { deal: [9, 4, 4, 0], startMoney: 100 },
  5: { deal: [8, 3, 3, 0], startMoney: 100 },
};
export const MIN_PLAYERS = Math.min(...Object.keys(PLAYER_CONFIG).map(Number));
export const MAX_PLAYERS = Math.max(...Object.keys(PLAYER_CONFIG).map(Number));

/** CARD_TABLE[suit] = how many cards of each auction type that suit has. */
export const CARD_TABLE: Record<AuctionType, number>[] = [
  { open: 3, once: 3, sealed: 2, fixed: 2, double: 2 }, // 12
  { open: 3, once: 2, sealed: 3, fixed: 3, double: 2 }, // 13
  { open: 3, once: 3, sealed: 3, fixed: 3, double: 2 }, // 14
  { open: 3, once: 3, sealed: 3, fixed: 3, double: 3 }, // 15
  { open: 4, once: 3, sealed: 3, fixed: 3, double: 3 }, // 16
];

export const TYPE_ORDER: AuctionType[] = ['open', 'once', 'sealed', 'fixed', 'double'];
