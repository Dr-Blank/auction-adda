# Auction Adda — Plan

Self-hosted multiplayer auction card game for friends on Discord voice. Browser-based, join by link, server enforces every rule, hidden information stays hidden, scoring is automatic. Themes are swappable skins over one rules engine; v1 ships the **Box Office** theme.

Status: **playable locally (M1–M4 built and tested, Docker image builds). Not deployed.** How to run: [README.md](README.md).

## Changes from the first draft

| # | Flaw | Fix |
| --- | --- | --- |
| 1 | **boardgame.io fought the design.** Unmaintained since 2022, and the draft needed a workaround for almost every feature: fixed `numPlayers`, `redact`, `ignoreStaleStateID`, a fake lobby phase. Two requirements could not be expressed at all: a move made on behalf of another player (skip), and a rule that depends on connection time (the 30-second gate), because moves cannot see connection state. | Dropped. The rules were already pure functions; a small own server (`node:http` + `ws`, about 300 lines) holds rooms, applies actions, and sends each seat its own redacted view. One runtime dependency. |
| 2 | **Host was a single point of failure.** Only the room creator could start, skip or release, so a host who dropped blocked the table. | No host role for running the table. Any seated player can start, skip and release. Skip and release still need the target seat to have been disconnected for 30 seconds. One later exception: a **room admin** (the creator) may call auction results agreed on voice; the role can be handed over, and anyone can take it once the admin has been away 30 seconds, so it never blocks the table. |
| 3 | **Skip of a fixed-price setter returned cards to hand**, which for a double lot means two different hands. | Skipped price-setter takes the lot free (same outcome as "no bids"). |
| 4 | **Automatic passes leaked hidden information.** The first draft passed players automatically when they had no money, and an early build extended that to anyone who could not outbid. Either one tells the table what a player cannot afford. | The server never acts for a player because of their money or hand. Everyone presses their own pass / done / decline, as at a real table. The only automatic move is the skip of a disconnected seat. |
| 5 | **Round-end screen needed someone to press continue** (another blocker). | Scoring and the next deal happen at once; the summary is an overlay each player dismisses on their own. |
| 6 | Start player of rounds 2–4 was unspecified. | Left of the player who played the round-ending card. |
| 7 | Open rules questions (5 × 5 table, tie-break, 0 price, fewer than three suits). | All locked below. |
| 8 | Rematch was undecided. | In v1: "New game" keeps the room, link and seats. |

## Goals

- 3–5 players, each on their own device, joined via a link pasted in Discord.
- Server-authoritative rules: no trust needed, no manual card shuffling, no manual money counting.
- Private hands, money and sealed bids; public purchases, value chart and auction log.
- Reconnect-safe: refresh or drop and rejoin the same seat.
- Nobody can block the table by walking away.
- Free to run: self-hosted on the home server, no paid services.
- Fully legal: original names, art and text (see Legal guardrails).

## Stack

| Layer | Choice | Reason |
| --- | --- | --- |
| Rules | Pure TypeScript, `(state, seat, action) → state` or throws `RuleError` | Testable without a server; no framework lock-in |
| Server | Node (`node:http` + `ws`), runs the `.ts` sources directly with Node's built-in type stripping | One process serves the built frontend and the WebSocket; no build step for the server |
| Frontend | React + Vite + TypeScript | |
| Persistence | One JSON file per room on a Docker volume, atomic write on every change | Games survive restarts |
| Packaging | Single Docker image + compose file | Deployed as a dockge stack |
| Public access | Cloudflare Tunnel → subdomain | Free HTTPS, no port forwarding, home IP hidden |
| Tests | Vitest: rules unit tests, random full games per player count, and a real-socket multi-client game | Rules are the risk |

No accounts. A player picks a display name; the server issues a random seat token kept in browser `localStorage`, so a refresh restores the seat.

## Architecture

```text
auction-adda/
  src/
    engine/          # theme-agnostic rules: no React, no server, no theme imports
      types.ts       # Card, GameState, Action, View
      config.ts      # PLAYER_CONFIG, CARD_TABLE, token values
      deck.ts        # deck build + seeded shuffle
      game.ts        # newGame, applyAction, pending, neutralAction
      view.ts        # viewFor(state, seat): redaction
    themes/
      ids.ts         # theme id list only (safe for the server to import)
      types.ts       # Theme interface
      index.ts       # theme registry (client only: contains JSX)
      box-office/    # v1 theme: skin, strings, poster renderer
    client/          # React UI (home, lobby, table, auction stage, overlays)
    server/          # rooms, protocol, persistence, static files
    protocol.ts      # message types shared by client and server
  scripts/bots.ts    # random-playing bots for solo testing
  test/
  Dockerfile
  compose.yaml
```

