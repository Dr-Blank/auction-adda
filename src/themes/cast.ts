import { SUITS } from "../config.ts";
import type { Card, Cast } from "../generated/index.ts";
import { rng } from "../rng.ts";
import { DEFAULT_TAGLINES, themeText } from "./defaults.ts";
import type { SuitSkin, Theme, ThemeDef } from "./types.ts";

function shuffle<T>(xs: readonly T[], r: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Genres that play, in the theme's order: the admin's pick when it fits this theme, else `SUITS`
 * of them picked by the seed.
 */
export function castGenres(count: number, cast: Cast): number[] {
  const { genres } = cast;
  const fits = genres.length === SUITS && new Set(genres).size === SUITS && genres.every((g) => g < count);
  const picked = fits ? genres : shuffle([...Array(count).keys()], rng(cast.seed)).slice(0, SUITS);
  return [...picked].sort((a, b) => a - b);
}

/** Initials, or more letters when another suit already has them. */
function shortName(name: string, taken: Set<string>): string {
  const words = name.split(/[\s-]+/).filter((w) => /^[a-z]/i.test(w));
  const letters = words.join("").toUpperCase();
  const tries = [
    words
      .map((w) => w[0])
      .join("")
      .slice(0, 3)
      .toUpperCase(),
    letters.slice(0, 2),
    letters.slice(0, 3),
  ];
  const free =
    tries.find((t) => !taken.has(t)) ?? [1, 2, 3, 4, 5].map((k) => `${letters[0]}${k}`).find((t) => !taken.has(t))!;
  taken.add(free);
  return free;
}

/** The theme as one game shows it. Each genre draws from its own stream, so its names do not change when other genres are picked. */
export function castTheme(def: ThemeDef, cast: Cast): Theme {
  const text = themeText(def);
  const taken = new Set<string>();
  const drawn = castGenres(def.genres.length, cast).map((key) => {
    const g = def.genres[key];
    const r = rng(cast.seed + 7919 * (key + 1));
    const pick = (xs: string[]) => xs[Math.floor(r() * xs.length)];
    const suit: SuitSkin = {
      key,
      name: pick(g.names),
      short: "",
      genre: pick(g.labels),
      color: g.color,
      ink: g.ink,
      glyph: g.glyph,
    };
    suit.short = shortName(suit.name, taken);
    return { suit, titles: shuffle(g.titles, r), taglines: shuffle(g.taglines ?? DEFAULT_TAGLINES, r) };
  });
  const cardTitle = (card: Card): string => {
    const { titles } = drawn[card.suit];
    const sequel = Math.floor(card.n / titles.length);
    return titles[card.n % titles.length] + (sequel ? ` ${sequel + 1}` : "");
  };
  const theme: Theme = {
    ...text,
    id: def.id,
    title: def.title,
    tagline: def.tagline,
    chrome: def.chrome ?? {},
    suits: drawn.map((d) => d.suit),
    cardTitle,
    renderCard: (card, size = "md") => {
      const { suit, taglines } = drawn[card.suit];
      return def.renderCard(card, size, {
        suit,
        title: cardTitle(card),
        tagline: taglines[card.n % taglines.length],
        theme,
      });
    },
    renderSuit: (suit, px) => def.renderSuit(drawn[suit].suit, px),
  };
  return theme;
}
