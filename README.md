# Auction Adda

A browser auction card game for 3–5 friends on voice chat. One person creates a room and pastes the link; everyone plays from their own device. The server enforces the rules, keeps hands, money and sealed bids private, and does the scoring.

## Run it

Needs Rust (the version in `rust-toolchain.toml`; rustup picks it up) for the server and Node 24 or newer for the frontend.

```sh
npm install
npm run build     # builds the frontend into dist/
npm start         # http://localhost:8787 (cargo run --release)
```

Rooms are saved in `data/` and survive restarts.

### Development

```sh
npm run server    # game server on :8787 (cargo run)
npm run dev       # frontend on :5173 with hot reload, proxies /ws to the server
cargo test        # rules, the recorded games, rooms; also rewrites src/generated
npm test          # builds the server, then plays real games against it over sockets
npm run typecheck
npm run format    # Biome: TS, CSS, JSON, Markdown (npm run lint only checks)
cargo clippy --all-targets && cargo fmt
```

Checks are defined once in [prek.toml](prek.toml) and shared by git hooks and CI. Install [prek](https://prek.j178.dev) and run `prek install` once per clone: commits then format the staged files, and pushes run clippy, typecheck and the tests. `prek run --all-files --hook-stage manual` runs everything CI runs (cargo-deny included).

The TypeScript types of every message live in `src/generated/`, written by `cargo test` from the Rust types; commit them with the change that caused them (CI fails when they are stale). The game constants are in `crates/engine/config.json`, read by the engine and the client alike.

The engine is checked against games recorded from the original TypeScript engine (`crates/engine/fixtures/`). After a deliberate rule change, rewrite them with `BLESS=1 cargo test -p engine --test fixtures` and review the diff.

`npm test` also renders the lobby and the table from real `state` messages (`test/fixtures/states/`) and compares the HTML with `test/__snapshots__/`. A snapshot change is a change players see: review it, then accept it with `npx vitest run -u`. After a protocol change, record new states with `node scripts/capture-states.ts` against a server on port 8799 (the script's header says how).

### Try it alone

Open the app, create a room and press _Add a bot_ on an empty seat in the lobby until there are enough players, then _Start_. The server plays those seats with random legal moves.

For testing the connection handling, bots can also join over the socket like a browser:

```sh
npm run bots -- ABC234 3          # 3 bots join room ABC234; you press Start
npm run bots -- ABC234 3 --delay 400
npm run bots -- --create 2 --admin human --open   # bots make a room and open it; you join as admin
npm run bots -- last 1 --drop-after 10 --rejoin-after 45   # a bot that drops mid-game and comes back
```

`last` means the room most recently created or joined by the bots script. The header of [scripts/bots.ts](scripts/bots.ts) lists every option (auto start, rematch, admin hand-off, dropping and rejoining).

In VS Code, _Tasks: Run Task_ has all of this ready: dev servers (including an in-memory one where seats unlock after 5 s), room and bot scenarios that ask for their settings, tests, typecheck and screenshots.

Screenshots of the table in headless Chromium (needs `chromium` on the PATH and a server on port 8799; images go to the given folder):

```sh
PORT=8799 npm start &
node scripts/screenshots.mjs ./shots 120               # plays one seat against 3 bots for 120 s, desktop
node scripts/screenshots.mjs ./shots/phone 120 phone   # the same at 390 × 844 with touch
```

Both runs check the layout rules in [docs/ui-guidelines-desktop.md](docs/ui-guidelines-desktop.md) and [docs/ui-guidelines-mobile.md](docs/ui-guidelines-mobile.md) and exit 1 if one is broken.

To see several human seats on one machine, open the room link in separate browser profiles or private windows (the seat is remembered per browser).

### Docker

Every push to `main` that passes the checks publishes `ghcr.io/dr-blank/auction-adda:latest` (amd64 and arm64), plus an immutable `sha-<commit>` tag. Version tags `v1.2.3` publish `1.2.3` and `1.2`.

```sh
docker compose pull && docker compose up -d   # run the latest release
docker compose up -d --build                  # or build from this checkout
```

Serves on `127.0.0.1:8787`; room files live in the `auction-adda-data` volume. The compose file binds to loopback only and trusts Cloudflare's `cf-connecting-ip` header, so put a tunnel (or another reverse proxy) in front for public access. To pin a release, replace `latest` with a `sha-…` or version tag.

The server runs as uid 1000 and will not start if it cannot write to `/data`. A volume Docker made fresh from the image already belongs to uid 1000; an older volume or a bind mount may belong to root. Fix it once:

```sh
docker run --rm -v auction-adda-data:/data alpine chown -R 1000:1000 /data
```

Logs go to stderr (`docker compose logs -f`). `RUST_LOG=debug` adds every connection, refused message and save.

## Settings

| Variable           | Default                    | Meaning                                                                                                                                                                                                    |
| ------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`             | `8787`                     | HTTP and WebSocket port                                                                                                                                                                                    |
| `HOST`             | `0.0.0.0`                  | Address to listen on; `::` for IPv6                                                                                                                                                                        |
| `DATA_DIR`         | `./data`                   | Where room files are kept; empty keeps rooms in memory only                                                                                                                                                |
| `SKIP_AFTER_MS`    | `30000`                    | How long a seat must be disconnected before the admin can skip it or free it, or (for the admin's seat) others can take admin                                                                              |
| `CREATE_LIMIT`     | `10`                       | Rooms one address may create per 10 minutes                                                                                                                                                                |
| `STATIC_DIR`       | `./dist`                   | Built frontend                                                                                                                                                                                             |
| `ALLOWED_ORIGINS`  | empty (any)                | Comma-separated origins allowed to open the WebSocket, e.g. `https://adda.example.com`                                                                                                                     |
| `TZ`               | `/etc/localtime`, else UTC | Time zone of log timestamps, e.g. `Asia/Kolkata`                                                                                                                                                           |
| `RUST_LOG`         | `info`                     | Log detail: `debug` adds every connection, refused message and save                                                                                                                                        |
| `CLIENT_IP_HEADER` | empty (socket address)     | Header holding the visitor's address behind a proxy, e.g. `cf-connecting-ip`. Set it only when the port is reachable through that proxy alone; otherwise anyone can forge it and get around `CREATE_LIMIT` |

Each one is also a command-line option; `auction-adda --help` lists them. Relative paths are relative to the working directory; the image sets `DATA_DIR=/data` and `STATIC_DIR=/app/dist`.

## During a game

- **Refresh or lost connection:** reopen the link in the same browser; you get your seat back.
- **Someone walked away:** once their seat has been disconnected for 30 seconds, the admin can press _Skip their move_ (they pass) or _Free seat_ (whoever opens the link next can take it over, with its hand and money).
- **Bidding by voice:** the room creator is admin (★). Open _Call it from voice_ on the stage to end the running auction with whatever the table agreed: pick the buyer and price, then confirm. The log shows who called it. The admin can hand the role over from the _Room_ menu; if the admin is away for 30 seconds, anyone can press _Become admin_.
- **Bots and kicking (admin):** on a disconnected player's seat, _Bot plays_ lets a bot move for them until they reopen the link; then the seat is theirs again. _Kick_ (in the player's seat sheet) takes the seat away for good: in the lobby the seat goes, in a game a bot plays it to the end.
- **Another game:** after the final result, the admin presses _New game, same players_.
- Rooms nobody has touched for 7 days are deleted.

## Layout

```text
crates/game/          what every game shares: seats, rule errors, the seeded generator, the Game
                      trait, and `check`, which plays any game at random against the rules all
                      games keep (tests/toy.rs is the smallest game, as a template)
crates/engine/        Auction Adda's rules: pure Rust, no I/O, no clock; config.json holds the constants
crates/server/        rooms, WebSocket protocol, persistence, static files (the auction-adda binary);
                      games.rs is the one place that names each game
src/generated/        TypeScript types and games.json written from the Rust types by cargo test (do not edit)
src/client/           the room around any game: home, lobby, seats' admin, reactions, the room menu,
                      the podium (chrome.tsx)
src/games/            one folder per game (its table, rules, lobby setup and themes); index.ts lists them
src/games/auction/    Auction Adda; its skins are in themes/, box-office is the first
scripts/              random-playing bots (bot.ts picks a move, bots.ts runs them), screenshots, state capture
test/                 the server as a black box over real sockets, rendered pages, theme and registry checks
```

A new theme is a folder in `src/games/auction/themes/`, an entry in its `index.ts` and a variant of `ThemeId` in `crates/server/src/protocol.rs` (listed in `ThemeId::ALL`, with `ThemeId::game` naming its game); the compiler and the tests refuse a theme that is missing on either side. The rules do not change. Theme names, titles and art must be invented: no real people, films, studios or logos.

### Adding a game

A room plays the game of its theme, so a new game is new themes plus:

1. A rules crate in `crates/` that implements `game::Game` (pure, seeded, no I/O). Its tests call `game::check::random_games::<YourGame>(n)`, which plays it at random and checks what the server relies on: who owes a move, skips, reseating, ending early, the state surviving the room file.
2. Its variants in `crates/server/src/games.rs` (the header lists every spot; the compiler finds the matches) and its themes in `ThemeId`. `cargo test` then writes its types and `src/generated/games.json`.
3. A folder in `src/games/` exporting a `GameClient` (`src/games/types.ts`): its table page, lobby setup, rules, themes. Register it in `src/games/index.ts`. The shared parts of a table page are in `src/client/chrome.tsx`.
4. Random moves for the socket bots, if `scripts/bots.ts` should play it.

Rules, names and art of a new game must be its own: game mechanics are free to reuse, but rule text, board art, names and logos of existing games are not.

## Licence

[AGPL-3.0](LICENSE). If you run a modified version for others, offer them its source; the home screen links to it.

The bundled Anton font is under the SIL Open Font License 1.1.
