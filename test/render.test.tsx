// @vitest-environment happy-dom
// The pages as they render from real `state` messages (test/fixtures/states/, written by
// scripts/capture-states.ts). A snapshot change is a change in what players see: review it, then
// accept it with `npx vitest run -u`.

import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Home } from "../src/client/Home.tsx";
import type { RoomState } from "../src/client/net.ts";
import { Room } from "../src/client/Room.tsx";
import { rng } from "../src/rng.ts";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const load = (dir: string) =>
  fs
    .readdirSync(path.join(import.meta.dirname, dir))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map(
      (f) =>
        [
          f.replace(/\.json$/, ""),
          JSON.parse(fs.readFileSync(path.join(import.meta.dirname, dir, f), "utf8")),
        ] as const,
    );
/** Auction Adda (scripts/capture-states.ts) and Pahunch (scripts/capture-pahunch.ts). */
const states = load("fixtures/states");
const pahunch = load("fixtures/pahunch");

/** States also checked at phone width. */
const PHONE_TOO = ["lobby-admin", "your-play", "open-buying-bid", "over"];
const PAHUNCH_PHONE_TOO = ["your-move", "vote-voter", "favour-asked", "over"];

// React wants to know it runs inside act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "setInterval", "requestAnimationFrame"] });
  vi.setSystemTime(NOW);
  // Confetti and the like: the same "random" every run.
  vi.spyOn(Math, "random").mockImplementation(rng(1));
  localStorage.clear();
  document.title = "Auction Adda";
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** FNV-1a, as hex: stands in for long drawings, which still fail the snapshot when they change. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function render(node: React.ReactNode): string {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  act(() => root.render(node));
  const html = el.innerHTML.replace(/(<svg[^>]*>)([\s\S]*?)<\/svg>/g, (_, open: string, body: string) =>
    body.length > 200 ? `${open}#${hash(body)}</svg>` : `${open}${body}</svg>`,
  );
  act(() => root.unmount());
  return html;
}

function room(state: object) {
  const s = { ...state, receivedAt: NOW } as RoomState;
  return render(<Room state={s} send={() => {}} join={() => {}} reactions={[]} />);
}

describe("room pages", () => {
  it.each(states)("%s", (_, state) => {
    expect(room(state)).toMatchSnapshot();
  });

  it.each(states.filter(([name]) => PHONE_TOO.includes(name)))("%s on a phone", (_, state) => {
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width: 390,
      height: 844,
    });
    expect(room(state)).toMatchSnapshot();
  });
});

