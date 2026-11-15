import type { ThemeId } from '../generated/index.ts';
import { boxOffice } from './box-office/index.tsx';
import type { Theme } from './types.ts';

/**
 * Client-only registry (themes contain JSX). `ThemeId` comes from the server's list, so a theme
 * missing on either side does not compile.
 */
export const THEMES: Record<ThemeId, Theme> = {
  'box-office': boxOffice,
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
export const DEFAULT_THEME: ThemeId = 'box-office';

export function getTheme(id: string): Theme {
  return THEMES[id as ThemeId] ?? THEMES[DEFAULT_THEME];
}
