// Where the board draws things: each room's box, and a smooth route for each path that goes
// around every other room instead of across it.
//
// A path leaves its room from the top edge and arrives at the next room's bottom edge, both
// straight up, like a wire into a socket. Between the two it is one cubic Bézier curve. Its two
// middle control points are chosen from a small grid of sideways shifts and heights, scoring each
// candidate: crossing a room box costs most, then a coin that lands near another coin, then
// crossing or running close beside another path, then extra length. A few rounds, each path
// taking the best route given all the others, settle it. The result depends only on the board's
// data, so it is worked out once per board.

import type { PahunchLayout } from "../../generated/index.ts";
import { slot } from "./derive.ts";

export const SEAT = 5.4;
const MIN_W = 15;

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  cols: number;
}

/** Where a room is drawn: centred on its board point, seats in one row up to 3, else two. */
export function boxOf(layout: PahunchLayout, room: number): Box {
  const r = layout.rooms[room];
  const cap = Math.max(1, r.cap);
  const cols = cap <= 3 ? cap : Math.ceil(cap / 2);
  const rows = Math.ceil(cap / cols);
  const w = Math.max(MIN_W, cols * SEAT + 3);
  const h = rows * SEAT + 6.2;
  return { x: r.x, y: r.y, w, h, cols };
}

export interface Route {
  /** The cubic's four points: start (top edge of `from`), two controls, end (bottom edge of `to`). */
  p: [Pt, Pt, Pt, Pt];
  /** SVG path data. */
  d: string;
  /** Where the path's coin, lock or blocker sits. */
  mid: Pt;
  /** The arrow: a point just short of the end, and the unit direction of travel there. */
  head: Pt;
  dir: Pt;
}

const bez = (p: Route["p"], t: number): Pt => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x, y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y };
};

const bezDir = (p: Route["p"], t: number): Pt => {
  const u = 1 - t;
  const x = 3 * u * u * (p[1].x - p[0].x) + 6 * u * t * (p[2].x - p[1].x) + 3 * t * t * (p[3].x - p[2].x);
  const y = 3 * u * u * (p[1].y - p[0].y) + 6 * u * t * (p[2].y - p[1].y) + 3 * t * t * (p[3].y - p[2].y);
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
};

const N = 24;
const sample = (p: Route["p"]) => Array.from({ length: N + 1 }, (_, k) => bez(p, k / N));

const inside = (q: Pt, b: Box, pad: number) =>
  Math.abs(q.x - b.x) < b.w / 2 + pad && Math.abs(q.y - b.y) < b.h / 2 + pad;

const cross = (a: Pt, b: Pt, c: Pt, d: Pt) => {
  const s = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return s(a, b, c) * s(a, b, d) < 0 && s(c, d, a) * s(c, d, b) < 0;
};

/**
 * Which way a path leaves its room: `0` up from the top edge, or `1` / `-1` out of the right / left
 * edge when the room it goes to lies wholly off to that side (straight up would bend it into an S).
 */
export function exitSide(layout: PahunchLayout, path: number): -1 | 0 | 1 {
  const { from, to } = layout.paths[path];
  const a = boxOf(layout, from);
  const b = boxOf(layout, to);
  if (b.x - b.w / 2 > a.x + a.w / 2) return 1;
  if (b.x + b.w / 2 < a.x - a.w / 2) return -1;
  return 0;
}

/** Where each path plugs into its rooms: spread along the edge, in the order of the far end. */
function ports(layout: PahunchLayout, boxes: Box[]) {
  const out: Pt[] = [];
  const inn: Pt[] = [];
  const spread = (room: number, ids: number[], far: (p: number) => number, top: boolean) => {
    const b = boxes[room];
    const inset = Math.min(3, b.w / 6);
    const span = b.w - 2 * inset;
    const sorted = [...ids].sort((a, c) => layout.rooms[far(a)].x - layout.rooms[far(c)].x || a - c);
    sorted.forEach((p, k) => {
      const at = { x: b.x - span / 2 + (span * (k + 0.5)) / sorted.length, y: top ? b.y - b.h / 2 : b.y + b.h / 2 };
      (top ? out : inn)[p] = at;
    });
  };
  // Side exits share the upper half of their edge, the highest target highest.
  const side = (room: number, ids: number[], dir: -1 | 1) => {
    const b = boxes[room];
    const lo = b.y - b.h / 2 + 3;
    const sorted = [...ids].sort((a, c) => layout.rooms[layout.paths[a].to].y - layout.rooms[layout.paths[c].to].y);
    sorted.forEach((p, k) => {
      out[p] = { x: b.x + (dir * b.w) / 2, y: lo + ((b.y - lo) * (k + 0.5)) / sorted.length };
    });
  };
  const ids = layout.paths.map((_, i) => i);
  const sides = ids.map((p) => exitSide(layout, p));
  layout.rooms.forEach((_, room) => {
    const leaving = ids.filter((p) => layout.paths[p].from === room);
    spread(
      room,
      leaving.filter((p) => sides[p] === 0),
      (p) => layout.paths[p].to,
      true,
    );
    side(
      room,
      leaving.filter((p) => sides[p] === 1),
      1,
    );
    side(
      room,
      leaving.filter((p) => sides[p] === -1),
      -1,
    );
    spread(
      room,
      ids.filter((p) => layout.paths[p].to === room),
      (p) => layout.paths[p].from,
      false,
    );
  });
  return { out, inn, sides };
}

const SHIFTS = [-18, -12, -7, -3, 0, 3, 7, 12, 18];
const BENDS = [0.3, 0.5, 0.75];
const PAD = 1.4;
const COIN = 7;

