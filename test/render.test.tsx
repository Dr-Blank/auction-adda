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

const DIR = path.join(import.meta.dirname, "fixtures/states");
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const states = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => [f.replace(/\.json$/, ""), JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"))] as const);

/** States also checked at phone width. */
const PHONE_TOO = ["lobby-admin", "your-play", "open-buying-bid", "over"];

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
