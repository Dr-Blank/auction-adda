// Random legal Pahunch moves from one seat's view, for socket bots and the state capture. Same
// choices as the server's bot (crates/pahunch/src/bot.rs): no thinking, no gifts, no lending
// unasked; asked for its favour, yes or no at random.

import {
  blockTargets,
  bribeChoices,
  climbs,
  count,
  enterRooms,
  extraMoves,
  nudges,
  votersLeft,
} from "../src/games/pahunch/derive.ts";
import type { PahunchAction, PahunchView } from "../src/generated/index.ts";

export function choosePahunch(v: PahunchView, random: () => number): PahunchAction | null {
  const me = v.you;
  if (me === null || v.over || !v.pending.includes(me)) return null;
  const pick = <T>(xs: T[]): T | undefined => xs[Math.floor(random() * xs.length)];
  const tokens = v.players[me]?.tokens ?? [];
  if (v.asked.includes(me)) return random() < 0.5 ? { type: "lend", on: true } : { type: "decline" };

  if (v.vote) {
    if (votersLeft(v, v.vote).includes(me)) {
      const of = count(v.rooms, v.vote.room, me);
      const r = random();
      const yes = r < 0.5 ? of : r < 0.7 ? Math.floor(random() * (of + 1)) : 0;
      return { type: "vote", yes };
    }
    const bribes = bribeChoices(v, v.vote, tokens);
    return bribes.length > 0 && random() < 0.7 ? { type: "bribe", token: bribes[0] } : { type: "withdraw" };
  }

  // Extra moves: mostly end the turn, now and then use one.
  if (v.moved) {
    const extra = extraMoves(v, me);
    const r = random() * 10;
    if (r < 3 && extra.nudge) {
      const p = pick(nudges(v));
      if (p !== undefined) return { type: "nudge", path: p };
    } else if (r >= 3 && r < 5 && extra.block) {
      const p = pick(blockTargets(v));
      if (p !== undefined) return { type: "block", path: p };
    } else if (r >= 5 && r < 8) {
      const c = pick(extra.again);
      if (c) return { type: "climb", path: c.path };
    }
    return { type: "done" };
  }

  const ups = climbs(v, me);
  const free = ups.filter((c) => c.kind !== "ask");
  const enters = enterRooms(v, me);
  const nudge = nudges(v);
  const roll = random() * 100;
  const climb = (c: { path: number } | undefined): PahunchAction | null => (c ? { type: "climb", path: c.path } : null);
  const enter = (r: number | undefined): PahunchAction | null => (r === undefined ? null : { type: "enter", room: r });
  const push = (p: number | undefined): PahunchAction | null => (p === undefined ? null : { type: "nudge", path: p });
  const first =
    roll < 30 ? climb(pick(free)) : roll < 60 ? climb(pick(ups)) : roll < 90 ? enter(pick(enters)) : push(pick(nudge));
  const block = pick(blockTargets(v));
  return (
    first ??
    climb(pick(ups)) ??
    enter(pick(enters)) ??
    push(pick(nudge)) ??
    (block === undefined ? null : { type: "block", path: block })
  );
}
