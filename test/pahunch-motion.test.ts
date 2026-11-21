// What the board animates between two views (src/games/pahunch/motion.ts): worked out from the
// log lines between them, the way the rules move pieces, and nothing when that cannot be told.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { effects } from "../src/games/pahunch/motion.ts";
import type { PahunchLog, PahunchView } from "../src/generated/index.ts";

const base = (
  JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/pahunch/your-move.json"), "utf8")) as {
    game: PahunchView;
  }
).game;

/** Seat 0 and seat 1 and a neutral in room 3 (3 seats); a 3 on path 11 (room 3 → room 9). */
function startView(): PahunchView {
  const v = structuredClone(base);
  v.rooms = v.rooms.map(() => []);
  v.rooms[3] = [0, 1, null];
  v.tokensOn[11] = { value: 3 };
  v.vote = null;
  return v;
}

function nextView(prev: PahunchView, lines: PahunchLog[], change: (v: PahunchView) => void): PahunchView {
  const v = structuredClone(prev);
  v.log = [...v.log, ...lines];
  change(v);
  return v;
}

describe("pahunch motion", () => {
  it("slides a climber up its path, closes up its old room and flies its token", () => {
    const prev = startView();
    const next = nextView(prev, [{ t: "climb", p: 0, path: 11, token: true, free: true }], (v) => {
      v.rooms[3] = [1, null];
      v.rooms[9] = [0];
      v.tokensOn[11] = { value: 4 };
    });
    expect(effects(prev, next)).toEqual([
      { t: "piece", room: 3, k: 0, from: { room: 3, k: 1 } },
      { t: "piece", room: 3, k: 1, from: { room: 3, k: 2 } },
      { t: "piece", room: 9, k: 0, from: { room: 3, k: 0 }, path: 11 },
      { t: "coin", path: 11, value: 3, to: 0, via: 11 },
      { t: "refill", path: 11 },
    ]);
  });

  it("drops a new climber in, hops the blocker, and flies gifts and pay", () => {
    const prev = startView();
    const to = prev.blocker === 4 ? 6 : 4;
    const next = nextView(
      prev,
      [
        { t: "enter", p: 2, room: 3 },
        { t: "gift", from: 1, to: 2, count: 2 },
        { t: "reward", p: 1, ones: 1 },
      ],
      (v) => {
        v.rooms[3] = [0, 1, null, 2];
        v.blocker = to;
      },
    );
    expect(effects(prev, next)).toEqual([
      { t: "piece", room: 3, k: 3, from: null },
      { t: "blocker", from: prev.blocker, to },
      { t: "gift", from: 1, to: 2, count: 2 },
      { t: "reward", p: 1, ones: 1 },
    ]);
  });

  it("shakes the room of a failed vote", () => {
    const prev = startView();
    prev.vote = { room: 3, path: 11, need: 2, answers: [1, null, null, null], bribed: 0, start: 0 };
    const next = nextView(
      prev,
      [
        { t: "vote", p: 1, yes: 0, of: 1 },
        { t: "fail", p: 0 },
      ],
      (v) => {
        v.vote = null;
      },
    );
    expect(effects(prev, next)).toEqual([{ t: "fail", room: 3 }]);
  });

  it("plays nothing for an undo, a reload, or rooms the log cannot explain", () => {
    const prev = startView();
    const undo = nextView(prev, [{ t: "undo", p: 0 }], (v) => {
      v.rooms[3] = [];
    });
    expect(effects(prev, undo)).toEqual([]);
    expect(effects(prev, structuredClone(prev))).toEqual([]);
    const odd = nextView(prev, [{ t: "done", p: 0 }], (v) => {
      v.rooms[3] = [1, 0, null];
    });
    expect(effects(prev, odd)).toEqual([]);
  });
});
