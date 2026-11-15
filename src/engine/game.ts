import { PLAYER_CONFIG, ROUNDS, SUITS, SUIT_LIMIT, TOKENS } from './config.ts';
import { buildDeck, rng, shuffle, sortHand } from './deck.ts';
import { RuleError } from './types.ts';
import type { Action, Auction, Card, GameState, Sale, SellType } from './types.ts';

function fail(message: string): never {
  throw new RuleError(message);
}

function isAmount(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
}

export function newGame(n: number, seed: number): GameState {
  const cfg = PLAYER_CONFIG[n];
  if (!cfg) fail(`Cannot play with ${n} players`);
  const random = rng(seed);
  const s: GameState = {
    n,
    players: Array.from({ length: n }, () => ({ hand: [], money: cfg.startMoney, bought: [] })),
    deck: shuffle(buildDeck(), random),
    round: 0,
    turn: Math.floor(random() * n),
    played: Array(SUITS).fill(0),
    tokens: Array.from({ length: ROUNDS }, () => Array(SUITS).fill(0)),
    auction: null,
    log: [],
    summaries: [],
    over: false,
    winners: [],
    seed,
  };
  deal(s);
  s.log.push({ t: 'round', round: 0, first: s.turn });
  return s;
}

function deal(s: GameState): void {
  const count = PLAYER_CONFIG[s.n].deal[s.round];
  for (const p of s.players) {
    for (let i = 0; i < count; i++) p.hand.push(s.deck.pop()!);
    sortHand(p.hand);
  }
}

/** Seats that owe an action right now. */
export function pending(s: GameState): number[] {
  if (s.over) return [];
  const a = s.auction;
  if (!a) return [s.turn];
  const all = s.players.map((_, i) => i);
  switch (a.kind) {
    case 'open':
      return all.filter((i) => i !== a.highBidder && !a.done[i]);
    case 'sealed':
      return all.filter((i) => a.bids[i] === null);
    case 'fixed':
      return a.price === null ? [a.auctioneer] : [a.toAct!];
    default:
      return [a.toAct!];
  }
}

/** Applies one move for a seat. Returns a new state; throws RuleError if the move is illegal. */
export function applyAction(prev: GameState, seat: number, action: Action): GameState {
  const s = structuredClone(prev);
  checkSeat(s, seat);
  act(s, seat, action);
  return s;
}

/**
 * Makes the neutral move for a seat that owes an action (used for absent players):
 * pass, done, sealed bid 0, decline. An auctioneer who owes a card plays nothing;
 * one who owes a fixed price takes the lot free.
 */
export function applySkip(prev: GameState, seat: number): GameState {
  const s = structuredClone(prev);
  checkSeat(s, seat);
  if (!pending(s).includes(seat)) fail('That player does not owe a move');
  s.log.push({ t: 'skip', p: seat });
  const a = s.auction;
  if (!a) {
    const next = nextWithCards(s, seat, false);
    if (next === null) endRound(s, seat);
    else s.turn = next;
  } else if (a.kind === 'open') {
    act(s, seat, { type: 'done', seenHigh: a.high });
  } else if (a.kind === 'sealed') {
    act(s, seat, { type: 'sealed', amount: 0 });
  } else if (a.kind === 'fixed' && a.price === null) {
    resolve(s, null, 0);
  } else if (a.kind === 'offer') {
    act(s, seat, { type: 'decline' });
  } else {
    act(s, seat, { type: 'pass' });
  }
  return s;
}

/**
 * Ends the running auction with a result called by the room admin, for tables that bid by voice.
 * `winner` null = no sale, the auctioneer takes the lot free. Payment follows the normal rules:
 * the winner pays the auctioneer, or the bank if the winner is the auctioneer.
 * During a double offer only "nobody adds" can be called: the second card would come from a hidden hand.
 */
