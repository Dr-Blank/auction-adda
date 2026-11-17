import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Sheet } from "./Sheet.tsx";

/**
 * A seat's look: one base-36 digit per part, in the order of `PARTS`. Each digit is taken modulo
 * the part's number of choices, so any string draws something (the server rolls bots' looks without
 * knowing the parts). New parts go at the end, so old looks keep their meaning.
 */

const SKIN = ["#ffe0c7", "#f6cfa9", "#eab98c", "#d9a066", "#c18450", "#9c6640", "#7a4b2c", "#583420"];
const HAIR = [
  "#1e1a1a",
  "#3b2618",
  "#62402a",
  "#8b3e22",
  "#c46a32",
  "#dcb565",
  "#ece0c4",
  "#9c9a9a",
  "#4d6fd0",
  "#c95f98",
];
const CLOTH = [
  "#e45d50",
  "#f0a33a",
  "#e8d06a",
  "#5fb27a",
  "#3f9c9a",
  "#4f7ad8",
  "#7a5fd0",
  "#c45d9e",
  "#3a3f4b",
  "#ecebe6",
];
/** Two close tones per background: a subtle top-to-bottom gradient. */
const BG: [string, string][] = [
  ["#f6e7d3", "#e6caa6"],
  ["#e3ecf7", "#c4d4ec"],
  ["#e6f2e3", "#c3ddbf"],
  ["#f4e1ea", "#e3bfd0"],
  ["#ece6f7", "#d0c3ec"],
  ["#fdf1cf", "#f0d993"],
  ["#dff1f0", "#b9dcda"],
  ["#f7e2d9", "#e9bda9"],
  ["#e7e7ea", "#cbccd3"],
  ["#3a3657", "#25223b"],
  ["#31514a", "#1f3631"],
  ["#5a3d37", "#3a2723"],
];
const INK = "#2b211d";
const MOUTH = "#5a1f22";
const FRAME = "#25222b";
const GOLD = "#d4a94a";

const FACES = [
  "M28,47 A22,25 0 1 0 72,47 A22,25 0 1 0 28,47 Z",
  "M30.5,47 A19.5,27 0 1 0 69.5,47 A19.5,27 0 1 0 30.5,47 Z",
  "M28,32 Q28,21 40,21 L60,21 Q72,21 72,32 L72,56 Q72,72 50,73 Q28,72 28,56 Z",
  "M28,40 Q28,21 50,21 Q72,21 72,40 Q72,58 50,74 Q28,58 28,40 Z",
  "M27,42 Q27,21 50,21 Q73,21 73,42 Q73,66 50,72 Q27,66 27,42 Z",
];
/** Where each face's ears sit (x of the left ear). */
const EAR_X = [28.5, 31, 28.5, 28.5, 27.5];

export const PARTS = [
  {
    key: "bg",
    label: "Background",
    count: BG.length,
    swatch: (i: number) => `linear-gradient(170deg, ${BG[i][0]}, ${BG[i][1]})`,
  },
  { key: "skin", label: "Skin", count: SKIN.length, swatch: (i: number) => SKIN[i] },
  { key: "face", label: "Face", count: FACES.length, zoom: true },
  { key: "hair", label: "Hair", count: 16 },
  { key: "hairColor", label: "Hair colour", count: HAIR.length, swatch: (i: number) => HAIR[i] },
  { key: "eyes", label: "Eyes", count: 8, zoom: true },
  { key: "brows", label: "Eyebrows", count: 6, zoom: true },
  { key: "mouth", label: "Mouth", count: 8, zoom: true },
  { key: "glasses", label: "Glasses", count: 7, zoom: true },
  { key: "beard", label: "Facial hair", count: 6, zoom: true },
  { key: "outfit", label: "Clothes", count: 8 },
  { key: "outfitColor", label: "Clothes colour", count: CLOTH.length, swatch: (i: number) => CLOTH[i] },
  { key: "extra", label: "Extras", count: 8 },
] as const;

export type PartKey = (typeof PARTS)[number]["key"];
export type Look = Record<PartKey, number>;
/** Parts where "none" (choice 0) is common enough that a random look picks it half the time. */
const OFTEN_NONE = new Set<PartKey>(["glasses", "beard", "extra"]);

