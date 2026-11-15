import { boxOffice } from './box-office/index.tsx';
import { DEFAULT_THEME } from './ids.ts';
import type { ThemeId } from './ids.ts';
import type { Theme } from './types.ts';

/** Client-only registry (themes contain JSX). The server validates ids against ./ids.ts. */
export const THEMES: Record<ThemeId, Theme> = {
  'box-office': boxOffice,
};

export function getTheme(id: string): Theme {
  return THEMES[id as ThemeId] ?? THEMES[DEFAULT_THEME];
}
