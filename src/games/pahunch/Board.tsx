// The board as SVG, drawn from the board's own data: each room where the board places it, its
// seats in one or two rows, the paths up between rooms with their tokens, and the blocker. Any
// board in boards.json draws without code changes.

import type { KeyboardEvent } from "react";
import type { PahunchLayout, PahunchView } from "../../generated/index.ts";
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

export interface BoardProps {
  v: PahunchView;
  skin: PahunchSkin;
  names: string[];
  /** Rooms and paths the viewer can do something with now: drawn as offers. */
  liveRooms: Set<number>;
  livePaths: Set<number>;
  selected: { room?: number; path?: number } | null;
  onRoom: (room: number) => void;
  onPath: (path: number) => void;
}

function press(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

export function Board({ v, skin, names, liveRooms, livePaths, selected, onRoom, onPath }: BoardProps) {
  const { layout } = v;
  const boxes = layout.rooms.map((_, i) => boxOf(layout, i));
  const ends = pathEnds(layout);
  const minX = Math.min(...boxes.map((b) => b.x - b.w / 2)) - 3;
  const maxX = Math.max(...boxes.map((b) => b.x + b.w / 2)) + 3;
  const minY = Math.min(...boxes.map((b) => b.y - b.h / 2)) - 3;
  const maxY = Math.max(...boxes.map((b) => b.y + b.h / 2)) + 3;
  const vote = v.vote;
  const who = (s: number | null) => (s === null ? skin.nouns.neutral : s === v.you ? "you" : names[s]);

  return (
    <svg
      className="ph-board"
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      role="group"
      aria-label={`The board: ${layout.name}`}
    >
      {layout.paths.map((p, i) => {
        const e = ends[i];
        const mx = (e.x1 + e.x2) / 2;
        const my = (e.y1 + e.y2) / 2;
        const token = v.tokensOn[i];
        const blocked = v.blocker === i;
        const live = livePaths.has(i);
        const cls = [
          "ph-path",
          live ? "live" : "",
          selected?.path === i ? "selected" : "",
          vote?.path === i ? "voting" : "",
          blocked ? "blocked" : "",
        ].join(" ");
        const label = `Path from ${roomName(skin, layout.board, p.from, layout.summit)} to ${roomName(skin, layout.board, p.to, layout.summit)}${
          blocked
            ? `, the ${skin.nouns.blocker} stands here`
            : token !== null
              ? `, ${token} ${skin.nouns.points} on it`
              : ""
        }`;
        return (
          <g
            key={`p${i}`}
            className={cls}
            data-path={i}
            role="button"
            tabIndex={live ? 0 : -1}
            aria-label={label}
            onClick={() => onPath(i)}
            onKeyDown={press(() => onPath(i))}
          >
            <line className="ph-path-hit" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
            <line className="ph-path-line" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
            {blocked ? (
              <g className="ph-blocker">
                <circle cx={mx} cy={my} r={2.9} />
                <text x={mx} y={my + 1.05}>
                  {skin.blockerGlyph}
                </text>
              </g>
            ) : token !== null ? (
              <g className="ph-token">
                <circle cx={mx} cy={my} r={2.3} />
                <text x={mx} y={my + 0.95}>
                  {token}
                </text>
              </g>
            ) : (
              <circle className="ph-path-dot" cx={mx} cy={my} r={0.8} />
            )}
          </g>
        );
      })}
      {boxes.map((b, room) => {
        const held = v.rooms[room] ?? [];
        const cap = layout.rooms[room].cap;
        const top = room === layout.summit;
        const live = liveRooms.has(room);
        const name = roomName(skin, layout.board, room, layout.summit);
        const cls = [
          "ph-room",
          top ? "top" : "",
          live ? "live" : "",
          selected?.room === room ? "selected" : "",
          vote?.room === room ? "voting" : "",
        ].join(" ");
        const left = b.x - b.w / 2;
        const seatsW = b.cols * SEAT;
        return (
          <g
            key={`r${room}`}
            className={cls}
            data-room={room}
            role="button"
            tabIndex={live ? 0 : -1}
            aria-label={`${name}: ${held.length} of ${cap} seats${held.length ? `, ${held.map(who).join(", ")}` : ""}`}
            onClick={() => onRoom(room)}
            onKeyDown={press(() => onRoom(room))}
          >
            <rect className="ph-room-box" x={left} y={b.y - b.h / 2} width={b.w} height={b.h} rx={1.6} />
            <text className="ph-room-name" x={b.x} y={b.y - b.h / 2 + 3.4}>
              {roomName(skin, layout.board, room, layout.summit, true)}
            </text>
            {Array.from({ length: cap }, (_, k) => {
              const col = k % b.cols;
              const row = Math.floor(k / b.cols);
              const cx = b.x - seatsW / 2 + SEAT / 2 + col * SEAT;
              const cy = b.y - b.h / 2 + 5.2 + SEAT / 2 + row * SEAT;
              const s = k < held.length ? held[k] : undefined;
              if (s === undefined) return <circle key={k} className="ph-seat empty" cx={cx} cy={cy} r={R} />;
              const look = s === null ? null : skin.seats[s % skin.seats.length];
              return (
                <g key={k} className={`ph-seat ${s === null ? "neutral" : `seat-${s}`} ${s === v.you ? "mine" : ""}`}>
                  <circle cx={cx} cy={cy} r={R} style={look ? { fill: look.color } : undefined} />
                  <text x={cx} y={cy + 0.85} style={look ? { fill: look.ink } : undefined}>
                    {s === null ? skin.neutralGlyph : (names[s]?.trim()[0] ?? "?").toUpperCase()}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
