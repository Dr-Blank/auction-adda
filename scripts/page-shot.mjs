// One screenshot of one page in headless Chromium, for checking a UI change by eye.
//
//   node scripts/page-shot.mjs <out.png> <url> [options]
//
//   --setup <js>    run on the page's origin first (e.g. put seat tokens in localStorage), then load <url>
//   --then <js>     run after the page loaded (click something, open a dialog); awaited if it returns a promise
//   --wait <ms>     after loading and after --then (default 1200)
//   --phone         390 × 844 with touch; otherwise 1300 × 900
//   --full          the whole page, not just the window
//
// Needs `chromium` on the PATH and Node 24. Prints page errors; exits 1 if there were any.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args.splice(i, 1).length > 0;
};
const setup = opt("--setup");
const then = opt("--then");
const wait = Number(opt("--wait") ?? 1200);
const phone = flag("--phone");
const full = flag("--full");
const [out, url] = args;
if (!out || !url) {
  console.error(
    "usage: node scripts/page-shot.mjs <out.png> <url> [--setup js] [--then js] [--wait ms] [--phone] [--full]",
  );
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "page-shot-"));
const chrome = spawn(
  "chromium",
  ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", `--user-data-dir=${profile}`, "about:blank"],
  { stdio: "ignore" },
);
const errors = [];
try {
  let ver;
  for (let i = 0; i < 50 && !ver; i++) {
    await sleep(200);
    ver = await fetch(`http://127.0.0.1:${port}/json/version`)
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
    if (m.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      errors.push(JSON.stringify(m.params.args).slice(0, 300));
  };
  const call = (method, params = {}, sessionId) =>
    new Promise((resolve) => {
      const i = ++id;
      waiting.set(i, resolve);
      cdp.send(JSON.stringify({ id: i, method, params, sessionId }));
    });
  const { targetId } = (await call("Target.createTarget", { url: "about:blank" })).result;
  const { sessionId } = (await call("Target.attachToTarget", { targetId, flatten: true })).result;
  const s = (method, params) => call(method, params, sessionId);
  const evaluate = async (expression) => {
    const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) errors.push(`script: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
    return r.result?.result?.value;
  };
  await s("Runtime.enable");
  await s("Page.enable");
  await s("Emulation.setDeviceMetricsOverride", {
    width: phone ? 390 : 1300,
    height: phone ? 844 : 900,
    deviceScaleFactor: phone ? 2 : 1,
    mobile: phone,
  });
  if (phone) await s("Emulation.setTouchEmulationEnabled", { enabled: true });
  if (setup) {
    await s("Page.navigate", { url: new URL(url).origin });
    await sleep(600);
    await evaluate(setup);
  }
  await s("Page.navigate", { url });
  await sleep(wait);
  if (then) {
    await evaluate(then);
    await sleep(wait);
  }
  const r = await s("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(r.result.data, "base64"));
  console.log("saved", out);
  cdp.close();
} finally {
  chrome.kill();
  fs.rmSync(profile, { recursive: true, force: true });
}
for (const e of errors) console.log("page error:", e);
process.exit(errors.length ? 1 : 0);
