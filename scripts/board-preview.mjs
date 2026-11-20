// Renders the Pahunch board from each recorded fixture (test/fixtures/pahunch/) to a PNG, with no
// server and no game: for tuning how the board draws (path routes, room looks) quickly.
//
//   node scripts/board-preview.mjs <out-dir> [width] [fixture-name ...]
//
// Writes <out-dir>/<fixture>.png (and .html). Needs `chromium` on the PATH. Run from the project root.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const [out = "./shots/board", width = "900", ...only] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const dir = "test/fixtures/pahunch";
const boards = JSON.parse(fs.readFileSync("crates/pahunch/boards.json", "utf8"));
const names = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .filter((n) => only.length === 0 || only.includes(n));

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { Board } = await vite.ssrLoadModule("/src/games/pahunch/Board.tsx");
  const { skinFor } = await vite.ssrLoadModule("/src/games/pahunch/skin.ts");
  const css = ["src/client/styles.css", "src/games/pahunch/pahunch.css"]
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
  for (const name of names) {
    const f = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
    const v = f.game;
    if (!v?.layout) continue;
    // Room places come from boards.json as it is now, so a layout change shows before re-recording.
    const board = boards.boards.find((b) => b.id === v.layout.board);
    if (board) v.layout.rooms = v.layout.rooms.map((r, i) => ({ ...r, x: board.rooms[i].x, y: board.rooms[i].y }));
    const skin = skinFor(f.room.theme);
    const svg = renderToStaticMarkup(
      React.createElement(Board, {
        v,
        skin,
        names: f.room.seats.map((s) => s.name),
        acting: false,
        liveRooms: new Set(),
        livePaths: new Set(),
        focus: null,
        targets: new Set(),
        blockerLive: false,
        selected: null,
        looks: f.room.seats.map((s) => s.avatar),
        faces: true,
        onRoom: () => {},
        onPath: () => {},
        onBlocker: () => {},
      }),
    );
    const vars = Object.entries(skin.chrome ?? {})
      .map(([k, val]) => `${k}:${val}`)
      .join(";");
    const html = `<!doctype html><meta charset="utf-8"><style>${css}
:root{${vars}}body{margin:0;padding:16px;background:var(--bg)}.ph-board{max-height:none}</style><div class="ph-table">${svg}</div>`;
    const file = path.resolve(out, `${name}.html`);
    fs.writeFileSync(file, html);
    const r = spawnSync("chromium", [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      `--window-size=${width},${Math.round(Number(width) * 1.12)}`,
      `--screenshot=${path.resolve(out, `${name}.png`)}`,
      `file://${file}`,
    ]);
    if (r.status !== 0) console.log(name, String(r.stderr));
    else console.log(path.resolve(out, `${name}.png`));
  }
} finally {
  await vite.close();
}