describe("pahunch pages", () => {
  beforeEach(() => {
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width: 1024,
      height: 768,
    });
  });

  it.each(pahunch)("%s", (_, state) => {
    expect(room(state)).toMatchSnapshot();
  });

  it.each(pahunch.filter(([name]) => PAHUNCH_PHONE_TOO.includes(name)))("%s on a phone", (_, state) => {
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width: 390,
      height: 844,
    });
    expect(room(state)).toMatchSnapshot();
  });

  it("shows no one else's points before the end", () => {
    for (const [name, state] of pahunch.filter(([n]) => n !== "over" && n !== "ended-early" && n !== "lobby-admin")) {
      const el = document.createElement("div");
      document.body.append(el);
      const root = createRoot(el);
      act(() =>
        root.render(<Room state={{ ...state, receivedAt: NOW }} send={() => {}} join={() => {}} reactions={[]} />),
      );
      // Other players' chips never show points; your own points are in your tray.
      const shown = [...el.querySelectorAll(".ph-seat-chip")].filter((c) => c.querySelector(".ph-points"));
      const me = (state as { you: number | null }).you;
      expect(
        shown.map((c) => Number((c as HTMLElement).dataset.seat)),
        name,
      ).toEqual([]);
      expect(!!el.querySelector(".ph-tray .ph-score"), name).toBe(me !== null);
      act(() => root.unmount());
    }
  });

  it("offers the moves of the room you tap", () => {
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    const sent: unknown[] = [];
    const state = { ...Object.fromEntries(pahunch)["your-move"], receivedAt: NOW } as RoomState;
    act(() => root.render(<Room state={state} send={(m) => sent.push(m)} join={() => {}} reactions={[]} />));
    // The board comes first: no move buttons until something on it is tapped.
    expect(el.querySelectorAll(".ph-pick .ph-move").length).toBe(0);
    const tap = (e: Element) => act(() => e.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    // Room A, then a way up from it (a button, or room B on the board): the facts, then the move.
    const from = [...el.querySelectorAll(".ph-room.live")].find((r) => {
      tap(r);
      const way = el.querySelector(".ph-pick .ph-then");
      if (!way) tap(r);
      return !!way;
    });
    expect(from, "a room with a way up").toBeDefined();
    const target = el.querySelector(".ph-room.target") as SVGGElement;
    tap(target);
    expect(sent).toHaveLength(0);
    expect(el.querySelectorAll(".ph-facts li").length).toBeGreaterThan(0);
    act(() => (el.querySelector(".ph-pick .ph-move:not(.ph-then)") as HTMLButtonElement).click());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "action" });
    act(() => root.unmount());
  });

  it("asks another player for their favour from their chip", () => {
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    const sent: unknown[] = [];
    const state = { ...Object.fromEntries(pahunch)["your-move"], receivedAt: NOW } as RoomState;
    act(() => root.render(<Room state={state} send={(m) => sent.push(m)} join={() => {}} reactions={[]} />));
    const chip = el.querySelector(".ph-fav-btn.live") as HTMLButtonElement;
    const owner = Number((chip.closest(".ph-seat-chip") as HTMLElement).dataset.seat);
    act(() => chip.click());
    const ask = [...document.querySelectorAll(".sheet .btn.primary")].find((b) => b.textContent?.startsWith("Ask"));
    act(() => (ask as HTMLButtonElement).click());
    expect(sent).toEqual([{ type: "action", action: { type: "request", owner, on: true } }]);
    act(() => root.unmount());
  });

  it("answers a request for your favour from the bar", () => {
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    const sent: unknown[] = [];
    const state = { ...Object.fromEntries(pahunch)["favour-asked"], receivedAt: NOW } as RoomState;
    act(() => root.render(<Room state={state} send={(m) => sent.push(m)} join={() => {}} reactions={[]} />));
    const buttons = el.querySelectorAll(".ph-request .ph-move");
    expect(buttons).toHaveLength(2);
    act(() => (buttons[1] as HTMLButtonElement).click());
    act(() => (buttons[0] as HTMLButtonElement).click());
    expect(sent).toEqual([
      { type: "action", action: { type: "decline" } },
      { type: "action", action: { type: "lend", on: true } },
    ]);
    act(() => root.unmount());
  });
});

describe("seats that are away, played by bots or open", () => {
  type Seat = { connected: boolean; awayMs: number | null; bot: boolean; open: boolean };
  /** The admin's view mid-game with seat 2 away past the skip time, seat 3 a stand-in bot and seat 1 a freed bot seat. */
  function awayState(): object {
    const s = structuredClone(Object.fromEntries(states)["their-play"]) as { room: { seats: Seat[] } };
    Object.assign(s.room.seats[2], { connected: false, awayMs: 45_000 });
    Object.assign(s.room.seats[3], { bot: true, connected: false, awayMs: 45_000 });
    Object.assign(s.room.seats[1], { bot: true, open: true });
    return s;
  }

  beforeEach(() => {
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width: 1024,
      height: 768,
    });
  });

  it("shows each seat's status and the admin's quick buttons", () => {
    expect(room(awayState())).toMatchSnapshot();
  });

  it.each([1, 2, 3])("opens seat %i's sheet with what the admin can do", (seat) => {
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    const s = { ...awayState(), receivedAt: NOW } as RoomState;
    act(() => root.render(<Room state={s} send={() => {}} join={() => {}} reactions={[]} />));
    act(() => (el.querySelector(`[data-seat="${seat}"] .avatar-btn`) as HTMLButtonElement).click());
    // A sheet may render outside the room's element.
    const sheet = document.querySelector('[role="dialog"]');
    expect(sheet?.outerHTML.replace(/(<svg[^>]*>)([\s\S]*?)<\/svg>/g, "$1#</svg>")).toMatchSnapshot();
    act(() => root.unmount());
  });
});

describe("home", () => {
  it("renders the start page with a saved name and rooms", () => {
    localStorage.setItem("aa:name", "Asha");
    const html = render(
      <Home
        send={() => {}}
        online
        myRooms={[
          {
            code: "ABC234",
            theme: "box-office",
            stage: { t: "playing", round: 1 },
            players: ["Asha", "Bilal", "Chitra"],
            seat: 0,
            admin: true,
            idleMs: 60_000,
            expiresInMs: 6 * 24 * 3600 * 1000,
          },
        ]}
        listRooms={() => {}}
      />,
    );
    expect(html).toMatchSnapshot();
  });
});
