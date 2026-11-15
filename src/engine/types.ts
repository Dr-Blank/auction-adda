export type AuctionType = 'open' | 'once' | 'sealed' | 'fixed' | 'double';
/** Auction types that actually sell a lot (a double takes the type of its second card). */
export type SellType = Exclude<AuctionType, 'double'>;

export interface Card {
  /** Unique 0–69. */
  id: number;
  suit: number;
  /** Index of the card within its suit (stable, used by themes to pick art). */
  n: number;
  type: AuctionType;
}

export interface Player {
  hand: Card[];
  money: number;
  /** Cards bought in the current round. */
  bought: Card[];
}

export interface Auction {
  /** 'offer' = a double card is on the table and players are asked for a second card. */
  kind: SellType | 'offer';
  cards: Card[];
  /** Receives the payment. During an offer this is the player who played the double card. */
  auctioneer: number;
  high: number;
  highBidder: number | null;
  /** Open auction: who has said they are done at the current high bid. */
  done: boolean[];
  /** Once-around, fixed-price and offer: how many players have had their turn. */
  step: number;
  /** Once-around, fixed-price (after the price is set) and offer: the seat that must act now. */
  toAct: number | null;
  /** Sealed auction. */
  bids: (number | null)[];
  /** Fixed-price auction. */
  price: number | null;
}

export type LogEntry =
  | { t: 'round'; round: number; first: number }
  | { t: 'play'; p: number; cards: Card[]; kind: SellType }
  | { t: 'offer'; p: number; cards: Card[] }
  | { t: 'bid'; p: number; amount: number }
  | { t: 'pass'; p: number }
  | { t: 'decline'; p: number }
  | { t: 'price'; p: number; amount: number }
  | { t: 'sealed'; bids: number[] }
  /** `by`: set when the room admin called the result (voice bidding) instead of the auction running its course. */
  | { t: 'sold'; to: number; from: number; price: number; cards: Card[]; by?: number }
  | { t: 'free'; p: number; cards: Card[]; by?: number }
  | { t: 'shelved'; p: number; cards: Card[]; suit: number }
  /** The admin took back the result they called for `cards`; the auction is running again. */
  | { t: 'undo'; by: number; cards: Card[] }
  | { t: 'skip'; p: number }
  | { t: 'score'; round: number }
  | { t: 'end'; winners: number[] };

export interface RoundSummary {
  round: number;
  /** Cards played per suit this round. */
  counts: number[];
  /** Suits that received the 30 / 20 / 10 tokens, best first. */
  ranked: number[];
  /** Value of one card of each suit this round (0 when the suit did not rank). */
  values: number[];
  /** Cards each player sold to the bank. */
  sold: Card[][];
  payouts: number[];
  /** Every lot that changed hands this round, in order. Missing in summaries saved before it existed. */
  sales?: Sale[];
}

/** One lot bought in a round. `from` = the auctioneer, paid unless it is the buyer (then the bank was paid). Price 0 = taken free. */
export interface Sale {
  to: number;
  from: number;
  price: number;
  cards: Card[];
}

export interface GameState {
  n: number;
  players: Player[];
  deck: Card[];
  /** 0–3 while playing, 4 when over. */
  round: number;
  /** Seat that must play a card when no auction is running. */
  turn: number;
  /** Cards played per suit in the current round. */
  played: number[];
  /** tokens[round][suit] = 30 / 20 / 10 / 0. */
  tokens: number[][];
  auction: Auction | null;
  log: LogEntry[];
  summaries: RoundSummary[];
  over: boolean;
  winners: number[];
  seed: number;
}

export type Action =
  | { type: 'play'; card: number; second?: number }
  | { type: 'bid'; amount: number; seenHigh?: number }
  | { type: 'done'; seenHigh: number }
  | { type: 'pass' }
  | { type: 'sealed'; amount: number }
  | { type: 'price'; amount: number }
  | { type: 'accept' }
  | { type: 'add'; card: number }
  | { type: 'decline' };

export const ACTION_TYPES: readonly Action['type'][] = [
  'play', 'bid', 'done', 'pass', 'sealed', 'price', 'accept', 'add', 'decline',
];

export interface AuctionView {
  kind: SellType | 'offer';
  cards: Card[];
  auctioneer: number;
  high: number;
  highBidder: number | null;
  done: boolean[];
  toAct: number | null;
  price: number | null;
  /** Sealed: who has submitted. Amounts stay hidden until the reveal. */
  bidsIn: boolean[];
  /** Sealed: the viewer's own bid. */
  yourBid: number | null;
}

export interface PlayerView {
  handCount: number;
  /** null = hidden. Own money is always visible; everyone's is revealed at game end. */
  money: number | null;
  bought: Card[];
}

/** What one seat (or a spectator, `you: null`) is allowed to know. */
export interface View {
  n: number;
  you: number | null;
  round: number;
  turn: number;
  played: number[];
  tokens: number[][];
  players: PlayerView[];
  hand: Card[];
  auction: AuctionView | null;
  /** Seats that owe an action right now. */
  pending: number[];
  log: LogEntry[];
  /** Position of `log[0]` in the full log (the view carries only the latest entries). */
  logStart: number;
  summaries: RoundSummary[];
  over: boolean;
  winners: number[];
  deckCount: number;
}

export class RuleError extends Error {}
