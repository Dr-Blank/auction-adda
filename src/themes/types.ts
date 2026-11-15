import type { JSX } from 'react';
import type { AuctionType, Card } from '../engine/types.ts';

export interface SuitSkin {
  name: string;
  /** Two or three letters, shown where space is tight and as a non-colour cue. */
  short: string;
  genre: string;
  color: string;
  /** Text colour that reads on `color`. */
  ink: string;
  /** A shape shown with the colour, so players who cannot tell the colours apart can tell the suits apart. */
  glyph: string;
}

export type CardSize = 'sm' | 'md' | 'lg';

/** Everything a player sees. The engine knows only suits 0–4, auction types and integers. */
export interface Theme {
  id: string;
  title: string;
  tagline: string;
  money(n: number): string;
  suits: [SuitSkin, SuitSkin, SuitSkin, SuitSkin, SuitSkin];
  auctionLabels: Record<AuctionType, string>;
  auctionHints: Record<AuctionType, string>;
  /** The auction type in four or five words, for where the full hint does not fit (phone stage). */
  auctionBriefs: Record<AuctionType, string>;
  auctionIcons: Record<AuctionType, string>;
  roundNames: [string, string, string, string];
  /** Names for the 30 / 20 / 10 tokens. */
  rankLabels: [string, string, string];
  nouns: { card: string; cards: string; suit: string; player: string; chart: string; round: string };
  /** Shown when the 5th card of a suit ends the round. */
  shelved: string;
  sold: string;
  cardTitle(card: Card): string;
  renderCard(card: Card, size?: CardSize): JSX.Element;
  /** Portrait for a suit (a face, a crest…), drawn at `px` pixels square. */
  renderSuit(suit: number, px: number): JSX.Element;
}
