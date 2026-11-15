import { describe, expect, it } from 'vitest';
import { chooseAction } from '../src/engine/bot.ts';
import { CARD_TABLE, PLAYER_CONFIG, TYPE_ORDER } from '../src/engine/config.ts';
import { buildDeck, rng } from '../src/engine/deck.ts';
import { applyAction, applyRuling, applySkip, newGame, pending, undoRuling } from '../src/engine/game.ts';
import { RuleError } from '../src/engine/types.ts';
import type { Action, AuctionType, Card, GameState } from '../src/engine/types.ts';
import { viewFor } from '../src/engine/view.ts';

const DECK = buildDeck();

/** The k-th card of a suit and auction type. */
function c(suit: number, type: AuctionType, k = 0): Card {
  const card = DECK.filter((x) => x.suit === suit && x.type === type)[k];
  if (!card) throw new Error(`no card ${suit}/${type}/${k}`);
  return card;
}

/** A game with chosen hands; seat 0 is to play. */
function table(hands: Card[][], money?: number[]): GameState {
  const s = newGame(hands.length, 1);
  s.turn = 0;
  s.log = [];
  hands.forEach((h, i) => (s.players[i].hand = h.slice()));
  money?.forEach((m, i) => (s.players[i].money = m));
  return s;
}

function run(s: GameState, moves: [number, Action][]): GameState {
  for (const [seat, action] of moves) s = applyAction(s, seat, action);
  return s;
}

const money = (s: GameState) => s.players.map((p) => p.money);
const bought = (s: GameState) => s.players.map((p) => p.bought.map((x) => x.id));
const illegal = (fn: () => unknown) => expect(fn).toThrow(RuleError);

// Fillers keep hands non-empty without interfering (suit 4, never reaches the limit in these tests).
const F = [c(4, 'open', 0), c(4, 'open', 1), c(4, 'open', 2), c(4, 'open', 3)];

describe('deck and deal', () => {
  it('has 70 cards matching the table', () => {
    expect(DECK).toHaveLength(70);
    expect(new Set(DECK.map((x) => x.id)).size).toBe(70);
    CARD_TABLE.forEach((row, suit) => {
      for (const type of TYPE_ORDER) {
        expect(DECK.filter((x) => x.suit === suit && x.type === type)).toHaveLength(row[type]);
      }
    });
    expect([0, 1, 2, 3, 4].map((suit) => DECK.filter((x) => x.suit === suit).length)).toEqual([12, 13, 14, 15, 16]);
  });

  it('deals the first round per player count', () => {
    for (const [n, cfg] of Object.entries(PLAYER_CONFIG)) {
      const s = newGame(Number(n), 7);
      expect(s.players.map((p) => p.hand.length)).toEqual(Array(Number(n)).fill(cfg.deal[0]));
      expect(s.deck.length).toBe(70 - Number(n) * cfg.deal[0]);
      expect(money(s)).toEqual(Array(Number(n)).fill(cfg.startMoney));
    }
  });

  it('rejects unsupported player counts', () => {
    illegal(() => newGame(2, 1));
    illegal(() => newGame(6, 1));
  });
});

