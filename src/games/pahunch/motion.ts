// Motion: no jump cuts. When a new view arrives, what changed is worked out from the log lines
// since the last one (`effects`, pure), and then played on the page (`play`): a climber slides up
// its path into its new seat, the others in its old room close up, a token taken waits on its path
// until the climber reaches it and is then picked up (a ring, a spinning hop, a flight into the
// player's tokens), a fresh token drops into the empty slot, the blocker hops to his new path, a
// failed vote shakes its room, and tokens fly between players for gifts, swaps and pay.
//
// The board is always drawn where things are now; an effect only animates an element from where
// it was (a FLIP), so a missed effect costs nothing but the motion. Under reduced motion, nothing
// moves. A reload, an undo or a gap in the log plays nothing.

import { type RefObject, useLayoutEffect, useRef } from "react";
import { reducedMotion } from "../../client/hooks.ts";
import { play as sound } from "../../client/sound.ts";
import type { PahunchLayout, PahunchLog, PahunchView } from "../../generated/index.ts";
import { bez, boxOf, type Pt, type Route, routes, seatAt } from "./route.ts";

/** A place on the board: a room and a seat in it. */
export interface Place {
  room: number;
  k: number;
}

export type Fx =
  /** A piece now in `room`, seat `k`, that was at `from` (`null`: new from the hand), by `path` if it climbed. */
  | { t: "piece"; room: number; k: number; from: Place | null; path?: number }
  | { t: "blocker"; from: number; to: number }
  /** The coin on `path` went to seat `to`, picked up as its climber passed it on `via`. */
  | { t: "coin"; path: number; value: number; to: number; via: number }
  /** A new coin lies on `path`. */
  | { t: "refill"; path: number }
  /** `count` tokens went from one seat to another (values hidden). */
  | { t: "gift"; from: number; to: number; count: number }
  /** Seat `p` earned `ones` from the supply. */
  | { t: "reward"; p: number; ones: number }
  /** The mover paid a neutral in `room`. */
  | { t: "bribe"; p: number; room: number }
  /** A vote in `room` failed. */
  | { t: "fail"; room: number };

/** The log lines since `prev`, or `null` when the log did not simply grow (a reload, an undo, a gap). */
export function freshLines(prev: PahunchView, next: PahunchView): PahunchLog[] | null {
  const prevEnd = prev.logStart + prev.log.length;
  const nextEnd = next.logStart + next.log.length;
  if (nextEnd <= prevEnd || prevEnd < next.logStart) return null;
  const fresh = next.log.slice(prevEnd - next.logStart);
  return fresh.some((e) => e.t === "undo" || e.t === "start") ? null : fresh;
}

