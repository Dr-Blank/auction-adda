// What a seat may do now, read from its view the way the rules read the state
// (crates/pahunch/src/rules.rs). The server decides; this only offers the moves it would take.

import type { PahunchCarry, PahunchFavour, PahunchLayout, PahunchView, PahunchVote } from "../../generated/index.ts";

type Rooms = PahunchView["rooms"];

/**
 * The favours on offer to the mover, with their owners: lent, with a use left (a favour is only
 * lent with one, so a hidden count counts as one).
 */
export function onOffer(v: PahunchView): { owner: number; kind: PahunchFavour }[] {
  return v.lent.flatMap((owner) => {
    const p = v.players[owner];
    return p?.favour && (p.uses ?? 1) > 0 ? [{ owner, kind: p.favour }] : [];
  });
}

export const offers = (v: PahunchView, kind: PahunchFavour) => onOffer(v).some((o) => o.kind === kind);

/**
 * Whether `pieces` more fit into `room`: `false` as it is, `true` only with one squeezed in by a
 * lent favour (one extra at most, never at the top), `null` not at all.
 */
export function roomFor(v: PahunchView, room: number, pieces = 1): boolean | null {
  const after = (v.rooms[room]?.length ?? 0) + pieces;
  const cap = v.layout.rooms[room]?.cap ?? 0;
  if (after <= cap) return false;
  if (room !== v.layout.summit && offers(v, "squeezeIn") && after <= cap + 1) return true;
  return null;
}

/** Climbers of `who` in `room` (`null` = neutrals). */
export const count = (rooms: Rooms, room: number, who: number | null) =>
  (rooms[room] ?? []).filter((x) => x === who).length;

/** Yes votes it takes to leave `room`. */
export const need = (layout: PahunchLayout, room: number) => Math.floor((layout.rooms[room]?.cap ?? 0) / 2) + 1;

/** The path holds a token: it leaves a room of more than 1 seat and is not a back path. */
export const slot = (layout: PahunchLayout, path: number) => {
  const p = layout.paths[path];
  return !!p && !p.back && (layout.rooms[p.from]?.cap ?? 0) > 1;
};

/** Paths the blocker may move to: another path with a token. */
export const blockTargets = (v: PahunchView) =>
  v.layout.paths.map((_, p) => p).filter((p) => p !== v.blocker && slot(v.layout, p));

export const isEntry = (layout: PahunchLayout, room: number) =>
  room !== layout.summit && layout.paths.every((p) => p.to !== room);

export const score = (tokens: number[] | null) => (tokens ?? []).reduce((a, b) => a + b, 0);

const bribeTokens = (layout: PahunchLayout, tokens: number[]) => tokens.filter((t) => t >= layout.minBribe).length;

/** Bottom rooms a new climber may go into. */
export function enterRooms(v: PahunchView, me: number): number[] {
  if ((v.players[me]?.hand ?? 0) === 0) return [];
  return v.layout.rooms.flatMap((_, r) => (isEntry(v.layout, r) && roomFor(v, r) !== null ? [r] : []));
}

/** A coin lies on `path` where a climb could take it. */
const coinOn = (v: PahunchView, path: number) => slot(v.layout, path) && v.tokensOn[path] != null;

export interface ClimbOption {
  path: number;
  /**
   * `blocked`: the blocker's path, free (unpaid unless a favour takes the token); `back`: a back path
   * opened by a favour; `own`: enough own climbers; `ask`: a vote.
   */
  kind: "blocked" | "back" | "own" | "ask";
  need: number;
  own: number;
  /** Lent favours the climb uses. */
  uses: PahunchFavour[];
  /** The token it takes, if any (from `swap` when one is asked for). */
  takes: number | null;
}

/** What a climb asks of lent favours beyond the plain move. */
export interface Extras {
  swap?: number;
  carry?: PahunchCarry;
}

/** Climbs `me` may start now, one per path, with the favours `extras` asks for. */
export function climbs(v: PahunchView, me: number, extras: Extras = {}): ClimbOption[] {
  const tokens = v.players[me]?.tokens ?? [];
  const { swap, carry } = extras;
  return v.layout.paths.flatMap((p, path): ClimbOption[] => {
    const uses: PahunchFavour[] = [];
    if (p.back) {
      if (!offers(v, "backStairs")) return [];
      uses.push("backStairs");
    }
    const own = count(v.rooms, p.from, me);
    if (own === 0) return [];
    if (carry) {
      const who = carry.t === "seat" ? carry.seat : null;
      if (!offers(v, "carry") || count(v.rooms, p.from, who) < (who === me ? 2 : 1)) return [];
      uses.push("carry");
    }
    const fit = roomFor(v, p.to, carry ? 2 : 1);
    if (fit === null) return [];
    if (fit) uses.push("squeezeIn");
    const covered = path === v.blocker && coinOn(v, path) && offers(v, "coveredToken");
    const takesOwn = coinOn(v, path) && (path !== v.blocker || covered);
    let takes = takesOwn ? path : null;
    if (swap !== undefined) {
      if (!offers(v, "swapToken") || !takesOwn || swap === path || swap === v.blocker || !coinOn(v, swap)) return [];
      uses.push("swapToken");
      takes = swap;
    } else if (covered) uses.push("coveredToken");
    const n = need(v.layout, p.from);
    const base = { path, need: n, own, uses, takes };
    if (p.back) return [{ ...base, kind: "back" }];
    if (path === v.blocker) return [{ ...base, kind: "blocked" }];
    if (own >= n) return [{ ...base, kind: "own" }];
    if (v.options.oneVotePerRoom && v.tried.includes(p.from)) return [];
    const others = (v.rooms[p.from] ?? []).filter((x) => x !== null && x !== me).length;
    const neutrals = Math.min(count(v.rooms, p.from, null), bribeTokens(v.layout, tokens));
    return own + others + neutrals >= n ? [{ ...base, kind: "ask" }] : [];
  });
}