export function decode(code: string): Look {
  const look = {} as Look;
  PARTS.forEach((p, i) => {
    const d = parseInt(code[i] ?? "0", 36);
    look[p.key] = (Number.isNaN(d) ? 0 : d) % p.count;
  });
  return look;
}

export const encode = (look: Look) => PARTS.map((p) => look[p.key].toString(36)).join("");

export function randomChoice(key: PartKey, not?: number, rand = Math.random): number {
  const { count } = PARTS.find((p) => p.key === key)!;
  if (not === undefined && OFTEN_NONE.has(key) && rand() < 0.5) return 0;
  // Another choice than the current one, so a reroll always changes something.
  const pick = Math.floor(rand() * (not === undefined ? count : count - 1));
  return not !== undefined && pick >= not ? pick + 1 : pick;
}

export function randomLook(rand = Math.random): string {
  const look = {} as Look;
  for (const p of PARTS) look[p.key] = randomChoice(p.key, undefined, rand);
  return encode(look);
}

/** A seat that never picked a look gets one from its name: the same on every screen. */
export function lookFromName(name: string): string {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return randomLook(() => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 2 ** 32;
  });
}

function mix(hex: string, to: number, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * (1 - f) + to * f);
  return `rgb(${ch(16)} ${ch(8)} ${ch(0)})`;
}
const shade = (hex: string, f: number) => mix(hex, 0, f);
const tint = (hex: string, f: number) => mix(hex, 255, f);

/** The element and its mirror image across the vertical centre line. */
const pair = (el: ReactNode) => (
  <>
    {el}
    <g transform="matrix(-1 0 0 1 100 0)">{el}</g>
  </>
);

const curls = (list: number[][], fill: string) =>
  list.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={fill} />);
const CURLY_TOP = [
  [30, 32, 7],
  [33, 23, 8],
  [42, 17, 9],
  [52, 15, 9],
  [62, 18, 9],
  [69, 25, 8],
  [71, 34, 6],
];
const SLICK = "M28,40 Q27,16 50,16 Q73,16 72,40 Q68,25 50,24 Q32,25 28,40 Z";
const BUZZ = "M28,40 Q27,18 50,18 Q73,18 72,40 Q70,28 50,27 Q30,28 28,40 Z";