describe('open auction', () => {
  const start = () => run(table([[c(0, 'open'), F[0]], [F[1]], [F[2]]]), [[0, { type: 'play', card: c(0, 'open').id }]]);

  it('sells to the high bidder once everyone else is done; winner pays the auctioneer', () => {
    let s = start();
    expect(pending(s)).toEqual([0, 1, 2]);
    s = run(s, [
      [1, { type: 'bid', amount: 10, seenHigh: 0 }],
      [2, { type: 'bid', amount: 15, seenHigh: 10 }],
      [0, { type: 'done', seenHigh: 15 }],
    ]);
    expect(s.auction).not.toBeNull();
    s = run(s, [[1, { type: 'done', seenHigh: 15 }]]);
    expect(s.auction).toBeNull();
    expect(money(s)).toEqual([115, 100, 85]);
    expect(bought(s)[2]).toEqual([c(0, 'open').id]);
    expect(s.turn).toBe(1);
  });

  it('rejects a bid or done made against a stale high bid', () => {
    const s = run(start(), [[1, { type: 'bid', amount: 10, seenHigh: 0 }]]);
    illegal(() => applyAction(s, 2, { type: 'bid', amount: 10, seenHigh: 0 }));
    illegal(() => applyAction(s, 2, { type: 'bid', amount: 12, seenHigh: 0 }));
    illegal(() => applyAction(s, 2, { type: 'done', seenHigh: 0 }));
    illegal(() => applyAction(s, 1, { type: 'done', seenHigh: 10 }));
    illegal(() => applyAction(s, 1, { type: 'bid', amount: 20, seenHigh: 10 }));
  });

  it('a new bid clears done flags', () => {
    let s = run(start(), [
      [0, { type: 'done', seenHigh: 0 }],
      [1, { type: 'bid', amount: 5, seenHigh: 0 }],
    ]);
    expect(s.auction!.done).toEqual([false, false, false]);
    s = run(s, [
      [0, { type: 'done', seenHigh: 5 }],
      [2, { type: 'done', seenHigh: 5 }],
    ]);
    expect(money(s)).toEqual([105, 95, 100]);
  });

  it('auctioneer who wins pays the bank', () => {
    const s = run(start(), [
      [0, { type: 'bid', amount: 20, seenHigh: 0 }],
      [1, { type: 'done', seenHigh: 20 }],
      [2, { type: 'done', seenHigh: 20 }],
    ]);
    expect(money(s)).toEqual([80, 100, 100]);
    expect(bought(s)[0]).toEqual([c(0, 'open').id]);
  });

  it('no bids: auctioneer takes it free', () => {
    const s = run(start(), [
      [0, { type: 'done', seenHigh: 0 }],
      [1, { type: 'done', seenHigh: 0 }],
      [2, { type: 'done', seenHigh: 0 }],
    ]);
    expect(money(s)).toEqual([100, 100, 100]);
    expect(bought(s)[0]).toEqual([c(0, 'open').id]);
  });

  it('nobody is marked done automatically, even when they cannot outbid; bids above own money are rejected', () => {
    let s = table([[c(0, 'open'), F[0]], [F[1]], [F[2]]], [100, 8, 0]);
    s = run(s, [[0, { type: 'play', card: c(0, 'open').id }]]);
    expect(s.auction!.done).toEqual([false, false, false]);
    illegal(() => applyAction(s, 1, { type: 'bid', amount: 9, seenHigh: 0 }));
    s = run(s, [[0, { type: 'bid', amount: 8, seenHigh: 0 }]]);
    // seats 1 and 2 cannot beat 8, but the table must not learn that from the server
    expect(pending(s)).toEqual([1, 2]);
    expect(viewFor(s, 0).auction!.done).toEqual([false, false, false]);
    s = run(s, [
      [1, { type: 'done', seenHigh: 8 }],
      [2, { type: 'done', seenHigh: 8 }],
    ]);
    expect(money(s)).toEqual([92, 8, 0]);
  });
});

describe('once-around auction', () => {
  const start = () => run(table([[c(0, 'once'), F[0]], [F[1]], [F[2]]]), [[0, { type: 'play', card: c(0, 'once').id }]]);

  it('goes left of the auctioneer and ends with the auctioneer', () => {
    let s = start();
    expect(pending(s)).toEqual([1]);
    illegal(() => applyAction(s, 2, { type: 'bid', amount: 5 }));
    s = run(s, [[1, { type: 'bid', amount: 5 }]]);
    illegal(() => applyAction(s, 2, { type: 'bid', amount: 5 }));
    s = run(s, [[2, { type: 'pass' }]]);
    expect(pending(s)).toEqual([0]);
    s = run(s, [[0, { type: 'bid', amount: 6 }]]);
    expect(money(s)).toEqual([94, 100, 100]);
    expect(bought(s)[0]).toHaveLength(1);
  });

  it('auctioneer takes it free without bidding when nobody bid', () => {
    const s = run(start(), [
      [1, { type: 'pass' }],
      [2, { type: 'pass' }],
    ]);
    expect(s.auction).toBeNull();
    expect(money(s)).toEqual([100, 100, 100]);
    expect(bought(s)[0]).toHaveLength(1);
  });

  it('players who cannot outbid still pass themselves', () => {
    let s = table([[c(0, 'once'), F[0]], [F[1]], [F[2]]], [3, 100, 0]);
    s = run(s, [[0, { type: 'play', card: c(0, 'once').id }]]);
    s = run(s, [[1, { type: 'bid', amount: 3 }]]);
    // seat 2 has no money and seat 0 cannot beat 3; neither is passed for them
    expect(pending(s)).toEqual([2]);
    illegal(() => applyAction(s, 2, { type: 'bid', amount: 4 }));
    s = run(s, [[2, { type: 'pass' }]]);
    expect(pending(s)).toEqual([0]);
    s = run(s, [[0, { type: 'pass' }]]);
    expect(money(s)).toEqual([6, 97, 0]);
  });
});

