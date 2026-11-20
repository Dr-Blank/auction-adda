import type { Cast, ThemeId } from "../../../generated/index.ts";
import { boxOffice } from "./box-office/index.tsx";
import { castTheme } from "./cast.ts";
import { leatherWillow } from "./leather-willow/index.tsx";
import type { Theme, ThemeDef } from "./types.ts";

/**
 * Client-only registry (themes contain JSX), the auction's themes of the server's `ThemeId` list.
 * A theme the server gives this game but missing here fails `test/games.test.ts`.
 */
export const THEMES = {
  "box-office": boxOffice,
  "leather-willow": leatherWillow,
} satisfies Partial<Record<ThemeId, ThemeDef>>;

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
export const DEFAULT_THEME = "box-office" satisfies keyof typeof THEMES;
const NO_CAST: Cast = { seed: 0, genres: [] };

export function getDef(id: string): ThemeDef {
  return (THEMES as Partial<Record<string, ThemeDef>>)[id] ?? THEMES[DEFAULT_THEME];
}

// Same room, same cast, same object: components can depend on it.
const cache = new Map<string, Theme>();

/** The theme as this room's game shows it. */
export function getTheme(id: string, cast: Cast = NO_CAST): Theme {
  const def = getDef(id);
  const key = `${def.id}:${cast.seed}:${cast.genres.join(",")}`;
  let theme = cache.get(key);
  if (!theme) {
    if (cache.size > 16) cache.clear();
    theme = castTheme(def, cast);
    cache.set(key, theme);
  }
  return theme;
}
