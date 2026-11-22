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
    expect(sent, "nothing goes before the second tap").toHaveLength(0);
    // Back keeps the pick; the second tap sends the move.
    act(() => ([...el.querySelectorAll(".ph-confirm .ph-move")].at(-1) as HTMLButtonElement).click());
    expect(el.querySelector(".ph-pick .ph-move:not(.ph-then)")).not.toBeNull();
    act(() => (el.querySelector(".ph-pick .ph-move:not(.ph-then)") as HTMLButtonElement).click());
    confirmMove();
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
    const ask = [...document.querySelectorAll(".sheet .btn.primary")].find((b) => b.textContent?.includes("Ask"));
    act(() => (ask as HTMLButtonElement).click());
    confirmMove();
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
    const buttons = () => el.querySelectorAll(".ph-request .ph-move");
    expect(buttons()).toHaveLength(2);
    act(() => (buttons()[1] as HTMLButtonElement).click());
    confirmMove();
    act(() => (buttons()[0] as HTMLButtonElement).click());
    confirmMove();
    expect(sent).toEqual([
      { type: "action", action: { type: "decline" } },
      { type: "action", action: { type: "lend", on: true } },
    ]);
    act(() => root.unmount());
  });
});

/** Every Pahunch move waits in the confirm strip: the second tap sends it. */
function confirmMove() {
  const yes = document.querySelector(".ph-confirm-yes") as HTMLButtonElement | null;
  expect(yes, "the confirm strip").not.toBeNull();
  act(() => yes?.click());
}

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
        deleteRoom={() => {}}
      />,
    );
    expect(html).toMatchSnapshot();
  });
});

// Last in the file: React's ids count up across renders, so tests added earlier would shift the
// ids in every snapshot after them.
describe("pahunch at seven seats (the other side of the board)", () => {
  const seven = load("fixtures/pahunch-seven");

  it.each(seven)("%s", (_, state) => {
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width: 1024,
      height: 768,
    });
    expect(room(state)).toMatchSnapshot();
  });

  it.each(seven)("%s on a phone", (_, state) => {
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width: 390,
      height: 844,
    });
    expect(room(state)).toMatchSnapshot();
  });
});