describe('sealed auction', () => {
  const start = (m?: number[]) =>
    run(table([[F[0]], [c(0, 'sealed'), F[1]], [F[2]], [F[3]]].map((h) => h), m), []);
  const play = (s: GameState) => {
    s.turn = 1;
    return run(s, [[1, { type: 'play', card: c(0, 'sealed').id }]]);
  };

  it('hides bids until all are in, then the highest wins', () => {
    let s = play(start());
    s = run(s, [
      [0, { type: 'sealed', amount: 12 }],
      [2, { type: 'sealed', amount: 30 }],
    ]);
    const v = viewFor(s, 3);
    expect(v.auction!.bidsIn).toEqual([true, false, true, false]);
    expect(v.auction!.yourBid).toBeNull();
    expect(JSON.stringify(v)).not.toContain('"bids"');
    expect(viewFor(s, 2).auction!.yourBid).toBe(30);
    illegal(() => applyAction(s, 2, { type: 'sealed', amount: 31 }));
    s = run(s, [
      [1, { type: 'sealed', amount: 0 }],
      [3, { type: 'sealed', amount: 29 }],
    ]);
    expect(money(s)).toEqual([100, 130, 70, 100]);
    expect(s.log.some((e) => e.t === 'sealed' && e.bids.join() === '12,0,30,29')).toBe(true);
  });

  it('tie goes to the auctioneer', () => {
    const s = run(play(start()), [
      [0, { type: 'sealed', amount: 20 }],
      [1, { type: 'sealed', amount: 20 }],
      [2, { type: 'sealed', amount: 20 }],
      [3, { type: 'sealed', amount: 5 }],
    ]);
    expect(money(s)).toEqual([100, 80, 100, 100]);
  });

  it('tie without the auctioneer goes to the nearest clockwise', () => {
    const s = run(play(start()), [
      [0, { type: 'sealed', amount: 20 }],
      [1, { type: 'sealed', amount: 1 }],
      [2, { type: 'sealed', amount: 5 }],
      [3, { type: 'sealed', amount: 20 }],
    ]);
    // clockwise from auctioneer 1: 2, 3, 0 → seat 3 wins
    expect(money(s)).toEqual([100, 120, 100, 80]);
  });

  it('all zero: auctioneer takes it free; broke players still seal their own 0', () => {
    let s = play(start([0, 100, 100, 0]));
    expect(pending(s)).toEqual([0, 1, 2, 3]);
    illegal(() => applyAction(s, 0, { type: 'sealed', amount: 1 }));
    s = run(s, [
      [0, { type: 'sealed', amount: 0 }],
      [1, { type: 'sealed', amount: 0 }],
      [2, { type: 'sealed', amount: 0 }],
      [3, { type: 'sealed', amount: 0 }],
    ]);
    expect(bought(s)[1]).toHaveLength(1);
    expect(money(s)).toEqual([0, 100, 100, 0]);
  });
});

