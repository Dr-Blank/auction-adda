// The board as SVG, drawn from the board's own data: each room where the board places it, its
// seats in one or two rows, the paths up between rooms with their coins, and the blocker. Any
// board in boards.json draws without code changes.
//
// The board is where you play: every room, path and the blocker is a button. What a tap does is
// the table's choice (pick a move, or explain the thing tapped). Drawn in layers so nothing that
// matters hides: room boxes, then the paths over them, then the pieces, then coins and the blocker.

import type { KeyboardEvent } from "react";
import type { PahunchLayout, PahunchView } from "../../generated/index.ts";
import { offers, slot } from "./derive.ts";
import type { PahunchSkin } from "./skin.ts";
import { roomName } from "./skin.ts";

const SEAT = 5.4;
const R = 2.15;
const MIN_W = 15;

interface Box {
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

/** Where each path leaves its room and arrives at the next: spread along the edges, by direction. */
function pathEnds(layout: PahunchLayout) {
  const spread = (room: number, ids: number[], other: (p: number) => number) => {
    const b = boxOf(layout, room);
    const sorted = [...ids].sort((a, c) => layout.rooms[other(a)].x - layout.rooms[other(c)].x);
    return new Map(sorted.map((p, k) => [p, b.x - b.w / 2 + (b.w * (k + 1)) / (sorted.length + 1)]));
  };
  const ids = layout.paths.map((_, i) => i);
  const fromX = new Map<number, number>();
  const toX = new Map<number, number>();
  layout.rooms.forEach((_, room) => {
    const out = ids.filter((p) => layout.paths[p].from === room);
    const inn = ids.filter((p) => layout.paths[p].to === room);
    for (const [p, x] of spread(room, out, (q) => layout.paths[q].to)) fromX.set(p, x);
    for (const [p, x] of spread(room, inn, (q) => layout.paths[q].from)) toX.set(p, x);
  });
  return layout.paths.map((p, i) => {
    const a = boxOf(layout, p.from);
    const b = boxOf(layout, p.to);
    return { x1: fromX.get(i)!, y1: a.y - a.h / 2, x2: toX.get(i)!, y2: b.y + b.h / 2 };
  });
}

/** What a path is: `back` stairs (locked, no coin), a `slot` that holds a coin, or `plain`. */
export const pathKind = (layout: PahunchLayout, path: number): "back" | "slot" | "plain" =>
  layout.paths[path]?.back ? "back" : slot(layout, path) ? "slot" : "plain";

/** What is picked on the board: a room, a path, the blocker, or the blocker and a path for it. */
export interface Pick {
  room?: number;
  path?: number;
  blocker?: boolean;
}

export interface BoardProps {
  v: PahunchView;
  skin: PahunchSkin;
  names: string[];
  /** The viewer owes a move: what they can use glows, the rest is muted. */
  acting: boolean;
  /** Rooms and paths the viewer can do something with now. */
  liveRooms: Set<number>;
  livePaths: Set<number>;
  /** While something is picked: the paths that matter to it. The rest fade further. */
  focus: Set<number> | null;
  /** Rooms the picked move could go to. */
  targets: Set<number>;
  blockerLive: boolean;
  selected: Pick | null;
  onRoom: (room: number) => void;
  onPath: (path: number) => void;
  onBlocker: () => void;
}

function press(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

const ORDER = { back: 0, plain: 1, slot: 2 };

export function Board(props: BoardProps) {
  const { v, skin, names, acting, liveRooms, livePaths, focus, targets, blockerLive, selected } = props;
  const { layout } = v;
  const boxes = layout.rooms.map((_, i) => boxOf(layout, i));
  const ends = pathEnds(layout);
  const minX = Math.min(...boxes.map((b) => b.x - b.w / 2)) - 3;
  const maxX = Math.max(...boxes.map((b) => b.x + b.w / 2)) + 3;
  const minY = Math.min(...boxes.map((b) => b.y - b.h / 2)) - 3;
  const maxY = Math.max(...boxes.map((b) => b.y + b.h / 2)) + 3;
  const vote = v.vote;
  const who = (s: number | null) => (s === null ? skin.nouns.neutral : s === v.you ? "you" : names[s]);
  const name = (r: number, short = false) => roomName(skin, layout.board, r, layout.summit, short);
  const keyOpen = offers(v, "backStairs");
  // Back stairs underneath, coin stairs on top, and whatever the pick is about above them all.
  const rank = (p: number) => ORDER[pathKind(layout, p)] + (livePaths.has(p) ? 5 : 0) + (focus?.has(p) ? 10 : 0);
  const order = layout.paths.map((_, i) => i).sort((a, b) => rank(a) - rank(b));
  const mid = (i: number) => ({ x: (ends[i].x1 + ends[i].x2) / 2, y: (ends[i].y1 + ends[i].y2) / 2 });
  const pathState = (i: number) =>
    [
      livePaths.has(i) ? "live" : acting ? "idle" : "",
      focus && !focus.has(i) ? "dim" : "",
      selected?.path === i ? "selected" : "",
      vote?.path === i ? "voting" : "",
    ].join(" ");
  const pathLabel = (i: number) => {
    const p = layout.paths[i];
    const token = v.tokensOn[i];
    const what =
      pathKind(layout, i) === "back"
        ? `, ${skin.nouns.backPath}, ${keyOpen ? "open this turn" : "locked"}`
        : v.blocker === i
          ? `, ${skin.nouns.blocker} sits here`
          : token
            ? `, ${token.value} ${skin.nouns.points} on it${token.bonus ? ` (${skin.bonuses[token.bonus].name})` : ""}`
            : "";
    return `${name(p.from)} up to ${name(p.to)}${what}`;
  };
  const roomState = (room: number) =>
    [
      liveRooms.has(room) ? "live" : acting ? "idle" : "",
      targets.has(room) ? "target" : "",
      selected?.room === room ? "selected" : "",
      vote?.room === room ? "voting" : "",
    ].join(" ");
  const tap = (fn: () => void) => ({ onClick: fn, onKeyDown: press(fn) });

  return (
    <svg
      className={`ph-board ${acting ? "acting" : ""} ${focus ? "picking" : ""}`}
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      role="group"
      aria-label={`The board: ${layout.name}`}
    >
      {/* Room boxes: the tap target for the room. */}
      <g className="ph-layer-rooms">
        {boxes.map((b, room) => (
          <g
            key={`r${room}`}
            className={`ph-room ${room === layout.summit ? "top" : ""} ${roomState(room)}`}
            data-room={room}
            role="button"
            tabIndex={0}
            aria-pressed={selected?.room === room}
            aria-label={`${name(room)}: ${(v.rooms[room] ?? []).length} of ${layout.rooms[room].cap} seats${(v.rooms[room] ?? []).length ? `, ${(v.rooms[room] ?? []).map(who).join(", ")}` : ""}`}
            {...tap(() => props.onRoom(room))}
          >
            <rect className="ph-room-box" x={b.x - b.w / 2} y={b.y - b.h / 2} width={b.w} height={b.h} rx={1.6} />
          </g>
        ))}
      </g>

      {/* Paths, over the boxes so none hides behind a room. */}
      <g className="ph-layer-paths">
        {order.map((i) => {
          const e = ends[i];
          const kind = pathKind(layout, i);
          // The arrow head, just short of the room it goes up to.
          const len = Math.hypot(e.x2 - e.x1, e.y2 - e.y1) || 1;
          const ux = (e.x2 - e.x1) / len;
          const uy = (e.y2 - e.y1) / len;
          const tip = { x: e.x2 - ux * 0.3, y: e.y2 - uy * 0.3 };
          const base = { x: tip.x - ux * 1.6, y: tip.y - uy * 1.6 };
          const head = `${tip.x},${tip.y} ${base.x - uy * 0.85},${base.y + ux * 0.85} ${base.x + uy * 0.85},${base.y - ux * 0.85}`;
          return (
            <g
              key={`p${i}`}
              className={`ph-path ${kind} ${kind === "back" && keyOpen ? "open" : ""} ${pathState(i)}`}
              data-path={i}
              role="button"
              tabIndex={0}
              aria-pressed={selected?.path === i}
              aria-label={pathLabel(i)}
              {...tap(() => props.onPath(i))}
            >
              <line className="ph-path-hit" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
              <line className="ph-path-case" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
              <line className="ph-path-line" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
              <polygon className="ph-path-head" points={head} />
            </g>
          );
        })}
      </g>

      {/* Names and pieces: part of the room's tap target. */}
      <g className="ph-layer-pieces">
        {boxes.map((b, room) => {
          const held = v.rooms[room] ?? [];
          const cap = layout.rooms[room].cap;
          const left = b.x - b.w / 2;
          const seatsW = b.cols * SEAT;
          return (
            <g
              key={`s${room}`}
              className={`ph-room-inside ${room === layout.summit ? "top" : ""} ${roomState(room)}`}
              onClick={() => props.onRoom(room)}
              aria-hidden="true"
            >
              <rect
                className="ph-room-pad"
                x={left + 0.6}
                y={b.y - b.h / 2 + 0.6}
                width={b.w - 1.2}
                height={b.h - 1.2}
              />
              <text className="ph-room-name" x={b.x} y={b.y - b.h / 2 + 3.1}>
                {name(room, true)}
              </text>
              {Array.from({ length: Math.max(cap, held.length) }, (_, k) => {
                const col = k % b.cols;
                const row = Math.floor(k / b.cols);
                const cx = b.x - seatsW / 2 + SEAT / 2 + col * SEAT;
                const cy = b.y - b.h / 2 + 5.2 + SEAT / 2 + row * SEAT;
                const s = k < held.length ? held[k] : undefined;
                if (s === undefined) return <circle key={k} className="ph-seat empty" cx={cx} cy={cy} r={R} />;
                const look = s === null ? null : skin.seats[s % skin.seats.length];
                // One squeezed in past the seats sits on the room's corner.
                const extra = k >= cap;
                const x = extra ? left + b.w - 0.6 : cx;
                const y = extra ? b.y - b.h / 2 + 0.6 : cy;
                return (
                  <g
                    key={k}
                    className={`ph-seat ${s === null ? "neutral" : `seat-${s}`} ${s === v.you ? "mine" : ""} ${extra ? "extra" : ""}`}
                  >
                    <circle cx={x} cy={y} r={R} style={look ? { fill: look.color } : undefined} />
                    <text x={x} y={y + 0.85} style={look ? { fill: look.ink } : undefined}>
                      {s === null ? skin.neutralGlyph : (names[s]?.trim()[0] ?? "?").toUpperCase()}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </g>

      {/* Coins, locks and the blocker on top: they are what a path is worth. */}
      <g className="ph-layer-marks">
        {order.map((i) => {
          const kind = pathKind(layout, i);
          const { x, y } = mid(i);
          const token = v.tokensOn[i];
          if (v.blocker === i) return null;
          return (
            <g
              key={`m${i}`}
              className={`ph-mark ${kind} ${kind === "back" && keyOpen ? "open" : ""} ${pathState(i)}`}
              onClick={() => props.onPath(i)}
              aria-hidden="true"
            >
              {kind === "back" ? (
                <g className="ph-lock">
                  <circle cx={x} cy={y} r={1.8} />
                  <text x={x} y={y + 0.62}>
                    {keyOpen ? skin.favours.backStairs.glyph : "🔒"}
                  </text>
                </g>
              ) : token ? (
                <g className={`ph-token ${token.bonus ? `bonus ${token.bonus}` : ""}`}>
                  <circle className="ph-coin-hit" cx={x} cy={y} r={4} />
                  <circle className="ph-coin" cx={x} cy={y} r={2.3} />
                  <text x={x} y={y + 0.95}>
                    {token.value}
                  </text>
                  {token.bonus && (
                    <g className="ph-coin-mark">
                      <circle cx={x + 2.1} cy={y - 1.9} r={1.3} />
                      <text x={x + 2.1} y={y - 1.4}>
                        {skin.bonuses[token.bonus].glyph}
                      </text>
                    </g>
                  )}
                </g>
              ) : kind === "slot" ? (
                <circle className="ph-slot-empty" cx={x} cy={y} r={1.3} />
              ) : null}
            </g>
          );
        })}
        {v.blocker !== null &&
          (() => {
            const at = v.blocker;
            const { x, y } = mid(at);
            const covered = v.tokensOn[at];
            const p = layout.paths[at];
            return (
              <g
                className={`ph-blocker ${blockerLive ? "live" : acting ? "idle" : ""} ${selected?.blocker ? "selected" : ""}`}
                role="button"
                tabIndex={0}
                aria-pressed={!!selected?.blocker}
                aria-label={`${skin.nouns.blocker}, on ${name(p.from)} up to ${name(p.to)}${covered ? `, sitting on ${covered.value} ${skin.nouns.points}` : ""}`}
                {...tap(props.onBlocker)}
              >
                <circle className="ph-blocker-hit" cx={x} cy={y} r={4.6} />
                <circle className="ph-blocker-ring" cx={x} cy={y} r={3.7} />
                <circle className="ph-blocker-disc" cx={x} cy={y} r={2.9} />
                <text x={x} y={y + 1.05}>
                  {skin.blockerGlyph}
                </text>
                {covered && (
                  <g className="ph-under">
                    <circle cx={x + 2.5} cy={y + 2.3} r={1.35} />
                    <text x={x + 2.5} y={y + 2.85}>
                      {covered.value}
                    </text>
                  </g>
                )}
              </g>
            );
          })()}
      </g>
    </svg>
  );
}