/** Per hair style: what goes behind the head, and what goes over it. */
function hair(style: number, h: string, l: Look): { back?: ReactNode; front?: ReactNode } {
  switch (style) {
    case 1:
      return { front: <path d={BUZZ} fill={h} opacity={0.9} /> };
    case 2:
      return { front: <path d="M26,44 Q22,13 50,13 Q78,13 74,44 Q73,31 66,26 Q54,31 40,25 Q31,31 26,44 Z" fill={h} /> };
    case 3:
      return {
        front: (
          <path
            d="M26,42 L23,25 L32,27 L32,12 L41,21 L46,8 L52,19 L59,8 L62,21 L70,12 L68,27 L77,25 L74,42 Q71,29 50,28 Q29,29 26,42 Z"
            fill={h}
          />
        ),
      };
    case 4:
      return {
        front: (
          <>
            <path d="M28,36 Q30,20 50,20 Q70,20 72,36 Q62,28 50,28 Q38,28 28,36 Z" fill={h} />
            {curls(CURLY_TOP, h)}
          </>
        ),
      };
    case 5:
      return {
        back: <circle cx={50} cy={34} r={33} fill={h} />,
        front: <path d="M28,38 Q29,22 50,22 Q71,22 72,38 Q62,30 50,30 Q38,30 28,38 Z" fill={h} />,
      };
    case 6:
      return {
        back: (
          <path
            d="M22,42 Q20,11 50,11 Q80,11 78,42 L80,88 L60,88 L62,56 L38,56 L40,88 L20,88 Z"
            fill={shade(h, 0.12)}
          />
        ),
        front: <path d="M27,44 Q25,13 50,13 Q75,13 73,44 Q71,27 58,24 Q47,32 30,33 Q28,38 27,44 Z" fill={h} />,
      };
    case 7:
      return {
        back: (
          <path
            d="M21,34 Q21,9 50,9 Q79,9 79,34 L79,64 Q72,68 66,64 L66,42 L34,42 L34,64 Q28,68 21,64 Z"
            fill={shade(h, 0.12)}
          />
        ),
        front: <path d="M27,40 Q25,12 50,12 Q75,12 73,40 L72,31 Q61,34 50,32 Q39,34 28,31 Z" fill={h} />,
      };
    case 8:
      return { back: <circle cx={50} cy={11} r={10} fill={shade(h, 0.08)} />, front: <path d={SLICK} fill={h} /> };
    case 9:
      return {
        back: <path d="M64,22 Q92,24 86,72 Q82,58 70,44 Z" fill={shade(h, 0.12)} />,
        front: <path d={SLICK} fill={h} />,
      };
    case 10:
      return {
        front: (
          <>
            <path d={BUZZ} fill={h} opacity={0.35} />
            <path d="M44,30 Q42,10 50,3 Q58,10 56,30 Q50,27 44,30 Z" fill={h} />
          </>
        ),
      };
    case 11:
      return {
        back: (
          <path
            d="M20,38 Q17,9 50,9 Q83,9 80,38 Q87,52 79,64 Q86,77 75,88 L25,88 Q14,77 21,64 Q13,52 20,38 Z"
            fill={shade(h, 0.12)}
          />
        ),
        front: <path d="M27,44 Q23,11 52,12 Q77,13 74,40 Q66,22 48,26 Q37,33 27,44 Z" fill={h} />,
      };
    case 12:
      return { front: <path d="M25,44 Q21,11 52,11 Q79,12 75,38 Q61,24 42,31 Q33,36 25,44 Z" fill={h} /> };
    case 13:
      return {
        back: curls(
          [
            [24, 30, 9],
            [76, 30, 9],
          ],
          shade(h, 0.08),
        ),
        front: <path d="M27,40 Q26,14 50,15 Q74,14 73,40 Q67,23 51,20 L49,20 Q33,23 27,40 Z" fill={h} />,
      };
    case 14: {
      // A beanie, in a colour of its own.
      const c = CLOTH[(l.outfitColor + 3) % CLOTH.length];
      return {
        front: (
          <>
            <path d="M24,38 Q24,7 50,7 Q76,7 76,38 Z" fill={c} />
            <path d="M23,33 L77,33 L77,41 Q50,38 23,41 Z" fill={shade(c, 0.2)} />
            <circle cx={50} cy={6} r={5} fill={tint(c, 0.4)} />
          </>
        ),
      };
    }
    case 15:
      return {
        back: curls(
          [
            [24, 40, 10],
            [22, 56, 10],
            [26, 70, 10],
            [76, 40, 10],
            [78, 56, 10],
            [74, 70, 10],
            [50, 14, 16],
            [32, 20, 11],
            [68, 20, 11],
          ],
          shade(h, 0.12),
        ),
        front: curls(CURLY_TOP, h),
      };
    default:
      return {};
  }
}

const dot = (x: number, r = 2.6) => <circle cx={x} cy={47} r={r} fill={INK} />;
const arc = (x: number) => (
  <path d={`M${x - 3.5},48 Q${x},44 ${x + 3.5},48`} stroke={INK} strokeWidth={2} fill="none" strokeLinecap="round" />
);
const eyeball = (r: number, pupil: number) => (
  <>
    <ellipse cx={41} cy={47} rx={r} ry={r * 0.92} fill="#fff" />
    <circle cx={41.4} cy={47.3} r={pupil} fill={INK} />
    <circle cx={42.2} cy={46.4} r={pupil * 0.35} fill="#fff" />
  </>
);

function eyes(style: number): ReactNode {
  switch (style) {
    case 1:
      return pair(eyeball(4.2, 2.2));
    case 2:
      return pair(arc(41));
    case 3:
      return pair(
        <>
          <path d="M38.5,46.5 A2.5,2.5 0 0 0 43.5,46.5 Z" fill={INK} />
          <path d="M37,46.5 L45,46.5" stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
        </>,
      );
    case 4:
      return (
        <>
          {dot(41)}
          {arc(59)}
        </>
      );
    case 5:
      return pair(eyeball(5, 2.8));
    case 6:
      return pair(
        <>
          {dot(41)}
          <path d="M38.6,45.2 L36.6,43.4 M40,44.5 L39.4,42.3" stroke={INK} strokeWidth={1.2} strokeLinecap="round" />
        </>,
      );
    case 7:
      return pair(
        <>
          <path d="M36.5,47 Q41,42.5 45.5,47 Q41,51 36.5,47 Z" fill="#fff" />
          <circle cx={41} cy={47} r={2} fill={INK} />
        </>,
      );
    default:
      return pair(dot(41));
  }
}