describe('fixed-price auction', () => {
  const start = (m?: number[]) =>
    run(table([[c(0, 'fixed'), F[0]], [F[1]], [F[2]]], m), [[0, { type: 'play', card: c(0, 'fixed').id }]]);

  it('first to accept buys', () => {
    let s = start();
    expect(pending(s)).toEqual([0]);
    illegal(() => applyAction(s, 0, { type: 'price', amount: 101 }));
    illegal(() => applyAction(s, 1, { type: 'price', amount: 10 }));
    illegal(() => applyAction(s, 1, { type: 'pass' }));
    s = run(s, [
      [0, { type: 'price', amount: 25 }],
      [1, { type: 'pass' }],
      [2, { type: 'accept' }],
    ]);
    expect(money(s)).toEqual([125, 100, 75]);
  });

  it('nobody accepts: auctioneer pays the bank', () => {
    const s = run(start(), [
      [0, { type: 'price', amount: 25 }],
      [1, { type: 'pass' }],
      [2, { type: 'pass' }],
    ]);
    expect(money(s)).toEqual([75, 100, 100]);
    expect(bought(s)[0]).toHaveLength(1);
  });

  it('a player who cannot afford the price passes themselves; price 0 is offered around', () => {
    let s = run(start([100, 10, 100]), [[0, { type: 'price', amount: 25 }]]);
    expect(pending(s)).toEqual([1]);
    illegal(() => applyAction(s, 1, { type: 'accept' }));
    s = run(s, [[1, { type: 'pass' }]]);
    expect(pending(s)).toEqual([2]);
    s = run(start(), [[0, { type: 'price', amount: 0 }]]);
    expect(pending(s)).toEqual([1]);
    s = run(s, [[1, { type: 'accept' }]]);
    expect(money(s)).toEqual([100, 100, 100]);
    expect(bought(s)[1]).toHaveLength(1);
  });
});