/** What changed from `prev` to `next`, as effects to play; empty when it cannot be told. */
export function effects(prev: PahunchView, next: PahunchView): Fx[] {
  if (prev.layout.board !== next.layout.board || prev.n !== next.n) return [];
  const fresh = freshLines(prev, next);
  if (!fresh) return [];
  const out: Fx[] = [];

  // Replay the moves on the old rooms, the way the rules make them: a piece leaves its room at
  // its first place there and joins the end of the room above. The result must be the new rooms.
  type Piece = { who: number | null; from: Place | null; path?: number };
  const rooms: Piece[][] = prev.rooms.map((r, room) => r.map((who, k) => ({ who, from: { room, k } })));
  let ok = true;
  const up = (path: number, who: number | null) => {
    const p = next.layout.paths[path];
    const here = p ? rooms[p.from] : undefined;
    const at = here ? here.findIndex((x) => x.who === who) : -1;
    if (!p || !here || at < 0) {
      ok = false;
      return;
    }
    const [piece] = here.splice(at, 1);
    rooms[p.to]?.push({ ...piece, path });
  };
  for (const e of fresh) {
    if (e.t === "enter") rooms[e.room]?.push({ who: e.p, from: null });
    else if (e.t === "climb") up(e.path, e.p);
    else if (e.t === "carry") up(e.path, e.who);
    else if (e.t === "nudge") up(e.path, null);
  }
  const same =
    ok &&
    rooms.length === next.rooms.length &&
    rooms.every((r, i) => r.length === next.rooms[i].length && r.every((x, k) => x.who === next.rooms[i][k]));
  if (same)
    rooms.forEach((r, room) => {
      r.forEach((x, k) => {
        if (x.from && x.from.room === room && x.from.k === k) return;
        out.push({ t: "piece", room, k, from: x.from, ...(x.path !== undefined && { path: x.path }) });
      });
    });

  if (prev.blocker !== null && next.blocker !== null && prev.blocker !== next.blocker)
    out.push({ t: "blocker", from: prev.blocker, to: next.blocker });

  // A coin that changed went to a climber that took a token, in order; the slot has a new one.
  const takers = fresh.flatMap((e) => (e.t === "climb" && e.token ? [{ p: e.p, path: e.path }] : []));
  next.tokensOn.forEach((now, path) => {
    const was = prev.tokensOn[path];
    if (!was || (now && now.value === was.value && now.bonus === was.bonus)) return;
    const by = takers.shift();
    if (by === undefined) return;
    out.push({ t: "coin", path, value: was.value, to: by.p, via: by.path });
    if (now) out.push({ t: "refill", path });
  });

  for (const e of fresh) {
    if (e.t === "gift") out.push({ t: "gift", from: e.from, to: e.to, count: e.count });
    else if (e.t === "trade") {
      out.push({ t: "gift", from: e.from, to: e.to, count: e.gave });
      out.push({ t: "gift", from: e.to, to: e.from, count: e.got });
    } else if (e.t === "reward") out.push({ t: "reward", p: e.p, ones: e.ones });
    else if (e.t === "bribe" && prev.vote) out.push({ t: "bribe", p: e.p, room: prev.vote.room });
    else if (e.t === "fail" && prev.vote) out.push({ t: "fail", room: prev.vote.room });
  }
  return out;
}

// ---- playing them ----

const CLIMB_MS = 850;
const SHIFT_MS = 380;

const animates = (el: Element | null): el is Element & { animate: Element["animate"] } =>
  !!el && typeof (el as { animate?: unknown }).animate === "function";

const shift = (p: Pt, end: Pt) => ({
  transform: `translate(${(p.x - end.x).toFixed(2)}px, ${(p.y - end.y).toFixed(2)}px)`,
});

/** A seat's face on the page (another player's chip, or your tray), to fly tokens to and from. */
function seatEl(seat: number): Element | null {
  return document.querySelector(`.ph-table [data-seat="${seat}"] .avatar-wrap`);
}

