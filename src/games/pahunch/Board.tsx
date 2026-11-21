// The board as SVG, drawn from the board's own data: each room where the board places it, its
// seats in one or two rows, the paths up between rooms with their coins, and the blocker. Any
// board in boards.json draws without code changes.
//
// The board is where you play: every room, path and the blocker is a button. What a tap does is
// the table's choice (pick a move, or explain the thing tapped). Paths are smooth wires routed
// around the rooms (route.ts), drawn under the room cards and plugged into their edges; pieces,
// coins and the blocker sit on top.
//
// A move always looks the same, whether it is your pick, a vote everyone watches, or the blocker
// going somewhere: the piece that moves is lifted, its path marches towards the room it goes to,
// and a faint copy of the piece already waits in the seat it will take.

import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";
import { AvatarFace } from "../../client/Avatar.tsx";
import type { PahunchCarry, PahunchLayout, PahunchView } from "../../generated/index.ts";
import { offers, slot } from "./derive.ts";
import { useMotion } from "./motion.ts";
import { boxOf, type Pt, routes, seatAt } from "./route.ts";
import type { PahunchSkin } from "./skin.ts";
import { roomIcon, roomName } from "./skin.ts";

export { boxOf } from "./route.ts";

const R = 2.15;

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
  /** Each seat's avatar look; drawn on its pieces when `faces` is on (an admin's display choice). */
  looks: string[];
  faces: boolean;
  /**
   * Favours the move on show uses, for everyone to see: the path whose token a swap takes instead
   * (raised and glowing; the path's own is crossed out), and the piece a carry takes along.
   */
  swap?: number;
  carry?: PahunchCarry;
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

/** A scalloped tile of eight petals about `r` across: the aunties' frame, unlike any player's round piece. */
function flower(x: number, y: number, r: number): string {
  const n = 8;
  const r0 = r * 0.8;
  const pt = (i: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return `${(x + r0 * Math.cos(a)).toFixed(2)} ${(y + r0 * Math.sin(a)).toFixed(2)}`;
  };
  const bulge = (r0 * Math.sin(Math.PI / n)).toFixed(2);
  return `M${pt(0)}${Array.from({ length: n }, (_, i) => `A${bulge} ${bulge} 0 0 1 ${pt(i + 1)}`).join("")}Z`;
}

/** Each seat's shape, drawn with its colour so colour is never the only sign of whose piece it is. */
export function seatShape(k: number, x: number, y: number, r: number): string {
  const poly = (n: number, turn: number, rr = r) =>
    `M${Array.from({ length: n }, (_, i) => {
      const a = turn + (i * 2 * Math.PI) / n;
      return `${(x + rr * Math.cos(a)).toFixed(2)} ${(y + rr * Math.sin(a)).toFixed(2)}`;
    }).join("L")}Z`;
  switch (k % 7) {
    case 0:
      return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
    case 1:
      return poly(3, -Math.PI / 2, r * 1.15);
    case 2:
      return poly(4, Math.PI / 4, r * 1.2);
    case 3:
      return poly(4, 0, r * 1.2);
    case 4: {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.5 : r * 1.2;
        return `${(x + rr * Math.cos(a)).toFixed(2)} ${(y + rr * Math.sin(a)).toFixed(2)}`;
      });
      return `M${pts.join("L")}Z`;
    }
    case 5:
      return poly(6, 0, r * 1.1);
    default: {
      const t = r * 0.38;
      return `M${x - t} ${y - r}h${2 * t}v${r - t}h${r - t}v${2 * t}h${t - r}v${r - t}h${-2 * t}v${t - r}h${t - r}v${-2 * t}h${r - t}Z`;
    }
  }
}