describe('double', () => {
  const D = c(1, 'double');

  it('second card from the same player sets the auction type; both sell as one lot', () => {
    let s = table([[D, c(1, 'fixed'), F[0]], [F[1]], [F[2]]]);
    illegal(() => applyAction(s, 0, { type: 'play', card: D.id, second: F[0].id }));
    illegal(() => applyAction(s, 0, { type: 'play', card: D.id, second: D.id }));
    illegal(() => applyAction(s, 0, { type: 'play', card: c(1, 'fixed').id, second: D.id }));
    s = run(s, [[0, { type: 'play', card: D.id, second: c(1, 'fixed').id }]]);
    expect(s.auction!.kind).toBe('fixed');
    expect(s.played[1]).toBe(2);
    s = run(s, [
      [0, { type: 'price', amount: 40 }],
      [1, { type: 'accept' }],
    ]);
    expect(bought(s)[1]).toEqual([D.id, c(1, 'fixed').id]);
    expect(money(s)).toEqual([140, 60, 100]);
  });

  it('a second double cannot be paired', () => {
    const s = table([[D, c(1, 'double', 1), F[0]], [F[1]], [F[2]]]);
    illegal(() => applyAction(s, 0, { type: 'play', card: D.id, second: c(1, 'double', 1).id }));
  });

  it('another player may add the second card and becomes the auctioneer', () => {
    let s = table([[D, F[0]], [F[1]], [c(1, 'once'), F[2]], [c(1, 'open'), F[3]]]);
    s = run(s, [[0, { type: 'play', card: D.id }]]);
    // seat 1 has no matching card but is still asked, so the table learns nothing about their hand
    expect(pending(s)).toEqual([1]);
    illegal(() => applyAction(s, 1, { type: 'add', card: F[1].id }));
    s = run(s, [[1, { type: 'decline' }]]);
    expect(pending(s)).toEqual([2]);
    illegal(() => applyAction(s, 3, { type: 'add', card: c(1, 'open').id }));
    s = run(s, [[2, { type: 'add', card: c(1, 'once').id }]]);
    expect(s.auction!.kind).toBe('once');
    expect(s.auction!.auctioneer).toBe(2);
    expect(pending(s)).toEqual([3]);
    s = run(s, [
      [3, { type: 'bid', amount: 10 }],
      [0, { type: 'bid', amount: 11 }],
      [1, { type: 'pass' }],
      [2, { type: 'pass' }],
    ]);
    // seat 0 (who played the double) pays seat 2 and gets nothing for the double
    expect(money(s)).toEqual([89, 100, 111, 100]);
    expect(bought(s)[0]).toHaveLength(2);
    expect(s.turn).toBe(3);
  });

  it('a player with a matching card may decline; nobody adds: the double is free', () => {
    let s = table([[D, F[0]], [c(1, 'once'), F[1]], [F[2]]]);
    s = run(s, [[0, { type: 'play', card: D.id }]]);
    expect(pending(s)).toEqual([1]);
    s = run(s, [
      [1, { type: 'decline' }],
      [2, { type: 'decline' }],
    ]);
    expect(s.auction).toBeNull();
    expect(bought(s)[0]).toEqual([D.id]);
    expect(money(s)).toEqual([100, 100, 100]);
    expect(s.turn).toBe(1);
  });

  it('double as 4th with the 5th as second card: round ends, neither is sold, both count', () => {
    let s = table([[D, c(1, 'open'), F[0]], [F[1]], [F[2]]]);
    s.played[1] = 3;
    s = run(s, [[0, { type: 'play', card: D.id, second: c(1, 'open').id }]]);
    expect(s.round).toBe(1);
    expect(s.summaries[0].counts[1]).toBe(5);
    expect(s.summaries[0].sold.flat()).toHaveLength(0);
    expect(s.players[0].hand.map((x) => x.id)).not.toContain(c(1, 'open').id);
  });

  it('same when another player adds the 5th; next round starts left of that player', () => {
    let s = table([[D, F[0]], [c(1, 'open'), F[1]], [F[2]]]);
    s.played[1] = 3;
    s = run(s, [
      [0, { type: 'play', card: D.id }],
      [1, { type: 'add', card: c(1, 'open').id }],
    ]);
    expect(s.round).toBe(1);
    expect(s.summaries[0].counts[1]).toBe(5);
    expect(s.turn).toBe(2);
  });

  it('double that is itself the 5th: round ends and the second card stays in hand', () => {
    let s = table([[D, c(1, 'open'), F[0]], [F[1]], [F[2]]]);
    s.played[1] = 4;
    s = run(s, [[0, { type: 'play', card: D.id, second: c(1, 'open').id }]]);
    expect(s.round).toBe(1);
    expect(s.summaries[0].counts[1]).toBe(5);
    expect(s.players[0].hand.map((x) => x.id)).toContain(c(1, 'open').id);
  });
});