function build(layout: PahunchLayout): Route[] {
  const boxes = layout.rooms.map((_, i) => boxOf(layout, i));
  const { out, inn, sides } = ports(layout, boxes);
  const marks = layout.paths.map((_, i) => layout.paths[i].back || slot(layout, i));
  const cands = layout.paths.map((path, i) => {
    const s = out[i];
    const e = inn[i];
    const dy = Math.max(4, s.y - e.y);
    const dx = Math.max(4, Math.abs(e.x - s.x));
    const dir = sides[i];
    const list: Route["p"][] = [];
    for (const k of BENDS)
      for (const a of SHIFTS)
        for (const b of SHIFTS)
          list.push([
            s,
            // Up from the top edge, or straight out of the side towards the room it goes to.
            dir === 0 ? { x: s.x + a, y: s.y - k * dy } : { x: s.x + dir * k * dx, y: s.y + a * 0.3 },
            { x: e.x + b, y: e.y + k * dy },
            e,
          ]);
    return { path, list };
  });
  // Every candidate's samples and fixed costs (rooms, length) once.
  const pre = cands.map(({ path, list }, i) =>
    list.map((p) => {
      const pts = sample(p);
      let cost = 0;
      boxes.forEach((b, room) => {
        const own = room === path.from || room === path.to;
        for (let k = 1; k < N; k++) if (inside(pts[k], b, own ? -0.2 : PAD)) cost += own ? 400 : 1000;
      });
      let len = 0;
      for (let k = 1; k <= N; k++) len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
      const mid = pts[N / 2];
      return {
        p,
        pts,
        mid,
        lo: { x: Math.min(...pts.map((q) => q.x)), y: Math.min(...pts.map((q) => q.y)) },
        hi: { x: Math.max(...pts.map((q) => q.x)), y: Math.max(...pts.map((q) => q.y)) },
        base:
          cost +
          len * 0.6 +
          (sides[i] === 0 ? Math.abs(p[1].x - p[0].x) : Math.abs(p[1].y - p[0].y) / 0.3) * 0.15 +
          Math.abs(p[2].x - p[3].x) * 0.15,
      };
    }),
  );
  type C = (typeof pre)[number][number];
  const between = (c: C, o: C, i: number, j: number) => {
    let cost = 0;
    if (marks[i] && marks[j] && Math.hypot(c.mid.x - o.mid.x, c.mid.y - o.mid.y) < COIN) cost += 300;
    if (c.hi.x < o.lo.x - 1.5 || o.hi.x < c.lo.x - 1.5 || c.hi.y < o.lo.y - 1.5 || o.hi.y < c.lo.y - 1.5) return cost;
    for (let a = 1; a <= N; a++)
      for (let b = 1; b <= N; b++) {
        if (cross(c.pts[a - 1], c.pts[a], o.pts[b - 1], o.pts[b])) cost += 25;
        else if (a > 2 && a < N - 2 && b > 2 && b < N - 2) {
          const d = Math.hypot(c.pts[a].x - o.pts[b].x, c.pts[a].y - o.pts[b].y);
          if (d < 1.6) cost += 3;
        }
      }
    // A coin sitting on another path.
    if (marks[i]) for (const q of o.pts) if (Math.hypot(q.x - c.mid.x, q.y - c.mid.y) < 2.6) cost += 40;
    return cost;
  };
  const centre = SHIFTS.length * ((SHIFTS.length - 1) / 2) + (SHIFTS.length - 1) / 2;
  const pick = pre.map((list) => list[SHIFTS.length * SHIFTS.length + centre]);
  for (let round = 0; round < 3; round++) {
    let changed = false;
    pre.forEach((list, i) => {
      let best = pick[i];
      let bestCost = Number.POSITIVE_INFINITY;
      for (const c of list) {
        let cost = c.base;
        if (cost >= bestCost) continue;
        for (let j = 0; j < pick.length && cost < bestCost; j++) if (j !== i) cost += between(c, pick[j], i, j);
        if (cost < bestCost) {
          bestCost = cost;
          best = c;
        }
      }
      if (best !== pick[i]) changed = true;
      pick[i] = best;
    });
    if (!changed) break;
  }
  return pick.map(({ p, mid }) => {
    const f = (n: number) => Math.round(n * 100) / 100;
    // The arrow sits a little short of the end, so the room's edge never covers it.
    let t = 1;
    let back = 0;
    let prev = p[3];
    while (t > 0.5 && back < 3.2) {
      t -= 0.01;
      const q = bez(p, t);
      back += Math.hypot(q.x - prev.x, q.y - prev.y);
      prev = q;
    }
    const head = bez(p, t);
    return {
      p,
      d: `M${f(p[0].x)} ${f(p[0].y)}C${f(p[1].x)} ${f(p[1].y)} ${f(p[2].x)} ${f(p[2].y)} ${f(p[3].x)} ${f(p[3].y)}`,
      mid: { x: f(mid.x), y: f(mid.y) },
      head: { x: f(head.x), y: f(head.y) },
      dir: bezDir(p, t),
    };
  });
}

const cache = new Map<string, Route[]>();

/** Each path's route on this board, worked out once per board. */
export function routes(layout: PahunchLayout): Route[] {
  const key = JSON.stringify([layout.rooms, layout.paths]);
  let r = cache.get(key);
  if (!r) {
    r = build(layout);
    cache.set(key, r);
  }
  return r;
}

/** How many sampled points of each route fall inside a room it does not join (0 = clear). */
export function overlaps(layout: PahunchLayout): number[] {
  const boxes = layout.rooms.map((_, i) => boxOf(layout, i));
  return routes(layout).map((r, i) => {
    const path = layout.paths[i];
    const pts = sample(r.p);
    let n = 0;
    boxes.forEach((b, room) => {
      if (room === path.from || room === path.to) return;
      for (const q of pts) if (inside(q, b, 0)) n++;
    });
    return n;
  });
}
