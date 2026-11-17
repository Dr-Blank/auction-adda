// Plays one seat in headless Chromium against three random bots and saves screenshots of the
// table in its main states (your turn, each auction type, sold moment, round results, log,
// menu, admin call and undo, phone width), and checks layout rules on every tick:
//
//   - the page never scrolls sideways (desktop 1300 px and phone 390 px);
//   - the other players sit in the top row and your seat sits by your hand;
//   - hovering a seat's bought-film stacks opens a panel listing as many films as the stacks show;
//   - on a phone, the action bar is on screen while you owe a move;
//   - no script errors on the page.
//
// With `phone` as the third argument the whole game is played at 390 × 844 with touch, and the
// phone rules in docs/ui-guidelines-mobile.md are checked on every tick: the chart strip, the lot
// and every hand card are on screen together, nothing hides under the action bar, action-bar
// controls are at least 40 px tall, and each tap-for-more sheet opens, fits and closes.
//
// Exits 1 if any check failed.
//
//   npm run build && PORT=8799 DATA_DIR= CREATE_LIMIT=1000 npm start &
//   node scripts/screenshots.mjs ./shots [seconds]
//   node scripts/screenshots.mjs ./shots/phone [seconds] phone
//
// Needs `chromium` on the PATH and Node 24 (global WebSocket). Run from the project root.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [out = "./shots", secs = "120", mode = "desktop"] = process.argv.slice(2);
/** `phone`: the whole game is played at 390 × 844 with touch (no hover), and the phone rules are checked on every tick. */
const phone = mode === "phone";
const port = process.env.PORT ?? "8799";
/** Theme of the rooms played (`THEME=leather-willow`). */
const theme = process.env.THEME ?? "box-office";
const BASE = `http://localhost:${port}`;
const WS = `ws://localhost:${port}/ws`;
const DEBUG_PORT = 9333;
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const fail = (msg) => {
  if (failures.includes(msg)) return;
  failures.push(msg);
  console.log("FAIL", msg);
};

