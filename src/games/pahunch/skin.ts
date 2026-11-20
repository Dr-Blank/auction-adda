// What a Pahunch theme names and colours. The rules know rooms, paths, climbers, neutrals, a
// blocker and point tokens by number; a skin turns them into a housing society, a film set…

import type { PahunchBonus } from "../../generated/index.ts";
import type { Skin } from "../types.ts";

export interface PahunchNouns {
  climber: string;
  climbers: string;
  /** The point unit: "3 izzat". */
  points: string;
  neutral: string;
  neutrals: string;
  /** What a neutral is paid with, as a phrase ("a box of kaju katli"). */
  bribe: string;
  blocker: string;
  /** The whole board ("the society"). */
  board: string;
}

export interface PahunchSkin extends Skin {
  nouns: PahunchNouns;
  /**
   * Room names by board id, in the board's room order; `short` fits on the board (about ten
   * letters). A board missing here gets numbers.
   */
  rooms: Record<string, { name: string; short: string }[]>;
  /** One colour per seat, and the ink that reads on it. */
  seats: { color: string; ink: string }[];
  /** The letter on a neutral's disc and on the blocker's badge. */
  neutralGlyph: string;
  blockerGlyph: string;
  /** Short lines for the rules: what the game is about, in this skin's words. */
  story: string;
  /** What each special coin is called. */
  bonuses: Record<PahunchBonus, string>;
}

export const societyCommittee: PahunchSkin = {
  id: "society-committee",
  title: "Society Committee",
  tagline: "Climb the housing society’s committees to the Chairman’s cabin. Votes have a price.",
  chrome: {
    "--bg": "#14110c",
    "--felt": "#191510",
    "--panel": "#211b14",
    "--panel-2": "#2b231a",
    "--raised": "#261f17",
    "--line": "#3d3226",
    "--text": "#f4ecdf",
    "--muted": "#b3a690",
    "--glow": "#2c2418",
    "--glow-2": "#3a2f1f",
    "--night": "#0a0806",
    "--field": "#100d09",
    "--shade-rgb": "20 17 12",
    "--accent": "#f0b85a",
    "--accent-rgb": "240 184 90",
    "--accent-soft": "#f7d9a4",
    "--accent-line": "#a87c38",
    "--edge": "#6f5d45",
    "--edge-2": "#6b5c49",
    "--edge-3": "#3f3427",
    "--deep": "#3a2e20",
    "--deep-2": "#241d15",
    "--dim": "#5c4f3d",
    "--dim-2": "#4a3f31",
    "--back-1": "#2f5d50",
    "--back-2": "#1e3d34",
  },
  nouns: {
    climber: "resident",
    climbers: "residents",
    points: "izzat",
    neutral: "aunty",
    neutrals: "aunties",
    bribe: "a box of kaju katli",
    blocker: "Daddu",
    board: "the society",
  },
  rooms: {
    full: [
      { name: "Notice board in-charge", short: "Notice board" },
      { name: "Residents’ WhatsApp group", short: "WhatsApp" },
      { name: "Gate pass desk", short: "Gate pass" },
      { name: "Parking sub-committee", short: "Parking" },
      { name: "Lift in-charge", short: "Lift" },
      { name: "Cultural secretary", short: "Cultural" },
      { name: "Sports in-charge", short: "Sports" },
      { name: "Water tank in-charge", short: "Water tank" },
      { name: "Festival committee", short: "Festival" },
      { name: "Garden committee", short: "Garden" },
      { name: "Security committee", short: "Security" },
      { name: "Treasurer’s desk", short: "Treasurer" },
      { name: "Maintenance committee", short: "Maintenance" },
      { name: "Managing committee", short: "Managing" },
      { name: "Chairman’s cabin", short: "Chairman" },
    ],
  },
  seats: [
    { color: "#e4572e", ink: "#1a0d08" },
    { color: "#4ea5d9", ink: "#06141c" },
    { color: "#8cc152", ink: "#0f1a06" },
    { color: "#c18ae0", ink: "#1a0c22" },
    { color: "#f2c14e", ink: "#1f1604" },
    { color: "#5fd3bc", ink: "#05201b" },
    { color: "#f28fb1", ink: "#2a0b16" },
  ],
  neutralGlyph: "A",
  blockerGlyph: "D",
  bonuses: { block: "Chai with Daddu", nudge: "Kitty party invite", favour: "Favour returned" },
  story:
    "Everyone in the society wants the Chairman’s cabin. Committees only let a resident move up when most of their members agree, so votes are traded for izzat, promises are made on the call, and the aunties can always be persuaded with a box of kaju katli. Daddu, the senior citizen, sits on one staircase: anyone may walk past him without a vote, but he sits on the izzat there, so nobody takes it.",
};

/** Every Pahunch theme, by id; the default first. */
export const SKINS: Record<string, PahunchSkin> = { "society-committee": societyCommittee };

export function skinFor(id: string): PahunchSkin {
  return SKINS[id] ?? societyCommittee;
}

/** A room's name in this skin, full or `short` for the board. */
export function roomName(skin: PahunchSkin, board: string, room: number, top: number, short = false): string {
  const named = skin.rooms[board]?.[room];
  if (named) return short ? named.short : named.name;
  return room === top ? "The top" : `Room ${room + 1}`;
}
