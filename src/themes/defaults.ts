import { SUIT_LIMIT } from '../config.ts';
import type { Nouns, Theme, ThemeDef } from './types.ts';

/** Plain English for everything a theme leaves out. */
export const DEFAULT_NOUNS: Nouns = { card: 'card', cards: 'cards', suit: 'suit', player: 'Player', chart: 'Value Chart', round: 'round' };

export const DEFAULT_TAGLINES = [
  'Everyone wants this one.',
  'A safe bet. Probably.',
  'Bid with your head, not your heart.',
  'Rarer than it looks.',
  'The table will talk about this one.',
  'Worth every rupee?',
];

type Text = Pick<
  Theme,
  'money' | 'auctionLabels' | 'auctionHints' | 'auctionBriefs' | 'auctionIcons' | 'roundNames' | 'rankLabels' | 'nouns' | 'shelved' | 'sold'
>;

/** The theme's words over the defaults; the default hints use the theme's nouns. */
export function themeText(def: ThemeDef): Text {
  const nouns = { ...DEFAULT_NOUNS, ...def.nouns };
  const { card, suit, round } = nouns;
  return {
    money: def.money ?? ((n) => `₹${n}`),
    auctionLabels: { open: 'Open Auction', once: 'Once Around', sealed: 'Sealed Bid', fixed: 'Fixed Price', double: 'Double', ...def.auctionLabels },
    auctionHints: {
      open: 'Anyone can raise at any time. Done takes you out until you bid again. It sells when everyone else is done or the bid timer runs out.',
      once: 'One bid each, going round the table. The seller bids last.',
      sealed: 'Everyone bids in secret, once. Highest wins; a tie goes to the seller, then clockwise.',
      fixed: 'The seller names a price. First player round the table to accept buys it; if nobody does, the seller pays.',
      double: `Add a second ${card} of the same ${suit}; both sell together using the second ${card}’s auction.`,
      ...def.auctionHints,
    },
    auctionBriefs: {
      open: 'Anyone raises, any time',
      once: 'One bid each, in turn',
      sealed: 'One secret bid each',
      fixed: 'Seller names the price',
      double: `Sells with a second ${card}`,
      ...def.auctionBriefs,
    },
    auctionIcons: { open: '⇈', once: '↻', sealed: '✉', fixed: '=', double: '×2', ...def.auctionIcons },
    roundNames: def.roundNames ?? ['First round', 'Second round', 'Third round', 'Final round'],
    rankLabels: def.rankLabels ?? ['Gold', 'Silver', 'Bronze'],
    nouns,
    shelved: def.shelved ?? `That makes ${SUIT_LIMIT} of one ${suit}: the ${round} ends and this ${card} goes unsold.`,
    sold: def.sold ?? 'Going once… going twice… SOLD!',
  };
}