export function applyRuling(prev: GameState, by: number, winner: number | null, price: number): GameState {
  const s = structuredClone(prev);
  checkSeat(s, by);
  const a = s.auction ?? fail('No auction is running');
  if (a.kind === 'offer' && winner !== null) fail('Nobody has added a second card yet; you can only call “nobody adds”');
  if (winner === null) {
    resolve(s, null, 0, by);
    return s;
  }
  if (!Number.isInteger(winner) || winner < 0 || winner >= s.n) fail('No such seat');
  if (!isAmount(price)) fail('Price must be a whole number');
  if (price > s.players[winner].money) fail('Not possible at that price. Check the amount with the buyer');
  resolve(s, winner, price, by);
  return s;
}

/**
 * Takes back a result the admin called: returns `before` (the state the ruling was applied to)
 * with an `undo` line added to the log. The caller checks that nothing else happened since.
 */
export function undoRuling(before: GameState, after: GameState, by: number): GameState {
  const called = after.log.findLast((e) => (e.t === 'sold' || e.t === 'free') && e.by !== undefined);
  if (!called || (called.t !== 'sold' && called.t !== 'free')) fail('Nothing to undo');
  const s = structuredClone(before);
  s.log.push({ t: 'undo', by, cards: called.cards });
  return s;
}

function checkSeat(s: GameState, seat: number): void {
  if (s.over) fail('The game is over');
  if (!Number.isInteger(seat) || seat < 0 || seat >= s.n) fail('No such seat');
}

function findCard(hand: Card[], id: unknown): Card {
  return hand.find((c) => c.id === id) ?? fail('That card is not in your hand');
}

function removeCard(hand: Card[], card: Card): void {
  hand.splice(hand.indexOf(card), 1);
}

function canPair(double: Card, second: Card): boolean {
  return second.id !== double.id && second.suit === double.suit && second.type !== 'double';
}

function act(s: GameState, seat: number, action: Action): void {
  const a = s.auction;
  const me = s.players[seat];
  switch (action?.type) {
    case 'play': {
      if (a) fail('An auction is already running');
      if (s.turn !== seat) fail('It is not your turn');
      const card = findCard(me.hand, action.card);
      let second: Card | null = null;
      if (action.second !== undefined && action.second !== null) {
        if (card.type !== 'double') fail('Only a double card can take a second card');
        second = findCard(me.hand, action.second);
        if (!canPair(card, second)) fail('The second card must be the same suit and not a double');
      }
      removeCard(me.hand, card);
      if (++s.played[card.suit] >= SUIT_LIMIT) return shelve(s, seat, [card]);
      if (card.type !== 'double') return startAuction(s, seat, [card], card.type);
      if (second) {
        removeCard(me.hand, second);
        if (++s.played[card.suit] >= SUIT_LIMIT) return shelve(s, seat, [card, second]);
        return startAuction(s, seat, [card, second], second.type as SellType);
      }
      s.auction = blankAuction(s, 'offer', seat, [card]);
      s.log.push({ t: 'offer', p: seat, cards: [card] });
      return advance(s);
    }

    case 'add': {
      if (!a || a.kind !== 'offer') fail('No double card is waiting for a second card');
      if (a.toAct !== seat) fail('It is not your turn');
      const double = a.cards[0];
      const card = findCard(me.hand, action.card);
      if (!canPair(double, card)) fail('The second card must be the same suit and not a double');
      removeCard(me.hand, card);
      if (++s.played[card.suit] >= SUIT_LIMIT) return shelve(s, seat, [double, card]);
      return startAuction(s, seat, [double, card], card.type as SellType);
    }

    case 'decline': {
      if (!a || a.kind !== 'offer') fail('No double card is waiting for a second card');
      if (a.toAct !== seat) fail('It is not your turn');
      s.log.push({ t: 'decline', p: seat });
      a.step++;
      return advance(s);
    }

    case 'bid': {
      if (!a) fail('No auction is running');
      const amount = action.amount;
      if (!isAmount(amount)) fail('Bid must be a whole number');
      if (a.kind === 'open') {
        if (action.seenHigh !== a.high) fail('The high bid changed, look again');
        if (a.highBidder === seat) fail('You already hold the high bid');
      } else if (a.kind === 'once') {
        if (a.toAct !== seat) fail('It is not your turn');
      } else {
        fail('This auction does not take bids like that');
      }
      if (amount <= a.high) fail(`Bid must be more than ${a.high}`);
      if (amount > me.money) fail('You do not have that much money');
      a.high = amount;
      a.highBidder = seat;
      s.log.push({ t: 'bid', p: seat, amount });
      if (a.kind === 'open') {
        a.done.fill(false);
        return settleOpen(s);
      }
      a.step++;
      return advance(s);
    }

    case 'done': {
      if (!a || a.kind !== 'open') fail('No open auction is running');
      if (a.highBidder === seat) fail('You hold the high bid');
      if (action.seenHigh !== a.high) fail('The high bid changed, look again');
      a.done[seat] = true;
      return settleOpen(s);
    }

    case 'pass': {
      if (!a || (a.kind !== 'once' && a.kind !== 'fixed')) fail('Nothing to pass on');
      if (a.kind === 'fixed' && a.price === null) fail('The price is not set yet');
      if (a.toAct !== seat) fail('It is not your turn');
      s.log.push({ t: 'pass', p: seat });
      a.step++;
      return advance(s);
    }

    case 'sealed': {
      if (!a || a.kind !== 'sealed') fail('No sealed auction is running');
      if (a.bids[seat] !== null) fail('You already bid');
      if (!isAmount(action.amount)) fail('Bid must be a whole number');
      if (action.amount > me.money) fail('You do not have that much money');
      a.bids[seat] = action.amount;
      return settleSealed(s);
    }

    case 'price': {
      if (!a || a.kind !== 'fixed') fail('No fixed-price auction is running');
      if (a.auctioneer !== seat) fail('Only the auctioneer sets the price');
      if (a.price !== null) fail('The price is already set');
      if (!isAmount(action.amount)) fail('Price must be a whole number');
      if (action.amount > me.money) fail('The price cannot be more than your own money');
      a.price = action.amount;
      a.high = action.amount;
      s.log.push({ t: 'price', p: seat, amount: action.amount });
      return advance(s);
    }

    case 'accept': {
      if (!a || a.kind !== 'fixed' || a.price === null) fail('Nothing to accept');
      if (a.toAct !== seat) fail('It is not your turn');
      if (a.price > me.money) fail('You do not have that much money');
      return resolve(s, seat, a.price);
    }

    default:
      fail('Unknown move');
  }
}