### Server protocol

One WebSocket at `/ws`, JSON messages.

| Client → server | Meaning |
| --- | --- |
| `create {theme, name}` | New room; sender takes seat 0 |
| `join {room, token?, name?}` | With a valid token: re-attach to that seat. Without: take a seat if the room is in the lobby and a name is given, else watch as spectator |
| `claim {seat, name}` | Take a seat that was released mid-game |
| `start` | Lobby → game, with the seats that are filled (3–5) |
| `action {action}` | A game move for the sender's seat |
| `skip {seat}` | Neutral move for a seat disconnected ≥ 30 s |
| `release {seat}` | Clear a seat's token (lobby: any time; in game: disconnected ≥ 30 s) |
| `leave` | Give up own seat (lobby only) |
| `rematch` | After game end: new game, same seats |
| `rule {winner, price}` | Admin only: end the running auction now, sold to `winner` for `price` (`winner` null = no sale, seller keeps it free). Normal payment rules; refused during a double offer or above the buyer's money. Logged with `by` |
| `admin {seat}` | Admin hands the role to `seat`; anyone else may name themselves once the admin has been away ≥ 30 s |

Server → client: `joined {room, seat, token}`, `state {…}` (room info plus this seat's redacted game view, sent to everyone after every change), `error {message}`.

### Theme system

The engine deals only in suits `0–4`, auction types and integer money. A theme provides everything visible:

```ts
interface Theme {
  id: string;
  title: string;
  tagline: string;
  money(n: number): string;
  suits: [SuitSkin, SuitSkin, SuitSkin, SuitSkin, SuitSkin]; // name, short name, genre, colours
  auctionLabels: Record<AuctionType, string>;
  auctionHints: Record<AuctionType, string>;
  roundNames: [string, string, string, string];
  rankLabels: [string, string, string]; // 30 / 20 / 10 tokens
  strings: UiStrings;
  renderCard(card: Card, size: 'sm' | 'md' | 'lg'): JSX.Element; // procedural SVG, seeded by card id
}
```

The room creator picks the theme; only the theme **id** is stored in the room so every client renders the same skin. The server checks the id against `themes/ids.ts` and never imports theme code. New theme = new folder + registry entry; engine untouched.

## Rules specification

### Components

- 70 cards across 5 suits. Suit order is fixed and doubles as the tie-breaker (lower index wins ties).
- Each card carries one auction type:

| Suit | Cards | Open | Once-around | Sealed | Fixed | Double |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 12 | 3 | 3 | 2 | 2 | 2 |
| 1 | 13 | 3 | 2 | 3 | 3 | 2 |
| 2 | 14 | 3 | 3 | 3 | 3 | 2 |
| 3 | 15 | 3 | 3 | 3 | 3 | 3 |
| 4 | 16 | 4 | 3 | 3 | 3 | 3 |

- Each player starts with 100 (displayed in theme currency).
- Value tokens: 30 / 20 / 10, one set per round, 4 rounds.

### Dealing

| Players | Round 1 | Round 2 | Round 3 | Round 4 |
| --- | --- | --- | --- | --- |
| 3 | 10 | 6 | 6 | 0 |
| 4 | 9 | 4 | 4 | 0 |
| 5 | 8 | 3 | 3 | 0 |

Cards not played carry over between rounds.

**Player count is data, not code.** `PLAYER_CONFIG` in `src/engine/config.ts` drives everything count-dependent. Supporting a new count = add one row. The room has up to `MAX_PLAYERS` seats; the game starts with however many are filled, as long as that count has a row. Tests run full simulated games for every key.

### Turn

Active player (the auctioneer) plays one card from hand; its auction type runs. Play passes clockwise. A player with an empty hand is skipped as auctioneer but still bids. The first player of round 1 is chosen at random (so a rematch does not always start with the same seat); later rounds start left of the player who played the round-ending card.

### Auction types

- **Open:** any player (auctioneer included) may bid at any time, each bid higher than the current high. The auction ends when every non-leading player is "done"; a new bid clears the flags. Bids and "done" presses arrive concurrently, so both carry the high bid the player was looking at: `bid(amount, seenHigh)` and `done(seenHigh)`. The server rejects a stale `seenHigh`, so nobody is marked done against a bid they never saw.
- **Once-around:** starting left of the auctioneer and ending with the auctioneer, each player bids once (higher than current) or passes.
- **Sealed:** every player including the auctioneer submits one hidden bid; server reveals all at once. Tie: auctioneer wins if tied, else the tied player nearest clockwise from the auctioneer.
- **Fixed-price:** auctioneer sets a price from 0 up to their own money. Clockwise from the auctioneer's left, each player accepts or passes; first accept buys. If nobody accepts, the auctioneer buys at that price.
- **Double:** the player plays a double card and may add a second card of the same suit that is not a double; the second card's auction type governs the auction of both cards as one lot. If the player does not add one, the opportunity passes clockwise; whoever adds a card becomes the auctioneer. If nobody adds, the player who played the double takes it for free. Play continues left of whoever was auctioneer.

### Payment

- Winner pays the auctioneer.
- Auctioneer winning their own auction pays the bank.
- No bids: auctioneer takes the card(s) free.
- No player may bid more than their current money.

### Edge cases (each has a test)

- **No automatic moves.** A player who cannot afford a bid, or holds no card to add to a double, still presses pass / done / decline / seals 0 themselves. Anything automatic would reveal their money or hand. Their own screen tells them privately that they cannot bid.
- Sealed bid of 0 means "pass". All bids 0: auctioneer takes the lot free.
- Once-around with no bids before the auctioneer's turn: auctioneer takes the lot free without bidding.
- Fixed price of 0 is legal and offered around like any other price (no special case).
- Double, second card supplied by another player: that player is the auctioneer for all purposes (sets the fixed price, bids last in once-around, wins sealed ties, receives the full payment). The player who played the double card receives nothing.
- Double, a player holding a matching card may still decline to add it.
- Double as the 4th card of a suit with a second card that would be the 5th: the round ends, neither card is auctioned, both count for ranking.
- Double card that is itself the 5th of its suit: the round ends at once; a second card played with it stays in hand.
- Players skipped by a double pass-around lose that turn; play resumes left of the new auctioneer.
- Only suits with at least one card played this round can receive a token, so fewer than three tokens may be awarded.
- Game-end tie: all tied players share the win.

### Absent players

With no timers, one player who walks away would block every auction type.

- The UI shows each seat's connection state.
- Any seated player can press "skip" on a seat that has been disconnected for 30 seconds and owes an action. The server then makes the neutral move for it: pass, done, sealed bid 0, decline to add a second card. Auctioneer's turn: plays nothing and the turn passes. Owes a fixed price: takes the lot free.
- Any seated player can release a seat that has been disconnected for 30 seconds (browser lost its token, player switched device). A released seat keeps its hand and money and can be claimed by whoever opens the link next.
- The 30-second gate is checked on the server, so skip cannot be used against a player who is merely thinking.

### Round end

The round ends immediately when a 5th card of any one suit is played (counting cards played this round, including both cards of a double lot). That card or lot is not auctioned. Also ends when all hands are empty.

### Scoring

1. Rank suits by cards played this round; ties broken by fixed suit order; suits with no cards are not ranked.
2. Top three suits receive 30 / 20 / 10 tokens on the value chart for this round.
3. A card's value = sum of its suit's tokens across all rounds so far, **only if** that suit placed top three this round; otherwise 0.
4. Bank pays each player for every card they bought this round; those cards are discarded.

### Game end

After round 4 scoring. Highest money wins; ties share. All money totals are revealed.

### Hidden information (`viewFor`)

- Hidden from others: hand contents, money total, unrevealed sealed bids, deck order, shuffle seed.
- Public: hand sizes, purchased cards, value chart, current auction state, auction log.
- A client with no seat (spectator) receives the public view only.
- Money is hidden in the same sense as at a physical table: every price in the log is public, so someone who adds them all up can derive every total. Accepted; the UI does not do the sum, and the server gives no shortcut (see "No automatic moves").
- The server never sends the full state to anyone; a test plays a whole game over real sockets and asserts no view contains another seat's hand.

## v1 theme: Box Office

| Game element | Box Office skin |
| --- | --- |
| Players | Producers, start with ₹100 crore |
| Suits | Five fictional superstars (draft names, editable in theme file): Veer Pratap (action), Kavya Malhan (romance), Selvam Anna (mass hero), Babloo Bhaiya (comedy), Zoya Mirza (art-house). Must not match any real person. |
| Cards | Procedurally generated film posters: genre palette, generated title (e.g. *Dil Se Dhokha 2*, *Inteqam: Returns*), tagline, seeded per card |
| Auction types | Open → Khuli Boli · Once-around → Ek Round · Sealed → Band Lifafa · Fixed → Fixed Rate · Double → Double Feature |
| Rounds | Release windows: Sankranti, Summer, Eid, Diwali |
| Tokens | Blockbuster / Superhit / Hit |
| Value chart | Box Office Chart |
| 5th card | "Overexposed! 5th film shelved." |

## UI

Single game screen:

- **Top:** value chart (5 suits × 4 rounds of tokens) plus this round's count per suit, highlighting suits close to the 5th card.
- **Centre:** auction stage — card(s), auction type, high bid and bidder, controls adapted to the auction type (bid input with quick-raise buttons, pass, done, accept).
- **Around:** opponents — name, hand size, purchased cards, turn and connection indicators, skip / release when allowed.
- **Bottom:** own hand (click to play) and own money.
- **Side:** auction log.
- **Overlays:** round-end scoring breakdown, game-end results with "New game".
- **Lobby:** create room (choose theme), copy link, pick name; anyone seated presses Start once 3–5 seats are filled.
- "Your turn" sound ping (generated with WebAudio, no asset files) and tab-title marker. Desktop first, phone-usable.

## Legal guardrails

- Game mechanics are not copyrightable; names, art and text are. Everything visible is original.
- No real actors, films, studios or logos; no likeness of real people.
- No "Modern Art" or designer branding anywhere in the product.
- Rules and UI text written from scratch.
- Dependencies under permissive licences only (MIT / Apache-2.0 / BSD / ISC).
- Repositories without a licence are reference-only: read for rules cross-checking, never copy code.
- Private use among friends; no monetisation.

## Milestones

| # | Work | State |
| --- | --- | --- |
| M0 | Rules locked | done |
| M1 | Skeleton, rules engine, tests (unit + random full games per player count) | done |
| M2 | Server: rooms, protocol, persistence, reconnect, skip/release; real-socket test | done |
| M3 | UI: home, lobby, table, auction controls, overlays | done; checked in headless Chromium against bots (full game, refresh, skip, free seat) |
| M4 | Box Office theme: poster generator, strings, sound | done; sound not yet heard by a human |
| M5 | Dockerfile + compose; deploy to dockge + Cloudflare Tunnel; playtest with friends | image builds and runs locally; deploy only on explicit go |

Not yet done: a playtest with real people (several browsers at once, phones), and taking a released seat through the UI (covered by a server test only).

## Deployment

- Build and test locally first.
- Each deploy step (image build, dockge stack, tunnel route) explained and run only on explicit go.
- Rollback: stop stack, remove tunnel route. Nothing else on the server changes.

### Public exposure

The subdomain is reachable by anyone, and anyone can create a room, which is written to disk.

- Room cap (200) and deletion of rooms untouched for 7 days (at startup and hourly).
- Per-IP limit on room creation; WebSocket message size cap; names trimmed to 20 characters.
- Optional `ALLOWED_ORIGINS` check on the WebSocket upgrade.
- Room codes are 6 random characters; seat tokens are 128-bit random and never sent to other clients.
- Container runs as a non-root user with only the data volume writable.

## Open items

- [ ] Dockge host / LXC
- [ ] Cloudflare domain and subdomain; existing `cloudflared` or new tunnel
- [ ] Final superstar names for the Box Office theme

## TODO (after v1)

- [ ] Theme: **Boli Lagao!** — cricket player auction, fictional franchises, ₹ crore
- [ ] Theme: **Kala Bazaar** — Indian folk art (Madhubani, Warli, Gond, Pattachitra, Kalamkari)
- [ ] Theme: **Aam Mandi** — mango wholesale (Alphonso, Kesar, Langra, Dasheri, Banganapalli)
- [ ] Theme: **Resham** — handloom sarees (Banarasi, Kanjeevaram, Paithani, Patola, Chanderi)
- [ ] Game: **For Sale** on the same lobby and theme system
- [ ] Bot players for empty seats
- [ ] Optional turn timers, game history
- [ ] Auto-skip a seat that stays away, so the others need not press skip on every auction
- [ ] Discord Activity embed
