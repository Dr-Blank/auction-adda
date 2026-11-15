import { describe, expect, it } from 'vitest';
import DECK from '../src/generated/deck.json' with { type: 'json' };
import type { Card } from '../src/generated/index.ts';
import { THEMES } from '../src/themes/index.ts';

const deck = DECK as Card[];

describe.each(Object.values(THEMES))('theme $id', (theme) => {
  it('gives every card of a suit its own title', () => {
    for (let suit = 0; suit < theme.suits.length; suit++) {
      const titles = deck.filter((c) => c.suit === suit).map((c) => theme.cardTitle(c));
      expect(new Set(titles).size, theme.suits[suit].name).toBe(titles.length);
    }
  });

  it('uses each title and star name once across the whole deck', () => {
    const titles = deck.map((c) => theme.cardTitle(c));
    expect(new Set(titles).size).toBe(deck.length);
    expect(new Set(theme.suits.map((s) => s.short)).size).toBe(theme.suits.length);
  });
});
