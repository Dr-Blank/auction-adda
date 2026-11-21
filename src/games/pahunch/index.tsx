import type { ThemeId } from "../../generated/index.ts";
import type { GameClient } from "../types.ts";
import { Rules } from "./Rules.tsx";
import { BOARDS, Setup } from "./Setup.tsx";
import { SKINS, skinFor } from "./skin.ts";
import { Table } from "./Table.tsx";

/** Pahunch: climb a board of committees by votes; points stay hidden; the full top room ends it. */
export const pahunch: GameClient = {
  id: "pahunch",
  title: "Pahunch",
  blurb: "A board game of votes and favours for 3–7 friends: climb to the top room, one deal at a time.",
  themes: Object.keys(SKINS) as ThemeId[],
  skin: (theme) => skinFor(theme),
  Table,
  Setup,
  setupSummary: () => (BOARDS.length > 1 ? "board and vote clock" : "vote clock"),
  Rules: ({ room, n }) => <Rules skin={skinFor(room.theme)} n={n} />,
  adminNote: "The admin can skip an away player's move (a random move is made for them) and set a clock for votes.",
  stage: () => "Climbing",
  clockDefault: [0, 10],
};
