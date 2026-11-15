import { pending } from './game.ts';
import type { GameState, View } from './types.ts';

const LOG_LIMIT = 150;

/** The part of the state one seat may see. `seat` null = spectator. Never send GameState itself to a client. */
export function viewFor(s: GameState, seat: number | null): View {
  const a = s.auction;
  return {
    n: s.n,
    you: seat,
    round: s.round,
    turn: s.turn,
    played: s.played,
    tokens: s.tokens,
    players: s.players.map((p, i) => ({
      handCount: p.hand.length,
      money: s.over || i === seat ? p.money : null,
      bought: p.bought,
    })),
    hand: seat === null ? [] : s.players[seat].hand,
    auction: a && {
      kind: a.kind,
      cards: a.cards,
      auctioneer: a.auctioneer,
      high: a.high,
      highBidder: a.highBidder,
      done: a.done,
      toAct: a.toAct,
      price: a.price,
      bidsIn: a.bids.map((b) => b !== null),
      yourBid: seat === null ? null : a.bids[seat],
    },
    pending: pending(s),
    log: s.log.slice(-LOG_LIMIT),
    logStart: Math.max(0, s.log.length - LOG_LIMIT),
    summaries: s.summaries,
    over: s.over,
    winners: s.winners,
    deckCount: s.deck.length,
  };
}
