// Renders every genre of a theme as it shows in a game: the star's portrait, the star's name and
// label, and a few of its cards at full size, with the real stylesheets. For iterating on card art,
// portraits and the name and title lists without playing a game. Writes `<theme>.html` (open it
// in a browser) and, when `chromium` is on the PATH, `<theme>.png`.
//
//   node scripts/cards.mjs [out=./shots/cards] [cards per genre=4]
//   THEME=leather-willow SEED=7 node scripts/cards.mjs
//
// THEME: one theme id, or all themes when left out. SEED: picks the names, titles and taglines
// (as a room's seed does). Run from the project root; needs no server.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";

/** The card game's themes (Auction Adda's): the only game with cards to render so far. */
const THEME_DIR = "src/games/auction/themes";
const [out = "./shots/cards", perGenre = "4"] = process.argv.slice(2);
const seed = Number(process.env.SEED ?? 1);
fs.mkdirSync(out, { recursive: true });

// Vite turns the themes' TSX and CSS imports into something Node can run.
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { THEMES, getTheme } = await vite.ssrLoadModule(`/${THEME_DIR}/index.ts`);
  const { SUITS } = await vite.ssrLoadModule("/src/games/auction/config.ts");
  const deck = JSON.parse(fs.readFileSync("src/generated/deck.json", "utf8"));
  const ids = process.env.THEME ? [process.env.THEME] : Object.keys(THEMES);

  for (const id of ids) {
    const def = THEMES[id];
    if (!def) throw new Error(`no theme ${id}; themes: ${Object.keys(THEMES).join(", ")}`);
    const count = def.genres.length;
    const rows = [];
    // A game plays SUITS genres at a time: cast windows of them until every genre has been shown.
    for (let start = 0; start < count; start += SUITS) {
      const first = Math.min(start, count - SUITS);
      const genres = Array.from({ length: SUITS }, (_, i) => first + i);
      const theme = getTheme(id, { seed, genres });
      theme.suits.forEach((suit, i) => {
        if (suit.key < start) return;
        const cards = deck.filter((c) => c.suit === i).slice(0, Number(perGenre));
        rows.push(`
          <section class="row">
            <div class="who">
              ${renderToStaticMarkup(theme.renderSuit(i, 96))}
              <b>${suit.key}. ${suit.name}</b><span>${suit.genre} · ${suit.short} · ${suit.glyph}</span>
            </div>
            <div class="cards">${cards.map((c) => renderToStaticMarkup(theme.renderCard(c, "lg"))).join("")}</div>
          </section>`);
      });
    }

    const css = (p) => `<link rel="stylesheet" href="${pathToFileURL(path.resolve(p)).href}">`;
    const themeCss = fs.readdirSync(`${THEME_DIR}/${id}`).filter((f) => f.endsWith(".css"));
    const chrome = Object.entries(getTheme(id).chrome)
      .map(([k, v]) => `${k}:${v}`)
      .join(";");
    const html = `<!doctype html><meta charset="utf-8"><title>${def.title} cards</title>
      ${css("node_modules/@fontsource/anton/latin-400.css")}${css("src/client/styles.css")}
      ${themeCss.map((f) => css(`${THEME_DIR}/${id}/${f}`)).join("")}
      <style>
        body { padding: 24px; background: var(--bg); color: var(--text); ${chrome} }
        .row { display: flex; gap: 24px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line); }
        .who { width: 180px; display: grid; justify-items: start; gap: 4px; flex: none; }
        .who span { color: var(--muted); font-size: 12px; }
        .cards { display: flex; gap: 16px; flex-wrap: wrap; }
      </style>
      <h1>${def.title} · ${count} genres · seed ${seed}</h1>${rows.join("")}`;
    const file = path.resolve(out, `${id}.html`);
    fs.writeFileSync(file, html);

    const png = path.resolve(out, `${id}.png`);
    const shot = spawnSync(
      "chromium",
      [
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        "--allow-file-access-from-files",
        `--window-size=1000,${140 + rows.length * 250}`,
        `--screenshot=${png}`,
        pathToFileURL(file).href,
      ],
      { stdio: "ignore" },
    );
    console.log(shot.status === 0 ? `${file}\n${png}` : `${file} (no chromium: no png)`);
  }
} finally {
  await vite.close();
}