describe('round end and scoring', () => {
  it('5th card is not sold; top three suits score; ties go to the lower suit', () => {
    let s = table([[c(2, 'open'), F[0]], [F[1]], [F[2]]]);
    s.played = [2, 2, 4, 0, 1];
    s.players[1].bought = [c(2, 'once'), c(0, 'once'), c(1, 'once'), c(4, 'once')];
    s.players[2].bought = [c(2, 'sealed'), c(2, 'fixed')];
    s = run(s, [[0, { type: 'play', card: c(2, 'open').id }]]);
    const sum = s.summaries[0];
    expect(sum.counts).toEqual([2, 2, 5, 0, 1]);
    expect(sum.ranked).toEqual([2, 0, 1]);
    expect(sum.values).toEqual([20, 10, 30, 0, 0]);
    expect(sum.payouts).toEqual([0, 60, 60]);
    expect(money(s)).toEqual([100, 160, 160]);
    expect(s.players.every((p) => p.bought.length === 0)).toBe(true);
    expect(s.played).toEqual([0, 0, 0, 0, 0]);
    expect(s.round).toBe(1);
    // next round: dealt 6 more, starts left of the player who ended the round
    expect(s.players.map((p) => p.hand.length)).toEqual([7, 7, 7]);
    expect(s.turn).toBe(1);
  });

  it('values accumulate across rounds, but only for suits that rank this round', () => {
    let s = table([[c(3, 'open'), F[0]], [F[1]], [F[2]]]);
    s.round = 1;
    s.tokens[0] = [30, 20, 10, 0, 0];
    s.played = [1, 0, 2, 4, 3];
    s.players[1].bought = [c(0, 'once'), c(2, 'once'), c(3, 'once'), c(4, 'once')];
    s = run(s, [[0, { type: 'play', card: c(3, 'open').id }]]);
    const sum = s.summaries[0];
    expect(sum.ranked).toEqual([3, 4, 2]);
    // suit 0 has 30 from round 1 but did not rank now → 0; suit 2: 10 + 10
    expect(sum.values).toEqual([0, 0, 20, 30, 20]);
    expect(sum.payouts[1]).toBe(70);
  });

  it('summary lists the round’s sales, without an undone call', () => {
    let s = table([[c(0, 'once')], [F[1], c(2, 'open')], []]);
    s.played[2] = 4;
    s = run(s, [
      [0, { type: 'play', card: c(0, 'once').id }],
      [1, { type: 'bid', amount: 5 }],
      [2, { type: 'pass' }],
      [0, { type: 'pass' }],
      [1, { type: 'play', card: F[1].id }],
    ]);
    // The admin calls the open auction for seat 2, then takes it back; everyone is done: seat 1 keeps it free.
    s = undoRuling(s, applyRuling(s, 0, 2, 9), 0);
    s = run(s, [
      [0, { type: 'done', seenHigh: 0 }],
      [2, { type: 'done', seenHigh: 0 }],
      [1, { type: 'done', seenHigh: 0 }],
      [1, { type: 'play', card: c(2, 'open').id }],
    ]);
    expect(s.round).toBe(1);
    expect(s.summaries[0].sales).toEqual([
      { to: 1, from: 0, price: 5, cards: [c(0, 'once')] },
      { to: 1, from: 1, price: 0, cards: [F[1]] },
    ]);
  });

  it('fewer than three suits played: only those get tokens', () => {
    let s = table([[c(0, 'open'), F[0]], [F[1]], [F[2]]]);
    s.played = [4, 0, 0, 0, 0];
    s = run(s, [[0, { type: 'play', card: c(0, 'open').id }]]);
    expect(s.summaries[0].ranked).toEqual([0]);
    expect(s.tokens[0]).toEqual([30, 0, 0, 0, 0]);
  });

  it('round ends when all hands are empty; game ends after round 4 with shared wins on ties', () => {
    let s = table([[c(0, 'open')], [], []]);
    s.round = 3;
    s = run(s, [
      [0, { type: 'play', card: c(0, 'open').id }],
      [1, { type: 'bid', amount: 10, seenHigh: 0 }],
      [0, { type: 'done', seenHigh: 10 }],
      [2, { type: 'done', seenHigh: 10 }],
    ]);
    expect(s.over).toBe(true);
    // seat 1 paid 10 and got 30 back; seat 0 received 10
    expect(money(s)).toEqual([110, 120, 100]);
    expect(s.winners).toEqual([1]);
    illegal(() => applyAction(s, 0, { type: 'pass' }));

    let t = table([[c(0, 'open')], [], []], [100, 130, 100]);
    t.round = 3;
    t = run(t, [
      [0, { type: 'play', card: c(0, 'open').id }],
      [0, { type: 'done', seenHigh: 0 }],
      [1, { type: 'done', seenHigh: 0 }],
      [2, { type: 'done', seenHigh: 0 }],
    ]);
    expect(money(t)).toEqual([130, 130, 100]);
    expect(t.winners).toEqual([0, 1]);
  });

  it('a player with no cards is skipped as auctioneer', () => {
    let s = table([[c(0, 'fixed'), F[0]], [], [F[2]]]);
    s = run(s, [
      [0, { type: 'play', card: c(0, 'fixed').id }],
      [0, { type: 'price', amount: 5 }],
      [1, { type: 'accept' }],
    ]);
    expect(s.turn).toBe(2);
  });
});