/** Board tokens a swap could take instead (any uncovered one; the climb's own path is left out per climb). */
export const swapTargets = (v: PahunchView) =>
  v.layout.paths.flatMap((_, p) => (p !== v.blocker && coinOn(v, p) ? [p] : []));

/** Pieces a carry could take along out of the rooms `me` can climb from: other seats, `me` (a second climber), neutrals. */
export function carryTargets(v: PahunchView, me: number): PahunchCarry[] {
  const seats = new Set<number>();
  let neutral = false;
  for (const p of v.layout.paths) {
    const here = v.rooms[p.from] ?? [];
    if (!here.includes(me)) continue;
    for (const x of here) {
      if (x === null) neutral = true;
      else if (x !== me || count(v.rooms, p.from, me) > 1) seats.add(x);
    }
  }
  return [
    ...[...seats].sort((a, b) => a - b).map((seat): PahunchCarry => ({ t: "seat", seat })),
    ...(neutral ? [{ t: "neutral" } as PahunchCarry] : []),
  ];
}

/** Paths a neutral may be nudged up. */
export function nudges(v: PahunchView): number[] {
  return v.layout.paths.flatMap((p, path) =>
    (!p.back || offers(v, "backStairs")) && count(v.rooms, p.from, null) > 0 && roomFor(v, p.to) !== null ? [path] : [],
  );
}

/** After the main move: the extra moves the mover has (bonus coins and lent favours). */
export function extraMoves(v: PahunchView, me: number) {
  const again = v.bonuses.climbAgain;
  return {
    block: v.bonuses.block > 0 || offers(v, "extraBlock"),
    nudge: v.bonuses.nudge > 0,
    again:
      again !== undefined && offers(v, "climbAgain")
        ? climbs(v, me).filter((c) => c.kind !== "ask" && v.layout.paths[c.path].from === again)
        : [],
  };
}

/**
 * Why the mover `me` cannot ask `owner` for their favour now, or `null` when they can (the rules'
 * `request`). Already asked counts as "can't" with its own reason.
 */
export function askBlock(v: PahunchView, me: number | null, owner: number): string | null {
  const p = v.players[owner];
  if (!v.options.favours || !p?.favour) return "no favour";
  if (me === null || v.over || v.turn !== me) return "not your turn";
  if (owner === me) return "never on your own move";
  if (v.vote !== null) return "wait for the vote";
  if (v.asked.includes(owner)) return "asked";
  if (v.lent.includes(owner)) return "on offer";
  if (v.used.includes(owner)) return "used this turn";
  if (p.uses === 0) return "used up";
  if (onceOffered(v, owner)) return "strict game: offered once this turn";
  return null;
}

/** Under the strict switch, `owner`'s favour was on offer once this turn and that offer ended unused. */
export const onceOffered = (v: PahunchView, owner: number) => v.options.oneVotePerRoom && v.withdrawn.includes(owner);

/** Seats that still owe an answer to the vote. */
export function votersLeft(v: PahunchView, vote: PahunchVote): number[] {
  return vote.answers.flatMap((a, s) => (s !== v.turn && a === null && count(v.rooms, vote.room, s) > 0 ? [s] : []));
}

/** Yes so far. */
export const yesSoFar = (vote: PahunchVote) => vote.answers.reduce<number>((a, b) => a + (b ?? 0), vote.bribed);

/** Tokens the mover can pay a neutral with, smallest first; empty when no neutral is left to pay. */
export function bribeChoices(v: PahunchView, vote: PahunchVote, tokens: number[]): number[] {
  if (count(v.rooms, vote.room, null) <= vote.bribed) return [];
  return [...new Set(tokens.filter((t) => t >= v.layout.minBribe))].sort((a, b) => a - b);
}

/** Seats with a climber in the top room, in order of arrival. */
export const atTop = (v: PahunchView) => (v.rooms[v.layout.summit] ?? []).filter((x): x is number => x !== null);
