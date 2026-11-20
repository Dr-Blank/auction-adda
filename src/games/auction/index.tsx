import type { GameClient } from "../types.ts";
import { ROUNDS } from "./config.ts";
import { Rules } from "./Rules.tsx";
import { Setup } from "./Setup.tsx";
import { Table } from "./Table.tsx";
import { getTheme, THEME_IDS } from "./themes/index.ts";

/** Auction Adda: cards go up for auction in five ways; four rounds rank the suits; most money wins. */
export const auction: GameClient = {
  id: "auction",
  title: "Auction Adda",
  blurb: "An auction card game for 3–5 friends. Everyone joins from their own device; keep the voice chat going.",
  themes: THEME_IDS,
  skin: (theme, cast) => getTheme(theme, cast),
  Table,
  Setup,
  setupSummary: (room) => `clock, ${getTheme(room.theme, room.cast).nouns.suit}s and names`,
  Rules: ({ room, n }) => <Rules theme={getTheme(room.theme, room.cast)} n={n} />,
  adminNote: "Playing on voice? The admin can end an auction with the result the table agreed (and undo a wrong call).",
  stage: (r, round) => {
    const theme = getTheme(r.theme);
    return `${theme.roundNames[round]} · ${theme.nouns.round} ${round + 1} of ${ROUNDS}`;
  },
};
