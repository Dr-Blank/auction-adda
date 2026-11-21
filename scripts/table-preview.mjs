// Renders the whole Pahunch table (seats, board, side column) from recorded fixtures to PNGs, with
// no server and no game: for checking a screen that is slow to reach by playing, such as the end
// with a winner. The page is rendered once, server side, so effects and animations do not run.
//
//   node scripts/table-preview.mjs <out-dir> [width] [fixture-name ...]
//
// Width 390 gives the phone layout. Writes <out-dir>/<fixture>-<width>.png (and .html). Needs
// `chromium` on the PATH. Run from the project root. PAHUNCH_FIXTURES reads another folder.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const [out = "./shots/table", width = "1300", ...only] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const dir = process.env.PAHUNCH_FIXTURES ?? "test/fixtures/pahunch";
const names = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .filter((n) => only.length === 0 || only.includes(n));

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { Room } = await vite.ssrLoadModule("/src/client/Room.tsx");
  const { skinFor } = await vite.ssrLoadModule("/src/games/pahunch/skin.ts");
  const css = ["src/client/styles.css", "src/games/pahunch/pahunch.css"]
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
  for (const name of names) {
    const state = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
    const body = renderToStaticMarkup(
      React.createElement(Room, {
        state: { ...state, receivedAt: Date.now() },
        send: () => {},
        join: () => {},
        reactions: [],
      }),
    );
    const vars = Object.entries(skinFor(state.room.theme).chrome ?? {})
      .map(([k, val]) => `${k}:${val}`)
      .join(";");
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}
:root{${vars}}</style>${body}`;
    const file = path.resolve(out, `${name}-${width}.html`);
    fs.writeFileSync(file, html);
    const png = path.resolve(out, `${name}-${width}.png`);
    const r = spawnSync("chromium", [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      // CSS entrances (the podium rising) finish before the shot. Counters stay at their start.
      "--virtual-time-budget=4000",
      `--window-size=${width},${Number(width) < 600 ? 1700 : 1000}`,
      `--screenshot=${png}`,
      `file://${file}`,
    ]);
    // A missing chromium sets r.error and no status.
    if (r.status !== 0) console.log(name, String(r.error ?? r.stderr));
    else console.log(png);
  }
} finally {
  await vite.close();
}