function brows(style: number, c: string): ReactNode {
  const d = ["", "M37,41 L45,41", "M37,42 Q41,38 45,41", "M37,39 L45,42", "M37,42 L45,39", "M37,41 Q41,39.5 45,41"][
    style
  ];
  if (!d) return null;
  return pair(<path d={d} stroke={c} strokeWidth={style === 5 ? 3.6 : 2.2} fill="none" strokeLinecap="round" />);
}

function mouth(style: number): ReactNode {
  const line = (d: string) => <path d={d} stroke={INK} strokeWidth={2} fill="none" strokeLinecap="round" />;
  switch (style) {
    case 1:
      return (
        <>
          <path d="M42,59 Q50,59.5 58,59 Q57,67 50,67 Q43,67 42,59 Z" fill={MOUTH} />
          <path d="M43,59.3 L57,59.3 L56.6,61.6 L43.4,61.6 Z" fill="#fff" />
        </>
      );
    case 2:
      return line("M45,61.5 L55,61.5");
    case 3:
      return <ellipse cx={50} cy={62} rx={2.6} ry={3.2} fill={MOUTH} />;
    case 4:
      return line("M44.5,61.5 Q51,63.5 56,59");
    case 5:
      return (
        <>
          <path d="M44,59.5 L56,59.5 Q55.5,65.5 50,65.5 Q44.5,65.5 44,59.5 Z" fill={MOUTH} />
          <ellipse cx={51.5} cy={64.5} rx={3} ry={2.6} fill="#e06d7a" />
        </>
      );
    case 6:
      return (
        <>
          <path d="M41,58 L59,58 Q58,70 50,70 Q42,70 41,58 Z" fill={MOUTH} />
          <path d="M42,58.2 L58,58.2 L57.7,60.4 L42.3,60.4 Z" fill="#fff" />
          <ellipse cx={50} cy={67.5} rx={5} ry={2.5} fill="#e06d7a" />
        </>
      );
    case 7:
      return line("M45.5,63 Q50,59.5 54.5,63");
    default:
      return line("M44,60 Q50,65.5 56,60");
  }
}

const MUSTACHE = "M42,58.5 Q46,55 50,57 Q54,55 58,58.5 Q54,59.5 50,58.6 Q46,59.5 42,58.5 Z";

function beard(style: number, h: string, skin: string): ReactNode {
  switch (style) {
    case 1:
      return (
        <path
          d="M29,52 Q30,73 50,74 Q70,73 71,52 Q66,66 50,66 Q34,66 29,52 Z M42,58 Q50,55 58,58 L58,59 Q50,57 42,59 Z"
          fill={shade(skin, 0.45)}
          opacity={0.3}
        />
      );
    case 2:
      return <path d={MUSTACHE} fill={h} />;
    case 3:
      return (
        <>
          <path
            d="M28,46 Q28,75 50,76 Q72,75 72,46 L69,46 Q68,66 58,66 Q54,64 50,64.5 Q46,64 42,66 Q32,66 31,46 Z"
            fill={h}
          />
          <path d={MUSTACHE} fill={h} />
        </>
      );
    case 4:
      return (
        <>
          <path d="M45,66 Q50,64.5 55,66 Q55,72 50,73 Q45,72 45,66 Z" fill={h} />
          <path d={MUSTACHE} fill={h} />
        </>
      );
    case 5:
      return (
        <path
          d="M40,56 Q38,60 42,60 Q46,56 50,58 Q54,56 58,60 Q62,60 60,56 Q58,58.5 56,57 Q53,55 50,56.5 Q47,55 44,57 Q42,58.5 40,56 Z"
          fill={h}
        />
      );
    default:
      return null;
  }
}

