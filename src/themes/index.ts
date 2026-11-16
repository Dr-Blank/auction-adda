import type { Cast, ThemeId } from '../generated/index.ts';
import { boxOffice } from './box-office/index.tsx';
import { castTheme } from './cast.ts';
import { leatherWillow } from './leather-willow/index.tsx';
import type { Theme, ThemeDef } from './types.ts';

/**
 * Client-only registry (themes contain JSX). `ThemeId` comes from the server's list, so a theme
 * missing on either side does not compile.
 */
export const THEMES: Record<ThemeId, ThemeDef> = {
  'box-office': boxOffice,
  'leather-willow': leatherWillow,
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
export const DEFAULT_THEME: ThemeId = 'box-office';
const NO_CAST: Cast = { seed: 0, genres: [] };

export function getDef(id: string): ThemeDef {
  return THEMES[id as ThemeId] ?? THEMES[DEFAULT_THEME];
}

// Same room, same cast, same object: components can depend on it.
const cache = new Map<string, Theme>();

/** The theme as this room's game shows it. */
export function getTheme(id: string, cast: Cast = NO_CAST): Theme {
  const def = getDef(id);
  const key = `${def.id}:${cast.seed}:${cast.genres.join(',')}`;
  let theme = cache.get(key);
  if (!theme) {
    if (cache.size > 16) cache.clear();
    theme = castTheme(def, cast);
    cache.set(key, theme);
  }
  return theme;
}
