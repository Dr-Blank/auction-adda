// Facts the table screen shows that are not stored directly in the view.

import { DEALS, ROUNDS, SUITS, TOKENS } from '../config.ts';
import type { Card, LogEntry, View } from '../generated/index.ts';
import type { Theme } from '../themes/types.ts';

/** What the deal at the start of `round` gives every player (all get the same), and why nothing when nothing. */
export function dealNote(theme: Theme, n: number, round: number): string {
  const count = DEALS[n]?.[round] ?? 0;
  const { cards } = theme.nouns;
  if (round === 0) return `Everyone is dealt ${count} ${cards}.`;
  if (count > 0) return `Everyone gets ${count} new ${cards}.`;
  return round === ROUNDS - 1
    ? `No new ${cards}: the last ${theme.nouns.round} is played with the ${cards} left in hand.`
    : `No new ${cards} this ${theme.nouns.round} (see “The deck and the deal” in the rules).`;
}

/** What one card of each suit would pay if the round ended right now. */
export function provisionalValues(g: View): number[] {
  if (g.round >= ROUNDS) return g.played.map(() => 0);
  const ranked = rankSuits(g.played);
  return g.played.map((_, suit) => {
    const rank = ranked.indexOf(suit);
    if (rank < 0) return 0;
    return TOKENS[rank] + g.tokens.slice(0, g.round).reduce((sum, row) => sum + row[suit], 0);
  });
}

/** Suits that would take the 30 / 20 / 10 tokens now, best first (ties go to the lower suit). */
export function rankSuits(played: number[]): number[] {
  return played
    .map((count, suit) => ({ count, suit }))
    .filter((x) => x.count > 0)
    .sort((x, y) => y.count - x.count || x.suit - y.suit)
    .slice(0, TOKENS.length)
    .map((x) => x.suit);
}

export function countBySuit(cards: Card[]): number[] {
  const counts = Array(SUITS).fill(0);
  for (const c of cards) counts[c.suit]++;
  return counts;
}

/** How a bought card was bought, from the log: price paid and to whom (the seller, or the bank). */
export interface Purchase {
  price: number;
  /** Seat paid; equal to the buyer when they paid the bank. null = taken free. */
  paid: number | null;
  /** Cards sold together in the same lot (a double pair). */
  lot: number;
}

/** Card id → how it was bought, for every sale and free take in the log. Later entries win (a call that was undone and redone). */
export function purchases(g: View): Map<number, Purchase> {
  const map = new Map<number, Purchase>();
  for (const e of g.log) {
    if (e.t === 'sold') e.cards.forEach((c) => map.set(c.id, { price: e.price, paid: e.from, lot: e.cards.length }));
    else if (e.t === 'free') e.cards.forEach((c) => map.set(c.id, { price: 0, paid: null, lot: e.cards.length }));
  }
  return map;
}

/** Index in `g.log` of the entry that opened the running auction (a play or a double offer), or -1. */
function auctionStart(g: View): number {
  if (!g.auction) return -1;
  for (let i = g.log.length - 1; i >= 0; i--) {
    const e = g.log[i];
    if (e.t === 'offer') return i;
    if (e.t === 'play') {
      // A play straight after a double offer belongs to the same lot.
      for (let j = i - 1; j >= 0; j--) {
        const p = g.log[j];
        if (p.t === 'decline') continue;
        return p.t === 'offer' ? j : i;
      }
      return i;
    }
    if (e.t === 'sold' || e.t === 'free' || e.t === 'shelved' || e.t === 'round') return -1;
  }
  return -1;
}

/** Seats clockwise starting after `me` (you sit at the bottom, the others face you across the table). */
export function aroundTable(n: number, me: number | null): number[] {
  if (me === null) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: n - 1 }, (_, k) => (me + 1 + k) % n);
}

/**
 * Seats in the order the hammer reaches them: the seat selling now (or choosing what to sell),
 * then each later seat clockwise that still holds cards, as the engine passes it on. Empty once the game is over.
 */
