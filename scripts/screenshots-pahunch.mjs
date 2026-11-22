// Plays one seat of a Society Committee (Pahunch) room in headless Chromium against three server
// bots, playing by tapping the board (a glowing room or Daddu, then a button in the bar). Saves
// screenshots of its main moments (your move, a picked room, Daddu picked, a tip, all moves, a vote
// as voter and as climber, a board tap explained, the log, the room menu, the gift sheet, the end)
// and checks on every tick:
//
//   - the page never scrolls sideways;
//   - the board is on screen and every room of it is drawn;
//   - on a phone, the action bar is on screen while you owe a move, and its buttons are at least
//     40 px tall;
//   - every turn of this seat can be played by tapping the board;
//   - a tap on the board while others move opens a sheet;
//   - no script errors on the page.
//
// After `seconds` the admin (this seat) ends the game early, so the no-winner end is seen too.
// Then, on Home, the admin closes the room with its 🗑 and checks it leaves the list. The token
// swap and carry picks (`swap-pick`, `carry-pick`) need a bot to lend that favour: the run asks
// for favours until it gets them, and says "not reached" if it never does. Exits 1 if any check
// failed.
//
//   npm run build && PORT=8799 DATA_DIR= CREATE_LIMIT=1000 npm start &
//   node scripts/screenshots-pahunch.mjs ./shots/pahunch [seconds] [phone]
//
// Needs `chromium` on the PATH and Node 24 (global WebSocket). Run from the project root.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [out = "./shots/pahunch", secs = "90", mode = "desktop"] = process.argv.slice(2);
const phone = mode === "phone";
const port = process.env.PORT ?? "8799";
const BASE = `http://localhost:${port}`;
const WS = `ws://localhost:${port}/ws`;
const DEBUG_PORT = 9334;
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const fail = (msg) => {
  if (failures.includes(msg)) return;
  failures.push(msg);
  console.log("FAIL", msg);
};

// ---- a room with three server bots (SEATS − 1); this seat is the admin ----
const sock = new WebSocket(WS);
let settings;
const { code, token } = await new Promise((resolve) => {
  // The vote clock is off by default; on here, so the vote shots show its ring.
  const prefs = { bidTimerS: 30, bidExtendS: 10 };
  sock.onopen = () => sock.send(JSON.stringify({ type: "create", theme: "society-committee", name: "tp", prefs }));
  sock.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "state") settings = m.room.settings;
    if (m.type === "joined") resolve({ code: m.room, token: m.token });
  };
});
console.log("room", code);
// FACES=1: the admin turns on "Avatars on the board".
if (process.env.FACES === "1") {
  for (let i = 0; i < 20 && !settings; i++) await sleep(50);
  sock.send(
    JSON.stringify({
      type: "settings",
      settings: { ...settings, gameOptions: { ...settings.gameOptions, avatarsOnBoard: true } },
    }),
  );
  await sleep(100);
}
// SEATS=6 or 7 plays the other side of the board.
for (let i = 0; i < Number(process.env.SEATS ?? 4) - 1; i++) {
  sock.send(JSON.stringify({ type: "bot" }));
  await sleep(100);
}
sock.send(JSON.stringify({ type: "start" }));
await sleep(300);
sock.close();

// ---- browser over the DevTools protocol ----
const profile = fs.mkdtempSync(path.join(out, "profile-"));
const chrome = spawn(
  "chromium",
  [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--window-size=1300,900",
    "--no-first-run",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
let ver;
for (let i = 0; i < 50 && !ver; i++) {
  await sleep(200);
  ver = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
    .then((r) => r.json())
    .catch(() => null);
}
if (!ver) throw new Error("chromium did not start");
const cdp = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => (cdp.onopen = r));
let id = 0;
const waiting = new Map();
cdp.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) {
    waiting.get(m.id)(m);
    waiting.delete(m.id);
  }
  if (m.method === "Runtime.exceptionThrown")
    fail(`page error: ${JSON.stringify(m.params.exceptionDetails).slice(0, 400)}`);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
    fail(`console error: ${JSON.stringify(m.params.args).slice(0, 300)}`);
};
const call = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    const i = ++id;
    waiting.set(i, resolve);
    cdp.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