describe('skipping absent players', () => {
  it('only a seat that owes a move can be skipped', () => {
    const s = table([[F[0]], [F[1]], [F[2]]]);
    illegal(() => applySkip(s, 1));
  });

  it('auctioneer who owes a card: turn passes, hand untouched', () => {
    const s = applySkip(table([[F[0]], [F[1]], [F[2]]]), 0);
    expect(s.turn).toBe(1);
    expect(s.players[0].hand).toHaveLength(1);
  });

  it('auctioneer who is the only one with cards: the round ends', () => {
    const s = applySkip(table([[F[0]], [], []]), 0);
    expect(s.round).toBe(1);
  });

  it('open → done, once → pass, sealed → 0, offer → decline, fixed → pass', () => {
    let s = run(table([[c(0, 'open'), F[0]], [F[1]], [F[2]]]), [[0, { type: 'play', card: c(0, 'open').id }]]);
    s = applySkip(applySkip(applySkip(s, 0), 1), 2);
    expect(bought(s)[0]).toHaveLength(1);

    s = run(table([[c(0, 'once'), F[0]], [F[1]], [F[2]]]), [[0, { type: 'play', card: c(0, 'once').id }]]);
    s = applySkip(s, 1);
    expect(pending(s)).toEqual([2]);

    s = run(table([[c(0, 'sealed'), F[0]], [F[1]], [F[2]]]), [[0, { type: 'play', card: c(0, 'sealed').id }]]);
    s = applySkip(s, 2);
    expect(s.auction!.bids).toEqual([null, null, 0]);

    s = run(table([[c(1, 'double'), F[0]], [c(1, 'open'), F[1]], [F[2]]]), [[0, { type: 'play', card: c(1, 'double').id }]]);
    s = applySkip(applySkip(s, 1), 2);
    expect(bought(s)[0]).toHaveLength(1);

    s = run(table([[c(0, 'fixed'), F[0]], [F[1]], [F[2]]]), [
      [0, { type: 'play', card: c(0, 'fixed').id }],
      [0, { type: 'price', amount: 9 }],
    ]);
    s = applySkip(applySkip(s, 1), 2);
    expect(money(s)).toEqual([91, 100, 100]);
  });

  it('auctioneer who owes a fixed price takes the lot free', () => {
    let s = run(table([[c(0, 'fixed'), F[0]], [F[1]], [F[2]]]), [[0, { type: 'play', card: c(0, 'fixed').id }]]);
    s = applySkip(s, 0);
    expect(bought(s)[0]).toHaveLength(1);
    expect(money(s)).toEqual([100, 100, 100]);
    expect(s.turn).toBe(1);
  });
});

describe('admin ruling (voice bidding)', () => {
  const once = () => run(table([[c(0, 'once'), F[0]], [F[1]], [F[2]]]), [[0, { type: 'play', card: c(0, 'once').id }]]);

  it('sells to any seat at any affordable price, mid-auction, and marks who called it', () => {
    const s = applyRuling(once(), 1, 2, 30);
    expect(s.auction).toBeNull();
    expect(money(s)).toEqual([130, 100, 70]);
    expect(bought(s)[2]).toEqual([c(0, 'once').id]);
    expect(s.log.at(-1)).toMatchObject({ t: 'sold', to: 2, from: 0, price: 30, by: 1 });
    expect(s.turn).toBe(1);
  });

  it('auctioneer as buyer pays the bank; no sale gives the lot free', () => {
    expect(money(applyRuling(once(), 0, 0, 12))).toEqual([88, 100, 100]);
    const free = applyRuling(once(), 0, null, 0);
    expect(money(free)).toEqual([100, 100, 100]);
    expect(bought(free)[0]).toEqual([c(0, 'once').id]);
    expect(free.log.at(-1)).toMatchObject({ t: 'free', p: 0, by: 0 });
  });

  it('rejects unaffordable prices, bad seats, no auction and a sale of a waiting double', () => {
    illegal(() => applyRuling(once(), 0, 1, 101));
    illegal(() => applyRuling(once(), 0, 1, -1));
    illegal(() => applyRuling(once(), 0, 7, 1));
    illegal(() => applyRuling(table([[F[0]], [F[1]], [F[2]]]), 0, 1, 1));
    const offer = run(table([[c(1, 'double'), F[0]], [F[1]], [F[2]]]), [[0, { type: 'play', card: c(1, 'double').id }]]);
    illegal(() => applyRuling(offer, 0, 1, 1));
  });

  it('a waiting double can be called as "nobody adds": the player keeps it free', () => {
    const offer = run(table([[c(1, 'double'), F[0]], [F[1]], [F[2]]]), [[0, { type: 'play', card: c(1, 'double').id }]]);
    const s = applyRuling(offer, 2, null, 0);
    expect(s.auction).toBeNull();
    expect(bought(s)[0]).toEqual([c(1, 'double').id]);
    expect(money(s)).toEqual([100, 100, 100]);
    expect(s.log.at(-1)).toMatchObject({ t: 'free', p: 0, by: 2 });
  });

  it('undo restores the auction as it was and logs who took the call back', () => {
    const before = once();
    const after = applyRuling(before, 1, 2, 30);
    const s = undoRuling(before, after, 1);
    expect(s.auction).toEqual(before.auction);
    expect(money(s)).toEqual([100, 100, 100]);
    expect(s.log.at(-1)).toEqual({ t: 'undo', by: 1, cards: [c(0, 'once')] });
    expect(before.log.at(-1)?.t).toBe('play');
    illegal(() => undoRuling(before, before, 1));
  });
});