/** The board's drawn area: every room card and every path, with a small margin. */
export function viewOf(layout: PahunchLayout) {
  const boxes = layout.rooms.map((_, i) => boxOf(layout, i));
  const xs = [
    ...boxes.flatMap((b) => [b.x - b.w / 2, b.x + b.w / 2]),
    ...routes(layout).flatMap((r) => r.p.map((q) => q.x)),
  ];
  const minX = Math.min(...xs) - 3;
  const maxX = Math.max(...xs) + 3;
  const minY = Math.min(...boxes.map((b) => b.y - b.h / 2)) - 3;
  const maxY = Math.max(...boxes.map((b) => b.y + b.h / 2)) + 3;
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

export function Board(props: BoardProps) {
  const { v, skin, names, acting, liveRooms, livePaths, focus, targets, blockerLive, selected, faces } = props;
  const { layout } = v;
  const boxes = layout.rooms.map((_, i) => boxOf(layout, i));
  const route = routes(layout);
  const { minX, minY, w: viewW, h: viewH } = viewOf(layout);
  const vote = v.vote;
  const who = (s: number | null) => (s === null ? skin.nouns.neutral : s === v.you ? "you" : names[s]);
  const name = (r: number, short = false) => roomName(skin, layout.board, r, layout.summit, short);
  const keyOpen = offers(v, "backStairs");

  // The move on show, if any: a vote everyone watches, or the viewer's own picked way up.
  const pickedPath = selected?.path !== undefined && !selected.blocker ? selected.path : undefined;
  const movePath = vote ? vote.path : pickedPath;
  const mover: number | null | undefined = (() => {
    if (movePath === undefined) return undefined;
    const from = v.rooms[layout.paths[movePath].from] ?? [];
    const seat = vote ? v.turn : v.you;
    if (seat !== null && from.includes(seat)) return seat;
    return from.includes(null) ? null : undefined;
  })();
  const landing = movePath !== undefined && mover !== undefined ? layout.paths[movePath].to : undefined;
  // A favour's part of the move: the token taken instead, and the piece taken along.
  const swapAt = movePath !== undefined ? props.swap : undefined;
  const carried: number | null | undefined =
    movePath !== undefined && props.carry ? (props.carry.t === "seat" ? props.carry.seat : null) : undefined;
  // The blocker's picked new place, shown as a faint blocker on that path.
  const blockerTo = selected?.blocker && selected.path !== undefined ? selected.path : undefined;

  // Back stairs underneath, coin stairs on top, and whatever the pick is about above them all.
  const inFocus = (p: number) => !!focus?.has(p) || movePath === p || blockerTo === p;
  const rank = (p: number) => ORDER[pathKind(layout, p)] + (inFocus(p) ? 10 : 0) + (movePath === p ? 10 : 0);
  const order = layout.paths.map((_, i) => i).sort((a, b) => rank(a) - rank(b));
  const pathState = (i: number) =>
    [
      // Paths glow only once something is picked; on the open board the rooms do the talking.
      focus && livePaths.has(i) && focus.has(i) ? "live" : acting ? "quiet" : "",
      focus && !focus.has(i) && movePath !== i ? "dim" : "",
      selected?.path === i ? "selected" : "",
      vote?.path === i ? "voting" : "",
      movePath === i || blockerTo === i ? "moving" : "",
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
      selected?.room === room
        ? ""
        : liveRooms.has(room)
          ? "live"
          : acting && !targets.has(room) && landing !== room
            ? "idle"
            : "",
      targets.has(room) || landing === room ? "target" : "",
      selected?.room === room ? "selected" : "",
      vote?.room === room ? "voting" : "",
      landing === room ? "landing" : "",
    ].join(" ");
  const tap = (fn: () => void) => ({ onClick: fn, onKeyDown: press(fn) });
  // About how wide a card's title runs (icon, gap, name at 2 units a letter-height); a longer one
  // is squeezed to fit its card.
  const titleW = (room: number) => 2.9 + name(room, true).length * 1.02;
  const uid = useId().replace(/[^\w-]/g, "");
  // Each new view slides what moved from where it was (motion.ts).
  const svgRef = useRef<SVGSVGElement>(null);
  useMotion(svgRef, v);

  /**
   * A piece: an aunty's own face on a square tile (players' pieces are round), or a player's
   * colour as a ring round their face or a disc with their shape.
   */
  const piece = (s: number | null, at: Pt, key: string | number, cls: string, place?: string): ReactNode => {
    const look = s === null ? null : skin.seats[s % skin.seats.length];
    const base = `ph-seat ${s === null ? "neutral" : `seat-${s}`} ${s === v.you ? "mine" : ""} ${cls}`;
    if (s === null)
      return (
        <g key={key} className={base} data-piece={place}>
          {/* Petals that turn slowly round her face. */}
          <path className="ph-piece-ring ph-petals" d={flower(at.x, at.y, R + 0.15)} />
          <AvatarFace
            code={skin.neutralLook}
            name={skin.nouns.neutral}
            lips={skin.neutralLips}
            x={at.x}
            y={at.y}
            r={R * 0.7}
          />
        </g>
      );
    return (
      <g key={key} className={`${base} ${faces ? "face" : ""}`} data-piece={place}>
        <circle className="ph-piece-ring" cx={at.x} cy={at.y} r={R} style={{ fill: look?.color }} />
        {faces ? (
          <AvatarFace code={props.looks[s] ?? ""} name={names[s] ?? ""} x={at.x} y={at.y} r={R - 0.6} />
        ) : (
          <path className="ph-shape" d={seatShape(s, at.x, at.y, 0.95)} style={{ fill: look?.ink }} />
        )}
      </g>
    );
  };

  return (
    <svg
      ref={svgRef}
      className={`ph-board ${acting ? "acting" : ""} ${focus ? "picking" : ""} ${movePath !== undefined ? "showing" : ""}`}
      viewBox={`${minX} ${minY} ${viewW} ${viewH}`}
      role="group"
      aria-label={`The board: ${layout.name}`}
    >
      <defs>
        <radialGradient id={`${uid}glow`}>
          <stop className="ph-glow-stop" offset="0" stopOpacity="0.9" />
          <stop className="ph-glow-stop" offset="0.5" stopOpacity="0.35" />
          <stop className="ph-glow-stop" offset="1" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Paths: wires under the room cards, so a room never has a line across it. */}
      <g className="ph-layer-paths">
        {order.map((i) => {
          const r = route[i];
          const kind = pathKind(layout, i);
          const deg = (Math.atan2(r.dir.y, r.dir.x) * 180) / Math.PI;
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
              <path className="ph-path-hit" d={r.d} />
              <path className="ph-path-glow" d={r.d} />
              <path className="ph-path-case" d={r.d} />
              <path className="ph-path-line" d={r.d} />
              <g transform={`translate(${r.head.x} ${r.head.y}) rotate(${deg.toFixed(1)})`}>
                <path className="ph-path-head" d="M0.9 0L-0.9 -1.05L-0.45 0L-0.9 1.05Z" />
              </g>
            </g>
          );
        })}
      </g>

      {/* Room cards: the tap target for the room, opaque over the wires. */}
      <g className="ph-layer-rooms">
        {boxes.map((b, room) => {
          const top = room === layout.summit;
          return (
            <g
              key={`r${room}`}
              className={`ph-room ${top ? "top" : ""} ${roomState(room)}`}
              data-room={room}
              role="button"
              tabIndex={0}
              aria-pressed={selected?.room === room}
              aria-label={`${name(room)}: ${(v.rooms[room] ?? []).length} of ${layout.rooms[room].cap} seats${(v.rooms[room] ?? []).length ? `, ${(v.rooms[room] ?? []).map(who).join(", ")}` : ""}`}
              {...tap(() => props.onRoom(room))}
            >
              <rect className="ph-room-halo" x={b.x - b.w / 2} y={b.y - b.h / 2} width={b.w} height={b.h} rx={1.6} />
              <rect className="ph-room-box" x={b.x - b.w / 2} y={b.y - b.h / 2} width={b.w} height={b.h} rx={1.6} />
              {top && (
                <rect
                  className="ph-room-inner"
                  x={b.x - b.w / 2 + 0.8}
                  y={b.y - b.h / 2 + 0.8}
                  width={b.w - 1.6}
                  height={b.h - 1.6}
                  rx={1}
                />
              )}
              {selected?.room === room && (
                <g className="ph-room-check">
                  <circle cx={b.x - b.w / 2} cy={b.y - b.h / 2} r={1.3} />
                  <path d={`M${b.x - b.w / 2 - 0.6} ${b.y - b.h / 2}l0.45 0.45l0.8 -0.9`} />
                </g>
              )}
            </g>
          );
        })}
      </g>

      {/* Sockets: where each wire plugs into a room's edge; they light up with their path. */}
      <g className="ph-layer-sockets" aria-hidden="true">
        {order.map((i) => {
          const r = route[i];
          return (
            <g key={`k${i}`} className={`ph-socket ${pathKind(layout, i)} ${pathState(i)}`}>
              <circle className="ph-socket-glow" cx={r.p[0].x} cy={r.p[0].y} r={2.6} fill={`url(#${uid}glow)`} />
              <circle className="ph-socket-glow" cx={r.p[3].x} cy={r.p[3].y} r={2.6} fill={`url(#${uid}glow)`} />
              <circle className="ph-socket-dot" cx={r.p[0].x} cy={r.p[0].y} r={0.62} />
              <circle className="ph-socket-dot" cx={r.p[3].x} cy={r.p[3].y} r={0.62} />
            </g>
          );
        })}
      </g>

      {/* Icons, names and pieces: part of the room's tap target. */}
      <g className="ph-layer-pieces">
        {boxes.map((b, room) => {
          const held = v.rooms[room] ?? [];
          const cap = layout.rooms[room].cap;
          const top = room === layout.summit;
          const icon = roomIcon(skin, layout.board, room, layout.summit);
          // The piece that moves is lifted (and one a carry takes along); it still sits in its seat.
          const fromHere = movePath !== undefined && layout.paths[movePath].from === room;
          const moving = fromHere ? held.indexOf(mover ?? -2) : -1;
          const along =
            fromHere && carried !== undefined ? held.findIndex((x, k) => x === carried && k !== moving) : -1;
          // Where they go: faint copies already in the seats they will take.
          const arriving =
            landing === room && mover !== undefined ? [mover, ...(carried !== undefined ? [carried] : [])] : [];
          return (
            <g
              key={`s${room}`}
              data-inside={room}
              className={`ph-room-inside ${top ? "top" : ""} ${roomState(room)}`}
              onClick={() => props.onRoom(room)}
              aria-hidden="true"
            >
              <rect
                className="ph-room-pad"
                x={b.x - b.w / 2 + 0.6}
                y={b.y - b.h / 2 + 0.6}
                width={b.w - 1.2}
                height={b.h - 1.2}
              />
              {/* The icon and short name share the card's top line; on a phone the icon alone. */}
              <text
                className="ph-room-title"
                x={b.x}
                y={b.y - b.h / 2 + 3.1}
                {...(titleW(room) > b.w - 1.6 ? { textLength: b.w - 1.6, lengthAdjust: "spacingAndGlyphs" } : {})}
              >
                <tspan className="ph-room-icon">{icon}</tspan>
                <tspan className="ph-room-name" dx={0.4}>
                  {name(room, true)}
                </tspan>
              </text>
              <text className="ph-room-icon solo" x={b.x} y={b.y - b.h / 2 + 3.4}>
                {icon}
              </text>
              {Array.from({ length: Math.max(cap, held.length) }, (_, k) => {
                const at = seatAt(b, k, cap);
                const s = k < held.length ? held[k] : undefined;
                if (s === undefined) {
                  if (k - held.length < arriving.length) return null;
                  return <circle key={k} className="ph-seat empty" cx={at.x} cy={at.y} r={R} />;
                }
                return piece(
                  s,
                  at,
                  k,
                  `${k >= cap ? "extra" : ""} ${k === moving || k === along ? "moving" : ""}`,
                  `${room}:${k}`,
                );
              })}
              {/* A full room still shows where the newcomer squeezes in, on its corner. */}
              {arriving.map((s, j) => {
                const k = held.length + j;
                return piece(s, seatAt(b, k, cap), `g${j}`, `ghost ${k >= cap ? "extra" : ""}`);
              })}
            </g>
          );
        })}
      </g>

      {/* Coins, locks and the blocker on top: they are what a path is worth. */}
      <g className="ph-layer-marks">
        {order.map((i) => {
          const kind = pathKind(layout, i);
          const { x, y } = route[i].mid;
          const token = v.tokensOn[i];
          if (v.blocker === i) return null;
          const swapped = swapAt === i;
          const crossed = swapAt !== undefined && movePath === i;
          return (
            <g
              key={`m${i}`}
              className={`ph-mark ${kind} ${kind === "back" && keyOpen ? "open" : ""} ${pathState(i)} ${swapped ? "swapped" : ""} ${crossed ? "crossed" : ""}`}
              onClick={() => props.onPath(i)}
              aria-hidden="true"
            >
              {kind === "back" ? (
                <g className="ph-lock">
                  <circle cx={x} cy={y} r={1.6} />
                  <text x={x} y={y + 0.55}>
                    {keyOpen ? skin.favours.backStairs.glyph : "🔒"}
                  </text>
                </g>
              ) : token ? (
                <g
                  className={`ph-token v${Math.min(token.value, 5)} ${token.bonus ? `bonus ${token.bonus}` : ""}`}
                  data-coin={i}
                >
                  <circle className="ph-coin-hit" cx={x} cy={y} r={4} />
                  <circle className="ph-coin-rim" cx={x} cy={y} r={2.3} />
                  <circle className="ph-coin" cx={x} cy={y} r={1.85} />
                  <text x={x} y={y + 0.85}>
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
                  {/* A swap takes another token: this one stays, struck through. */}
                  {crossed && <path className="ph-coin-strike" d={`M${x - 2.2} ${y + 2.2}L${x + 2.2} ${y - 2.2}`} />}
                </g>
              ) : kind === "slot" ? (
                <circle className="ph-slot-empty" cx={x} cy={y} r={1.3} />
              ) : null}
            </g>
          );
        })}
        {blockerTo !== undefined && blockerTo !== v.blocker && (
          <g className="ph-blocker ghost" aria-hidden="true">
            <circle className="ph-blocker-disc" cx={route[blockerTo].mid.x} cy={route[blockerTo].mid.y} r={2.9} />
            <AvatarFace
              code={skin.blockerLook}
              name={skin.nouns.blocker}
              x={route[blockerTo].mid.x}
              y={route[blockerTo].mid.y}
              r={2.5}
            />
          </g>
        )}
        {v.blocker !== null &&
          (() => {
            const at = v.blocker;
            const { x, y } = route[at].mid;
            const covered = v.tokensOn[at];
            const p = layout.paths[at];
            return (
              <g
                className={`ph-blocker ${blockerLive ? "live" : acting ? "idle" : ""} ${selected?.blocker ? "selected" : ""} ${blockerTo !== undefined && blockerTo !== at ? "moving" : ""}`}
                role="button"
                tabIndex={0}
                aria-pressed={!!selected?.blocker}
                aria-label={`${skin.nouns.blocker}, on ${name(p.from)} up to ${name(p.to)}${covered ? `, sitting on ${covered.value} ${skin.nouns.points}` : ""}`}
                {...tap(props.onBlocker)}
              >
                <circle className="ph-blocker-hit" cx={x} cy={y} r={4.6} />
                <circle className="ph-blocker-ring" cx={x} cy={y} r={3.7} />
                <circle className="ph-blocker-disc" cx={x} cy={y} r={2.9} />
                <AvatarFace code={skin.blockerLook} name={skin.nouns.blocker} x={x} y={y} r={2.5} />
                {/* The coin under him, at his feet: its value colour and its bonus mark, like any coin. */}
                {covered && (
                  <g className={`ph-token ph-under v${Math.min(covered.value, 5)}`}>
                    <circle className="ph-coin-rim" cx={x + 2.6} cy={y + 2.4} r={1.65} />
                    <circle className="ph-coin" cx={x + 2.6} cy={y + 2.4} r={1.3} />
                    <text x={x + 2.6} y={y + 3.0}>
                      {covered.value}
                    </text>
                    {covered.bonus && (
                      <g className="ph-coin-mark">
                        <circle cx={x + 4.1} cy={y + 1.0} r={0.95} />
                        <text x={x + 4.1} y={y + 1.42}>
                          {skin.bonuses[covered.bonus].glyph}
                        </text>
                      </g>
                    )}
                  </g>
                )}
              </g>
            );
          })()}
      </g>
    </svg>
  );
}
