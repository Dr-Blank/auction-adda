import type { ComponentType } from "react";
import type { Reaction, RoomState } from "../client/net.ts";
import type { Cast, ClientMsg, GameId, MyRoom, RoomInfo, ThemeId } from "../generated/index.ts";

/** What the room around a game needs from a theme: its name and the page colours. */
export interface Skin {
  id: string;
  title: string;
  tagline: string;
  /** CSS variables for the whole page (`--bg`, `--panel`, `--glow`…). */
  chrome: Record<`--${string}`, string>;
}

export interface TableProps {
  /** The room's state with a game in it (`state.game` is this game's view). */
  state: RoomState;
  send: (m: ClientMsg) => void;
  reactions: Reaction[];
}

export interface RoomProps {
  room: RoomInfo;
  /** The viewer's seat; `null` = watching. */
  me: number | null;
  send: (m: ClientMsg) => void;
}

/**
 * One game as the browser shows it. The room around it (home, lobby, seats, reactions, admin,
 * freeze, the room menu's shared parts) is the same for every game; the game brings its table,
 * its rules, its lobby setup and its themes. Register it in `src/games/index.ts`.
 */
export interface GameClient {
  id: GameId;
  /** The game's name, on Home when there is more than one game. */
  title: string;
  /** One line on Home: what the game is and for how many. */
  blurb: string;
  /** This game's themes, the default first. `src/generated/games.json` says the same (a test checks). */
  themes: ThemeId[];
  /** A theme's look for the page; `cast` as the room holds it. Unknown ids get the default theme. */
  skin(theme: string, cast?: Cast): Skin;
  /** The page while a game is played (and once it is over). */
  Table: ComponentType<TableProps>;
  /** In the lobby, under "Advanced" (and wherever the game wants it): what the admin sets up. */
  Setup: ComponentType<RoomProps>;
  /** A few words on what `Setup` holds, for the "Advanced" summary. */
  setupSummary(room: RoomInfo): string;
  /** The rules, at the foot of the lobby. */
  Rules: ComponentType<{ room: RoomInfo; n?: number }>;
  /** What the admin can do in this game beyond starting it, for the lobby note. */
  adminNote: string;
  /** Where a running game stands, for the room list on Home ("Summer · season 2 of 4"). */
  stage(room: MyRoom, round: number): string;
  /**
   * The room clock (seconds, top-up seconds) a new room starts with when this browser never set
   * one for the game; left out: the server's default.
   */
  clockDefault?: [number, number];
}