describe("pahunch deals: asks for tokens and swaps", () => {
  /** Seat 2 (you, tokens 1 1 1) off turn: seat 0 asks you for 2, seat 3 offers 4 for your 1 + 1; you asked seat 1 for 1. */
  function dealState(): RoomState {
    const s = structuredClone(Object.fromEntries(pahunch)["their-move"]) as {
      game: { pleas: object[]; offers: object[]; pending: number[] };
    };
    s.game.pleas = [
      { by: 0, of: 2, count: 2 },
      { by: 2, of: 1, count: 1 },
    ];
    s.game.offers = [{ by: 3, to: 2, give: [4], want: [1, 1] }];
    s.game.pending = [1, 2];
    return { ...s, receivedAt: NOW } as unknown as RoomState;
  }

  it("answers an ask with a gift sheet set to its count, a swap with yes, and takes back your own ask", () => {
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    const sent: unknown[] = [];
    act(() => root.render(<Room state={dealState()} send={(m) => sent.push(m)} join={() => {}} reactions={[]} />));
    const bars = () => el.querySelectorAll(".ph-request");
    expect(bars()).toHaveLength(2);
    // The confirm strip takes the bar's place, so each button is found again after it.
    const button = (bar: number, k: number) => bars()[bar].querySelectorAll(".ph-move")[k] as HTMLButtonElement;
    act(() => button(0, 1).click());
    confirmMove();
    act(() => button(1, 0).click());
    confirmMove();
    act(() => button(0, 0).click());
    // The gift sheet opens on the asker with the two smallest tokens picked.
    expect(document.querySelector(".sheet .ph-give-who.on")?.textContent).toContain("Chitra");
    const picked = [...document.querySelectorAll("button.ph-chip.on")];
    expect(picked.map((b) => b.textContent)).toEqual(["1", "1"]);
    const confirm = [...document.querySelectorAll(".sheet .btn.primary")].find((b) =>
      b.textContent?.includes("🎁 Give"),
    ) as HTMLButtonElement;
    act(() => confirm.click());
    confirmMove();
    const recall = el.querySelector(".ph-tray .ph-offer-x") as HTMLButtonElement;
    act(() => recall.click());
    confirmMove();
    expect(sent).toEqual([
      { type: "action", action: { type: "refuse", from: 0, deal: "plea" } },
      { type: "action", action: { type: "accept", from: 3 } },
      { type: "action", action: { type: "give", to: 0, tokens: [1, 1] } },
      { type: "action", action: { type: "recall", to: 1, deal: "plea" } },
    ]);
    act(() => root.unmount());
  });

  it("asks for a count and offers a swap from the tray", () => {
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    const sent: unknown[] = [];
    const s = structuredClone(Object.fromEntries(pahunch)["their-move"]) as unknown as RoomState;
    act(() =>
      root.render(<Room state={{ ...s, receivedAt: NOW }} send={(m) => sent.push(m)} join={() => {}} reactions={[]} />),
    );
    const sheetButton = (label: string) =>
      [...document.querySelectorAll(".sheet button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
    // The tray has one door to the token sheet; its tabs pick the deal.
    const tray = (label: string) => {
      act(() => (el.querySelector(".ph-tray .ph-tokens-btn") as HTMLButtonElement).click());
      const tab = [...document.querySelectorAll(".sheet .ph-deal-modes .btn")].find((b) =>
        b.textContent?.includes(label),
      ) as HTMLButtonElement;
      act(() => tab.click());
    };
    tray("Ask");
    act(() => (document.querySelector('.sheet [aria-label="One more"]') as HTMLButtonElement).click());
    act(() => sheetButton("🙏 Ask ").click());
    confirmMove();
    tray("Swap");
    act(() => (document.querySelector(".sheet button.ph-chip:not(.ph-want-add)") as HTMLButtonElement).click());
    act(() => (document.querySelector('.sheet [aria-label="Add a 3"]') as HTMLButtonElement).click());
    act(() => sheetButton("⇄ Offer").click());
    confirmMove();
    expect(sent).toEqual([
      { type: "action", action: { type: "plead", of: 0, count: 2 } },
      { type: "action", action: { type: "offer", to: 0, give: [1], want: [3] } },
    ]);
    act(() => root.unmount());
  });

  it("opens the token sheet on a player from their seat sheet", () => {
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    const sent: unknown[] = [];
    const s = structuredClone(Object.fromEntries(pahunch)["their-move"]) as unknown as RoomState;
    act(() =>
      root.render(<Room state={{ ...s, receivedAt: NOW }} send={(m) => sent.push(m)} join={() => {}} reactions={[]} />),
    );
    act(() => (el.querySelector('.ph-seat-chip[data-seat="3"] .avatar-btn') as HTMLButtonElement).click());
    const ask = [...document.querySelectorAll(".sheet .ph-deal-modes .btn")].find((b) =>
      b.textContent?.includes("Ask"),
    ) as HTMLButtonElement;
    act(() => ask.click());
    const go = [...document.querySelectorAll(".sheet .btn.primary")].find((b) =>
      b.textContent?.includes("🙏 Ask Dev"),
    ) as HTMLButtonElement;
    act(() => go.click());
    confirmMove();
    expect(sent).toEqual([{ type: "action", action: { type: "plead", of: 3, count: 1 } }]);
    act(() => root.unmount());
  });
});

describe("pahunch: the climber takes the needed yes", () => {
  it("picks whose spare yes earn the 1s", () => {
    // You (seat 2) climb out of a 3-room with seats 0 and 3: both said yes, one is needed.
    const s = structuredClone(Object.fromEntries(pahunch)["vote-climber"]) as {
      game: { rooms: (number | null)[][]; vote: { answers: (number | null)[] }; pending: number[] };
    };
    s.game.rooms[8] = [0, 2, 3];
    s.game.vote.answers = [1, null, 1, 1];
    s.game.pending = [2];
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    const sent: unknown[] = [];
    act(() =>
      root.render(
        <Room
          state={{ ...s, receivedAt: NOW } as unknown as RoomState}
          send={(m) => sent.push(m)}
          join={() => {}}
          reactions={[]}
        />,
      ),
    );
    const faces = [...el.querySelectorAll(".ph-take-who .ph-give-who")] as HTMLButtonElement[];
    expect(faces.map((f) => f.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    act(() => faces[0].click());
    act(() => faces[1].click());
    act(() => (el.querySelector(".ph-take-go") as HTMLButtonElement).click());
    confirmMove();
    expect(sent).toEqual([{ type: "action", action: { type: "take", votes: [1, 0, 0, 0] } }]);
    act(() => root.unmount());
  });
});

describe("pahunch: favour picks on a climb, and the blocker from the list", () => {
  /** You (seat 1) share room 3 with seat 2 and a neutral; seat 0 lends a token swap, seat 2 a carry. */
  function pickState(): RoomState {
    const s = structuredClone(Object.fromEntries(pahunch)["your-move"]) as {
      game: {
        rooms: (number | null)[][];
        lent: number[];
        players: { favour: string | null; uses: number | null }[];
      };
    };
    s.game.rooms[2] = [];
    s.game.rooms[3] = [null, 2, 1];
    s.game.players[0].favour = "swapToken";
    s.game.players[0].uses = 2;
    s.game.lent = [0, 2];
    return { ...s, receivedAt: NOW } as unknown as RoomState;
  }

  function mount(state: RoomState) {
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    const sent: { action?: object }[] = [];
    act(() => root.render(<Room state={state} send={(m) => sent.push(m as never)} join={() => {}} reactions={[]} />));
    const tap = (e: Element) => act(() => e.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    return { el, root, sent, tap };
  }

  it("takes another token and another piece along on a climb", () => {
    const { el, root, sent, tap } = mount(pickState());
    tap(el.querySelector('.ph-room[data-room="3"]') as Element);
    tap(el.querySelector('.ph-room[data-room="9"]') as Element);
    const swap = el.querySelector('[aria-label="Token swap: take instead"]') as HTMLElement;
    const carry = el.querySelector('[aria-label="Carry: take along"]') as HTMLElement;
    expect(swap, "the swap pick").not.toBeNull();
    expect(carry, "the carry pick").not.toBeNull();
    // The path's own token comes first and is picked; then every other uncovered one.
    const swaps = [...swap.querySelectorAll("button")];
    expect(swaps[0].getAttribute("aria-pressed")).toBe("true");
    act(() => (swaps.find((b) => b.dataset.path === "12") as HTMLButtonElement).click());
    const carries = [...carry.querySelectorAll("button")];
    expect(carries[0].getAttribute("aria-pressed"), "nobody, at first").toBe("true");
    act(() => (carries.find((b) => b.dataset.seat === "2") as HTMLButtonElement).click());
    act(() => (el.querySelector(".ph-pick .ph-move:not(.ph-then)") as HTMLButtonElement).click());
    confirmMove();
    expect(sent.at(-1)?.action).toEqual({ type: "climb", path: 11, swap: 12, carry: { t: "seat", seat: 2 } });
    act(() => root.unmount());
  });

  it("sends the blocker from the list of all moves", () => {
    const { el, root, sent } = mount({ ...Object.fromEntries(pahunch)["your-move"], receivedAt: NOW } as RoomState);
    const all = [...el.querySelectorAll(".ph-pick button")].find((b) => b.textContent?.includes("All moves"));
    act(() => (all as HTMLButtonElement).click());
    const send = el.querySelector('[aria-label="Send Daddu to"]') as HTMLElement;
    act(() => (send.querySelector('button[data-path="12"]') as HTMLButtonElement).click());
    confirmMove();
    expect(sent.at(-1)?.action).toEqual({ type: "block", path: 12 });
    act(() => root.unmount());
  });

  it("explains a tapped room in the sheet order: what it does, chips, small print", () => {
    const { el, root, tap } = mount({ ...Object.fromEntries(pahunch)["their-move"], receivedAt: NOW } as RoomState);
    // Room 1 is a bottom room of 5 seats: leaving takes a vote, and new climbers join here.
    tap(el.querySelector('.ph-room[data-room="1"]') as Element);
    const sheet = document.querySelector(".sheet") as HTMLElement;
    expect(sheet.querySelector(".ph-sheet-lead")?.textContent).toBe("Leaving takes 3 yes votes of its 5 seats.");
    const chips = [...sheet.querySelectorAll(".ph-sheet-facts > [aria-label]")].map((c) =>
      c.getAttribute("aria-label"),
    );
    expect(chips[0]).toMatch(/^\d of 5 seats taken/);
    expect(chips[1]).toBe("3 yes of 5 to leave");
    expect(chips.slice(2).every((c) => c?.startsWith("↑ "))).toBe(true);
    expect(sheet.querySelector(".ph-sheet-small")?.textContent).toBe("New residents join here.");
    act(() => root.unmount());
  });

  it("shows a run of the same log line once, with its count", () => {
    const s = structuredClone(Object.fromEntries(pahunch)["their-move"]) as unknown as {
      game: { log: object[] };
    };
    const gift = { t: "gift", from: 2, to: 3, count: 1 };
    s.game.log.push(gift, gift, gift, { t: "gift", from: 2, to: 3, count: 2 }, gift);
    const { el, root } = mount({ ...s, receivedAt: NOW } as unknown as RoomState);
    const rows = [...el.querySelectorAll(".recent li")].slice(0, 3);
    expect(rows.map((r) => r.querySelector(".ph-log-n")?.textContent ?? "")).toEqual(["", "", " ×3"]);
    expect(rows[2].querySelector(".ph-log-n")?.getAttribute("aria-label")).toBe("3 times");
    expect(rows[1].textContent).toMatch(/2 tokens/);
    act(() => root.unmount());
  });
});