function centre(el: Element): Pt {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** A board point on the page. */
function onPage(svg: SVGSVGElement, p: Pt): Pt | null {
  const m = svg.getScreenCTM?.();
  if (!m) return null;
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** A token chip that flies across the page from `a` to `b`, then is gone. */
function fly(a: Pt, b: Pt, cls: string, text: string, delay: number) {
  const el = document.createElement("span");
  el.className = `ph-fly ${cls}`;
  el.textContent = text;
  el.setAttribute("aria-hidden", "true");
  el.style.left = `${a.x}px`;
  el.style.top = `${a.y}px`;
  document.body.append(el);
  if (typeof el.animate !== "function") {
    el.remove();
    return;
  }
  const go = el.animate(
    [
      { transform: "translate(-50%, -50%) scale(0.6)", opacity: 0 },
      { transform: "translate(-50%, -50%) scale(1.15)", opacity: 1, offset: 0.15 },
      { transform: `translate(calc(-50% + ${b.x - a.x}px), calc(-50% + ${b.y - a.y}px)) scale(0.8)`, opacity: 1 },
    ],
    { duration: 650, delay, easing: "cubic-bezier(.5,0,.3,1)", fill: "both" },
  );
  go.onfinish = () => el.remove();
  go.oncancel = () => el.remove();
}

/** How far along a climb (0–1 of its run) the climber passes the coin on its path. */
function passAt(p: Route["p"], coin: Pt): number {
  let best = 0.5;
  let near = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= 50; i++) {
    const q = bez(p, i / 50);
    const d = Math.hypot(q.x - coin.x, q.y - coin.y);
    if (d < near) [near, best] = [d, i / 50];
  }
  // The climb's keyframes: its seat, 13 points along the wire, its new seat.
  return (1 + best * 12) / 14;
}

/**
 * A token picked up on the way: it lies where it was until the climber reaches it (`when` ms),
 * then hops up spinning with a ring, and flies into the player's tokens, which give a small bump.
 */
function pickUp(a: Pt, size: number, target: Element, bump: Element, value: number, when: number) {
  const el = document.createElement("span");
  el.className = `ph-fly ph-chip v${Math.min(value, 5)} ph-picked`;
  el.textContent = `${value}`;
  el.setAttribute("aria-hidden", "true");
  // For the screenshot script, which holds the frame just after the pickup.
  el.dataset.when = `${when}`;
  Object.assign(el.style, {
    left: `${a.x}px`,
    top: `${a.y}px`,
    minWidth: `${size}px`,
    height: `${size}px`,
    fontSize: `${Math.max(10, size * 0.5)}px`,
  });
  document.body.append(el);
  if (typeof el.animate !== "function") {
    el.remove();
    return;
  }
  const b = centre(target);
  const hop = 360;
  const flight = 560;
  const total = when + hop + flight;
  const at = (dx: number, dy: number, turn: number, scale: number) =>
    `translate(-50%, -50%) translate(${dx}px, ${dy}px) perspective(200px) rotateY(${turn}deg) scale(${scale})`;
  const go = el.animate(
    [
      { transform: at(0, 0, 0, 1), offset: 0 },
      { transform: at(0, 0, 0, 1), offset: when / total, easing: "cubic-bezier(.2,.9,.3,1)" },
      { transform: at(0, -size * 1.1, 720, 1.4), offset: (when + hop) / total, easing: "cubic-bezier(.5,0,.3,1)" },
      { transform: at(b.x - a.x, b.y - a.y, 720, Math.max(0.6, 30 / size)) },
    ],
    { duration: total, fill: "both" },
  );
  go.onfinish = () => {
    el.remove();
    if (typeof bump.animate === "function")
      bump.animate([{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }], {
        duration: 260,
        easing: "ease-out",
      });
  };
  go.oncancel = () => el.remove();
  setTimeout(() => sound("coin"), when);
}

/** A "+n" that rises from a seat's face and fades. */
function rise(at: Pt, text: string, delay: number) {
  const el = document.createElement("span");
  el.className = "ph-fly ph-rise";
  el.textContent = text;
  el.setAttribute("aria-hidden", "true");
  el.style.left = `${at.x}px`;
  el.style.top = `${at.y}px`;
  document.body.append(el);
  if (typeof el.animate !== "function") {
    el.remove();
    return;
  }
  const go = el.animate(
    [
      { transform: "translate(-50%, -50%)", opacity: 0 },
      { transform: "translate(-50%, -90%)", opacity: 1, offset: 0.2 },
      { transform: "translate(-50%, -260%)", opacity: 0 },
    ],
    { duration: 1100, delay, easing: "ease-out", fill: "both" },
  );
  go.onfinish = () => el.remove();
  go.oncancel = () => el.remove();
}

/** Plays `fx` on the board `svg` (drawn for `layout`) and around it. */
export function play(svg: SVGSVGElement, layout: PahunchLayout, fx: Fx[]) {
  const route = routes(layout);
  const box = (r: number) => boxOf(layout, r);
  const cap = (r: number) => layout.rooms[r]?.cap ?? 0;
  const climbs = fx.some((f) => f.t === "piece" && f.path !== undefined);
  // When each taken coin is picked up (ms): its slot refills after.
  const picked = new Map<number, number>();
  for (const f of fx) {
    switch (f.t) {
      case "piece": {
        const el = svg.querySelector(`[data-piece="${f.room}:${f.k}"]`);
        if (!animates(el)) break;
        const end = seatAt(box(f.room), f.k, cap(f.room));
        if (f.from === null) {
          // From the hand: it drops in from below the room.
          el.animate(
            [
              { ...shift({ x: end.x, y: end.y + 7 }, end), opacity: 0 },
              { ...shift(end, end), opacity: 1 },
            ],
            { duration: SHIFT_MS + 150, easing: "cubic-bezier(.2,.8,.3,1)", fill: "backwards" },
          );
          break;
        }
        const start = seatAt(box(f.from.room), f.from.k, cap(f.from.room));
        if (f.path === undefined) {
          el.animate([shift(start, end), shift(end, end)], {
            duration: SHIFT_MS,
            delay: climbs ? 200 : 0,
            easing: "ease-in-out",
            fill: "backwards",
          });
          break;
        }
        // Up its path: out of its seat to the socket, along the wire, into its new seat. Even
        // speed along the wire (eased only leaving and arriving), so it passes its coin on time.
        const r = route[f.path];
        const along = Array.from({ length: 13 }, (_, i) => bez(r.p, i / 12));
        const pts = [start, ...along, end];
        el.animate(
          pts.map((p, i) => ({
            ...shift(p, end),
            offset: i / (pts.length - 1),
            easing: i === 0 ? "ease-in" : i === pts.length - 2 ? "ease-out" : "linear",
          })),
          { duration: CLIMB_MS, fill: "backwards" },
        );
        break;
      }
      case "blocker": {
        const el = svg.querySelector(".ph-blocker:not(.ghost)");
        if (!animates(el)) break;
        const a = route[f.from]?.mid;
        const b = route[f.to]?.mid;
        if (!a || !b) break;
        const top = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 6 };
        el.animate([shift(a, b), shift(top, b), shift(b, b)], {
          duration: 700,
          easing: "ease-in-out",
          fill: "backwards",
        });
        break;
      }
      case "coin": {
        const at = route[f.path]?.mid;
        const via = route[f.via];
        const a = at ? onPage(svg, at) : null;
        // Your own token goes into your tray's tokens; another player's to their face.
        const tray = document.querySelector(`.ph-tray[data-seat="${f.to}"]`);
        const target = tray?.querySelector(".ph-tray-tokens .ph-chip:last-of-type") ?? seatEl(f.to);
        if (!a || !via || !target) break;
        const when = Math.round(passAt(via.p, via.mid) * CLIMB_MS);
        picked.set(f.path, when);
        const scale = svg.getScreenCTM?.()?.a ?? 6;
        pickUp(a, Math.max(18, 4.6 * scale), target, tray?.querySelector(".ph-score") ?? target, f.value, when);
        break;
      }
      case "refill": {
        const el = svg.querySelector(`[data-coin="${f.path}"]`);
        if (!animates(el)) break;
        // A fresh token drops into the slot once the old one is picked up.
        const delay = (picked.get(f.path) ?? CLIMB_MS) + 380;
        el.animate(
          [
            { transform: "scale(0)", opacity: 0 },
            { transform: "scale(1.25)", opacity: 1, offset: 0.7 },
            { transform: "scale(1)", opacity: 1 },
          ],
          { duration: 420, delay, easing: "ease-out", fill: "backwards" },
        );
        break;
      }
      case "gift": {
        const a = seatEl(f.from);
        const b = seatEl(f.to);
        if (!a || !b) break;
        for (let i = 0; i < Math.min(f.count, 3); i++) fly(centre(a), centre(b), "ph-chip", "🪙", i * 120);
        break;
      }
      case "reward": {
        const at = seatEl(f.p);
        if (at) rise(centre(at), `+${f.ones} 🪙`, climbs ? CLIMB_MS : 0);
        break;
      }
      case "bribe": {
        const a = seatEl(f.p);
        const b = onPage(svg, box(f.room));
        if (a && b) fly(centre(a), b, "ph-chip", "🪙", 0);
        break;
      }
      case "fail": {
        const el = svg.querySelector(`[data-inside="${f.room}"]`);
        if (!animates(el)) break;
        el.animate(
          [0, -0.8, 0.8, -0.6, 0.6, -0.3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
          { duration: 500, easing: "ease-in-out" },
        );
        break;
      }
    }
  }
}

/** Plays what changed each time a new view of the board arrives. */
export function useMotion(svg: RefObject<SVGSVGElement | null>, v: PahunchView) {
  const prev = useRef<PahunchView | null>(null);
  useLayoutEffect(() => {
    const was = prev.current;
    prev.current = v;
    if (!was || !svg.current || reducedMotion()) return;
    const fx = effects(was, v);
    if (fx.length > 0) play(svg.current, v.layout, fx);
  }, [v, svg]);
}