function glasses(style: number): ReactNode {
  const frame = { stroke: FRAME, strokeWidth: 1.8, strokeLinecap: "round" as const };
  const temple = <path d="M35,46 L29,45" {...frame} />;
  switch (style) {
    case 1:
      return (
        <>
          {pair(
            <>
              <circle cx={41} cy={47} r={5.5} fill="#fff" fillOpacity={0.15} {...frame} />
              {temple}
            </>,
          )}
          <path d="M46.5,46.5 Q50,44.5 53.5,46.5" fill="none" {...frame} />
        </>
      );
    case 2:
      return (
        <>
          {pair(
            <>
              <rect x={34.5} y={42.5} width={13} height={9.5} rx={2} fill="#fff" fillOpacity={0.15} {...frame} />
              {temple}
            </>,
          )}
          <path d="M47.5,46 L52.5,46" {...frame} />
        </>
      );
    case 3:
      return (
        <>
          {pair(
            <>
              <path d="M34,43 L47,43 Q47,52 41,52 Q34,52 34,43 Z" fill="#1b1b22" />
              <path d="M36,45 L39,45" stroke="#fff" strokeOpacity={0.5} strokeWidth={1.2} strokeLinecap="round" />
              {temple}
            </>,
          )}
          <path d="M47,44 L53,44" {...frame} />
        </>
      );
    case 4:
      return (
        <>
          {pair(
            <>
              <path
                d="M33,41.5 Q40,42 47,43.5 Q47,51 41,51 Q35,51 33,41.5 Z"
                fill="#fff"
                fillOpacity={0.15}
                {...frame}
                strokeWidth={2}
              />
              {temple}
            </>,
          )}
          <path d="M47,45 L53,45" {...frame} />
        </>
      );
    case 5:
      return (
        <>
          {pair(
            <>
              <path d="M35,44 Q41,42 47,44" fill="none" {...frame} strokeWidth={2.6} />
              <path d="M35,44 Q35,51 41,51 Q47,51 47,44" fill="none" {...frame} strokeWidth={0.9} opacity={0.6} />
              {temple}
            </>,
          )}
          <path d="M47,44 L53,44" {...frame} />
        </>
      );
    case 6:
      return (
        <>
          <circle cx={59} cy={47} r={6} fill="#fff" fillOpacity={0.15} stroke={GOLD} strokeWidth={1.8} />
          <path d="M65,48 Q70,58 66,70" stroke={GOLD} strokeWidth={0.9} fill="none" />
        </>
      );
    default:
      return null;
  }
}

function outfit(style: number, c: string, skin: string, scarf: string): { under?: ReactNode; over: ReactNode } {
  const neck = shade(skin, 0.12);
  const base = <path d="M12,100 C14,84 26,79 38,78 L62,78 C74,79 86,84 88,100 Z" fill={c} />;
  const crew = <path d="M42,78 Q50,85 58,78 Z" fill={neck} />;
  const vee = <path d="M43,78 L50,90 L57,78 Z" fill={neck} />;
  switch (style) {
    case 1:
      return {
        over: (
          <>
            {base}
            {vee}
          </>
        ),
      };
    case 2:
      return {
        under: <path d="M30,82 Q30,66 50,66 Q70,66 70,82 Z" fill={shade(c, 0.25)} />,
        over: (
          <>
            {base}
            {crew}
            <path d="M46,83 L46,94 M54,83 L54,94" stroke={tint(c, 0.6)} strokeWidth={1.5} strokeLinecap="round" />
          </>
        ),
      };
    case 3:
      return {
        over: (
          <>
            {base}
            {vee}
            <path d="M42,77 L50,87 L44,91 L38,80 Z M58,77 L50,87 L56,91 L62,80 Z" fill={tint(c, 0.35)} />
            <circle cx={50} cy={93} r={1.1} fill={shade(c, 0.35)} />
          </>
        ),
      };
    case 4:
      return {
        over: (
          <>
            {base}
            <path d="M42,76 Q50,80 58,76 L58,81 Q50,85 42,81 Z" fill={shade(c, 0.2)} />
            <path d="M50,83 L50,100" stroke={shade(c, 0.25)} strokeWidth={1.2} />
            {[87, 92, 97].map((y) => (
              <circle key={y} cx={51.8} cy={y} r={0.9} fill={GOLD} />
            ))}
          </>
        ),
      };
    case 5:
      return {
        over: (
          <>
            {base}
            <path d="M42,78 L50,100 L58,78 Z" fill="#f4f1ea" />
            <path d="M42,78 L50,90 L57,78 Z" fill={neck} />
            {pair(<path d="M41,78 L35,85 L41,88 L50,100 L44,80 Z" fill={shade(c, 0.22)} />)}
          </>
        ),
      };
    case 6:
      return {
        over: (
          <>
            {base}
            <path d="M41,64 L59,64 L60,80 Q50,83 40,80 Z" fill={shade(c, 0.12)} />
            <path
              d="M41,69 Q50,71 59,69 M40.5,74 Q50,76 59.5,74"
              stroke={shade(c, 0.3)}
              strokeWidth={0.8}
              fill="none"
            />
          </>
        ),
      };
    case 7:
      return {
        over: (
          <>
            {base}
            {crew}
            <path d="M38,76 Q50,84 62,76 L63,82 Q50,90 37,82 Z" fill={scarf} />
            <path d="M54,83 L60,83 L58,97 L52,97 Z" fill={shade(scarf, 0.12)} />
          </>
        ),
      };
    default:
      return {
        over: (
          <>
            {base}
            {crew}
          </>
        ),
      };
  }
}

