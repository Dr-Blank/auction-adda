# UI guidelines: phone

How the table screen works on a phone, and the rules any change to it must keep. The desktop layout has its own file: [ui-guidelines-desktop.md](ui-guidelines-desktop.md). The visual language (colour, type, motion, sound) is shared and lives there.

"Phone" means a viewport up to 700 px wide. From 701 to 960 px (tablet portrait) the page is one column with the chart strip on top, but seats, stage and hand keep their desktop size.

## The one idea

**The screen shows facts; a tap explains them.**

A player who knows the game needs numbers, icons and pips, and needs them all at once. A new player needs sentences. Both get the same screen: by default it holds no explanatory text, and every element that carries meaning opens a sheet that spells it out.

This replaces hover. A phone has no hover, so nothing may be reachable by hover alone (see [Tap for more](#tap-for-more)).

## What must be on screen together

To decide a bid you compare three things. They must be visible at the same time, without scrolling, while the bid controls are up:

1. **The chart**: how many films of each star are out, and what a film pays now.
2. **The lot**: the film for sale, its auction type, the price and who leads.
3. **Your hand and money**: every card, not a scrolling row.

The layout pins the first and third to the screen edges and puts the lot between them:

```text
┌──────────────────────────────┐
│ SANKRANTI · season 1 of 4 ☰ 🔊 ? │  top bar
├──────────────────────────────┤
│ RR    CC    SA    BB    ZM  ⓘ│  chart strip   ← pinned to the top
│ ▮▮▯▯▯ ▮▯▯▯▯ ▯▯▯▯▯ ▮▮▮▯▯ ▯▯▯▯▯ │
│ ₹20   ₹10   –     ₹30   –    │
│ hand2 hand1 hand2 hand1 hand2│
├──────────────────────────────┤
│   (B1)      (B2)      (B3)   │  seats, one column each
│   Bot 1     Bot 2     Bot 3  │
│   ▯9        ▯8 [BB²]  ▯8     │
│ ┌──────────────────────────┐ │
│ │ [poster] ↻ ONCE AROUND ⓘ │ │  stage: the lot
│ │          ₹6 cr Bot 3 leads│ │
│ │          🔨 Seller: Bot 1 │ │
│ │ Bot 2 pass → Bot 3 ₹6 ▲ →│ │  order rail
│ └──────────────────────────┘ │
├──────────────────────────────┤
│ (TP)[RR] Your hand 8 ⓘIcons ₹55│  hand          ← pinned above the action bar
│ [✉][×2][×2][✉][✉][↻]         │
│ [⇈][✉]                       │
├══════════════════════════════┤
│ (−) ₹ 7 cr (+)    +5 +10 min │  action bar    ← docked to the bottom edge
│ [   Bid ₹7 cr   ] [  Pass  ] │     while you owe a move
└──────────────────────────────┘
```

If the screen is too short for everything (a small phone with a large hand), only the middle scrolls: seats and stage move under the pinned chart and hand. Below 600 px of height the hand stops being pinned so the lot is never squeezed out.

## Components

### Chart strip

Five equal cells, one per star, always in theme order. Each cell, top to bottom:

| Line | Shows | Example |
| --- | --- | --- |
| Face + initials | Which star (colour, portrait, two letters) | `RR` |
| Pips | Films played this season, out of 5; the last pip is dashed red | `▮▮▯▯▯` |
| Value | What one film pays if the season ended now; `flop` outside the top three; `–` if none played | `₹30 cr` |
| Hand | Films of that star in your hand, in gold; empty when none | `hand 2` |

- A star at 4 of 5 gets a red outline and a slow pulse. A shelved star flashes red with `Shelved` for about two seconds.
- The strip is one button. A tap opens the chart sheet: a key for the three kinds of mark, then the full row for every star with its rank label, medals from earlier seasons, and a sentence saying how the value was worked out.
- No labels, legends or headings in the strip itself. If a new number is ever added to it, it gets a line in the sheet's key.

### Seats

- One equal-width column per other player, so every seat is on screen. Never a sideways-scrolling row.
- Shown: avatar (ring pulses when they owe a move, 🔨 badge on the seller), name, card count, bought-film stacks.
- Not shown: the "bidding / pass / sells next" text chips. The order rail in the stage and the "Next seller" line carry that.
- Speech bubbles ("₹6 cr", "Pass") drop below the avatar, because the pinned chart would cover one above it.
- A tap anywhere on a seat opens its sheet: role, whether they owe a move, admin, cards in hand, connection, and each film bought this season with what was paid. Skip / Free seat / Become admin live in the sheet as full-size buttons.

### Stage (the lot)

- Poster on the left, facts on the right in this order: auction type, price and leader, seller and next seller. The order rail runs across the bottom.
- The poster keeps its auction-type badge, so type is stated twice: on the card and as the heading.
- The auction type heading is tappable (and has an ⓘ). It opens the auction-types sheet with the running type marked `now`. The one-sentence hint that sits beside the seller on a desktop is not shown.
- Two posters (a Double Feature pair) shrink so the facts still fit beside them.
- The sold / no bids / shelved moment stays inside the stage, in one row at its top.

### Hand

- Every card is on screen at once: small cards (auction icon top left, star initials at the bottom, star colour and art), wrapped in rows of six, sorted by star. No fan, no overlap, no sideways scroll.
- Film titles are not shown here. They do not affect a bid; the large view has them.
- Header, one line: your avatar, your bought stacks, "Your hand N", an `ⓘ Icons` button, your money in gold.
- Taps:
  - Not your turn to play: a tap opens the large view of that card (poster, auction type, star, the rule for that type).
  - Your turn to play: a tap selects the card. The stage shows it large with its auction type, and the action bar offers "Auction …".
  - `ⓘ Icons` opens the auction-types sheet (what ⇈ ↻ ✉ = ×2 mean).
- The hand is pinned above the action bar, with an opaque background, so the lot scrolls under it and never over it.

### Action bar

- Docked to the bottom edge whenever you owe a move, with a gold top border. When you do not owe a move it is a line of status text inside the stage.
- Bid box: `−` amount `+` and the `+5 +10 min` chips on one row, the main and secondary buttons on the next, at most one line of hint under them. "of ₹N" is dropped because your money is in the hand header right above.
- The main button is gold, names the action and the amount ("Bid ₹7 cr"), and is twice as wide as the secondary one.
- The amount field is never focused automatically. The on-screen keyboard would cover the hand and the lot; steppers and chips are enough to bid.
- Its height changes with its content. `Table.tsx` measures it into `--dock`; the hand and the page's bottom padding use that. Do not hard-code a height.

### Sheets

One component for all "more info": [Sheet.tsx](../src/client/Sheet.tsx).

- Rises from the bottom edge (thumb reach), at most 86% of the screen height, scrolls inside itself.
- Closes on the ✕ (44 px), a tap outside, or Escape. Sticky title.
- Content is plain sentences, complete without the screen behind it.
- A sheet never contains an action a player needs on their turn. Those stay on the table; sheets explain. The exceptions are rare and not part of a turn: the away-seat actions, and the admin's call.

### Admin controls

The app does not carry voice. When an auction is settled on Discord or a call instead of with the buttons, the room admin records the result (see the desktop file for the full behaviour).

- On the stage the admin sees one line under the lot: `🔨 Call it from voice · admin`. Nobody else sees it.
- A tap opens a sheet with full-size fields: "Sold to" (pre-filled with the leader), "for" (pre-filled with the high bid), `Call it…`, then a sentence to confirm. The sheet closes on confirm or when the lot changes.
- "Undo call" appears on the sold moment and on the stage until anyone moves.
- It is a sheet, not a panel: an inline form pushes the lot under the pinned hand, and a dedicated admin screen would take the admin away from the table they are also playing at.

## Tap for more

Every fact that a desktop shows in a tooltip, and every hint hidden to save space, has a tap target:

| You tap | You get |
| --- | --- |
| Chart strip | Key to pips, value and "hand N"; each star's rank, medals, past seasons and how its value is made up |
| Auction type on the stage (or its ⓘ) | All five auction types, the running one marked |
| `ⓘ Icons` in the hand header | The same sheet: what each card icon means |
| A hand card (not your turn) | Large poster, auction type, star, rule |
| A hand card (your turn) | Selects it; the stage shows it large with its type |
| A seat or your own avatar | Role, turn, admin, cards, money rule, connection, films bought with prices |
| Bought-film stack | Popover with the films and prices (also in the seat sheet) |
| `🔨 Call it from voice` (admin) | Sheet to record a result agreed on voice |
| ☰ | Full auction log, grouped per lot |
| ? | Room code, share link, admin hand-over, How to play |
| 🏆 | Last season's results again |

Rule for new work: if you add a `title="…"` attribute, you owe a tap path to the same words. If you hide text on a phone, it must appear in a sheet.

## Rules

### Touch

- Tap targets are at least 44 × 44 px for actions, 40 px for chips and steppers, with at least 6 px between neighbours. Small visuals get a larger invisible target (the whole seat, the whole chart strip).
- No gesture is required: no swipe, long-press, double-tap or drag. A tap does everything.
- No hover styles that stick after a tap (`@media (hover: none)` cancels the hand's hover lift).
- `touch-action: manipulation` on controls, so a fast second tap bids instead of zooming.

### Layout

- The page never scrolls sideways, and no part of it does either, except a wide results table inside the results sheet.
- Fixed and pinned elements: the chart strip (top), the hand (bottom), the action bar (bottom, only when you owe a move). Nothing else is fixed. Pinned elements have opaque backgrounds.
- Use `dvh`, not `vh`, for full-height things: the browser's bars change the viewport height.
- Respect `env(safe-area-inset-bottom)` under the action bar and sheets.
- Grids that hold text use `minmax(0, 1fr)` tracks. An `auto` track grows to its longest sentence and pushes the layout off screen.

### Text and input

- Inputs are 16 px or larger, or iOS zooms the page on focus.
- Numeric input uses `inputMode="numeric"`.
- Never autofocus a field on touch.
- Body text is not smaller than 0.78 rem; the two smallest labels (chart "hand N", stack counts) are 0.68 rem and must stay two words at most.

### Content

- Default screen: numbers, icons, pips, names. No sentences except the status line and one hint in the action bar.
- One meaning per mark, the same mark everywhere: an auction icon on a hand card is the same icon on the stage heading, in the sheet and in the rules.
- Colour is never the only signal: stars have initials and a glyph, a hot star has four filled pips, a lead has ▲.
- Gold is for you (see the desktop file). On the phone that is: your money, "hand N" in the chart, the action bar border, the main button, your stop on the rail.

## How to check

Automated, in headless Chromium at 390 × 844 with touch emulation, playing a whole game against bots:

```sh
npm run build && PORT=8799 DATA_DIR= CREATE_LIMIT=1000 npm start &
node scripts/screenshots.mjs ./shots/phone 120 phone
```

It exits 1 if, on any tick: the page scrolls sideways; the chart strip is off screen or does not show five stars; any hand card is off screen, under the action bar or under the strip; the hand scrolls sideways; the lot is covered; an action-bar control is off screen or under 40 px tall; a sheet (chart, auction types from the stage, auction types from the hand, seat) fails to open on a tap, is wider than the screen, or fails to close; a seat's sheet lists a different number of films than its stacks show.

By hand, on a real phone, because a script cannot judge these:

- **Thumb test:** play a full season one-handed. Every bid, pass and card play is reachable without shifting grip.
- **Glance test:** mid-auction, without scrolling, answer: what is for sale, what type, the price, who leads, how many of that star are out, how many you hold, your money.
- **New-player test:** hand the phone to someone who has not played. Every question they ask ("what does ✉ mean?", "why ₹30?") should be answerable by tapping the thing they are asking about.
- **Keyboard test:** tap the amount to type a bid. The page must not zoom, and the action bar must stay usable above the keyboard.
- **Small phone:** repeat at 360 × 640 with 12 or more cards in hand.
