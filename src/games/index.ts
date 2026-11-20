// The games the client can show. Which game a theme plays comes from the server's list
// (src/generated/games.json, written from `ThemeId::game`), so client and server always agree.

import GAMES_JSON from "../generated/games.json" with { type: "json" };
import type { Cast, GameId, ThemeId } from "../generated/index.ts";
import { auction } from "./auction/index.tsx";
import type { GameClient, Skin } from "./types.ts";

/** Every game, by id. `GameId` comes from the server: a game missing here does not compile. */
export const GAMES: Record<GameId, GameClient> = { auction };

/** The games in the order Home and the theme picker show them. */
export const GAME_LIST: GameClient[] = Object.values(GAMES);

export const DEFAULT_GAME: GameId = "auction";

const THEME_GAME = GAMES_JSON.themes as Record<string, GameId>;

/** The game a theme plays; a theme no longer known plays the default game (as on the server). */
export function gameOf(theme: string): GameClient {
  return GAMES[THEME_GAME[theme]] ?? GAMES[DEFAULT_GAME];
}

/** Every theme, game by game. */
export const THEME_IDS: ThemeId[] = GAME_LIST.flatMap((g) => g.themes);

export const DEFAULT_THEME: ThemeId = GAMES[DEFAULT_GAME].themes[0];

/** A theme's look for the page around the game. */
export function skinOf(theme: string, cast?: Cast): Skin {
  return gameOf(theme).skin(theme, cast);
}