function extra(style: number, skin: string, l: Look): ReactNode {
  switch (style) {
    case 1:
      return pair(<ellipse cx={37.5} cy={56.5} rx={4} ry={2.4} fill="#ff6f86" opacity={0.35} />);
    case 2:
      return pair(
        [
          [39, 53],
          [42, 55],
          [38, 56.5],
          [41.5, 51.8],
        ].map(([x, y]) => <circle key={`${x},${y}`} cx={x} cy={y} r={0.65} fill={shade(skin, 0.4)} />),
      );
    case 3:
      return <circle cx={50} cy={41} r={1.6} fill="#c8233a" />;
    case 4:
      return pair(<circle cx={EAR_X[l.face]} cy={57} r={2.6} stroke={GOLD} strokeWidth={1.2} fill="none" />);
    case 5:
      return <path d="M53.6,54.4 A1.6,1.6 0 1 1 52.4,56.4" stroke={GOLD} strokeWidth={1} fill="none" />;
    case 6:
      return <circle cx={60.5} cy={60} r={0.9} fill={shade(skin, 0.55)} />;
    default:
      return null;
  }
}

/** Over-the-ear headphones go over everything, hair included. */
function headphones(l: Look): ReactNode {
  if (l.extra !== 7) return null;
  const accent = CLOTH[(l.outfitColor + 5) % CLOTH.length];
  return (
    <>
      <path d="M24,48 Q24,6 50,6 Q76,6 76,48" stroke="#2c2c34" strokeWidth={4} fill="none" />
      {pair(
        <>
          <rect x={20} y={41} width={9} height={17} rx={3.5} fill="#3a3a46" />
          <rect x={20} y={46} width={3} height={7} rx={1.5} fill={accent} />
        </>,
      )}
    </>
  );
}

function Drawing({ look: l, viewBox }: { look: Look; viewBox: string }) {
  const skin = SKIN[l.skin];
  const h = HAIR[l.hairColor];
  const c = CLOTH[l.outfitColor];
  const hr = hair(l.hair, h, l);
  const fit = outfit(l.outfit, c, skin, CLOTH[(l.outfitColor + 4) % CLOTH.length]);
  return (
    <svg viewBox={viewBox} aria-hidden="true">
      {hr.back}
      {fit.under}
      <rect x={43} y={62} width={14} height={22} fill={shade(skin, 0.12)} />
      {fit.over}
      {pair(<circle cx={EAR_X[l.face]} cy={50} r={5} fill={shade(skin, 0.06)} />)}
      <path d={FACES[l.face]} fill={skin} />
      {extra(l.extra, skin, l)}
      {beard(l.beard, h, skin)}
      <path
        d="M50,49 Q47,55 50,56 Q52,56 53,55"
        stroke={shade(skin, 0.3)}
        strokeWidth={1.6}
        fill="none"
        strokeLinecap="round"
      />
      {mouth(l.mouth)}
      {eyes(l.eyes)}
      {brows(l.brows, shade(h, 0.15))}
      {hr.front}
      {glasses(l.glasses)}
      {headphones(l)}
    </svg>
  );
}