describe('hidden information', () => {
  it('a view never contains other hands, other money, the deck or the seed', () => {
    const s = newGame(4, 99);
    for (const seat of [0, 1, 2, 3, null]) {
      const v = viewFor(s, seat);
      const text = JSON.stringify(v);
      expect(text).not.toContain('"deck"');
      expect(text).not.toContain('"seed"');
      expect(v.hand).toEqual(seat === null ? [] : s.players[seat].hand);
      v.players.forEach((p, i) => expect(p.money).toBe(i === seat ? 100 : null));
      expect(Object.keys(v.players[0]).sort()).toEqual(['bought', 'handCount', 'money']);
    }
  });
});

describe('random full games', () => {
  for (const n of Object.keys(PLAYER_CONFIG).map(Number)) {
    it(`${n} players: 60 games finish with consistent cards and money`, { timeout: 60_000 }, () => {
      const check = (ok: boolean, what: string) => {
        if (!ok) throw new Error(what);
      };
      for (let seed = 1; seed <= 60; seed++) {
        const random = rng(seed * 7919 + n);
        let s = newGame(n, seed);
        let bank = 0; // net money the bank has paid out
        let steps = 0;
        while (!s.over) {
          if (++steps > 5000) throw new Error(`game ${seed} did not finish`);
          const owing = pending(s);
          check(owing.length > 0, `game ${seed}: nobody owes a move`);
          const seat = owing[Math.floor(random() * owing.length)];
          const before = s;
          if (random() < 0.03) s = applySkip(s, seat);
          else s = applyAction(s, seat, chooseAction(viewFor(s, seat), random)!);

          check(s.players.every((p) => p.money >= 0), `game ${seed}: negative money`);
          const held = [...s.deck, ...s.players.flatMap((p) => [...p.hand, ...p.bought])];
          check(new Set(held.map((x) => x.id)).size === held.length, `game ${seed}: duplicate card`);
          // money only enters through round payouts and leaves when an auctioneer buys their own lot
          const total = (g: GameState) => g.players.reduce((sum, p) => sum + p.money, 0);
          const paid = s.summaries.slice(before.summaries.length).reduce((sum, r) => sum + r.payouts.reduce((x, y) => x + y, 0), 0);
          const ownBuys = s.log
            .slice(before.log.length)
            .reduce((sum, e) => sum + (e.t === 'sold' && e.to === e.from ? e.price : 0), 0);
          bank += paid - ownBuys;
          check(total(s) === n * 100 + bank, `game ${seed}: money appeared or vanished`);
        }
        expect(s.round).toBe(4);
        expect(s.summaries).toHaveLength(4);
        expect(s.winners.length).toBeGreaterThan(0);
      }
    });
  }
});
