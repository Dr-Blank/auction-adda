# Auction Adda

A browser auction card game for 3–5 friends on voice chat. One person creates a room and pastes the link; everyone plays from their own device. The server enforces the rules, keeps hands, money and sealed bids private, and does the scoring.

## Run it

Needs Node 24 or newer (the server runs its TypeScript sources directly).

```sh
npm install
npm run build     # builds the frontend into dist/
npm start         # http://localhost:8787
```

Rooms are saved in `data/` and survive restarts.

### Development

```sh
npm run server    # game server on :8787
npm run dev       # frontend on :5173 with hot reload, proxies /ws to the server
npm test          # rules tests, random full games, real-socket game
npm run typecheck
```

### Try it alone

Open the app, create a room, then seat bots that play random legal moves:

```sh
npm run bots -- ABC234 3          # 3 bots join room ABC234; you press Start
npm run bots -- ABC234 3 --delay 400
npm run bots -- --create 2 --admin human --open   # bots make a room and open it; you join as admin
npm run bots -- last 1 --drop-after 10 --rejoin-after 45   # a bot that drops mid-game and comes back
```

`last` means the room most recently created or joined by the bots script. The header of [scripts/bots.ts](scripts/bots.ts) lists every option (auto start, rematch, admin hand-off, dropping and rejoining).

In VS Code, *Tasks: Run Task* has all of this ready: dev servers (including an in-memory one where seats unlock after 5 s), room and bot scenarios that ask for their settings, tests, typecheck and screenshots.

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

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | HTTP and WebSocket port |
| `HOST` | all interfaces | Address to listen on |
| `DATA_DIR` | `./data` | Where room files are kept; empty keeps rooms in memory only |
| `SKIP_AFTER_MS` | `30000` | How long a seat must be disconnected before others can skip it, free it or take admin |
| `CREATE_LIMIT` | `10` | Rooms one address may create per 10 minutes |
| `STATIC_DIR` | `./dist` | Built frontend |
| `ALLOWED_ORIGINS` | empty (any) | Comma-separated origins allowed to open the WebSocket, e.g. `https://adda.example.com` |
| `CLIENT_IP_HEADER` | empty (socket address) | Header holding the visitor's address behind a proxy, e.g. `cf-connecting-ip`. Set it only when the port is reachable through that proxy alone; otherwise anyone can forge it and get around `CREATE_LIMIT` |

## During a game

- **Refresh or lost connection:** reopen the link in the same browser; you get your seat back.
- **Someone walked away:** once their seat has been disconnected for 30 seconds, any player can press *Skip their move* (they pass) or *Free seat* (whoever opens the link next can take it over, with its hand and money).
- **Bidding by voice:** the room creator is admin (★). Open *Call it from voice* on the stage to end the running auction with whatever the table agreed: pick the buyer and price, then confirm. The log shows who called it. The admin can hand the role over from the *Room* menu; if the admin is away for 30 seconds, anyone can press *Become admin*.
- **Another game:** after the final result, *New game, same players*.
- Rooms nobody has touched for 7 days are deleted.

## Layout

```text
src/engine/     rules: pure TypeScript, no UI or network
src/server/     rooms, WebSocket protocol, persistence, static files
src/themes/     skins; box-office is the first
src/client/     React UI
scripts/bots.ts random-playing bots
test/           rules, random full games, server
```

A new theme is a folder in `src/themes/` plus one line in `ids.ts` and `index.ts`; the rules do not change. Theme names, titles and art must be invented: no real people, films, studios or logos.

## Licence

[AGPL-3.0](LICENSE). If you run a modified version for others, offer them its source; the home screen links to it.

The bundled Anton font is under the SIL Open Font License 1.1.
