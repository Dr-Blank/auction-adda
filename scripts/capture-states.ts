// Records `state` messages from one real game, for the render tests in test/render.test.tsx.
//
//   PORT=8799 DATA_DIR= CREATE_LIMIT=1000 npm start &
//   node scripts/capture-states.ts [ws://localhost:8799/ws]
//
// Four socket players play random legal moves (scripts/bot.ts) with no thinking time; a fifth
// tab watches. The script keeps the first state seat 0 receives at each moment the render tests
// need (lobby, your move, every auction kind from both sides, a round's results, the final
// result, a spectator) and writes them to test/fixtures/states/. The clock fields are set to
// fixed values, so a rendered page does not depend on when it was captured.
//
// Rerun it after a protocol change, then review the snapshot diff of the render tests.

import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import type { ClientMsg, ServerMsg } from "../src/generated/index.ts";
import { rng } from "../src/rng.ts";
import { chooseAction } from "./bot.ts";

type State = Extract<ServerMsg, { type: "state" }>;

const url = process.argv[2] ?? "ws://localhost:8799/ws";
const out = path.resolve(import.meta.dirname, "../test/fixtures/states");
const random = rng(20261120);
const PLAYERS = 4;

/** One socket client; resolves `joined` once it has a seat (or watches). */
function client(name: string) {
  const ws = new WebSocket(url);
  const got: State[] = [];
  let latest: State | undefined;
  const listeners: ((s: State) => void)[] = [];
  const open = new Promise<void>((resolve) => ws.once("open", () => resolve()));
  ws.on("message", (data: Buffer) => {
    const m = JSON.parse(data.toString()) as ServerMsg;
    if (m.type === "error") console.error(`${name}: ${m.message}`);
    if (m.type !== "state") return;
    latest = m;
    got.push(m);
    for (const l of listeners) l(m);
  });
  return {
    name,
    open,
    send: (m: ClientMsg) => ws.send(JSON.stringify(m)),
    latest: () => latest,
    onState: (l: (s: State) => void) => listeners.push(l),
    close: () => ws.close(),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Fixed clock fields: a captured state renders the same whenever the test runs. */
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
  theme: "box-office",
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
players[1].send({ type: "ready", on: true });
await until(() => players[0].latest()?.room.seats[1].ready === true, "ready");
keep("lobby-admin", players[0].latest());
keep("lobby-player", players[2].latest());

// From here every state seat 0 sees is a candidate.
players[0].onState((s) => {
  const g = s.game;
  if (!g) return;
  if (g.over) return keep("over", s);
  if (g.summaries.length === 1 && !g.auction) keep("after-round-1", s);
  const a = g.auction;
  if (!a) {
    keep(g.turn === 0 ? "your-play" : "their-play", s);
    return;
  }
  const mine = a.auctioneer === 0 ? "selling" : "buying";
  if (a.kind === "open") keep(`open-${mine}${a.highBidder === null ? "" : "-bid"}`, s);
  else if (a.kind === "fixed") keep(`fixed-${mine}${a.price === null ? "" : "-priced"}`, s);
  else keep(`${a.kind}-${mine}`, s);
});
watcher.onState((s) => {
  if (s.game?.auction) keep("spectator", s);
});

players[0].send({ type: "start" });
await until(() => !!players[0].latest()?.game, "the start");

// Everyone moves at random until the game ends.
for (let step = 0; step < 5000 && !players[0].latest()?.game?.over; step++) {
  let moved = false;
  for (const p of players) {
    const v = p.latest()?.game;
    const action = v && chooseAction(v, random);
    if (action) {
      p.send({ type: "action", action });
      moved = true;
    }
  }
  await sleep(moved ? 15 : 30);
}
await until(() => !!players[0].latest()?.game?.over, "the end");
await sleep(100);

fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) fs.rmSync(path.join(out, f));
for (const [key, s] of [...saved].sort(([a], [b]) => a.localeCompare(b))) {
  fs.writeFileSync(path.join(out, `${key}.json`), `${JSON.stringify(s, null, 2)}\n`);
}
console.log(
  `Room ${code}: wrote ${saved.size} states to ${path.relative(process.cwd(), out)}: ${[...saved.keys()].join(", ")}`,
);
for (const c of [...players, watcher]) c.close();
