// Screenshots of the room-management screens, as the admin: the lobby (theme picker, room
// settings, Close room), the room menu in a game, and the game over after "End game now".
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
for (let i = 0; i < 3; i++) send({ type: "bot" });
await until((s) => s.room.seats.length === 4);

/** One shot of the room page as the admin's browser. */
const shot = (name, then) => {
  const file = path.join(out, `${name}.png`);
  const setup = `localStorage.setItem("aa:token:${code}", ${JSON.stringify(token)})`;
  const cmd = ["scripts/page-shot.mjs", file, `${BASE}/#${code}`, "--setup", setup, "--full"];
  if (then) cmd.push("--then", then);
  if (phone) cmd.push("--phone");
  execFileSync("node", cmd, { stdio: "inherit" });
};
const click = (text) =>
  `[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(text)})?.click()`;

shot("lobby");
send({ type: "start" });
await until((s) => s.game);
await sleep(4000);
shot("menu", `document.querySelector("[aria-label='Room and rules']")?.click()`);
send({ type: "end" });
await until((s) => s.game?.over);
shot("over");
send({ type: "lobby" });
await until((s) => !s.game);
shot("lobby-after", click("Close room"));
sock.close();
