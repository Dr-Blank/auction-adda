// What a Pahunch theme names and colours. The rules know rooms, paths, climbers, neutrals, a
// blocker and point tokens by number; a skin turns them into a housing society, a film set…

import type { PahunchBonus, PahunchFavour } from "../../generated/index.ts";
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
  /** The blocker as said mid-sentence, with its article if it takes one ("Daddu", "the Producer"). */
  blocker: string;
  /** A way up between rooms, and one that is locked ("staircase", "back stairs"). */
  path: string;
  backPath: string;
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
  /** Each special coin: its name, a mark drawn on the coin, and what taking it with your own climb does. */
  bonuses: Record<PahunchBonus, { name: string; glyph: string; effect: string }>;
  /** Each favour: its name, a mark for small places, and what it lets the mover do, in one sentence. */
  favours: Record<PahunchFavour, { name: string; glyph: string; effect: string }>;
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
    path: "staircase",
    backPath: "back stairs",
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
  bonuses: {
    block: {
      name: "Chai with Daddu",
      glyph: "☕",
      effect: "After your move this turn, you may also send Daddu to another staircase.",
    },
    nudge: {
      name: "Kitty party invite",
      glyph: "✉",
      effect: "After your move this turn, you may also nudge an aunty up.",
    },
    favour: { name: "Favour returned", glyph: "↺", effect: "One use of your favour comes back at once (two at most)." },
  },
  favours: {
    extraBlock: {
      name: "Daddu’s chess partner",
      glyph: "♞",
      effect: "The mover also sends Daddu to another staircase, before or after their move.",
    },
    coveredToken: {
      name: "Daddu’s favourite",
      glyph: "♥",
      effect: "Walking past Daddu, the mover still takes the izzat he sits on.",
    },
    swapToken: {
      name: "Kitty party host",
      glyph: "⇄",
      effect: "Moving up, the mover takes any other izzat lying on the board instead of the one on their staircase.",
    },
    climbAgain: {
      name: "Fast-track",
      glyph: "⏩",
      effect: "A resident the mover puts into a one-seat post moves up again at once.",
    },
    squeezeIn: {
      name: "Builder’s relative",
      glyph: "+1",
      effect: "The mover fits one extra into a full committee (never the Chairman’s cabin).",
    },
    backStairs: {
      name: "Back-gate key",
      glyph: "🔑",
      effect: "The mover may use a back staircase, with no vote.",
    },
    carry: {
      name: "Car-pool uncle",
      glyph: "🚗",
      effect:
        "Moving up, the mover brings one more resident or aunty from the same room along. It takes no izzat, and its owner has no say.",
    },
  },
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
