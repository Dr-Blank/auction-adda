/** Theme ids only, so the server can validate a theme without importing any UI code. */
export const THEME_IDS = ['box-office'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const DEFAULT_THEME: ThemeId = 'box-office';
