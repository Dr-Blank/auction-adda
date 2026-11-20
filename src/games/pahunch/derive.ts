// What a seat may do now, read from its view the way the rules read the state
// (crates/pahunch/src/rules.rs). The server decides; this only offers the moves it would take.

import type { PahunchLayout, PahunchView, PahunchVote } from "../../generated/index.ts";

type Rooms = PahunchView["rooms"];

/** Climbers of `who` in `room` (`null` = neutrals). */
export const count = (rooms: Rooms, room: number, who: number | null) =>
  (rooms[room] ?? []).filter((x) => x === who).length;

export const space = (v: PahunchView, room: number) => (v.rooms[room]?.length ?? 0) < (v.layout.rooms[room]?.cap ?? 0);

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
  return v.layout.rooms.flatMap((_, r) => (isEntry(v.layout, r) && space(v, r) ? [r] : []));
}

export interface ClimbOption {
  path: number;
  /** `blocked`: the blocker's path, free and unpaid; `own`: enough own climbers; `ask`: a vote. */
  kind: "blocked" | "own" | "ask";
  need: number;
  own: number;
}

/** Climbs `me` may start now, one per path. */
export function climbs(v: PahunchView, me: number): ClimbOption[] {
  const tokens = v.players[me]?.tokens ?? [];
  return v.layout.paths.flatMap((p, path): ClimbOption[] => {
    const own = count(v.rooms, p.from, me);
    if (p.back || own === 0 || !space(v, p.to)) return [];
    const n = need(v.layout, p.from);
    if (path === v.blocker) return [{ path, kind: "blocked", need: n, own }];
    if (own >= n) return [{ path, kind: "own", need: n, own }];
    if (v.tried.includes(p.from)) return [];
    const others = (v.rooms[p.from] ?? []).filter((x) => x !== null && x !== me).length;
    const neutrals = Math.min(count(v.rooms, p.from, null), bribeTokens(v.layout, tokens));
    return own + others + neutrals >= n ? [{ path, kind: "ask", need: n, own }] : [];
  });
}

/** Paths a neutral may be nudged up. */
export function nudges(v: PahunchView): number[] {
  return v.layout.paths.flatMap((p, path) =>
    !p.back && count(v.rooms, p.from, null) > 0 && space(v, p.to) ? [path] : [],
  );
}

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
