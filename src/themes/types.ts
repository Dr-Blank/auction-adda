import type { JSX } from 'react';
import type { AuctionType, Card } from '../generated/index.ts';

/** One suit as a game shows it: its genre and the names drawn for it. */
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
  /** Index of the genre in the theme's list; art and portraits go by it. */
  key: number;
}

export type CardSize = 'sm' | 'md' | 'lg';

export interface Nouns {
  card: string;
  cards: string;
  suit: string;
  player: string;
  chart: string;
  round: string;
}

/** Everything a player sees, for one game. The engine knows only suits, auction types and integers. */
export interface Theme {
  id: string;
  title: string;
  tagline: string;
  chrome: Record<`--${string}`, string>;
  money(n: number): string;
  suits: SuitSkin[];
  auctionLabels: Record<AuctionType, string>;
  auctionHints: Record<AuctionType, string>;
  /** The auction type in four or five words, for where the full hint does not fit (phone stage). */
  auctionBriefs: Record<AuctionType, string>;
  auctionIcons: Record<AuctionType, string>;
  roundNames: [string, string, string, string];
  /** Names for the 30 / 20 / 10 tokens. */
  rankLabels: [string, string, string];
  nouns: Nouns;
  /** Shown when the 5th card of a suit ends the round. */
  shelved: string;
  sold: string;
  cardTitle(card: Card): string;
  renderCard(card: Card, size?: CardSize): JSX.Element;
  /** Portrait for a suit (a face, a crest…), drawn at `px` pixels square. */
  renderSuit(suit: number, px: number): JSX.Element;
}

/**
 * A suit candidate. Every list may be any length: each game shows one name and one label, and
 * shuffles the titles (past the end of the list they come back as sequels: "Title 2").
 */
export interface Genre {
  names: string[];
  labels: string[];
  titles: string[];
  /** Left out: the default taglines. */
  taglines?: string[];
  color: string;
  ink: string;
  glyph: string;
}

/** What a card shows in this game. */
export interface CardLook {
  suit: SuitSkin;
  title: string;
  tagline: string;
  theme: Theme;
}

/** Words a theme may leave out; they then come from `defaults.ts`. Records merge key by key. */
export interface ThemeText {
  money?: (n: number) => string;
  auctionLabels?: Partial<Record<AuctionType, string>>;
  auctionHints?: Partial<Record<AuctionType, string>>;
  auctionBriefs?: Partial<Record<AuctionType, string>>;
  auctionIcons?: Partial<Record<AuctionType, string>>;
  roundNames?: [string, string, string, string];
  rankLabels?: [string, string, string];
  nouns?: Partial<Nouns>;
  shelved?: string;
  sold?: string;
}

/** A theme as written: any number of genres (at least one per suit), resolved per game by `castTheme`. */
export interface ThemeDef extends ThemeText {
  id: string;
  title: string;
  tagline: string;
  genres: Genre[];
  /** CSS variables for the app around the cards (`--bg`, `--panel`, `--glow`…); left out: the default look. */
  chrome?: Record<`--${string}`, string>;
  renderCard(card: Card, size: CardSize, look: CardLook): JSX.Element;
  renderSuit(suit: SuitSkin, px: number): JSX.Element;
}