function blankAuction(s: GameState, kind: Auction['kind'], auctioneer: number, cards: Card[]): Auction {
  return {
    kind,
    cards,
    auctioneer,
    high: 0,
    highBidder: null,
    done: Array(s.n).fill(false),
    step: 0,
    toAct: null,
    bids: Array(s.n).fill(null),
    price: null,
  };
}

function startAuction(s: GameState, auctioneer: number, cards: Card[], kind: SellType): void {
  s.auction = blankAuction(s, kind, auctioneer, cards);
  s.log.push({ t: 'play', p: auctioneer, cards, kind });
  if (kind === 'open') settleOpen(s);
  else if (kind === 'once') advance(s);
  else if (kind === 'sealed') settleSealed(s);
  // fixed: wait for the auctioneer's price
}

// Nothing below ever acts for a player because of their money or their hand: an automatic
// pass would tell the table what that player cannot afford or does not hold.

/** Open auction: closes when everyone but the leader has said they are done. */
function settleOpen(s: GameState): void {
  const a = s.auction!;
  if (s.players.every((_, i) => i === a.highBidder || a.done[i])) resolve(s, a.highBidder, a.high);
}

function settleSealed(s: GameState): void {
  const a = s.auction!;
  if (a.bids.some((b) => b === null)) return;
  const bids = a.bids as number[];
  s.log.push({ t: 'sealed', bids: bids.slice() });
  const best = Math.max(...bids);
  if (best === 0) return resolve(s, null, 0);
  // Ties: the auctioneer first, then clockwise from the auctioneer.
  for (let k = 0; k < s.n; k++) {
    const seat = (a.auctioneer + k) % s.n;
    if (bids[seat] === best) return resolve(s, seat, best);
  }
}

