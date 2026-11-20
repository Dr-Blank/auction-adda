import { describe, expect, it } from "vitest";
import { GAME_LIST, GAMES, gameOf, THEME_IDS } from "../src/games/index.ts";
import GAMES_JSON from "../src/generated/games.json" with { type: "json" };

// The server says which game each theme plays (`ThemeId::game`); the client's registry must agree.
describe("game registry", () => {
  it("lists every theme under the game the server plays it with", () => {
    const server = GAMES_JSON.themes as Record<string, string>;
    expect(Object.keys(server).sort()).toEqual([...THEME_IDS].sort());
    for (const g of GAME_LIST) {
      for (const theme of g.themes) expect(server[theme], theme).toBe(g.id);
    }
  });

  it("has a client for every game the server hosts", () => {
    expect(Object.keys(GAMES_JSON.players).sort()).toEqual(Object.keys(GAMES).sort());
  });

  it("falls back to the default game for a theme it does not know", () => {
    expect(gameOf("no-such-theme").id).toBe("auction");
  });

  it("gives every theme a title and a tagline", () => {
    for (const id of THEME_IDS) {
      const skin = gameOf(id).skin(id);
      expect(skin.title, id).toBeTruthy();
      expect(skin.tagline, id).toBeTruthy();
    }
  });
});
