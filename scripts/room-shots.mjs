// Screenshots of the room-management screens, as the admin: the lobby (theme picker, room
// settings, Close room), the room menu in a game, a game a player froze (as the admin and as
// them), a freed bot seat (and the same game as the
// player who left it, and as a watcher), and the game over after "End game now".
// Each step drives the room over the WebSocket, then takes one shot with page-shot.mjs.
//
//   npm run build && PORT=8799 DATA_DIR= CREATE_LIMIT=1000 npm start &
//   node scripts/room-shots.mjs ./shots/room [--phone]
//
// Needs `chromium` on the PATH and Node 24 (global WebSocket). Run from the project root.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const phone = args.includes("--phone");
const [out = "./shots/room"] = args.filter((a) => !a.startsWith("--"));
const port = process.env.PORT ?? "8799";
const theme = process.env.THEME ?? "box-office";
const BASE = `http://localhost:${port}`;
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sock = new WebSocket(`ws://localhost:${port}/ws`);
/** The latest `state`, and waiters for a condition on it. */
let state;
const waiters = [];
sock.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === "error") console.log("server:", m.message);
  if (m.type !== "state") return;
  state = m;
  for (const w of [...waiters]) if (w.test(m)) waiters.splice(waiters.indexOf(w), 1) && w.done(m);
};
const until = (test) => (state && test(state) ? state : new Promise((done) => waiters.push({ test, done })));
const send = (msg) => sock.send(JSON.stringify(msg));
await new Promise((r) => {
  sock.onopen = r;
});

const joined = new Promise((resolve) => {
  const prev = sock.onmessage;
  sock.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "joined") resolve(m);
    prev(ev);
  };
});
send({ type: "create", theme, name: "Ana" });
const { room: code, token } = await joined;
console.log("room", code);
for (let i = 0; i < 2; i++) send({ type: "bot" });
await until((s) => s.room.seats.length === 3);

// A second player, who leaves mid-game.
const ben = new WebSocket(`ws://localhost:${port}/ws`);
const benToken = new Promise((resolve) => {
  ben.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "joined" && m.token) resolve(m.token);
  };
});
ben.onopen = () => ben.send(JSON.stringify({ type: "join", room: code, name: "Ben" }));
const benKey = await benToken;
await until((s) => s.room.seats.length === 4);

/** One shot of the room page as the admin's browser (`as`: another seat token, or null for a browser without one). */
const shot = (name, then, as = token) => {
  const file = path.join(out, `${name}.png`);
  const setup = as ? `localStorage.setItem("aa:token:${code}", ${JSON.stringify(as)})` : "localStorage.clear()";
  const cmd = ["scripts/page-shot.mjs", file, `${BASE}/#${code}`, "--setup", setup, "--full"];
  if (then) cmd.push("--then", then);
  if (phone) cmd.push("--phone");
  execFileSync("node", cmd, { stdio: "inherit" });
};
const click = (text) =>
  `[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(text)})?.click()`;

// Someone watching, for the watcher list.
const watcher = new WebSocket(`ws://localhost:${port}/ws`);
watcher.onopen = () => watcher.send(JSON.stringify({ type: "join", room: code, viewer: "Wanda" }));
await until((s) => s.room.watchers.length > 0);

shot("lobby");
send({ type: "settings", settings: { locked: true, freeze: "anyone", rename: true } });
await until((s) => s.room.settings.locked);
const openAdvanced = `document.querySelector("details.advanced").open = true`;
shot("lobby-settings", openAdvanced);
shot("lobby-locked-viewer", openAdvanced, null);
shot("lobby-rename", `document.querySelector(".rename-btn")?.click()`);
send({ type: "settings", settings: { locked: false, freeze: "anyone", rename: true } });
send({ type: "start" });
await until((s) => s.game);
await sleep(4000);
shot("menu", `document.querySelector("[aria-label='Room and rules']")?.click()`);
// Ben freezes the game: the admin and Ben may unfreeze it.
ben.send(JSON.stringify({ type: "freeze", on: true }));
await until((s) => s.room.frozenBy === 3);
shot("game-frozen");
shot("game-frozen-ben", null, benKey);
send({ type: "freeze", on: false });
await until((s) => s.room.frozenBy === null);
// Ben leaves to a bot; the admin frees bot seat 1 for whoever opens the link.
ben.send(JSON.stringify({ type: "leave" }));
await until((s) => s.room.seats[3].bot);
send({ type: "release", seat: 1 });
await until((s) => s.room.seats[1].open);
shot("game-freed", `document.querySelector("[data-seat='1'] .avatar-btn")?.click()`);
shot("game-left", null, benKey);
shot("game-viewer", null, null);
send({ type: "end" });
await until((s) => s.game?.over);
shot("over");
send({ type: "lobby" });
await until((s) => !s.game);
shot("lobby-after", click("Close room"));

// The admin drops: after 20 s every player is offered the role.
const cleo = new WebSocket(`ws://localhost:${port}/ws`);
const cleoToken = new Promise((resolve) => {
  cleo.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "joined" && m.token) resolve(m.token);
  };
});
cleo.onopen = () => cleo.send(JSON.stringify({ type: "join", room: code, name: "Cleo" }));
const cleoKey = await cleoToken;
sock.close();
await sleep(21_000);
shot("lobby-admin-away", null, cleoKey);
watcher.close();
ben.close();
cleo.close();