/**
 * A seat's picture in its round frame. Empty `code`: the look comes from `name`. `zoom` shows just
 * the face, for choosing small features.
 */
export function Avatar(props: { code: string; name: string; className?: string; title?: string; zoom?: boolean }) {
  const { code, name, className = "", title, zoom = false } = props;
  const look = decode(code || lookFromName(name));
  const [top, bottom] = BG[look.bg];
  return (
    <span
      className={`avatar ${className}`}
      title={title}
      style={{ background: `linear-gradient(170deg, ${top}, ${bottom})` }}
    >
      <Drawing look={look} viewBox={zoom ? "25 28 50 50" : "0 0 100 100"} />
    </span>
  );
}

/** One row of choices for a part: a strip of previews and a dice that rolls just that part. */
function PartRow({
  part,
  look,
  set,
}: {
  part: (typeof PARTS)[number];
  look: Look;
  set: (key: PartKey, value: number) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const value = look[part.key];
  // A roll can land off screen: scroll the strip (only sideways; the sheet stays put) to the pick.
  useEffect(() => {
    const pick = strip.current?.children[value];
    if (!strip.current || !pick) return;
    const box = strip.current.getBoundingClientRect();
    const at = pick.getBoundingClientRect();
    if (at.left < box.left || at.right > box.right) {
      strip.current.scrollBy({ left: at.left - box.left - (box.width - at.width) / 2, behavior: "smooth" });
    }
  }, [value]);
  return (
    <div className="look-row">
      <div className="look-row-head">
        <b>{part.label}</b>
        <button
          type="button"
          className="icon-btn"
          onClick={() => set(part.key, randomChoice(part.key, value))}
          aria-label={`Random ${part.label.toLowerCase()}`}
          title="Random"
        >
          🎲
        </button>
      </div>
      <div className="look-strip" ref={strip} role="radiogroup" aria-label={part.label}>
        {Array.from({ length: part.count }, (_, i) => {
          const on = i === value;
          const preview = { ...look, [part.key]: i };
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${part.label} ${i + 1}`}
              className={`look-pick ${on ? "on" : ""}`}
              onClick={() => set(part.key, i)}
            >
              {"swatch" in part ? (
                <span className="look-swatch" style={{ background: part.swatch(i) }} />
              ) : (
                <Avatar code={encode(preview)} name="" zoom={"zoom" in part} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Your picture as a button; it opens the editor in a sheet. */
export function LookButton({
  code,
  name,
  onChange,
  className = "",
}: {
  code: string;
  name: string;
  onChange: (code: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="avatar-btn look-btn"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="Change your picture"
        title="Change your picture"
      >
        <Avatar code={code} name={name} className={className} />
        <span className="look-edit" aria-hidden="true">
          ✎
        </span>
      </button>
      {open && (
        <Sheet title="Your picture" onClose={() => setOpen(false)}>
          <AvatarEditor code={code} name={name} onChange={onChange} />
          <button type="button" className="btn primary" onClick={() => setOpen(false)}>
            Done
          </button>
        </Sheet>
      )}
    </>
  );
}

/** Builds a look part by part. Every change goes straight to `onChange`. */
export function AvatarEditor({
  code,
  name,
  onChange,
}: {
  code: string;
  name: string;
  onChange: (code: string) => void;
}) {
  const look = decode(code || lookFromName(name));
  const set = (key: PartKey, value: number) => onChange(encode({ ...look, [key]: value }));
  return (
    <div className="look-editor">
      <div className="look-top">
        <Avatar code={encode(look)} name={name} className="huge" />
        <button type="button" className="btn" onClick={() => onChange(randomLook())}>
          🎲 Shuffle all
        </button>
      </div>
      {PARTS.map((p) => (
        <PartRow key={p.key} part={p} look={look} set={set} />
      ))}
    </div>
  );
}
