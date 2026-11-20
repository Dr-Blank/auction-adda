// Records `state` messages from real Pahunch games, for the render tests in test/render.test.tsx.
//
//   PORT=8799 DATA_DIR= CREATE_LIMIT=1000 npm start &
//   node scripts/capture-pahunch.ts [ws://localhost:8799/ws]
//
// Four socket players in a Society Committee room play random legal moves
// (scripts/pahunch-bot.ts); a fifth tab watches. The script keeps the first state seat 0 receives
// at each moment the render tests need (lobby, your move, their move, a vote as voter and as the
// climber, a bonus move, the final result, a game the admin ended early, a spectator) and writes them to
// test/fixtures/pahunch/. The clock fields are fixed, as in scripts/capture-states.ts.

import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import type { ClientMsg, PahunchView, ServerMsg } from "../src/generated/index.ts";
import { rng } from "../src/rng.ts";
import { choosePahunch } from "./pahunch-bot.ts";

type State = Omit<Extract<ServerMsg, { type: "state" }>, "game"> & { game: PahunchView | null };

const url = process.argv[2] ?? "ws://localhost:8799/ws";
const out = path.resolve(import.meta.dirname, "../test/fixtures/pahunch");
const random = rng(20261121);
const PLAYERS = 4;

function client(name: string) {
  const ws = new WebSocket(url);
  let latest: State | undefined;
  const listeners: ((s: State) => void)[] = [];
  const open = new Promise<void>((resolve) => ws.once("open", () => resolve()));
  ws.on("message", (data: Buffer) => {
    const m = JSON.parse(data.toString()) as ServerMsg;
    if (m.type === "error") console.error(`${name}: ${m.message}`);
    if (m.type !== "state") return;
    const s = m as State;
    latest = s;
    for (const l of listeners) l(s);
  });
  return {
    open,
    send: (m: ClientMsg) => ws.send(JSON.stringify(m)),
    latest: () => latest,
    onState: (l: (s: State) => void) => listeners.push(l),
    close: () => ws.close(),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 600; i++) {
    if (check()) return;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

function steady(s: State): State {
  const room = {
    ...s.room,
    seats: s.room.seats.map((seat) => ({ ...seat, awayMs: seat.connected ? null : 45_000 })),
    bidMsLeft: s.room.bidMsLeft === null ? null : 12_000,
    bidMsWindow: s.room.bidMsWindow === null ? null : 30_000,
  };
  return { ...s, room };
}

const saved = new Map<string, State>();
function keep(key: string, s: State | undefined): void {
  if (s && !saved.has(key)) saved.set(key, steady(structuredClone(s)));
}

const players = Array.from({ length: PLAYERS }, (_, i) => client(`P${i}`));
const watcher = client("watcher");
await Promise.all([...players, watcher].map((c) => c.open));

players[0].send({
  type: "create",
  theme: "society-committee",
  name: "Asha",
  avatar: "3k9a1c0b2d4e5f6g",
  prefs: { bidTimerS: 30, bidExtendS: 10, genres: [] },
});
await until(() => !!players[0].latest(), "the room");
const code = players[0].latest()!.room.code;
const names = ["Asha", "Bilal", "Chitra", "Dev"];
for (let i = 1; i < PLAYERS; i++) {
  players[i].send({ type: "join", room: code, name: names[i], avatar: `${i}a${i}b${i}c${i}d${i}e${i}f${i}g${i}h` });
  await until(() => players[i].latest()?.you === i, `seat ${i}`);
}
watcher.send({ type: "join", room: code, viewer: "Esha" });
await until(() => watcher.latest() !== undefined, "the watcher");
keep("lobby-admin", players[0].latest());

let phase: "first" | "second" = "first";
players[0].onState((s) => {
  const g = s.game;
  if (!g) return;
  if (phase === "second") {
    if (g.over) keep("ended-early", s);
    return;
  }
  if (g.over) return keep("over", s);
  // Wait until the board fills a little, so the pages show climbers in rooms.
  if (g.logStart + g.log.length < 12) return;
  // Seats are drawn at the start: seat 0's player sits wherever `you` says.
  const me = g.you ?? -1;
  if (g.vote) keep(g.turn === me ? "vote-climber" : g.pending.includes(me) ? "vote-voter" : "vote-watching", s);
  else if (g.turn === me && (g.bonuses.block > 0 || g.bonuses.nudge > 0)) keep("your-bonus", s);
  else keep(g.turn === me ? "your-move" : "their-move", s);
});
watcher.onState((s) => {
  if (s.game?.vote) keep("spectator", s);
});

const play = async (until_: () => boolean) => {
  for (let step = 0; step < 20000 && !until_(); step++) {
    let moved = false;
    for (const p of players) {
      const v = p.latest()?.game;
      const action = v && choosePahunch(v, random);
      if (action) {
        p.send({ type: "action", action });
        moved = true;
      }
    }
    await sleep(moved ? 12 : 25);
  }
};

players[0].send({ type: "start" });
await until(() => !!players[0].latest()?.game, "the start");
await play(() => !!players[0].latest()?.game?.over);
await until(() => !!players[0].latest()?.game?.over, "the end");
await sleep(100);

// A second game the admin ends early: no winner, no podium.
phase = "second";
players[0].send({ type: "rematch" });
await until(() => players[0].latest()?.game?.over === false, "the rematch");
await play(() => (players[0].latest()?.game?.logStart ?? 0) + (players[0].latest()?.game?.log.length ?? 0) > 20);
players[0].send({ type: "end" });
await until(() => saved.has("ended-early"), "the early end");

fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) fs.rmSync(path.join(out, f));
for (const [key, s] of [...saved].sort(([a], [b]) => a.localeCompare(b))) {
  fs.writeFileSync(path.join(out, `${key}.json`), `${JSON.stringify(s, null, 2)}\n`);
}
console.log(
  `Room ${code}: wrote ${saved.size} states to ${path.relative(process.cwd(), out)}: ${[...saved.keys()].join(", ")}`,
);
for (const c of [...players, watcher]) c.close();