// ---- room with three bots; this seat is "tp" and is the admin ----
const sock = new WebSocket(WS);
const { code, token } = await new Promise((resolve) => {
  sock.onopen = () => sock.send(JSON.stringify({ type: "create", theme, name: "tp" }));
  sock.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "joined") resolve({ code: m.room, token: m.token });
  };
});
console.log("room", code);
const bots = spawn("node", ["scripts/bots.ts", code, "3", "--delay", "900", "--url", WS], { stdio: "ignore" });
await new Promise((resolve) => {
  sock.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "state" && m.room.seats.length === 4 && !m.game) {
      sock.send(JSON.stringify({ type: "start" }));
      resolve();
    }
  };
});
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
const shot = async (name) => {
  const r = await s("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(r.result.data, "base64"));
  console.log("shot", name);
};
const size = (w, h, mobile = false) =>
  s("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });

const base = () => (phone ? size(390, 844, true) : size(1300, 900));
if (phone) await s("Emulation.setTouchEmulationEnabled", { enabled: true });
// Headless Chromium has no mouse and reports `hover: none` (it cannot be emulated), so desktop shots
// look like a wide touch screen: they include the small ⓘ buttons that a screen with a mouse hides.
await base();
await s("Page.navigate", { url: `${BASE}/` });
await sleep(800);
await evaluate(
  `localStorage.setItem('aa:token:${code}', '${token}'); localStorage.setItem('aa:voice','1'); localStorage.setItem('aa:mute','1')`,
);
await s("Page.navigate", { url: `${BASE}/#${code}` });
await sleep(1500);

const taken = new Set();
const once = async (name) => {
  if (taken.has(name)) return false;
  taken.add(name);
  await shot(name);
  return true;
};
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
const clickText = (prefix) =>
  evaluate(
    `[...document.querySelectorAll('.action-bar .btn')].find((b) => b.textContent.startsWith(${JSON.stringify(prefix)}))?.click()`,
  );

// ---- checks ----
/** Layout rules that hold in every state of the table. */
const checkLayout = async (where) => {
  const r = await evaluate(`(() => {
    const d = document.documentElement;
    const top = document.querySelectorAll('.seats .seat').length;
    const mine = document.querySelectorAll('.hand-head .seat.me').length;
    const players = document.querySelectorAll('[data-seat]').length;
    const tapUi = [...document.querySelectorAll('.tap-only')].filter((e) => e.getClientRects().length).length;
    const strip = !!document.querySelector('.chart-strip');
    return { wide: d.scrollWidth - innerWidth, top, mine, players, tapUi, strip, mouse: matchMedia('(hover: hover)').matches, w: innerWidth, table: !!document.querySelector('.table') };
  })()`);
  if (!r?.table) return;
  if (r.wide > 1) fail(`${where}: page scrolls sideways by ${r.wide}px`);
  if (r.mine !== 1) fail(`${where}: your seat is not by your hand (${r.mine})`);
  if (r.top !== 3) fail(`${where}: expected 3 other players in the top row, saw ${r.top}`);
  // Wide screen: never the chart strip; with a mouse, none of the tap-for-more buttons either.
  if (r.w > 960 && r.strip) fail(`${where}: the chart strip shows on the desktop layout`);
  if (r.w > 960 && r.mouse && r.tapUi)
    fail(`${where}: ${r.tapUi} touch-only control(s) visible on a desktop with a mouse`);
};

/** Hover the first seat with bought films: the panel must list as many films as its stacks show. */
const checkBought = async () => {
  const box = await evaluate(`(() => {
    const b = document.querySelector('button.owned');
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    const shown = [...b.querySelectorAll('.mini-card')].reduce((n, c) => n + Number(c.querySelector('.mc-count')?.textContent || 1), 0);
    return { x: r.left + 8, y: r.top + r.height / 2, shown };
  })()`);
  if (!box) return false;
  await s("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
  await sleep(250);
  const listed = await evaluate(`document.querySelectorAll('.bought-pop li').length`);
  // Visible means on top: the element at the panel's centre must be the panel (not the stage over it).
  const onTop = await evaluate(`(() => {
    const p = document.querySelector('.bought-pop');
    if (!p) return false;
    const r = p.getBoundingClientRect();
    return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && p.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  })()`);
  await shot("bought-hover");
  if (listed !== box.shown) fail(`bought panel lists ${listed} films, stacks show ${box.shown}`);
  if (!onTop) fail("bought panel is not visible on top of the page");
  const priced = await evaluate(
    `[...document.querySelectorAll('.bought-pop li small:last-child')].every((x) => x.textContent.trim() !== '')`,
  );
  if (!priced) fail("bought panel has a film without a price line");
  await s("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  await sleep(300);
  if (await evaluate(`!!document.querySelector('.bought-pop')`))
    fail("bought panel did not close when the pointer left");
  return true;
};

/** Phone width while you owe a move: the action bar must be on screen without scrolling. */
const checkPhoneBar = async () => {
  const r = await evaluate(`(() => {
    const bar = document.querySelector('.table.acting .action-bar');
    if (!bar) return null;
    const b = bar.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, h: innerHeight };
  })()`);
  if (r && (r.bottom > r.h + 1 || r.top < 0))
    fail(`phone: action bar off screen (${Math.round(r.top)}–${Math.round(r.bottom)} of ${r.h})`);
};

/**
 * Phone rules (docs/ui-guidelines-mobile.md): the chart strip, the lot and the whole hand are on
 * screen together, nothing in the hand scrolls sideways or hides under the action bar, and the
 * controls in the action bar are large enough to hit.
 */
const checkPhone = async (where) => {
  const r = await evaluate(`(() => {
    const box = (x) => { const e = document.querySelector(x); return e ? e.getBoundingClientRect() : null; };
    if (document.querySelector('.overlay, .drawer-back') || !document.querySelector('.table')) return null;
    scrollTo(0, 0);
    const h = innerHeight, w = innerWidth;
    const strip = box('.chart-strip'), hand = box('.hand-panel'), bar = box('.table.acting .action-bar'), lot = box('.stage .lot-posters');
    // Cards still flying in from a deal are not in place yet.
    const cards = [...document.querySelectorAll('.hand-card:not(.deal-in)')].map((c) => c.getBoundingClientRect());
    const floor = bar ? bar.top : h;
    const small = [...document.querySelectorAll('.table.acting .action-bar button')].filter((b) => b.getBoundingClientRect().height < 40).map((b) => b.textContent.trim());
    return {
      strip: !!strip && strip.top >= 0 && strip.bottom <= h,
      cells: document.querySelectorAll('.chart-strip .star-cell').length,
      handScroll: (document.querySelector('.hand')?.scrollWidth ?? 0) - (document.querySelector('.hand')?.clientWidth ?? 0),
      cardsOut: cards.filter((c) => c.left < 0 || c.right > w + 1 || c.bottom > floor + 1 || c.top < (strip ? strip.bottom - 1 : 0)).length,
      cards: cards.length,
      handUnderBar: !!hand && !!bar && hand.bottom > bar.top + 1,
      lotOut: !!lot && (lot.top < (strip ? strip.bottom - 1 : 0) || lot.bottom > (hand ? hand.top : floor) + 1),
      small,
      barOut: [...document.querySelectorAll('.table.acting .action-bar button, .table.acting .action-bar input')]
        .map((b) => b.getBoundingClientRect())
        .filter((b) => b.left < 0 || b.right > w + 1 || b.bottom > h + 1).length,
    };
  })()`);
  if (!r) return;
  if (r.barOut) fail(`${where}: ${r.barOut} action bar control(s) are off screen`);
  if (!r.strip) fail(`${where}: the chart strip is not on screen`);
  if (r.cells !== 5) fail(`${where}: the chart strip shows ${r.cells} stars, not 5`);
  if (r.handScroll > 1) fail(`${where}: the hand scrolls sideways by ${r.handScroll}px`);
  if (r.cardsOut) fail(`${where}: ${r.cardsOut} of ${r.cards} hand cards are off screen or covered`);
  if (r.handUnderBar) fail(`${where}: the hand is under the action bar`);
  if (r.lotOut) fail(`${where}: the lot is covered by the chart strip or the hand`);
  if (r.small.length) fail(`${where}: action bar controls under 40px tall: ${r.small.join(", ")}`);
};

/** Phone: each tap target opens its sheet (chart, auction types, seat), and Escape closes it. */
const sheetsDone = new Set();
const checkSheet = async (name, selector, expect, what) => {
  if (sheetsDone.has(name)) return;
  if (
    !(await evaluate(
      `!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector('.overlay, .moment')`,
    ))
  )
    return;
  sheetsDone.add(name);
  await click(selector);
  await sleep(350);
  const n = await evaluate(`document.querySelectorAll(${JSON.stringify(`.sheet ${expect}`)}).length`);
  await shot(`sheet-${name}`);
  if (!n) fail(`sheet ${name}: tapping ${selector} did not open ${what}`);
  const fits = await evaluate(`(() => {
    const e = document.querySelector('.sheet');
    if (!e) return true;
    const r = e.getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && e.scrollWidth <= e.clientWidth + 1;
  })()`);
  if (!fits) fail(`sheet ${name}: wider than the screen or off its bottom edge`);
  await s("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(200);
  if (await evaluate(`!!document.querySelector('.sheet')`)) fail(`sheet ${name}: Escape did not close it`);
};

/** Phone: a tap on a seat with bought films opens its sheet, listing as many films as the stacks show. */
const checkBoughtPhone = async () => {
  const shown = await evaluate(`(() => {
    const b = document.querySelector('.seats button.owned');
    if (!b) return null;
    const n = [...b.querySelectorAll('.mini-card')].reduce((k, c) => k + Number(c.querySelector('.mc-count')?.textContent || 1), 0);
    b.closest('.seat').querySelector('.seat-name').click();
    return n;
  })()`);
  if (shown === null) return false;
  await sleep(350);
  const listed = await evaluate(`document.querySelectorAll('.sheet .bought-list li').length`);
  await shot("sheet-seat-bought");
  if (listed !== shown) fail(`seat sheet lists ${listed} films, stacks show ${shown}`);
  await evaluate(`document.querySelector('.sheet-back')?.click()`);
  await sleep(250);
  if (await evaluate(`!!document.querySelector('.sheet')`))
    fail("seat sheet: a tap outside did not close it (or it reopened)");
  return true;
};

const end = Date.now() + Number(secs) * 1000;
let tick = 0;
let calls = 0;
let inspected = false;
let sawShelve = false;
let undone = false;
let boughtChecked = false;
while (Date.now() < end) {
  await sleep(700);
  tick++;
  const st = await evaluate(`(() => {
    const q = (x) => document.querySelector(x);
    const btn = (p) => [...document.querySelectorAll('.action-bar .btn')].some((b) => b.textContent.startsWith(p));
    return {
      premiere: !!q('.premiere'),
      moment: !!q('.moment'),
      play: !!q('.hand-panel.owing') && !q('.stage .lot-row'),
      selected: !!q('.hand-card.selected'),
      bidbox: !!q('.bidbox'),
      sealed: !!q('.stage-sealed .bidbox'),
      price: !!q('.stage-fixed .bidbox'),
      buy: btn('Buy for'),
      offer: btn('Decline'),
      ruling: !!q('.ruling'),
      kind: (q('.stage') || {}).className || '',
      over: !!q('.gameover'),
    };
  })()`);
  if (!st) continue;
  if (!st.premiere) await checkLayout(`tick ${tick}`);
  if (phone && !st.premiere) {
    await checkPhone(`tick ${tick}`);
    if (!st.moment) {
      await checkSheet("chart", ".chart-strip", ".star-row.expanded", "the full chart");
      await checkSheet("types-stage", ".stage .kind-label .info-btn", ".types dl > div", "the auction types");
      await checkSheet("types-hand", ".hand-head .info-btn", ".types dl > div", "the auction types");
      await checkSheet("seat", ".seats .avatar-btn", ".seat-facts li", "the seat sheet");
    }
  }
  if (await evaluate(`!!document.querySelector('.moment-shelved')`)) {
    sawShelve = true;
    await once("shelved");
    const r = await evaluate(
      `({ reel: !!document.querySelector('.star-row.shelving, .star-cell.shelving'), premiere: !!document.querySelector('.premiere') })`,
    );
    if (!r.reel) fail("shelved: the star’s reel does not show the shelving");
    if (r.premiere) fail("shelved: round results covered the shelved moment");
  }
  if (!boughtChecked && !st.premiere && !st.moment && tick > 10)
    boughtChecked = phone ? await checkBoughtPhone() : await checkBought();
  if (st.over) {
    await once("gameover");
    break;
  }
  if (st.premiere) {
    await sleep(4500);
    (await once("premiere")) || (await shot(`premiere-${tick}`));
    const grouped = await evaluate(`[...document.querySelectorAll('.premiere .payout')].every((row) => {
      const suits = [...row.querySelectorAll('.film-group')].map((g) => g.title.split(' × ')[1]?.split(':')[0]);
      return new Set(suits).size === suits.length;
    })`);
    if (!grouped) fail("premiere: a star appears in more than one group in a payout row");
    if (!(await evaluate(`!!document.querySelector('.premiere .your-round')`))) {
      await click(".premiere .row .btn:last-child");
      await sleep(300);
      if (!(await evaluate(`!!document.querySelector('.premiere .your-round .ledger')`)))
        fail("premiere details: your-round ledger missing");
      if (
        phone &&
        (await evaluate(
          `[...document.querySelectorAll('.premiere, .premiere .scroll-x')].some((el) => el.scrollWidth > el.clientWidth + 1)`,
        ))
      ) {
        fail("premiere details: a table scrolls sideways on the phone");
      }
      await evaluate(`document.querySelector('.premiere .your-round').scrollIntoView()`);
      (await once("premiere-details")) || (await shot(`premiere-details-${tick}`));
      await evaluate(`document.querySelector('.premiere > .row').scrollIntoView()`);
      (await once("premiere-table")) || (await shot(`premiere-table-${tick}`));
    }
    await click(".premiere .btn.primary");
    await sleep(350);
    if (await evaluate(`!!document.querySelector('.hand-card.deal-in')`)) await once("dealt");
    continue;
  }
  if (st.moment) (await once("moment")) || (st.kind.includes("sealed") && (await once("moment-sealed")));
  if (st.play) {
    if (!st.selected) {
      await once("my-turn");
      await click(".hand-card.clickable");
      await sleep(300);
      await once("selected");
    }
    await click(".action-bar .btn.primary");
    continue;
  }
  // Call a result, then undo it from the SOLD moment. A bot moving first closes the undo (as it
  // should), so try again on a later lot, up to three calls.
  if (st.ruling && !undone && calls < 3 && tick > 20 + calls * 15) {
    calls++;
    // Phone: the admin controls are a one-line button on the stage that opens a sheet.
    if (phone) {
      await click(".ruling-btn");
      await sleep(350);
      if (!(await evaluate(`!!document.querySelector('.sheet .ruling-sheet form')`)))
        fail("admin call: the sheet did not open on a phone");
    }
    const R = phone ? ".ruling-sheet" : ".ruling";
    await once("ruling-open");
    await click(`${R} form button`);
    await sleep(200);
    await once("ruling-confirm");
    await click(`${R} .btn.primary`);
    await sleep(150);
    const hit = await evaluate(
      `(() => { const b = document.querySelector('.moment .undo-btn'); b?.click(); return !!b; })()`,
    );
    if (hit) {
      undone = true;
      await sleep(400);
      await once("undo-done");
      const back = await evaluate(`!!document.querySelector('.stage .lot-row') && !document.querySelector('.moment')`);
      if (!back) fail("undo: the auction did not come back");
      if (
        !(await evaluate(
          `[...document.querySelectorAll('.recent li')].some((li) => li.textContent.includes('take back the call'))`,
        ))
      )
        fail("undo: the Latest box does not show the undo");
    } else {
      await once("ruling-done");
      console.log("note: a bot moved before the undo; trying again on a later lot");
    }
    continue;
  }
  if (st.price) {
    await once("set-price");
    await click(".bidbox .btn.primary");
    continue;
  }
  if (st.sealed) {
    await once("sealed");
    await click(".bidbox .btn.primary");
    continue;
  }
  if (st.bidbox) {
    if (!st.moment) await once(`bid-${st.kind.match(/stage-(\w+)/)?.[1] ?? "x"}`);
    if (!taken.has("mobile-bid")) {
      taken.add("mobile-bid");
      await size(390, 844, true);
      await sleep(500);
      await shot("mobile-bid");
      await checkLayout("phone");
      await checkPhoneBar();
      await checkPhone("phone bid");
      await base();
      await sleep(300);
    }
    if (Math.random() < 0.35) await click(".bidbox .btn.primary");
    else
      await evaluate(
        `([...document.querySelectorAll('.bidbox .btn')].find((b) => !b.classList.contains('primary')) || document.querySelector('.bidbox .btn.primary'))?.click()`,
      );
    continue;
  }
  if (st.buy) {
    await once("fixed-buy");
    await clickText("Pass");
    continue;
  }
  if (st.offer) {
    await once("offer");
    await clickText("Decline");
    continue;
  }
  if (tick % 15 === 0) await shot(`tick-${tick}`);
  if (tick === 30) {
    await click('[aria-label="Auction log"]');
    await sleep(400);
    await shot("log-drawer");
    await click(".drawer-back");
    await click('[aria-label="Room and rules"]');
    await sleep(300);
    await shot("menu");
    await click('[aria-label="Room and rules"]');
  }
  if (
    !inspected &&
    !st.play &&
    !st.premiere &&
    !st.moment &&
    (await evaluate(`!!document.querySelector('.hand-card.inspectable')`))
  ) {
    inspected = true;
    await click(".hand-card.inspectable");
    await sleep(300);
    if (!(await evaluate(`!!document.querySelector('.inspect .poster-lg')`)))
      fail("inspect: tapping a hand card did not open the large view");
    await shot("inspect");
    await s("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(200);
    if (await evaluate(`!!document.querySelector('.inspect')`)) fail("inspect: Escape did not close the large view");
  }
  if (tick === 40) {
    await size(390, 844, true);
    await sleep(500);
    await shot("mobile-idle");
    await checkLayout("phone");
    await checkPhone("phone idle");
    await base();
  }
}
await shot("final");
if (phone)
  for (const name of ["chart", "types-stage", "types-hand", "seat"])
    if (!sheetsDone.has(name)) fail(`sheet ${name}: never got to open it`);
if (!inspected) fail("inspect: never had a hand card to inspect");
if (!sawShelve) console.log("note: no round ended by shelving in this run; that check did not run");

// ---- home and lobby ----
await s("Page.navigate", { url: `${BASE}/` });
await sleep(800);
await shot("home");
const lobby = new WebSocket(WS);
const seat = await new Promise((resolve) => {
  lobby.onopen = () => lobby.send(JSON.stringify({ type: "create", theme, name: "tp" }));
  lobby.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "joined") resolve({ code: m.room, token: m.token });
  };
});
lobby.close();
await evaluate(`localStorage.setItem('aa:token:${seat.code}', '${seat.token}')`);
await s("Page.navigate", { url: `${BASE}/#${seat.code}` });
await sleep(1200);
await shot("lobby");
if (
  !(await evaluate(
    `!!document.querySelector('.lobby .admin-note') && !!document.querySelector('.lobby-seats .admin-mark')`,
  ))
)
  fail("lobby: the admin role is not shown");
await size(390, 844, true);
await sleep(400);
if ((await evaluate(`document.documentElement.scrollWidth - innerWidth`)) > 1)
  fail("lobby: page scrolls sideways on a phone");
await shot("lobby-phone");
bots.kill();
chrome.kill();
await sleep(300);
fs.rmSync(profile, { recursive: true, force: true });
if (!boughtChecked) fail("never saw a seat with bought films to hover");
if (!undone) fail("undo: never managed to undo a call (bots always moved first, or the button never showed)");
console.log(failures.length ? `${failures.length} check(s) failed` : "all checks passed");
process.exit(failures.length ? 1 : 0);