export function hammerOrder(g: View): number[] {
  if (g.over) return [];
  const from = g.auction ? g.auction.auctioneer : g.turn;
  const order = [from];
  for (let k = 1; k < g.n; k++) {
    const seat = (from + k) % g.n;
    if (g.players[seat].handCount > 0) order.push(seat);
  }
  return order;
}

/** What a seat that owes a move is doing, for the label by its name; null when it owes nothing. */
export function doing(g: View, seat: number): string | null {
  if (!g.pending.includes(seat)) return null;
  const a = g.auction;
  if (!a) return 'choosing';
  if (a.kind === 'open') return 'bidding';
  if (a.kind === 'sealed') return 'sealing';
  if (a.kind === 'once') return 'to bid';
  if (a.kind === 'fixed') return a.price === null ? 'pricing' : 'deciding';
  return 'deciding';
}

/** What each seat last said in the running auction ("bid 7", "pass", "no"), from the log. */
export function lastWords(g: View): (LogEntry | null)[] {
  const words: (LogEntry | null)[] = Array(g.n).fill(null);
  const from = auctionStart(g);
  if (from < 0) return words;
  for (const e of g.log.slice(from + 1)) {
    if (e.t === 'bid' || e.t === 'pass' || e.t === 'decline' || e.t === 'price') words[e.p] = e;
  }
  return words;
}

export type RailState = 'now' | 'lead' | 'bid' | 'passed' | 'done' | 'sealed' | 'waiting';
export interface RailStop {
  seat: number;
  state: RailState;
  /** Amount said, for `bid` and `lead`. */
  amount?: number;
  seller: boolean;
}

/** Seats in the order the auction visits them (left of the seller first, seller last) and where each stands. */
export function rail(g: View): RailStop[] {
  const a = g.auction;
  if (!a) return [];
  const words = lastWords(g);
  const order = Array.from({ length: g.n }, (_, k) => (a.auctioneer + 1 + k) % g.n);
  const turnIdx = a.toAct === null ? -1 : order.indexOf(a.toAct);
  return order.map((seat, idx) => {
    const seller = seat === a.auctioneer;
    const base = { seat, seller };
    if (a.kind === 'open') {
      if (a.highBidder === seat) return { ...base, state: 'lead', amount: a.high };
      if (a.done[seat]) return { ...base, state: 'done' };
      return { ...base, state: 'waiting' };
    }
    if (a.kind === 'sealed') return { ...base, state: a.bidsIn[seat] ? 'sealed' : 'waiting' };
    if (a.kind === 'fixed' && a.price === null) return { ...base, state: seller ? 'now' : 'waiting' };
    if (a.toAct === seat) return { ...base, state: 'now' };
    if (turnIdx >= 0 && idx < turnIdx) {
      const w = words[seat];
      if (w?.t === 'bid') return { ...base, state: a.highBidder === seat ? 'lead' : 'bid', amount: w.amount };
      return { ...base, state: 'passed' };
    }
    return { ...base, state: 'waiting' };
  });
}

/** Log entries grouped per lot, newest first, for the log drawer. */
export interface LogGroup {
  key: number;
  /** The entry that sums the group up: the sale, the round start… */
  head: LogEntry;
  /** Bids, passes and the opening play, oldest first. */
  steps: LogEntry[];
  open: boolean;
}

export function groupLog(log: LogEntry[], start: number): LogGroup[] {
  const groups: LogGroup[] = [];
  let current: LogGroup | null = null;
  log.forEach((e, i) => {
    const key = start + i;
    if (e.t === 'undo') {
      // The called lot is back on the table: a new group that the next result closes.
      current = { key, head: e, steps: [e], open: true };
      groups.push(current);
    } else if (e.t === 'play' || e.t === 'offer') {
      if (!current) {
        current = { key, head: e, steps: [], open: true };
        groups.push(current);
      }
      current.steps.push(e);
    } else if (e.t === 'sold' || e.t === 'free' || e.t === 'shelved') {
      if (current) {
        current.head = e;
        current.open = false;
        current = null;
      } else {
        groups.push({ key, head: e, steps: [], open: false });
      }
    } else if (current) {
      current.steps.push(e);
    } else {
      groups.push({ key, head: e, steps: [], open: false });
    }
  });
  return groups.reverse();
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