const {
  result: { targetId },
} = await call("Target.createTarget", { url: "about:blank" });
const {
  result: { sessionId },
} = await call("Target.attachToTarget", { targetId, flatten: true });
const s = (method, params) => call(method, params, sessionId);
await s("Runtime.enable");
await s("Page.enable");
const evaluate = async (expr) =>
  (await s("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const taken = new Set();
const shot = async (name) => {
  if (taken.has(name)) return;
  taken.add(name);
  // Not beyond the viewport: that capture re-renders the page and catches a sheet mid fade-in.
  const r = await s("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(r.result.data, "base64"));
  console.log("shot", name);
};
await s(
  "Emulation.setDeviceMetricsOverride",
  phone
    ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
    : { width: 1300, height: 900, deviceScaleFactor: 1, mobile: false },
);
if (phone) await s("Emulation.setTouchEmulationEnabled", { enabled: true });
await s("Page.navigate", { url: `${BASE}/` });
await sleep(800);
await evaluate(`localStorage.setItem('aa:token:${code}', '${token}'); localStorage.setItem('aa:mute','1')`);
await s("Page.navigate", { url: `${BASE}/#${code}` });
await sleep(1500);

// ---- checks ----
const check = async (where) => {
  const r = await evaluate(`(() => {
    const d = document.documentElement;
    const board = document.querySelector('.ph-board');
    const b = board?.getBoundingClientRect();
    const bar = document.querySelector('.action-bar');
    const a = bar?.getBoundingClientRect();
    const owing = !!document.querySelector('.stage.owing');
    const small = bar ? [...bar.querySelectorAll('.btn, select, button')].filter((x) => x.getClientRects().length && x.getBoundingClientRect().height < 40).map((x) => (x.className || x.tagName) + ' (' + Math.round(x.getBoundingClientRect().height) + 'px)').join(', ') : '';
    return {
      // clientWidth leaves out a scrollbar; innerWidth would hide an overflow of its width.
      wide: Math.max(d.scrollWidth, ...[...document.querySelectorAll('.table > *')].map((e) => e.getBoundingClientRect().right)) - d.clientWidth,
      table: !!document.querySelector('.ph-table'),
      over: !!document.querySelector('.gameover, .ph-ended'),
      rooms: document.querySelectorAll('.ph-room').length,
      boardW: b ? b.width : 0,
      owing, bar: !!bar, barOn: a ? a.top >= 0 && a.bottom <= innerHeight + 1 : false, small,
    };
  })()`);
  if (!r?.table) return r;
  if (r.wide > 1) fail(`${where}: page scrolls sideways by ${r.wide}px`);
  // The final board stays at the end, so these hold then too.
  if (r.rooms < 2) fail(`${where}: the board shows ${r.rooms} rooms`);
  if (r.boardW < 200) fail(`${where}: the board is ${r.boardW}px wide`);
  if (phone && r.owing && r.bar && !r.barOn) fail(`${where}: the action bar is off screen while you owe a move`);
  if (phone && r.owing && r.small) fail(`${where}: action-bar control(s) under 40px: ${r.small}`);
  return r;
};

// A board room is an SVG group, which has no .click(): send the event itself.
const clickFirst = (selector) =>
  evaluate(
    `(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b) return false; b.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`,
  );

// Every move waits in the confirm strip: shoot it once, then the second tap sends the move.
const confirm = async (made) => {
  if (!made) return false;
  await sleep(150);
  if (!taken.has("confirm-strip")) await shot("confirm-strip");
  if (await clickFirst(".ph-confirm-yes")) return true;
  // A new turn or vote result clears a move waiting to be confirmed: that is no failure.
  const moved = await evaluate(
    `!document.querySelector('.ph-pick, .action-bar [aria-label="Your vote"], .action-bar [aria-label="Your climb"]')`,
  );
  if (!moved) fail("a move showed no confirm strip");
  return false;
};

// The favour picks on a climb (tiles in the bar), shot once each when on screen: the shot, the
// picks' label, the favour's glyph (skin.ts).
const PICKS = [
  ["swap-pick", "Token swap: take instead", "⇄"],
  ["carry-pick", "Carry: take along", "🚗"],
];
const wantPicks = () => PICKS.some(([name]) => !taken.has(name));
const shootPicks = async () => {
  for (const [name, label] of PICKS)
    if (!taken.has(name) && (await evaluate(`!!document.querySelector('[aria-label="${label}"]')`))) await shot(name);
};

const end = Date.now() + Number(secs) * 1000;
let ended = false;
// Moves slide rather than jump (motion.ts): script-driven animations, not the CSS loops.
let motion = 0;
const moving = () =>
  evaluate(
    `document.getAnimations().filter((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)).length`,
  );
for (let tick = 0; tick < 4000; tick++) {
  await sleep(400);
  const now = (await moving()) ?? 0;
  motion += now;
  // One shot mid-move, to see that things slide from where they were: every animation is held
  // at 45% of its run for the shot, then let go.
  // A token picked up on the way: hold the frame just after the climber reaches it.
  const when = await evaluate(`document.querySelector(".ph-picked")?.dataset.when ?? null`);
  if (when !== null && when !== undefined && !taken.has("pickup")) {
    const held = `document.getAnimations().filter((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition))`;
    await evaluate(`${held}.forEach((a) => { a.pause(); a.currentTime = ${Number(when) + 180}; })`);
    await shot("pickup");
    await evaluate(`${held}.forEach((a) => a.play())`);
  }
  if (now > 0 && !taken.has("motion")) {
    const held = `document.getAnimations().filter((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition))`;
    await evaluate(
      `${held}.forEach((a) => { a.pause(); const t = a.effect.getTiming(); a.currentTime = (Number(t.delay) || 0) + Number(t.duration) * 0.45; })`,
    );
    await shot("motion");
    await evaluate(`${held}.forEach((a) => a.play())`);
  }
  const r = await check(`tick ${tick}`);
  if (!r?.table) continue;
  if (r.over) {
    await sleep(800);
    await shot(ended ? "ended-early" : "over");
    break;
  }
  const state = await evaluate(`(() => ({
    move: !!document.querySelector('.ph-pick'),
    extra: !!document.querySelector('.ph-pick .ph-done'),
    vote: !!document.querySelector('.action-bar [aria-label="Your vote"]'),
    climb: !!document.querySelector('.action-bar [aria-label="Your climb"]'),
    voting: !!document.querySelector('.ph-vote'),
  }))()`);
  if (state.voting && !state.vote && !state.climb) await shot("vote-watching");
  if (state.move) {
    // Played the way a person plays: tap something glowing on the board, then a button in the bar.
    await shot(state.extra ? "extra-move" : "your-move");
    if (!taken.has("daddu") && (await clickFirst(".ph-blocker.live"))) {
      await sleep(300);
      await shot("daddu");
      if (await clickFirst(".ph-path.live")) {
        await sleep(300);
        await shot("daddu-path");
      }
      await clickFirst('.ph-pick button[aria-label="Clear"]');
      await sleep(200);
    }
    // Ask a bot for its favour from its chip: the sheet, then the request waiting in the bar. The
    // swap and carry picks show only with such a favour on offer, so keep asking its holder (the
    // chip's title starts with the favour's glyph) until both are shot.
    const holder = PICKS.filter(([name]) => !taken.has(name))
      .map(([, , glyph]) => `.ph-fav-btn.live[title^="${glyph}"]`)
      .join(", ");
    const chip = !taken.has("favour-sheet") ? `${holder ? `${holder}, ` : ""}.ph-fav-btn.live` : holder;
    if (chip && !state.extra && (await clickFirst(chip))) {
      await sleep(300);
      await shot("favour-sheet");
      const asked = await evaluate(
        `(() => { const b = [...document.querySelectorAll('[role="dialog"] .btn.primary')].find((x) => x.textContent.includes('Ask')); if (!b) return false; b.click(); return true; })()`,
      );
      if (!asked) fail("a glowing favour opened no sheet with an Ask button");
      await confirm(asked);
      await sleep(150);
      await shot("favour-asked");
      // Give the bot time to answer before the move: it thinks for up to 2.25 s.
      if (wantPicks()) await sleep(2500);
    }
    if (!taken.has("tip") && (await clickFirst(".ph-pick .ph-tip-btn"))) {
      await sleep(300);
      await shot("tip");
      await clickFirst(".ph-pick .ph-tip-btn");
    }
    if (!taken.has("all-moves") && (await clickFirst('.ph-pick button[aria-expanded="false"].ph-chipbtn'))) {
      await sleep(300);
      await shot("all-moves");
      await clickFirst('.ph-pick button[aria-expanded="true"].ph-chipbtn');
      await sleep(200);
    }
    let moved = false;
    if (await clickFirst(".ph-room.live")) {
      await sleep(300);
      await shot("selected");
      await shootPicks();
      // A way up out of the room picks that way first (A, then B): its facts, then the move.
      if (await clickFirst(".ph-pick .ph-move.ph-then")) {
        await sleep(300);
        await shot("confirm");
        await shootPicks();
        moved = await confirm(await clickFirst(".ph-pick .ph-move:not(.ph-then)"));
      } else moved = await confirm(await clickFirst(".ph-pick .ph-move-grid .btn"));
    }
    if (!moved && (await clickFirst(".ph-blocker.live"))) {
      await sleep(200);
      if (await clickFirst(".ph-path.live")) {
        await sleep(200);
        moved = await confirm(await clickFirst(".ph-pick .ph-move-grid .btn"));
      }
    }
    if (!moved && state.extra) moved = await confirm(await clickFirst(".ph-pick .ph-done"));
    if (!moved) fail(`tick ${tick}: no move could be made by tapping the board`);
    await sleep(300);
  } else if (state.vote) {
    await shot("vote-voter");
    await confirm(await clickFirst('.action-bar [aria-label="Your vote"] .ph-move-grid .btn'));
  } else if (state.climb) {
    await shot("vote-climber");
    await confirm(await clickFirst('.action-bar [aria-label="Your climb"] .btn:not([disabled])'));
  } else if (!taken.has("their-move") && !state.voting) {
    // The turn may have come round since the check above: then this is not their move.
    if (await evaluate(`!!document.querySelector('.ph-pick, .ph-vote')`)) continue;
    await shot("their-move");
    // A tap on the board explains what was tapped.
    if (await clickFirst(".ph-room")) {
      // Sheets fade in: wait until they are fully shown.
      await sleep(900);
      const open = await evaluate(`!!document.querySelector('[role="dialog"]')`);
      if (!open) fail("a tap on a room while others move opened no sheet");
      // An open sheet is solid and on top: nothing of the board shows through it.
      const sheet = await evaluate(`(() => {
        const s = document.querySelector('.sheet');
        const r = s.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return JSON.stringify({ opacity: getComputedStyle(s).opacity, back: getComputedStyle(s).backgroundColor, onTop: s.contains(top), top: top?.className?.baseVal ?? top?.className });
      })()`);
      const seen = JSON.parse(sheet);
      if (Number(seen.opacity) < 1 || !seen.onTop) fail(`the room sheet is not solid on top: ${sheet}`);
      await shot("board-info");
      await evaluate(`dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      await sleep(200);
    }
    // The sheets, once each, while someone else moves.
    await clickFirst('.icon-btn[aria-label="Log"]');
    await sleep(900);
    await shot("log");
    await clickFirst('[role="dialog"] .sheet-close, [role="dialog"] button[aria-label="Close"]');
    await evaluate(`dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(200);
    if (await clickFirst(".ph-tray .ph-give")) {
      await sleep(900);
      await shot("give");
      await evaluate(`dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      await sleep(200);
    }
    // Another seat's sheet: where ✋ and ▲ on the chips are explained.
    if (await clickFirst(".ph-seat-chip .ph-seat-more")) {
      await sleep(900);
      if (!(await evaluate(`!!document.querySelector('[role="dialog"] .ph-stats')`)))
        fail("the seat sheet has no counts");
      await shot("seat");
      await evaluate(`dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      await sleep(200);
    }
  }
  if (!ended && Date.now() > end) {
    ended = true;
    await clickFirst('.icon-btn[aria-label="Room and rules"]');
    await sleep(300);
    await shot("menu");
    await evaluate(
      `[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'End game now')?.click()`,
    );
    await sleep(200);
    await evaluate(
      `[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'End game')?.click()`,
    );
  }
}

console.log(`animations seen: ${motion}`);
if (motion === 0) fail("no move was animated");
// Whether a bot lends a swap or carry is luck: a run without one is no failure.
for (const [name] of PICKS) if (!taken.has(name)) console.log(`not reached: ${name}`);

// ---- Home: the admin closes the room from its 🗑, two taps, and it leaves the list ----
await s("Page.navigate", { url: `${BASE}/` });
await sleep(1500);
const bin = `.my-room button[aria-label="Close room ${code}"]`;
const listed = `!!document.querySelector('.my-room a[href="#${code}"]')`;
if (!(await clickFirst(bin))) fail("Home lists no 🗑 for this room");
else {
  await sleep(300);
  await shot("home-delete");
  const yes = await evaluate(
    `(() => { const b = document.querySelector('.my-room .confirm .btn.danger'); if (!b) return false; b.click(); return true; })()`,
  );
  if (!yes) fail("the 🗑 asked nothing before closing the room");
  await sleep(1000);
  if (await evaluate(listed)) fail("the closed room is still listed on Home");
  await shot("home-deleted");
}

const exited = new Promise((r) => chrome.once("exit", r));
chrome.kill();
await exited;
fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
if (failures.length) {
  console.log(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
process.exit(0);
