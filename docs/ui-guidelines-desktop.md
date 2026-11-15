# UI guidelines: desktop

How the table screen works on a wide screen with a mouse and keyboard, the visual language shared by every screen size, and the rules any change must keep. The phone layout has its own file: [ui-guidelines-mobile.md](ui-guidelines-mobile.md).

"Desktop" means a viewport wider than 960 px. Seats form an arc from 1100 px.

## The idea

**A table, a stage and a hand; not a dashboard.**

The screen is a card table seen from your seat. The other players sit across from you, the lot being sold is the one raised object in the middle, your cards are in front of you, and the chart hangs on the wall to the right. Anything that is not one of those lives behind an icon in the top bar.

There is room for text here, so the desktop shows short hints in place (the auction rule beside the seller, "5th film of a star ends the season" under the chart title) and uses tooltips for the rest.

## Layout

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ AUCTION ADDA  SANKRANTI · season 1 of 4                 ☰ Log  🔊  ? Room │
├───────────────────────────────────────────────────┬──────────────────────┤
│      (B1) Bot 1        (B2) Bot 2       (B3) Bot 3 │ BOX OFFICE CHART     │
│      ▯▯▯ 7  [BB]       ▯▯▯ 8            ▯▯▯ 8 [ZM] │ 5th film ends season │
│ ┌───────────────────────────────────────────────┐ │ (face) Rocket Rathore│
│ │ [ poster ]  ↻ ONCE AROUND                     │ │   ▮▮▯▯▯      ₹30 cr  │
│ │             No bids yet                       │ │ (face) Chahat Chandni│
│ │             🔨 Seller: Bot 1 · Next: Bot 2 ·  │ │   ▮▯▯▯▯      ₹20 cr  │
│ │                one bid each, seller last      │ │ …                    │
│ │  Bot 2 pass → Bot 3 pass → You to bid → Bot 1 │ ├──────────────────────┤
│ │ ───────────────────────────────────────────── │ │ LATEST               │
│ │  (−) ₹ 1 cr of ₹85 (+)  +5 +10 min  [Bid] [Pass]│ │ You buy … for ₹15 cr │
│ └───────────────────────────────────────────────┘ │ Bot 3 buys …         │
│ (TP) You   │ Your hand 8                    ₹85 cr │ [Full log]           │
│ [RR][CC]   │                                       │                      │
│  RR ×2      CC ×2      SA ×1     BB ×1     ZM ×2   │                      │
│ [card][card] [card][card] [card]  [card]  [card]…  │                      │
└───────────────────────────────────────────────────┴──────────────────────┘
```

- Two columns: the table (seats, stage, hand) and a 340 px side column (chart, latest) that sticks to the top while the table scrolls.
- Reading order top to bottom is turn order: others, the lot, you.
- The action bar is the bottom of the stage, directly under the lot it acts on.

## Components

### Top bar

Brand, season name and number, then icon buttons with labels: last results (after the first season), log, sound, room. Room code, share link, admin hand-over and How to play are in the Room menu. The share link shows on the table by itself while a seat is open.

### Seats

- The other players, clockwise from your left, so turn order reads left to right. Your own seat sits by your hand.
- Each seat: avatar (green ring connected, pulsing ring when they owe a move), one role badge (🔨 seller, 👑 winner), name with ★ for the admin, a chip saying what they are doing ("bidding", "pass"), "Sells next", card backs with a count, and the films they bought as small stacks by star.
- No boxes around seats; they sit on the felt.
- Hover, focus or click on the bought stacks opens the actual posters with what was paid. A click on the avatar opens the seat's sheet with everything in sentences.
- Events appear as speech bubbles on the seat that caused them ("₹6 cr", "Pass", "✉ Sealed") for about two seconds.

### Stage

- The only raised surface on the table. A gold inner border means you owe a move.
- Large poster, then: auction type in the display face, the price at 3.2 rem with who leads, seller and next seller with the one-sentence rule, and the order rail (seats in the order the auction visits them, each with its state).
- Idle: who is choosing, or "Your move: pick a film from your hand". Selecting a card previews it here with its rule before you commit.
- Sold / no bids / shelved: a stamp over the poster for about two seconds, the poster flies to the buyer's stacks, sealed bids are shown as envelopes. A click skips it.
- Admin only: "Call it from voice" folds out under the action bar (see [Admin controls](#admin-controls)), and "Undo call" shows until anyone moves.

### Admin controls

The app does not carry voice. Players talk on Discord or a call; when an auction is settled there instead of with the buttons, the room admin records the result so the game can go on.

- Shown to the admin only, on every running auction (open bidding included), as a fold-out under the action bar. It remembers whether it was left open.
- Two steps: pick the buyer and the price (pre-filled with the current leader and high bid), then confirm a sentence that states the result ("Bot 2 buys “Vardi Ka Vaada” for ₹21 cr"). "Nobody" means the seller keeps the lot free.
- The result is marked "(called by …)" in the log and on the sold moment, so everyone sees it was a call.
- "Undo call" is offered on the sold moment and on the stage until anyone makes the next move.
- It is a subview of the stage, not a panel of its own: one player has it, and only at the moment of a call. The admin role itself (who has it, handing it over) is in the Room menu.

### Bid box

`−` amount `+`, "of ₹N", `+5 +10 min`, then the gold main button and the secondary button. The amount is focused when the box appears.

| Key | Does |
| --- | --- |
| Enter | Bid / Seal / Set price |
| Esc | Pass / Done |
| ↑ ↓ | One more / one less |

The keys are printed on the buttons (hidden on touch screens).

### Hand

- Full posters, grouped by star with a "RR ×2" label, fanned within a group. Hovering a fan spreads it; hovering a card lifts it.
- Playable cards have a gold edge on your turn. Selected: lifted with a gold outline. During a Double Feature offer, matching cards have a dashed gold outline and the rest dim.
- A card you cannot play right now opens a large view on click (cursor: zoom-in).
- Your money, in gold, at the right of the header.

### Chart

One row per star: portrait, name and genre, "N in your hand" in gold, five pips (last one dashed red), the value of one film now with its rank label, and medals for earlier seasons.

- Tooltip on the value: how it is made up. Click on the medals: scores by season.
- At 4 of 5 the row pulses red with "1 more ends the season". A shelved star's row stays full and flashes for about two seconds.

### Latest and log

Latest: the last four results (sales, free takes, shelvings, season starts, undos). The full log is a drawer from the right, grouped per lot with bids folded under each result. Your own seat reads "You", in gold.

## Hover, and what backs it up

Hover is a convenience here, never the only way:

- Every tooltip's words are also reachable by click or focus (seat sheet, medals, large card view, the Room menu's rules).
- Hover popovers stay open while the pointer crosses to them, and pin on click.
- On a wide screen without hover (a tablet in landscape, a touch laptop) small ⓘ buttons appear next to the chart title, the auction type and the hand title. They open the same sheets as on a phone. With a mouse they are hidden.
- Everything works from the keyboard: Tab order follows the layout, focus is visible (2 px outline), Escape closes drawers, sheets and the large card view.

## Visual language (all screen sizes)

- **Gold is for you.** Your move, your money, your main button, "in your hand". Nothing else is gold, including the brand.
- **Star colours carry identity.** Stacks, pips, posters, chart cells. Each colour is paired with initials and a glyph, so nobody has to tell colours apart.
- **Two surface levels.** The felt (background with a vignette and grain) and raised objects (stage, cards, action bar, sheets). Seats and the chart sit on the felt without boxes.
- **Other signal colours:** violet for someone else's move, green for a lead or a sale, red for danger (4 of 5, shelved).
- **Type:** Anton (bundled, OFL) for titles, auction types, prices and money. system-ui for everything else. Georgia on posters. Money in tabular numerals.
- **Motion:** 150–250 ms for state changes, about 2 s for sold and shelved moments, a staged reveal for season results (skippable). Nothing loops except the "owes a move" pulse and the 4-of-5 warning. All motion is off under `prefers-reduced-motion`, and every animated event has a static form (stamp, number, chip).
- **Sound:** generated with WebAudio, no assets: turn, bid, pass, gavel, cash, fanfare. One mute toggle, remembered.
- **Words:** theme nouns everywhere (film, star, season), never engine terms. Your seat is "You". Buttons name the action and the amount.

## Rules

- The stage answers, without the log: what is for sale, how, the price, who leads, whose move it is, who sells next.
- One role badge per seat; states are chips or bubbles, not more badges.
- No new permanent panels. New information goes into the stage, a seat or the chart if it belongs to one; otherwise behind a top-bar icon.
- Private facts are marked as private where they could be mistaken for public ("Only you can see that").
- Destructive or table-wide actions (admin calls) take two steps and can be undone.
- A change for phones goes inside the `max-width` media queries or behind `useMedia`. The desktop tree and styles must not change as a side effect.

## How to check

Automated, in headless Chromium at 1300 × 900, playing one seat against three bots:

```sh
npm run build && PORT=8799 DATA_DIR= CREATE_LIMIT=1000 npm start &
node scripts/screenshots.mjs ./shots 120
```

It exits 1 if: the page scrolls sideways; the other players are not in the top row or your seat is not by your hand; the phone chart strip shows on the wide layout; the bought-films popover lists a different number of films than the stacks, is hidden, lacks a price, or stays open; an admin undo does not bring the lot back; the large card view fails to open or close; a shelving does not show on the chart before the results; the lobby does not show the admin; the page logs an error.

Headless Chromium has no mouse and reports `hover: none`, so its desktop screenshots include the small ⓘ buttons that a screen with a mouse hides.

By hand:

- **Five-second test:** show a mid-auction screenshot to someone who has not played. They should say whose turn it is, what is for sale, the price and who leads within five seconds.
- **No-log test:** play a season with the log closed. If anyone opens it to follow an auction, the stage is missing something.
- **Keyboard test:** play a season without the mouse.
- **Reduced-motion test:** with motion off, every event still shows.
