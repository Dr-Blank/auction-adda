import { describe, expect, it } from 'vitest';
import { buildDeck } from '../src/engine/deck.ts';
import { THEMES } from '../src/themes/index.ts';

const DECK = buildDeck();

describe.each(Object.values(THEMES))('theme $id', (theme) => {
  it('gives every card of a suit its own title', () => {
    for (let suit = 0; suit < theme.suits.length; suit++) {
      const titles = DECK.filter((c) => c.suit === suit).map((c) => theme.cardTitle(c));
      expect(new Set(titles).size, theme.suits[suit].name).toBe(titles.length);
    }
  });

  it('uses each title and star name once across the whole deck', () => {
    const titles = DECK.map((c) => theme.cardTitle(c));
    expect(new Set(titles).size).toBe(DECK.length);
    expect(new Set(theme.suits.map((s) => s.short)).size).toBe(theme.suits.length);
  });
});