/** Once-around, fixed-price and offer: hand the turn to the next seat, or finish when it comes back to the auctioneer. */
function advance(s: GameState): void {
  const a = s.auction!;
  if (a.step >= s.n) return resolve(s, a.highBidder, a.high);
  const seat = (a.auctioneer + 1 + a.step) % s.n;
  if (seat === a.auctioneer) {
    // Once-around: with no bids the auctioneer takes the lot free; otherwise they get the last bid.
    if (a.kind === 'once' && a.highBidder === null) return resolve(s, null, 0);
    if (a.kind === 'fixed') return resolve(s, seat, a.price!);
    if (a.kind === 'offer') return resolve(s, null, 0);
  }
  a.toAct = seat;
}

/** Ends the auction. `winner` null = nobody bid, the auctioneer takes the lot free. */
function resolve(s: GameState, winner: number | null, price: number, by?: number): void {
  const a = s.auction!;
  const ruled = by === undefined ? {} : { by };
  if (winner === null) {
    s.players[a.auctioneer].bought.push(...a.cards);
    s.log.push({ t: 'free', p: a.auctioneer, cards: a.cards, ...ruled });
  } else {
    s.players[winner].money -= price;
    if (winner !== a.auctioneer) s.players[a.auctioneer].money += price;
    s.players[winner].bought.push(...a.cards);
    s.log.push({ t: 'sold', to: winner, from: a.auctioneer, price, cards: a.cards, ...ruled });
  }
  s.auction = null;
  const next = nextWithCards(s, a.auctioneer, true);
  if (next === null) endRound(s, a.auctioneer);
  else s.turn = next;
}

/** First seat clockwise after `from` that still holds cards. */
function nextWithCards(s: GameState, from: number, includeFrom: boolean): number | null {
  for (let k = 1; k <= (includeFrom ? s.n : s.n - 1); k++) {
    const seat = (from + k) % s.n;
    if (s.players[seat].hand.length > 0) return seat;
  }
  return null;
}

/** The card (or double lot) that brought a suit to the limit is not sold, and the round ends. */
function shelve(s: GameState, seat: number, cards: Card[]): void {
  s.log.push({ t: 'shelved', p: seat, cards, suit: cards[0].suit });
  endRound(s, seat);
}

/** Lots bought since the round started, from the log. An undone call is not in it: undo restores the state before the call. */
function roundSales(s: GameState, round: number): Sale[] {
  const start = s.log.findLastIndex((e) => e.t === 'round' && e.round === round);
  const sales: Sale[] = [];
  for (const e of s.log.slice(start + 1)) {
    if (e.t === 'sold') sales.push({ to: e.to, from: e.from, price: e.price, cards: e.cards });
    else if (e.t === 'free') sales.push({ to: e.p, from: e.p, price: 0, cards: e.cards });
  }
  return sales;
}

function endRound(s: GameState, ender: number): void {
  const round = s.round;
  const counts = s.played.slice();
  const ranked = counts
    .map((count, suit) => ({ count, suit }))
    .filter((x) => x.count > 0)
    .sort((x, y) => y.count - x.count || x.suit - y.suit)
    .slice(0, TOKENS.length)
    .map((x) => x.suit);
  ranked.forEach((suit, i) => (s.tokens[round][suit] = TOKENS[i]));
  const values = counts.map((_, suit) =>
    ranked.includes(suit) ? s.tokens.slice(0, round + 1).reduce((sum, row) => sum + row[suit], 0) : 0,
  );
  const sold = s.players.map((p) => p.bought);
  const payouts = sold.map((cards) => cards.reduce((sum, c) => sum + values[c.suit], 0));
  s.players.forEach((p, i) => {
    p.money += payouts[i];
    p.bought = [];
  });
  s.summaries.push({ round, counts, ranked, values, sold, payouts, sales: roundSales(s, round) });
  s.log.push({ t: 'score', round });
  s.auction = null;
  s.played = Array(SUITS).fill(0);
  s.round++;

  if (s.round >= ROUNDS) {
    const best = Math.max(...s.players.map((p) => p.money));
    s.winners = s.players.flatMap((p, i) => (p.money === best ? [i] : []));
    s.over = true;
    s.log.push({ t: 'end', winners: s.winners });
    return;
  }
  deal(s);
  const first = nextWithCards(s, ender, true);
  if (first === null) return endRound(s, ender);
  s.turn = first;
  s.log.push({ t: 'round', round: s.round, first });
}
