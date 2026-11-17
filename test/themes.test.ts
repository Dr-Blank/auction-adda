import { describe, expect, it } from "vitest";
import { SUITS } from "../src/config.ts";
import DECK from "../src/generated/deck.json" with { type: "json" };
import type { Card } from "../src/generated/index.ts";
import { castGenres } from "../src/themes/cast.ts";
import { getTheme, THEMES } from "../src/themes/index.ts";

const deck = DECK as Card[];
const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7_777 + 1);

describe.each(Object.values(THEMES))("theme $id", (def) => {
  it("has enough genres, and every list has something in it", () => {
    expect(def.genres.length).toBeGreaterThanOrEqual(SUITS);
    for (const g of def.genres) {
      expect(g.names.length && g.labels.length && g.titles.length, g.names[0]).toBeTruthy();
      expect(g.taglines?.length ?? 1).toBeGreaterThan(0);
    }
  });

  it("never shows one title, star name or short name twice in a game", () => {
    for (const seed of SEEDS) {
      const theme = getTheme(def.id, { seed, genres: [] });
      const titles = deck.map((c) => theme.cardTitle(c));
      expect(new Set(titles).size, `seed ${seed}`).toBe(deck.length);
      expect(new Set(theme.suits.map((s) => s.short)).size).toBe(SUITS);
      expect(new Set(theme.suits.map((s) => s.name)).size).toBe(SUITS);
    }
  });

  it("draws different names from different seeds", () => {
    const shown = new Set(
      SEEDS.map((seed) =>
        getTheme(def.id, { seed, genres: [] })
          .suits.map((s) => s.name)
          .join(),
      ),
    );
    expect(shown.size).toBeGreaterThan(1);
  });

  it("plays the genres the admin picked, and ignores a pick that does not fit", () => {
    const pick = [...Array(SUITS).keys()].reverse();
    expect(castGenres(def.genres.length, { seed: 1, genres: pick })).toEqual([...pick].sort());
    const bad = castGenres(def.genres.length, { seed: 1, genres: [0, 0, 1, 2, 99] });
    expect(new Set(bad).size).toBe(SUITS);
    expect(bad.every((g) => g < def.genres.length)).toBe(true);
  });

  it("gives every genre a real colour, never a grey that reads as text", () => {
    const saturation = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    };
    for (const g of def.genres) expect(saturation(g.color), `${g.names[0]} ${g.color}`).toBeGreaterThanOrEqual(0.3);
  });

  it("fills every word it leaves out from the defaults", () => {
    const theme = getTheme(def.id);
    for (const t of ["open", "once", "sealed", "fixed", "double"] as const) {
      expect(
        theme.auctionLabels[t] && theme.auctionHints[t] && theme.auctionBriefs[t] && theme.auctionIcons[t],
      ).toBeTruthy();
    }
    expect(theme.sold && theme.shelved && theme.nouns.card).toBeTruthy();
  });
});

it("a genre keeps its names when the admin swaps another genre", () => {
  const def = THEMES["box-office"];
  if (def.genres.length <= SUITS) return;
  const a = getTheme(def.id, { seed: 42, genres: [0, 1, 2, 3, 4] });
  const b = getTheme(def.id, { seed: 42, genres: [0, 1, 2, 3, 5] });
  expect(a.suits.slice(0, 4).map((s) => s.name)).toEqual(b.suits.slice(0, 4).map((s) => s.name));
});
