import { CARD_TABLE, TYPE_ORDER } from './config.ts';
import type { Card } from './types.ts';

/** Small seeded generator (mulberry32) so a game can be replayed from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  CARD_TABLE.forEach((row, suit) => {
    let n = 0;
    for (const type of TYPE_ORDER) {
      for (let i = 0; i < row[type]; i++) deck.push({ id: deck.length, suit, n: n++, type });
    }
  });
  return deck;
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sortHand(hand: Card[]): void {
  hand.sort((x, y) => x.suit - y.suit || TYPE_ORDER.indexOf(x.type) - TYPE_ORDER.indexOf(y.type) || x.id - y.id);
}
