import "./pahunch.css";
import type { ReactNode } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Avatar } from "../../client/Avatar.tsx";
import { Brand } from "../../client/Brand.tsx";
import {
  connectionFact,
  FreezeButton,
  freezeRights,
  GameOver,
  MuteButton,
  RoomMenu,
  SeatAwayRow,
  SeatSheetActions,
  seatRights,
  standings,
  TableNotices,
  useAwayFor,
  useDock,
  useYourMove,
} from "../../client/chrome.tsx";
import { Rename, Toggle } from "../../client/Lobby.tsx";
import type { Reaction, RoomState } from "../../client/net.ts";
import { Floats, ReactBar } from "../../client/Reactions.tsx";
import { Sheet } from "../../client/Sheet.tsx";
import { play } from "../../client/sound.ts";
import type {
  ClientMsg,
  PahunchAction,
  PahunchCarry,
  PahunchFavour,
  PahunchLog,
  PahunchView,
  PahunchVote,
  RoomInfo,
} from "../../generated/index.ts";
import type { TableProps } from "../types.ts";
import type { Pick } from "./Board.tsx";
import { Board, pathKind, seatShape, viewOf } from "./Board.tsx";
import type { ClimbOption, Extras } from "./derive.ts";
import {
  askBlock,
  atTop,
  blockTargets,
  bribeChoices,
  carryTargets,
  climbFavours,
  climbs,
  count,
  enterRooms,
  extraMoves,
  isEntry,
  need,
  nudges,
  offers,
  onceOffered,
  onOffer,
  score,
  swapTargets,
  votersLeft,
  yesSoFar,
} from "./derive.ts";
import { Rules } from "./Rules.tsx";
import { VoteClock } from "./Setup.tsx";
import type { PahunchSkin } from "./skin.ts";
import { roomIcon, roomName, skinFor } from "./skin.ts";
import { S } from "./strings.ts";

interface Ctx {
  v: PahunchView;
  skin: PahunchSkin;
  names: string[];
  me: number | null;
  /** "You" for the viewer, else the name. */
  who: (i: number) => string;
  /** The room's icon and full name ("📋 Notice board"): wherever a room is named, its icon leads. */
  room: (r: number) => string;
  /** The room's icon and name as the board shows it. */
  short: (r: number) => string;
  /** The room's icon, as the board shows it. */
  icon: (r: number) => string;
  /** Each seat's avatar look. */
  looks: string[];
  pts: (n: number) => string;
}

function useCtx(state: RoomState): Ctx {
  const v = state.game as PahunchView;
  const { room } = state;
  const skin = skinFor(room.theme);
  const names = room.seats.map((s) => s.name);
  const me = v.you;
  const icon = (r: number) => roomIcon(skin, v.layout.board, r, v.layout.summit);
  return {
    v,
    skin,
    names,
    me,
    who: (i) => (i === me ? "You" : (names[i] ?? `Seat ${i + 1}`)),
    room: (r) => `${icon(r)} ${roomName(skin, v.layout.board, r, v.layout.summit)}`,
    short: (r) => `${icon(r)} ${roomName(skin, v.layout.board, r, v.layout.summit, true)}`,
    icon,
    looks: room.seats.map((s) => s.avatar),
    pts: (n) => `${n} ${skin.nouns.points}`,
  };
}

const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A line of text with faces in it, so it reads at a glance: the blocker's name becomes his face
 * (the name stays for screen readers), and a neutral's name gets her face beside it.
 */
function Rich({ ctx, text }: { ctx: Ctx; text: string }) {
  const { skin } = ctx;
  const { blocker, neutral, neutrals } = skin.nouns;
  const words = [blocker, neutrals, neutral].filter(Boolean).sort((a, b) => b.length - a.length);
  // Whole words only, so a player named "Shaunty" keeps their name.
  const parts = text.split(new RegExp(`\\b(${words.map(literal).join("|")})\\b`, "i"));
  return (
    <>
      {parts.map((part, i) => {
        const word = part.toLowerCase();
        if (word === blocker.toLowerCase())
          return (
            <span key={i} className="ph-inline-face blocker" role="img" aria-label={part}>
              <Avatar code={skin.blockerLook} name={blocker} />
            </span>
          );
        if (word === neutral.toLowerCase() || word === neutrals.toLowerCase())
          return (
            <span key={i} className="ph-inline-who">
              <span className="ph-inline-face neutral" aria-hidden="true">
                <Avatar code={skin.neutralLook} name={neutral} lips={skin.neutralLips} />
              </span>
              {part}
            </span>
          );
        return part;
      })}
    </>
  );
}

/** A seat's face in a line of text; its name is the label. */
function Face({ ctx, i }: { ctx: Ctx; i: number }) {
  return (
    <span className="ph-inline-face" role="img" aria-label={ctx.who(i)}>
      <Avatar code={ctx.looks[i] ?? ""} name={ctx.names[i] ?? ""} />
    </span>
  );
}

/** The room clock: milliseconds left (ticking while it runs), its whole stretch, and whether a freeze holds it. */
interface Clock {
  left: number;
  total: number;
  paused: boolean;
}

function useClock(state: RoomState): Clock | null {
  const { room } = state;
  const running = room.bidMsLeft !== null && room.frozenBy === null;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [running]);
  if (room.bidMsLeft === null) return null;
  const left = Math.max(0, room.bidMsLeft - (running ? Date.now() - state.receivedAt : 0));
  return { left, total: Math.max(room.bidMsWindow ?? 0, room.bidMsLeft, 1), paused: !running };
}

const RING_R = 16;
const RING_C = 2 * Math.PI * RING_R;

/**
 * The vote clock as a ring that drains, the seconds in the middle. The last 5 seconds turn it red
 * and pulse it; a frozen game shows ⏸ under the number.
 */
function ClockRing({ clock }: { clock: Clock }) {
  const secs = Math.ceil(clock.left / 1000);
  const urgent = secs <= 5 && !clock.paused;
  return (
    <span
      className={`ph-clock${urgent ? " urgent" : ""}${clock.paused ? " paused" : ""}`}
      role="img"
      aria-label={clock.paused ? `${secs} seconds left, paused` : `${secs} seconds left`}
    >
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="ph-clock-track" cx="20" cy="20" r={RING_R} />
        <circle
          className="ph-clock-fill"
          cx="20"
          cy="20"
          r={RING_R}
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - clock.left / clock.total)}
        />
      </svg>
      <span className="ph-clock-secs" aria-hidden="true">
        {secs}
        {clock.paused && <small>⏸</small>}
      </span>
    </span>
  );
}

/**
 * One button in the move bar: a verb, and a muted note saying where and for what. It either makes
 * a move (`action`) or picks something on the board (`goTo`: a room's way up, or Daddu).
 */
interface Move {
  key: string;
  verb: string;
  note: string;
  action?: PahunchAction;
  goTo?: Pick;
  /** The room it starts from (a new climber: the room it enters). */
  room?: number;
  path?: number;
  /** The room it goes to. */
  to: number;
}

/** The short note on a climb: (where to,) what it takes, what it needs, the favours it uses. */
function climbNote(ctx: Ctx, c: ClimbOption, withTo = true): string {
  const { v, skin } = ctx;
  const token = c.takes === null ? null : v.tokensOn[c.takes];
  const parts = withTo ? [`→ ${ctx.short(v.layout.paths[c.path].to)}`] : [];
  if (token) parts.push(`+${token.value}${token.bonus ? ` ${skin.bonuses[token.bonus].glyph}` : ""}`);
  else if (c.kind === "blocked") parts.push(`no ${skin.nouns.points}`);
  if (c.kind === "ask") parts.push(`${c.own} of ${c.need} yes`);
  else if (!withTo) parts.push("no vote");
  if (c.uses.length) parts.push(c.uses.map((k) => skin.favours[k].glyph).join(" "));
  return parts.join(" · ");
}

/**
 * What a climb up a picked path needs and gives, as short facts: the votes and whose they are (or
 * why none are needed), the points it takes, the favours it uses.
 */
function climbFacts(ctx: Ctx, c: ClimbOption): string[] {
  const { v, skin, me } = ctx;
  const { points, blocker, neutral, neutrals, bribe } = skin.nouns;
  const from = v.layout.paths[c.path].from;
  const out: string[] = [];
  if (c.kind === "back") out.push(`${skin.favours.backStairs.glyph} Open: no vote`);
  else if (c.kind === "blocked") out.push(`${upper(blocker)} is here: no vote`);
  else if (c.kind === "own")
    out.push((v.layout.rooms[from]?.cap ?? 0) === 1 ? "Post of one: no vote" : `Your ${c.own} carry the vote`);
  else {
    const here = v.rooms[from] ?? [];
    const seats = [...new Set(here.filter((x): x is number => x !== null && x !== me))];
    const aunties = count(v.rooms, from, null);
    const whose = [
      ...seats.map((s) => `${ctx.names[s]} ×${count(v.rooms, from, s)}`),
      ...(aunties ? [`${aunties === 1 ? neutral : neutrals} ×${aunties} (${bribe})`] : []),
    ];
    out.push(`Needs ${c.need} yes · you have ${c.own}`);
    if (whose.length) out.push(`Ask ${whose.join(", ")}`);
    if (v.tried.includes(from)) out.push("They said no once this turn");
  }
  const token = c.takes === null ? null : v.tokensOn[c.takes];
  if (token) {
    const b = token.bonus ? skin.bonuses[token.bonus] : null;
    out.push(`+${token.value} ${points}${b ? ` ${b.glyph} ${b.name}` : ""}`);
  } else if (c.kind !== "back" && c.kind !== "own") out.push(`No ${points} to take`);
  if (c.uses.length)
    out.push(`Uses ${c.uses.map((k) => `${skin.favours[k].glyph} ${skin.favours[k].name}`).join(", ")}`);
  return out;
}

/** A message waiting in the confirm strip, and what it does in words. */
interface Asking {
  msg: ClientMsg;
  what: string;
}

/** A move in words, glyph first: what the confirm strip asks about. */
function describe(ctx: Ctx, a: PahunchAction): string {
  const { v, skin, names, who } = ctx;
  const paths = v.layout.paths;
  const { climber, neutral, blocker, points } = skin.nouns;
  const favour = (owner: number) => {
    const k = v.players[owner]?.favour;
    return k ? `${skin.favours[k].glyph} ${skin.favours[k].name}` : "";
  };
  switch (a.type) {
    case "enter":
      return S.enter(climber, ctx.short(a.room));
    case "climb": {
      const p = paths[a.path];
      const c =
        ctx.me === null
          ? undefined
          : climbs(v, ctx.me, { swap: a.swap, carry: a.carry }).find((x) => x.path === a.path);
      const line =
        c?.kind === "ask"
          ? S.askVotes(ctx.short(p.from), ctx.short(p.to))
          : S.climb(ctx.short(p.from), ctx.short(p.to));
      const extra = [
        a.swap !== undefined
          ? S.swapFor(skin.favours.swapToken.glyph, v.tokensOn[a.path]?.value ?? 0, v.tokensOn[a.swap]?.value ?? 0)
          : null,
        a.carry ? S.carryWith(skin.favours.carry.glyph, a.carry.t === "seat" ? who(a.carry.seat) : neutral) : null,
      ].filter(Boolean);
      return [line, ...extra].join(" · ");
    }
    case "vote":
      return a.yes > 0 ? S.voteYes(a.yes) : S.voteNo;
    case "bribe":
      return S.bribe(neutral, a.token);
    case "take":
      return S.take;
    case "withdraw":
      return S.withdraw;
    case "nudge":
      return S.nudge(neutral, ctx.short(paths[a.path].from), ctx.short(paths[a.path].to));
    case "block":
      return S.block(blocker, ctx.short(paths[a.path].from), ctx.short(paths[a.path].to));
    case "done":
      return S.endTurn;
    case "lend":
      return ctx.me === null ? "" : a.on ? S.lend(favour(ctx.me), who(v.turn)) : S.unlend(favour(ctx.me));
    case "request":
      return a.on
        ? S.request(names[a.owner] ?? "", favour(a.owner))
        : v.lent.includes(a.owner)
          ? S.turnDown(names[a.owner] ?? "", favour(a.owner))
          : S.unrequest(names[a.owner] ?? "", favour(a.owner));
    case "decline":
      return ctx.me === null ? "" : S.decline(favour(ctx.me));
    case "give":
      return S.give(tokensWord(a.tokens.length), `${score(a.tokens)} ${points}`, names[a.to] ?? "");
    case "plead":
      return S.plead(names[a.of] ?? "", a.count);
    case "offer":
      return S.offer(names[a.to] ?? "", a.give.join("+"), a.want.join("+"));
    case "accept":
      return S.accept(names[a.from] ?? "");
    case "refuse":
      return S.refuse(names[a.from] ?? "");
    case "recall":
      return a.deal === "plea" ? S.recallPlea(names[a.to] ?? "") : S.recallOffer(names[a.to] ?? "");
  }
}

/**
 * The second tap: what the move does, then two equal buttons. Escape goes back. It takes the
 * action bar's place, so a double tap on a move never confirms it.
 */
function ConfirmBar({
  what,
  label,
  onYes,
  onNo,
}: {
  what: ReactNode;
  label: string;
  onYes: () => void;
  onNo: () => void;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onNo();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onNo]);
  return (
    <div className="ph-moves ph-confirm" role="group" aria-label={S.confirmLabel(label)}>
      <p className="ph-confirm-what">{what}</p>
      <div className="ph-move-grid ph-confirm-grid">
        <button type="button" className="btn ph-move ph-confirm-yes" onClick={onYes}>
          <b>{S.confirm}</b>
        </button>
        <button type="button" className="btn ph-move" onClick={onNo}>
          <b>{S.back}</b>
        </button>
      </div>
    </div>
  );
}

export function Table({ state, send, reactions }: TableProps) {
  const ctx = useCtx(state);
  const { v, skin, names, me } = ctx;
  const { room } = state;
  // Every move waits in the confirm strip for a second tap, away from the button it came from.
  const [asking, setAsking] = useState<Asking | null>(null);
  const act = (action: PahunchAction) => setAsking({ msg: { type: "action", action }, what: describe(ctx, action) });
  const owing = me !== null && v.pending.includes(me);
  useYourMove(owing);
  const awayFor = useAwayFor(state);
  const { frozen, canFreeze } = freezeRights(room, me, v.over);
  const [menu, setMenu] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [deal, setDeal] = useState<DealInit | null>(null);
  const [pick, setPickRaw] = useState<Pick | null>(null);
  const [info, setInfo] = useState<Pick | null>(null);
  const [picks, setExtras] = useState<Extras>({});
  // A favour taken back mid-pick drops its pick, or no climb would match it.
  const extras: Extras = {
    ...(offers(v, "swapToken") && picks.swap !== undefined && { swap: picks.swap }),
    ...(offers(v, "carry") && picks.carry && { carry: picks.carry }),
  };
  const setPick = (p: Pick | null) => {
    setPickRaw(p);
    setExtras({});
  };
  const isAdmin = me !== null && room.admin === me;

  // A reward to you rings; a climb clicks; the end plays.
  const seen = useRef(v.logStart + v.log.length);
  useEffect(() => {
    const total = v.logStart + v.log.length;
    const fresh = v.log.slice(Math.max(0, seen.current - v.logStart));
    seen.current = total;
    if (fresh.some((e) => e.t === "reward" && e.p === me)) play("cash");
    else if (fresh.some((e) => e.t === "climb")) play("bid");
    if (fresh.some((e) => e.t === "end")) play("fanfare");
  }, [v.log, v.logStart, me]);
  // A new turn, vote or phase clears the pick, and a move waiting to be confirmed.
  const moment = `${v.turn}:${v.vote === null}:${v.moved}:${v.over}`;
  useEffect(() => {
    if (moment) {
      setPickRaw(null);
      setExtras({});
      setAsking(null);
    }
  }, [moment]);

  // ---- what the mover can do now ----
  const paths = v.layout.paths;
  const { climber, neutral, blocker } = skin.nouns;
  const myTurn = me !== null && !v.over && v.vote === null && v.turn === me;
  // After the main move, only extra moves are left (or ending the turn).
  const extra = myTurn && v.moved ? extraMoves(v, me) : null;
  const canBlock = myTurn && (!extra || extra.block);
  const blockAt = canBlock ? blockTargets(v) : [];
  // Before the main move, a lent favour moves the blocker without ending the turn.
  const blockFavour = myTurn && !extra && offers(v, "extraBlock");
  const myClimbs = myTurn ? (extra ? extra.again : climbs(v, me, extras)) : [];
  const moves: Move[] = [
    ...(myTurn && !extra ? enterRooms(v, me) : []).map(
      (r): Move => ({
        key: `e${r}`,
        verb: `✚ Add a ${climber}`,
        note: `→ ${ctx.short(r)}`,
        action: { type: "enter", room: r },
        room: r,
        to: r,
      }),
    ),
    ...myClimbs.map(
      (c): Move => ({
        key: `c${c.path}`,
        verb: extra ? "↑ Move on" : c.kind === "ask" ? "🗳️ Ask for votes" : "↑ Move up",
        note: climbNote(ctx, c),
        action: extra
          ? { type: "climb", path: c.path }
          : {
              type: "climb",
              path: c.path,
              ...(extras.swap !== undefined && { swap: extras.swap }),
              ...(extras.carry && { carry: extras.carry }),
            },
        room: paths[c.path].from,
        path: c.path,
        to: paths[c.path].to,
      }),
    ),
    ...(myTurn && (!extra || extra.nudge) ? nudges(v) : []).map(
      (p): Move => ({
        key: `n${p}`,
        verb: `⇡ Nudge an ${neutral}`,
        note: `→ ${ctx.short(paths[p].to)} · +1`,
        action: { type: "nudge", path: p },
        room: paths[p].from,
        path: p,
        to: paths[p].to,
      }),
    ),
  ];
  const blockMove = (p: number): Move => ({
    key: `b${p}`,
    verb: `➜ Send ${blocker} here`,
    note: `${ctx.short(paths[p].from)} → ${ctx.short(paths[p].to)}${blockFavour ? ` · ${skin.favours.extraBlock.glyph} then move` : ""}`,
    action: { type: "block", path: p },
    path: p,
    to: paths[p].to,
  });
  const blockerLive = blockAt.length > 0;
  const movePaths = moves.flatMap((m) => (m.path === undefined ? [] : [m.path]));
  /** From a picked room: a button per way up that has a move, which picks that way (A, then B). */
  const destination = (p: number): Move => {
    const c = myClimbs.find((x) => x.path === p);
    return {
      key: `d${p}`,
      verb: `↑ ${ctx.short(paths[p].to)}`,
      note: c ? climbNote(ctx, c, false) : `⇡ nudge an ${neutral} · +1`,
      goTo: { path: p },
      room: paths[p].from,
      path: p,
      to: paths[p].to,
    };
  };
  const movesFor = (p: Pick): Move[] => {
    if (p.blocker) return p.path !== undefined && blockAt.includes(p.path) ? [blockMove(p.path)] : [];
    if (p.room !== undefined) {
      const out = [...new Set(moves.filter((m) => m.room === p.room && m.path !== undefined).map((m) => m.path))];
      return [
        ...moves.filter((m) => m.room === p.room && m.path === undefined),
        ...out.flatMap((x) => (x === undefined ? [] : [destination(x)])),
      ];
    }
    if (p.path !== undefined)
      return [
        ...moves.filter((m) => m.path === p.path),
        ...(blockAt.includes(p.path) ? [blockMove(p.path)] : []),
        // Daddu's own path: climb past him free, or move him on.
        ...(p.path === v.blocker && blockerLive
          ? [
              {
                key: "md",
                verb: `Move ${blocker}…`,
                note: `to another ${skin.nouns.path}`,
                goTo: { blocker: true },
                path: p.path,
                to: paths[p.path].to,
              },
            ]
          : []),
      ];
    return [];
  };
  const picked = pick ? movesFor(pick) : [];
  const facts =
    pick?.path !== undefined && !pick.blocker
      ? (() => {
          const c = myClimbs.find((x) => x.path === pick.path);
          if (c) return climbFacts(ctx, c);
          const out = [`No ${climber} of yours to climb here`];
          if (moves.some((m) => m.key === `n${pick.path}`))
            out.push(`Nudge an ${neutral} up: no vote, +1 ${skin.nouns.points} to you`);
          if (pick.path === v.blocker) out.push(`${upper(blocker)} is here`);
          return out;
        })()
      : [];
  const liveRooms = new Set(moves.flatMap((m) => (m.room === undefined ? [] : [m.room])));
  const livePaths = new Set(pick?.blocker ? blockAt : movePaths);
  // A picked route for the blocker stands out; the other routes fade but stay tappable.
  const focus = pick
    ? new Set(
        pick.blocker
          ? pick.path !== undefined
            ? [pick.path]
            : blockAt
          : picked.flatMap((m) => (m.path === undefined ? [] : [m.path])),
      )
    : null;
  const targets = new Set(pick && !pick.blocker ? picked.filter((m) => m.path !== undefined).map((m) => m.to) : []);

  // Room A, then room B, picks the way from A to B. Tapping the pick again clears it.
  const onRoom = (r: number) => {
    if (!myTurn) return setInfo({ room: r });
    const from = pick?.room;
    if (from !== undefined && from !== r) {
      const way = paths.findIndex((x, i) => x.from === from && x.to === r && movePaths.includes(i));
      if (way >= 0) return setPick({ path: way });
    }
    if (from === r) return setPick(null);
    // From a picked way back to its room.
    if (pick?.path !== undefined && !pick.blocker && paths[pick.path].from === r) return setPick({ room: r });
    if (movesFor({ room: r }).length > 0) return setPick({ room: r });
    if (pick?.blocker) return setPick(null);
    setInfo({ room: r });
  };
  const onPath = (p: number) => {
    if (myTurn && pick?.blocker && blockAt.includes(p)) setPick({ blocker: true, path: p });
    else if (myTurn && movesFor({ path: p }).length > 0)
      setPick(pick?.path === p && !pick.blocker ? null : { path: p });
    else setInfo({ path: p });
  };
  const onBlocker = () =>
    blockerLive ? setPick(pick?.blocker ? null : { blocker: true }) : setInfo({ blocker: true });

  let bar: ReactNode = null;
  if (!v.over && me !== null) {
    const deals = <DealBar ctx={ctx} act={act} onGive={setDeal} />;
    const request =
      v.asked.includes(me) || v.pleas.some((p) => p.of === me) || v.offers.some((o) => o.to === me) ? (
        <>
          {v.asked.includes(me) && <RequestBar ctx={ctx} act={act} />}
          {deals}
        </>
      ) : null;
    if (v.vote && (v.turn === me || votersLeft(v, v.vote).includes(me)))
      bar = <VoteBar ctx={ctx} vote={v.vote} act={act} />;
    else if (myTurn)
      bar = (
        <PickBar
          ctx={ctx}
          pick={pick}
          setPick={setPick}
          picked={picked}
          moves={moves}
          extra={extra !== null}
          blockerLive={blockerLive}
          extras={extras}
          setExtras={setExtras}
          act={act}
          onInfo={setInfo}
          facts={facts}
        />
      );
    if (request)
      bar = (
        <>
          {request}
          {bar}
        </>
      );
  }
  // The last move can be taken back by whoever made it, or by the admin, until anything else happens.
  const undoBy = room.undoBy ?? null;
  const canUndo = room.canUndo && me !== null && !frozen && (isAdmin || undoBy === me);
  const undoWhat = undoBy === me ? S.undoMine : undoBy !== null ? S.undoTheirs(names[undoBy] ?? "") : S.undoAny;
  if (asking)
    bar = (
      <ConfirmBar
        what={<Rich ctx={ctx} text={asking.what} />}
        label={asking.what}
        onYes={() => {
          send(asking.msg);
          setAsking(null);
        }}
        onNo={() => setAsking(null)}
      />
    );
  const docked = asking !== null || (owing && bar !== null);
  const dockEl = useDock(docked);
  const clock = useClock(state);

  const top = atTop(v);
  const capTop = v.layout.rooms[v.layout.summit]?.cap ?? 0;
  const view = viewOf(v.layout);
  const boardRatio = view.w / view.h;
  const status = v.over
    ? "Final result"
    : v.vote
      ? `${ctx.who(v.turn)} ${v.turn === me ? "are" : "is"} asking for votes`
      : `${ctx.who(v.turn)} to move`;

  return (
    <div
      className={`table ph-table ${docked ? "acting" : ""} ${frozen ? "frozen" : ""}`}
      // The board's width for its height: a wide screen sizes the board's column by it.
      style={{
        ["--board-ratio" as string]: boardRatio.toFixed(3),
        ["--seat-rows" as string]: seatRows(names.length - (me === null ? 0 : 1)),
      }}
    >
      <header className="topbar">
        <Brand />
        <span className="round">
          <b>{status}</b> · {ctx.room(v.layout.summit)} {top.length}/{capTop}
        </span>
        <span className="grow" />
        {canFreeze && !frozen && <FreezeButton onClick={() => send({ type: "freeze", on: true })} />}
        <button className="icon-btn" onClick={() => setLogOpen(true)} title="What happened" aria-label="Log">
          ☰ <span className="lbl">Log</span>
        </button>
        <MuteButton />
        <button
          className="icon-btn"
          onClick={() => setMenu(!menu)}
          aria-expanded={menu}
          title="Room and rules"
          aria-label="Room and rules"
        >
          ? <span className="lbl">Room</span>
        </button>
        {menu && (
          <RoomMenu
            room={room}
            me={me}
            names={names}
            send={send}
            over={v.over}
            onClose={() => setMenu(false)}
            adminHint="Can skip an away player (a random move is made for them) and set the vote clock."
            endAsk="End the game for everyone? Nobody wins a game ended early."
            settings={
              <>
                <VoteClock room={room} me={me} send={send} />
                <TipsSwitch />
              </>
            }
            rules={<Rules skin={skin} n={v.n} options={v.options} />}
          />
        )}
      </header>

      <TableNotices
        state={state}
        send={send}
        names={names}
        over={v.over}
        hidden={`Everyone’s ${skin.nouns.points} stays hidden.`}
      />

      <Players
        ctx={ctx}
        room={room}
        reactions={reactions}
        awayFor={awayFor}
        send={send}
        act={act}
        onDeal={me !== null ? setDeal : undefined}
      />

      {/* The result has its own place (beside the board, or above it on a phone); the final board stays. */}
      {v.over && (
        <section className="ph-result" aria-label="Final result">
          <End ctx={ctx} room={room} send={send} isAdmin={isAdmin} />
        </section>
      )}

      <section className={`stage ph-stage ${owing ? "owing" : ""}`}>
        {/* The vote's card sits in the side column, never over the board, so the board never moves. */}
        <Board
          v={v}
          skin={skin}
          names={names}
          acting={myTurn}
          liveRooms={liveRooms}
          livePaths={livePaths}
          focus={focus}
          targets={targets}
          blockerLive={blockerLive}
          selected={pick}
          looks={room.seats.map((s) => s.avatar)}
          faces={room.settings.gameOptions.avatarsOnBoard ?? false}
          swap={v.vote ? v.vote.swap : pick?.path !== undefined && !pick.blocker ? extras.swap : undefined}
          carry={v.vote ? v.vote.carry : pick?.path !== undefined && !pick.blocker ? extras.carry : undefined}
          onRoom={onRoom}
          onPath={onPath}
          onBlocker={onBlocker}
        />
        <CoinKey ctx={ctx} />
      </section>

      <aside className="side ph-side">
        {v.vote && !v.over && <VoteSummary ctx={ctx} vote={v.vote} clock={clock} />}
        {me !== null && (
          <MyTray
            ctx={ctx}
            room={room}
            reactions={reactions}
            awayFor={awayFor}
            send={send}
            act={act}
            owing={owing}
            onDeal={setDeal}
          />
        )}
        {bar && (
          <div ref={dockEl} className={`action-bar ph-bar ${owing || asking ? "your-turn" : ""}`}>
            {bar}
          </div>
        )}
        {canUndo && !asking && (
          <button
            type="button"
            className="btn ph-undo"
            aria-label={undoWhat}
            onClick={() => setAsking({ msg: { type: "undo" }, what: undoWhat })}
          >
            {S.undo} <small>{undoBy === me ? "" : undoBy !== null ? <Face ctx={ctx} i={undoBy} /> : null}</small>
          </button>
        )}
        <section className="recent" aria-label={S.latest}>
          <h2>{S.latest}</h2>
          <LogList ctx={ctx} last={20} />
          <button className="btn small ghost" onClick={() => setLogOpen(true)}>
            {S.fullLog}
          </button>
        </section>
      </aside>

      {info && <BoardInfo ctx={ctx} pick={info} onClose={() => setInfo(null)} />}
      {logOpen && (
        <Sheet title={S.logTitle} onClose={() => setLogOpen(false)}>
          <LogList ctx={ctx} className="log" />
        </Sheet>
      )}
      {deal && me !== null && !v.over && (
        <DealSheet
          key={`${deal.mode}:${deal.to ?? ""}:${deal.count ?? ""}`}
          ctx={ctx}
          init={deal}
          act={act}
          onClose={() => setDeal(null)}
        />
      )}
    </div>
  );
}

// ---- players ----

interface SeatProps {
  ctx: Ctx;
  room: RoomInfo;
  reactions: Reaction[];
  awayFor: (seat: number) => number | null;
  send: (m: ClientMsg) => void;
  act: (a: PahunchAction) => void;
  /** Opens the token sheet (give, ask, swap) on a player. */
  onDeal?: (init: DealInit) => void;
}

/** A seat's colour with its shape on it, as its pieces carry them on the board. */
function SeatSwatch({ seat }: { seat: number }) {
  return (
    <svg className="ph-swatch" viewBox="-1.6 -1.6 3.2 3.2" aria-hidden="true">
      <path d={seatShape(seat, 0, 0, 0.95)} />
    </svg>
  );
}

/** Rows of seat chips for `shown` chips: at most four to a row. */
const seatRows = (shown: number) => Math.max(1, Math.ceil(shown / 4));

/** The other players' chips (a watcher sees everyone); your own seat is your tray. */
function Players(props: SeatProps) {
  const { ctx } = props;
  const shown = ctx.names.filter((_, i) => i !== ctx.me).length;
  // At most four chips to a row, and the rows as even as they go (six: 3 + 3, five: 3 + 2), every
  // chip one width.
  const rows = seatRows(shown);
  const cols = Math.max(1, Math.ceil(shown / rows));
  return (
    <section className="seats ph-players" aria-label="Players" style={{ ["--cols" as string]: cols }}>
      {ctx.names.map((_, i) => (i === ctx.me ? null : <PlayerChip key={i} {...props} i={i} />))}
    </section>
  );
}

/** Everything known about one seat, in sentences. */
function SeatSheet({
  ctx,
  room,
  awayFor,
  send,
  i,
  onClose,
  onDeal,
}: Omit<SeatProps, "reactions" | "act"> & { i: number; onClose: () => void }) {
  const { v, skin, me } = ctx;
  const seat = room.seats[i];
  const p = v.players[i];
  const away = awayFor(i);
  const rights = seatRights(room, me, i, away, v.over);
  const [kicking, setKicking] = useState(false);
  const owing = v.pending.includes(i);
  const atTheTop = count(v.rooms, v.layout.summit, i);
  const onBoard = v.rooms.reduce((n, r) => n + r.filter((x) => x === i).length, 0) - atTheTop;
  const name = i === me ? "You" : seat.name;
  const winner = v.over && v.winners.includes(i);
  const mark = markOf(v, i);
  const { climbers, points } = skin.nouns;
  const favour = p.favour ? skin.favours[p.favour] : null;
  const whose = i === me ? "Your" : `${seat.name}’s`;
  // What the seat owes now leads; then its counts, each glyph with its meaning in small words.
  const lead = winner
    ? `👑 ${name} won the game.`
    : owing
      ? mark === "votes"
        ? `🗳️ ${whose} vote is due.`
        : mark === "to move"
          ? `▶ ${whose} move.`
          : `⏳ ${whose} answer is due.`
      : null;
  const stats = [
    { glyph: "✋", n: `${p.hand}`, word: `${climbers} still to place` },
    { glyph: "⬆️", n: `${onBoard}`, word: "on the way up" },
    { glyph: "▲", n: `${atTheTop}`, word: `in ${ctx.room(v.layout.summit)}` },
    { glyph: "🪙", n: p.tokens ? `${score(p.tokens)}` : "?", word: points },
  ];
  const favourState = v.lent.includes(i)
    ? `🤝 On offer to ${ctx.who(v.turn)} now.`
    : v.used.includes(i)
      ? `✔ Used by ${ctx.who(v.turn)} this turn.`
      : v.asked.includes(i)
        ? `⏳ ${ctx.who(v.turn)} asked for it.`
        : null;
  const facts = [
    room.admin === i ? "★ Room admin." : null,
    p.tokens
      ? `🪙 ${score(p.tokens)} ${points} in ${p.tokens.length} tokens${i === me && !v.over ? ". Only you can see it." : "."}`
      : `🪙 ${upper(points)} stays hidden until the game ends.`,
    favour ? `${favour.glyph} ${favour.name}: ${favour.effect} ${upper(usesLeft(p.uses))}.` : null,
    favourState,
    connectionFact(room, i, name, away, rights),
  ].filter((f): f is string => f !== null);
  return (
    <Sheet
      title={
        <>
          <Avatar code={seat.avatar} name={seat.name} className="small" /> {i === me ? `You (${seat.name})` : seat.name}
        </>
      }
      label={`About ${i === me ? "your seat" : seat.name}`}
      onClose={onClose}
    >
      {i === me && room.settings.rename && (
        <p className="rename-row">
          Your name: <b>{seat.name}</b> <Rename name={seat.name} send={send} />
        </p>
      )}
      {lead && <p className="ph-sheet-lead">{lead}</p>}
      <div className="ph-stats">
        {stats.map((s) => (
          <span key={s.glyph} className="ph-stat">
            <b>
              <span aria-hidden="true">{s.glyph}</span> {s.n}
            </b>
            <small>{s.word}</small>
          </span>
        ))}
        {favour && (
          <span className="ph-stat">
            <b>
              <span aria-hidden="true">{favour.glyph}</span> <Uses n={p.uses} />
            </b>
            <small>{favour.name}</small>
          </span>
        )}
      </div>
      {onDeal && me !== null && i !== me && !v.over && (
        <div className="ph-deal-modes" role="group" aria-label={`Tokens with ${seat.name}`}>
          {(
            [
              ["give", "🎁 Give"],
              ["ask", "🙏 Ask"],
              ["swap", "⇄ Swap"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className="btn"
              onClick={() => {
                onClose();
                onDeal({ mode, to: i });
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <SeatSheetActions
        room={room}
        me={me}
        i={i}
        owing={owing}
        rights={rights}
        send={send}
        kicking={kicking}
        setKicking={setKicking}
      />
      <ul className="ph-sheet-small plain">
        {facts.map((f) => (
          <li key={f}>
            <Rich ctx={ctx} text={f} />
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function PlayerChip(props: SeatProps & { i: number }) {
  const { ctx, room, reactions, awayFor, send, act, i } = props;
  const { v, skin, me } = ctx;
  const seat = room.seats[i];
  const p = v.players[i];
  const away = awayFor(i);
  const rights = seatRights(room, me, i, away, v.over);
  const [info, setInfo] = useState(false);
  const [favourOpen, setFavourOpen] = useState(false);
  const owing = v.pending.includes(i);
  const look = skin.seats[i % skin.seats.length];
  const atTheTop = count(v.rooms, v.layout.summit, i);
  const name = i === me ? "You" : seat.name;
  const winner = v.over && v.winners.includes(i);
  const mark = markOf(v, i);
  const { points } = skin.nouns;
  const favour = p.favour ? skin.favours[p.favour] : null;

  return (
    <div
      className={`seat ph-seat-chip ${i === me ? "me" : ""} ${owing ? "owing" : ""} ${seat.connected ? "" : "away"} ${winner ? "winner" : ""}`}
      data-seat={i}
      style={{ ["--seat" as string]: look.color, ["--seat-ink" as string]: look.ink }}
    >
      <div className="avatar-wrap">
        <button
          className="avatar-btn"
          onClick={() => setInfo(true)}
          aria-haspopup="dialog"
          aria-label={`About ${i === me ? "your seat" : seat.name}`}
        >
          <Avatar code={seat.avatar} name={seat.name} className={seat.connected ? "on" : ""} />
        </button>
        <SeatSwatch seat={i} />
        <Floats reactions={reactions} seat={i} />
        {i === me && <ReactBar room={room} send={send} side />}
      </div>
      <button className="seat-body ph-seat-more" onClick={() => setInfo(true)} aria-haspopup="dialog">
        <span className="seat-name">
          {name}
          {room.admin === i && <span className="admin-mark">★</span>}
          {seat.bot && <span aria-label="bot"> 🤖</span>}
          {winner && <span aria-label="winner"> 👑</span>}
          {mark && (
            <span className="mark now ph-mark-glyph" role="img" aria-label={mark}>
              {mark === "votes" ? "🗳️" : "▶"}
            </span>
          )}
        </span>
        <span className="seat-line ph-counts">
          <span role="img" aria-label={`${p.hand} still to place`}>
            ✋ {p.hand}
          </span>
          <span role="img" aria-label={`${atTheTop} at the top`}>
            ▲ {atTheTop}
          </span>
          {p.tokens && (
            <b className="ph-points" role="img" aria-label={`${score(p.tokens)} ${points}`}>
              🪙 {score(p.tokens)}
            </b>
          )}
        </span>
      </button>
      {favour && p.favour && <FavourChip ctx={ctx} owner={i} onOpen={() => setFavourOpen(true)} />}
      <SeatAwayRow room={room} i={i} owing={owing} rights={rights} send={send} />
      {info && (
        <SeatSheet
          ctx={ctx}
          room={room}
          awayFor={awayFor}
          send={send}
          i={i}
          onClose={() => setInfo(false)}
          onDeal={props.onDeal}
        />
      )}
      {favourOpen && <FavourSheet ctx={ctx} owner={i} act={act} onClose={() => setFavourOpen(false)} />}
    </div>
  );
}

/**
 * Another player's favour on their chip: its glyph and uses, and where it stands this turn
 * (offered, asked for, used). Glows when the viewer, moving, can ask for it. Tap: what it does.
 */
function FavourChip({ ctx, owner, onOpen }: { ctx: Ctx; owner: number; onOpen: () => void }) {
  const { v, skin, me } = ctx;
  const p = v.players[owner];
  if (!p?.favour) return null;
  const f = skin.favours[p.favour];
  const state = v.used.includes(owner)
    ? "used"
    : v.lent.includes(owner)
      ? "offered"
      : v.asked.includes(owner)
        ? "asked"
        : null;
  const canAsk = askBlock(v, me, owner) === null;
  const word = { used: "used", offered: "on offer", asked: "asked…" };
  return (
    <button
      type="button"
      className={`ph-fav-btn ${state ?? ""} ${canAsk ? "live" : ""}`}
      onClick={onOpen}
      aria-haspopup="dialog"
      title={`${f.glyph} ${f.name}: ${f.effect}`}
      aria-label={`${ctx.names[owner]}’s favour: ${f.name}, ${usesLeft(p.uses)}${state ? `, ${word[state]}` : ""}`}
    >
      <span className="ph-fav-glyph" aria-hidden="true">
        {f.glyph}
      </span>
      <span className="ph-fav-side" aria-hidden="true">
        <Uses n={p.uses} />
        {state && <small>{word[state]}</small>}
      </span>
    </button>
  );
}

/**
 * One player's favour, explained. What it does leads, big; then whose it is and where it stands
 * this turn; then the button; the small print last and muted. On your turn, the place to ask
 * another player for theirs, or to turn down one on offer.
 */
function FavourSheet({
  ctx,
  owner,
  act,
  onClose,
}: {
  ctx: Ctx;
  owner: number;
  act: (a: PahunchAction) => void;
  onClose: () => void;
}) {
  const { v, skin, me } = ctx;
  const p = v.players[owner];
  if (!p?.favour) return null;
  const f = skin.favours[p.favour];
  const pay = v.layout.pay[p.favour] ?? 0;
  const mine = owner === me;
  const name = ctx.names[owner];
  const mover = ctx.who(v.turn);
  const status = v.used.includes(owner)
    ? `✔ Used by ${mover} this turn`
    : v.lent.includes(owner)
      ? `🤝 On offer to ${mover}`
      : v.asked.includes(owner)
        ? `⏳ ${mover} asked: ${mine ? "your" : "their"} answer is due`
        : null;
  const block = askBlock(v, me, owner);
  const asking = !mine && me !== null && v.turn === me && v.asked.includes(owner);
  const offeredToMe = !mine && me !== null && v.turn === me && v.lent.includes(owner) && v.vote === null;
  const ask = (on: boolean) => {
    act({ type: "request", owner, on });
    onClose();
  };
  const { points } = skin.nouns;
  return (
    <Sheet title={`${f.glyph} ${f.name}`} label={`${mine ? "Your" : `${name}’s`} favour`} onClose={onClose}>
      <p className="ph-sheet-lead">{f.effect}</p>
      <div className="ph-sheet-facts">
        <span className="ph-fav-owner">
          <Avatar code={ctx.looks[owner] ?? ""} name={name} className="small" /> {mine ? "You" : name}
        </span>
        <Uses n={p.uses} />
        <span className="ph-fav-pay" role="img" aria-label={`Each use earns ${mine ? "you" : name} ${pay} ${points}`}>
          +{pay} 🪙
        </span>
        {status && <span className="ph-fav-status">{status}</span>}
      </div>
      {asking || offeredToMe ? (
        <button type="button" className="btn" onClick={() => ask(false)}>
          {asking ? "↩ Take back the request" : "✕ Turn it down: my moves won’t use it"}
        </button>
      ) : (
        !mine &&
        me !== null &&
        v.turn === me &&
        !v.over &&
        (block === null ? (
          <button type="button" className="btn primary" onClick={() => ask(true)}>
            🙏 Ask {name} for {f.glyph} {f.name}
          </button>
        ) : (
          <p className="muted small">You can’t ask for it now: {block}.</p>
        ))
      )}
      <ul className="ph-sheet-small">
        <li>
          It only helps someone else’s move, never {mine ? "your" : "its owner’s"} own. Each use earns{" "}
          {mine ? "you" : name} {pay} {points}.
        </li>
        <li>
          {mine
            ? "On someone else’s turn, offer it to them, or wait to be asked. An offer they do not use costs nothing and ends with their turn."
            : `On your turn, ask ${name} for it. They say yes (it is then on offer to you) or no. Agree on the call what they get for it.`}
        </li>
        {p.uses === null && <li>How many uses are left stays secret until the game ends.</li>}
      </ul>
    </Sheet>
  );
}

/** What a seat owes now, as a short mark: a vote or the move (an answer to a request shows on its favour). */
function markOf(v: PahunchView, i: number): string | null {
  if (!v.pending.includes(i)) return null;
  if (v.vote && i !== v.turn) return v.vote.answers[i] === null && count(v.rooms, v.vote.room, i) > 0 ? "votes" : null;
  return i === v.turn ? "to move" : null;
}

// ---- your tray: you, your izzat, your favour ----

/** A favour's uses left as words; `null` = hidden from this viewer (the room keeps them secret). */
const usesLeft = (n: number | null) => (n === null ? "uses left hidden" : `${n} of 2 uses left`);

/** Two dots for a favour's uses: filled ones are left; a hidden count shows as "?". */
function Uses({ n }: { n: number | null }) {
  return (
    <span className={`ph-uses ${n === null ? "hidden" : ""}`} role="img" aria-label={usesLeft(n)}>
      {n === null ? "?" : "●".repeat(n) + "○".repeat(Math.max(0, 2 - n))}
    </span>
  );
}

// The 💡 tips can be switched off from the menu, on this device; they start on.
const TIPS_KEY = "aa:tips";
const tipsListeners = new Set<() => void>();
const tipsOn = () => {
  try {
    return localStorage.getItem(TIPS_KEY) !== "0";
  } catch {
    return true;
  }
};
function setTips(on: boolean) {
  try {
    localStorage.setItem(TIPS_KEY, on ? "1" : "0");
  } catch {
    // No storage: the switch lasts until the page reloads.
  }
  for (const f of tipsListeners) f();
}
function useTips(): boolean {
  return useSyncExternalStore(
    (f) => {
      tipsListeners.add(f);
      return () => tipsListeners.delete(f);
    },
    tipsOn,
    () => true,
  );
}

/** The menu's switch for every 💡 on the table: each player's own, on this device. */
function TipsSwitch() {
  const on = useTips();
  return <Toggle label={S.tipsSwitch} hint={S.tipsHint} on={on} admin onChange={setTips} />;
}

/**
 * A small rule or a deal idea for new players: hidden behind 💡 until tapped, so it never gets in
 * the way of players who know the game. One per panel at most; the menu switches them all off.
 */
function Tip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const shown = useTips();
  if (!shown) return null;
  return (
    <>
      <button
        type="button"
        className={`ph-tip-btn ${open ? "on" : ""}`}
        aria-expanded={open}
        aria-label={open ? "Hide tip" : "Tip"}
        onClick={() => setOpen(!open)}
      >
        💡
      </button>
      {open && (
        <span className="ph-tip" role="note">
          {children}
        </span>
      )}
    </>
  );
}

function MyTray(
  props: SeatProps & { act: (a: PahunchAction) => void; owing: boolean; onDeal: (init: DealInit) => void },
) {
  const { ctx, room, reactions, awayFor, send, act, owing, onDeal } = props;
  const { v, skin } = ctx;
  const me = ctx.me ?? 0;
  const seat = room.seats[me];
  const p = v.players[me];
  const look = skin.seats[me % skin.seats.length];
  const [info, setInfo] = useState(false);
  const tokens = p?.tokens ?? [];
  const atTheTop = count(v.rooms, v.layout.summit, me);
  if (!seat || !p) return null;
  return (
    <section
      className={`ph-tray ${owing ? "owing" : ""}`}
      data-seat={me}
      aria-label="You"
      style={{ ["--seat" as string]: look.color, ["--seat-ink" as string]: look.ink }}
    >
      <div className="ph-tray-head">
        <div className="avatar-wrap">
          <button
            className="avatar-btn"
            onClick={() => setInfo(true)}
            aria-haspopup="dialog"
            aria-label="About your seat"
          >
            <Avatar code={seat.avatar} name={seat.name} className="on" />
          </button>
          <SeatSwatch seat={me} />
          <Floats reactions={reactions} seat={me} />
          <ReactBar room={room} send={send} side />
        </div>
        <button className="ph-tray-who" onClick={() => setInfo(true)} aria-haspopup="dialog">
          <span className="seat-name">You{room.admin === me && <span className="admin-mark">★</span>}</span>
          <span className="ph-counts">
            <span role="img" aria-label={`${p.hand} still to place`}>
              ✋ {p.hand}
            </span>
            <span role="img" aria-label={`${atTheTop} at the top`}>
              ▲ {atTheTop}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="ph-score"
          onClick={() => setInfo(true)}
          aria-haspopup="dialog"
          aria-label={`Your ${skin.nouns.points}: ${score(tokens)}`}
        >
          <span aria-hidden="true">🪙</span> <b>{score(tokens)}</b>
        </button>
      </div>
      <div className="ph-tokens ph-tray-tokens">
        {tokens.map((t, k) => (
          <span key={k} className={`ph-chip v${Math.min(t, 5)}`}>
            {t}
          </span>
        ))}
        {!v.over && tokens.length > 0 && (
          <button type="button" className="btn small ph-give" onClick={() => onDeal({ mode: "give" })}>
            🎁 Give
          </button>
        )}
        {!v.over && (
          <button type="button" className="btn small ph-give" onClick={() => onDeal({ mode: "ask" })}>
            🙏 Ask
          </button>
        )}
        {!v.over && tokens.length > 0 && (
          <button type="button" className="btn small ph-give" onClick={() => onDeal({ mode: "swap" })}>
            ⇄ Swap
          </button>
        )}
        {!v.over && (
          <Tip>
            Only you see your {skin.nouns.points} until the end. Give, ask for or swap tokens any time to seal a deal
            made on the call: a vote, a favour, a promise.
            {p.favour &&
              ` Your favour only helps someone else’s move, never your own: offer it when it helps the mover, and agree on the call what they give you for it. Each use earns you ${v.layout.pay[p.favour] ?? 0} ${skin.nouns.points}.`}
          </Tip>
        )}
      </div>
      {!v.over && <MyDeals ctx={ctx} act={act} onOpen={onDeal} />}
      {p.favour && !v.over && <MyFavour ctx={ctx} act={act} />}
      {info && <SeatSheet ctx={ctx} room={room} awayFor={awayFor} send={send} i={me} onClose={() => setInfo(false)} />}
    </section>
  );
}

/** Your favour: what it is and its uses; on another player's turn, the offer to them. */
function MyFavour({ ctx, act }: { ctx: Ctx; act: (a: PahunchAction) => void }) {
  const { v, skin, me } = ctx;
  const [info, setInfo] = useState(false);
  if (me === null) return null;
  const p = v.players[me];
  const kind: PahunchFavour | null = p?.favour ?? null;
  if (!p || !kind) return null;
  const f = skin.favours[kind];
  const pay = v.layout.pay[kind] ?? 0;
  const theirs = v.turn !== me;
  const offered = v.lent.includes(me);
  const spent = v.used.includes(me);
  const mover = ctx.names[v.turn];
  const once = !offered && onceOffered(v, me);
  const toggle = theirs && !spent && !once && (offered || (p.uses ?? 0) > 0);
  const asked = v.asked.includes(me);
  // Where it stands, as a glyph and the mover's face; the words are the button's label.
  const state = spent
    ? `used by ${mover}`
    : offered
      ? `on offer to ${mover}`
      : asked
        ? `${mover} asks for it`
        : once
          ? "offered once this turn"
          : `each use earns you ${pay} ${skin.nouns.points}`;
  return (
    <div className={`ph-my-favour ${offered ? "offered" : ""}`}>
      <button
        type="button"
        className="ph-fav-name"
        onClick={() => setInfo(true)}
        aria-haspopup="dialog"
        title={f.effect}
        aria-label={`Your favour: ${f.name}, ${usesLeft(p.uses)}, ${state}`}
      >
        <span className="ph-fav-glyph" aria-hidden="true">
          {f.glyph}
        </span>
        <span aria-hidden="true">
          <b>{f.name}</b>
          <small>
            <Uses n={p.uses} />{" "}
            {spent ? (
              <>
                ✔ <Face ctx={ctx} i={v.turn} />
              </>
            ) : offered ? (
              <>
                🤝 → <Face ctx={ctx} i={v.turn} />
              </>
            ) : asked ? (
              <>
                🙏 <Face ctx={ctx} i={v.turn} />
              </>
            ) : once ? (
              "↩ offered once this turn"
            ) : (
              `+${pay} 🪙`
            )}
          </small>
        </span>
      </button>
      {toggle && (
        <button
          type="button"
          className="btn ph-offer-btn"
          aria-pressed={offered}
          aria-label={offered ? `Take back your ${f.name}` : `Offer your ${f.name} to ${mover}`}
          disabled={offered && v.vote !== null}
          onClick={() => act({ type: "lend", on: !offered })}
        >
          {offered ? (
            "↩ Take back"
          ) : (
            <>
              🤝 Offer {f.glyph} → <Face ctx={ctx} i={v.turn} />
            </>
          )}
        </button>
      )}
      {info && <FavourSheet ctx={ctx} owner={me} act={act} onClose={() => setInfo(false)} />}
    </div>
  );
}

// ---- your move ----

/**
 * The favours on offer to the mover (with a ✕ to turn one down, so no climb uses it), and those
 * they asked for (with a ✕ to take the request back). Tap a name: what the favour does; a mouse
 * sees it on hover too.
 */
function OnOffer({ ctx, act }: { ctx: Ctx; act: (a: PahunchAction) => void }) {
  const { v, skin } = ctx;
  const [open, setOpen] = useState<number | null>(null);
  const list = onOffer(v);
  const asked = v.asked.flatMap((owner) => {
    const kind = v.players[owner]?.favour;
    return kind ? [{ owner, kind }] : [];
  });
  if (list.length === 0 && asked.length === 0) return null;
  const name = (owner: number, kind: PahunchFavour, extra?: ReactNode) => (
    <button
      type="button"
      className="ph-offer-name"
      onClick={() => setOpen(owner)}
      aria-haspopup="dialog"
      title={skin.favours[kind].effect}
    >
      {skin.favours[kind].glyph} {skin.favours[kind].name} {extra ?? <Face ctx={ctx} i={owner} />}
    </button>
  );
  return (
    <div className="ph-on-offer" aria-label="Favours for your move">
      {list.map(({ owner, kind }) => (
        <span key={owner} className="ph-offer">
          {name(owner, kind)}
          {v.vote === null && (
            <button
              type="button"
              className="ph-offer-x"
              aria-label={`Turn down ${ctx.names[owner]}’s ${skin.favours[kind].name}`}
              onClick={() => act({ type: "request", owner, on: false })}
            >
              ✕
            </button>
          )}
        </span>
      ))}
      {asked.map(({ owner, kind }) => (
        <span key={`a${owner}`} className="ph-offer asked">
          {name(
            owner,
            kind,
            <small role="img" aria-label={`asked ${ctx.names[owner]}, waiting`}>
              ⏳ <Face ctx={ctx} i={owner} />
            </small>,
          )}
          <button
            type="button"
            className="ph-offer-x"
            aria-label={`Take back the request to ${ctx.names[owner]}`}
            onClick={() => act({ type: "request", owner, on: false })}
          >
            ✕
          </button>
        </span>
      ))}
      {open !== null && <FavourSheet ctx={ctx} owner={open} act={act} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** The mover asked for your favour: yes puts it on offer to them, no keeps it. */
function RequestBar({ ctx, act }: { ctx: Ctx; act: (a: PahunchAction) => void }) {
  const { v, skin, me } = ctx;
  const kind = me === null ? null : (v.players[me]?.favour ?? null);
  if (!kind) return null;
  const f = skin.favours[kind];
  const pay = v.layout.pay[kind] ?? 0;
  const { points } = skin.nouns;
  return (
    <div className="ph-moves ph-request" role="group" aria-label="A request for your favour">
      <div className="ph-pick-head">
        <b className="ph-turn">🙏 Asked</b>
        <span className="ph-pick-what">
          {ctx.names[v.turn]} asks for your {f.glyph} {f.name}
        </span>
        <Tip>
          Agree on the call what you get for it before you say yes. Yes puts it on offer: you earn {pay} {points} only
          if they use it, and then it loses a use.
        </Tip>
      </div>
      <div className="ph-move-grid">
        <button type="button" className="btn ph-move" onClick={() => act({ type: "lend", on: true })}>
          <b>✓ Yes, offer it</b>
          <small>
            +{pay} {points} if used
          </small>
        </button>
        <button type="button" className="btn ph-move" onClick={() => act({ type: "decline" })}>
          <b>✗ No</b>
          <small>keep it</small>
        </button>
      </div>
    </div>
  );
}

const carryKey = (c: PahunchCarry | undefined) => (c === undefined ? "" : c.t === "seat" ? `s${c.seat}` : "n");

function MoveButton({
  ctx,
  m,
  act,
  setPick,
}: {
  ctx: Ctx;
  m: Move;
  act: (a: PahunchAction) => void;
  setPick: (p: Pick | null) => void;
}) {
  return (
    <button
      type="button"
      className={`btn ph-move ${m.goTo ? "ph-then" : ""}`}
      onClick={() => (m.action ? act(m.action) : m.goTo && setPick(m.goTo))}
    >
      <b>
        <Rich ctx={ctx} text={m.verb} />
      </b>
      <small>
        <Rich ctx={ctx} text={m.note} />
      </small>
    </button>
  );
}

/**
 * Your move: one line saying what is picked on the board, then its moves as big buttons. Nothing
 * picked: a hint, and every move behind "All moves".
 */
function PickBar(props: {
  ctx: Ctx;
  pick: Pick | null;
  setPick: (p: Pick | null) => void;
  picked: Move[];
  moves: Move[];
  /** After the main move: only extra moves, and ending the turn. */
  extra: boolean;
  blockerLive: boolean;
  extras: Extras;
  setExtras: (e: Extras) => void;
  act: (a: PahunchAction) => void;
  onInfo: (p: Pick) => void;
  /** For a picked way up: what the climb needs and gives. */
  facts: string[];
}) {
  const { ctx, pick, picked, moves, extra, extras, setExtras, act, setPick, facts } = props;
  const { v, skin } = ctx;
  const paths = v.layout.paths;
  const me = ctx.me ?? 0;
  const [all, setAll] = useState(false);
  const { blocker, points, neutral, climbers } = skin.nouns;
  const route = (p: number) => `${ctx.short(paths[p].from)} → ${ctx.short(paths[p].to)}`;
  const title = !pick
    ? null
    : pick.blocker
      ? pick.path === undefined
        ? blocker
        : `${blocker} → ${route(pick.path)}`
      : pick.room !== undefined
        ? ctx.room(pick.room)
        : pick.path !== undefined
          ? route(pick.path)
          : null;
  const hint = pick?.blocker
    ? pick.path === undefined
      ? `Tap a glowing ${skin.nouns.path}`
      : null
    : !pick
      ? extra
        ? moves.length > 0 || props.blockerLive
          ? "Use a glowing move, or end your turn"
          : S.waitFavour
        : `Tap a glowing room${props.blockerLive ? ` or ${blocker}` : ""}`
      : pick.room !== undefined && picked.some((m) => m.goTo)
        ? `${ctx.room(pick.room)}: where to?`
        : null;

  // Favour pickers, only for a picked way up with a climb that can use them.
  const fromRoom = pick?.path !== undefined && !pick.blocker ? paths[pick.path].from : undefined;
  const climbsHere = picked.filter((m) => m.action?.type === "climb");
  const swaps =
    !extra && fromRoom !== undefined && offers(v, "swapToken") && (climbsHere.length > 0 || extras.swap !== undefined)
      ? swapTargets(v).filter((p) => p !== pick?.path)
      : [];
  const carries =
    !extra && fromRoom !== undefined && offers(v, "carry")
      ? carryTargets(v, me).filter((c) => {
          const who = c.t === "seat" ? c.seat : null;
          return count(v.rooms, fromRoom, who) >= (who === me ? 2 : 1) && count(v.rooms, fromRoom, me) > 0;
        })
      : [];

  // Every move, by the room it starts from: the list behind "All moves".
  const groups = [...new Set(moves.flatMap((m) => (m.room === undefined ? [] : [m.room])))].map((r) => ({
    r,
    list: moves.filter((m) => m.room === r),
  }));

  return (
    <div className="ph-moves ph-pick">
      <div className="ph-pick-head">
        <b className="ph-turn">{extra ? "Extra move" : "Your move"}</b>
        {title && !hint && (
          <span className="ph-pick-what">
            <Rich ctx={ctx} text={title} />
          </span>
        )}
        {hint && (
          <span className="ph-hint">
            <Rich ctx={ctx} text={hint} />
          </span>
        )}
        <Tip>
          {pick?.blocker
            ? `Climbing past ${blocker} needs no vote but takes no ${points}. Send him onto the ${points} a rival is after, or off a ${skin.nouns.path} you want to climb.`
            : extra
              ? "Extra moves come from special coins and favours. Use them in any order, or end your turn."
              : `One move a turn. Short of votes? Ask on the call, and offer ${points} or a favour for a yes. Tap another player’s favour to ask for it.`}
        </Tip>
        {pick && (
          <>
            <button
              type="button"
              className="icon-btn ph-chipbtn ph-info"
              aria-label="About this"
              onClick={() => props.onInfo(pick)}
            >
              i
            </button>
            <button
              type="button"
              className="icon-btn ph-chipbtn"
              aria-label="Clear"
              onClick={() => props.setPick(null)}
            >
              ✕
            </button>
          </>
        )}
        {!pick && moves.length > 0 && (
          <button type="button" className="btn small ghost ph-chipbtn" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? "Hide list" : "All moves"}
          </button>
        )}
      </div>
      {facts.length > 0 && (
        <ul className="ph-facts" aria-label="What this climb needs">
          {facts.map((f) => (
            <li key={f}>
              <Rich ctx={ctx} text={f} />
            </li>
          ))}
        </ul>
      )}
      <OnOffer ctx={ctx} act={act} />
      {pick && picked.length > 0 && (
        <div className="ph-move-grid" role="group" aria-label="Moves">
          {picked.map((m) => (
            <MoveButton key={m.key} ctx={ctx} m={m} act={act} setPick={setPick} />
          ))}
        </div>
      )}
      {swaps.length > 0 && pick?.path !== undefined && (
        <Opts glyph={skin.favours.swapToken.glyph} label={S.swapPick}>
          <Opt on={extras.swap === undefined} label={S.swapOwn} onTap={() => setExtras({ ...extras, swap: undefined })}>
            <CoinChip ctx={ctx} path={pick.path} />
            <small>{S.onTheWay}</small>
          </Opt>
          {swaps.map((p) => (
            <Opt
              key={p}
              path={p}
              on={extras.swap === p}
              label={S.swapFrom(v.tokensOn[p]?.value ?? 0, route(p))}
              onTap={() => setExtras({ ...extras, swap: p })}
            >
              <CoinChip ctx={ctx} path={p} />
              <small>
                <Rich ctx={ctx} text={route(p)} />
              </small>
            </Opt>
          ))}
        </Opts>
      )}
      {carries.length > 0 && (
        <Opts glyph={skin.favours.carry.glyph} label={S.carryPick}>
          <Opt
            on={extras.carry === undefined}
            label={S.nobody}
            onTap={() => setExtras({ ...extras, carry: undefined })}
          >
            <span className="ph-opt-glyph">✕</span>
            <small>{S.nobody}</small>
          </Opt>
          {carries.map((c) => (
            <Opt
              key={carryKey(c)}
              seat={c.t === "seat" ? c.seat : undefined}
              on={carryKey(extras.carry) === carryKey(c)}
              label={
                c.t === "seat"
                  ? c.seat === ctx.me
                    ? S.carryOwn(climbers)
                    : ctx.names[c.seat]
                  : S.carryNeutral(neutral)
              }
              onTap={() => setExtras({ ...extras, carry: c })}
            >
              {c.t === "seat" ? (
                <>
                  <Face ctx={ctx} i={c.seat} />
                  <small>{c.seat === ctx.me ? "+1" : ctx.names[c.seat]}</small>
                </>
              ) : (
                <>
                  <span className="ph-opt-glyph">{skin.neutralGlyph}</span>
                  <small>+1</small>
                </>
              )}
            </Opt>
          ))}
        </Opts>
      )}
      {!pick && all && (
        <div className="ph-all">
          {groups.map(({ r, list }) => (
            <div key={r} className="ph-all-room">
              <span className="ph-act-label">{ctx.room(r)}</span>
              <div className="ph-move-grid">
                {list.map((m) => (
                  <MoveButton key={m.key} ctx={ctx} m={m} act={act} setPick={setPick} />
                ))}
              </div>
            </div>
          ))}
          {props.blockerLive && <BlockPicker ctx={ctx} act={act} />}
        </div>
      )}
      {extra && (
        <button type="button" className="btn ph-move ph-done" onClick={() => act({ type: "done" })}>
          <b>{S.endTurn}</b>
        </button>
      )}
    </div>
  );
}

/** A row of picks, one per choice: the glyph says which favour or piece it is for. */
function Opts({ glyph, label, children }: { glyph: string; label: string; children: ReactNode }) {
  return (
    <div className="ph-opts-row">
      <span className="ph-opts-glyph" aria-hidden="true">
        {glyph}
      </span>
      <div className="ph-opts" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

/** One pick in an `Opts` row: what it is on top (a coin, a face, a glyph), a word beneath. */
function Opt(props: {
  on?: boolean;
  label: string;
  onTap: () => void;
  path?: number;
  seat?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`ph-give-who ph-opt${props.on ? " on" : ""}`}
      aria-pressed={props.on === undefined ? undefined : props.on}
      aria-label={props.label}
      data-path={props.path}
      data-seat={props.seat}
      onClick={props.onTap}
    >
      {props.children}
    </button>
  );
}

/** The blocker's move, for the "All moves" view: a tap on where he goes (the confirm strip follows). */
function BlockPicker({ ctx, act }: { ctx: Ctx; act: (a: PahunchAction) => void }) {
  const { v, skin } = ctx;
  const route = (p: number) => `${ctx.short(v.layout.paths[p].from)} → ${ctx.short(v.layout.paths[p].to)}`;
  return (
    <div className="ph-all-room">
      <Opts glyph={skin.blockerGlyph} label={S.blockPick(skin.nouns.blocker)}>
        {blockTargets(v).map((p) => (
          <Opt key={p} path={p} label={route(p)} onTap={() => act({ type: "block", path: p })}>
            <CoinChip ctx={ctx} path={p} />
            <small>
              <Rich ctx={ctx} text={route(p)} />
            </small>
          </Opt>
        ))}
      </Opts>
    </div>
  );
}

// ---- what a tap on the board explains ----

/**
 * The key to the special coins on the board: one chip per bonus glyph lying there now (a tap
 * works on a phone, where nothing hovers). A tap opens what every bonus does.
 */
function CoinKey({ ctx }: { ctx: Ctx }) {
  const { v, skin } = ctx;
  const [open, setOpen] = useState(false);
  const here = new Set(v.tokensOn.flatMap((t) => (t?.bonus ? [t.bonus] : [])));
  if (here.size === 0) return null;
  const all = Object.keys(skin.bonuses) as (keyof typeof skin.bonuses)[];
  return (
    <div className="ph-coin-key">
      {all
        .filter((b) => here.has(b))
        .map((b) => (
          <button
            key={b}
            type="button"
            className="ph-key-chip"
            aria-label={`${skin.bonuses[b].name}: what it does`}
            onClick={() => setOpen(true)}
          >
            <span className="ph-key-glyph">{skin.bonuses[b].glyph}</span> <Rich ctx={ctx} text={skin.bonuses[b].name} />
          </button>
        ))}
      {open && (
        <Sheet title="🪙 Special coins" onClose={() => setOpen(false)}>
          <ul className="ph-key-list">
            {all.map((b) => (
              <li key={b} className={here.has(b) ? "" : "muted"}>
                <span className="ph-key-glyph">{skin.bonuses[b].glyph}</span>
                <span>
                  <span className="ph-key-effect">
                    <Rich ctx={ctx} text={skin.bonuses[b].effect} />
                  </span>
                  <small>
                    <Rich ctx={ctx} text={skin.bonuses[b].name} />
                  </small>
                </span>
              </li>
            ))}
          </ul>
          <p className="ph-sheet-small">
            The mark sits on a coin’s edge. Take that coin and you get its bonus too, on top of its {skin.nouns.points}.
          </p>
        </Sheet>
      )}
    </div>
  );
}

function BoardInfo({ ctx, pick, onClose }: { ctx: Ctx; pick: Pick; onClose: () => void }) {
  const { v, skin } = ctx;
  const { layout } = v;
  const { points, blocker, neutral, neutrals, climber } = skin.nouns;
  const coinLine = (p: number) => {
    const t = v.tokensOn[p];
    if (!t) return null;
    const b = t.bonus ? skin.bonuses[t.bonus] : null;
    return `${t.value} ${points}${b ? ` with ${b.glyph} ${b.name}` : ""}`;
  };
  // A chip: a fact as glyphs and numbers, its words in the label.
  const chip = (key: string, label: string, body: ReactNode, cls = "") => (
    <span key={key} className={cls} role="img" aria-label={label}>
      {body}
    </span>
  );
  const coinChip = (p: number) =>
    v.tokensOn[p] ? chip(`c${p}`, coinLine(p) ?? "", <CoinChip ctx={ctx} path={p} />, "ph-fact-coin") : null;
  const votesChip = (r: number) =>
    chip("v", S.factVotes(need(layout, r), layout.rooms[r].cap), `🗳️ ${need(layout, r)}/${layout.rooms[r].cap}`);
  let title = "";
  let lead = "";
  let chips: ReactNode[] = [];
  let small: string[] = [];
  if (pick.blocker && v.blocker !== null) {
    const p = layout.paths[v.blocker];
    title = `${skin.blockerGlyph} ${upper(blocker)}`;
    lead = S.blockerLead(upper(blocker), points);
    chips = [
      chip(
        "at",
        S.factOn(ctx.room(p.from), ctx.room(p.to)),
        <Rich ctx={ctx} text={`${ctx.icon(p.from)} → ${ctx.icon(p.to)}`} />,
      ),
      coinChip(v.blocker),
    ];
    small = [
      S.blockerCovered(points, `${skin.favours.coveredToken.glyph} ${skin.favours.coveredToken.name}`),
      S.blockerMove(blocker, climber, skin.nouns.path, points, skin.nouns.backPath),
    ];
  } else if (pick.path !== undefined) {
    const i = pick.path;
    const p = layout.paths[i];
    const kind = pathKind(layout, i);
    const bonus = v.tokensOn[i]?.bonus;
    const key = `${skin.favours.backStairs.glyph} ${skin.favours.backStairs.name}`;
    title = `${ctx.short(p.from)} → ${ctx.short(p.to)}`;
    lead =
      kind === "back"
        ? S.backLead(key, points)
        : v.blocker === i
          ? S.blockedLead(upper(blocker), points)
          : kind === "plain"
            ? S.plainLead(points)
            : S.pathLead(need(layout, p.from), ctx.room(p.from));
    chips = [
      chip(
        "way",
        S.factWay(kind === "back" ? skin.nouns.backPath : skin.nouns.path, ctx.room(p.from), ctx.room(p.to)),
        <Rich ctx={ctx} text={`${ctx.icon(p.from)} → ${ctx.icon(p.to)}${kind === "back" ? " 🔒" : ""}`} />,
      ),
      kind === "slot" && v.blocker !== i ? votesChip(p.from) : null,
      coinChip(i),
      v.blocker === i ? chip("b", S.factBlocker(upper(blocker)), skin.blockerGlyph) : null,
      kind === "back" && offers(v, "backStairs")
        ? chip("k", S.factKey, `${skin.favours.backStairs.glyph} ✓`, "ph-fav-status")
        : null,
    ];
    small = [
      bonus ? `${skin.bonuses[bonus].glyph} ${skin.bonuses[bonus].name}: ${skin.bonuses[bonus].effect}` : "",
      kind === "back" ? "" : S.nudgeNote(neutral, points),
    ].filter(Boolean);
  } else if (pick.room !== undefined) {
    const r = pick.room;
    const held = v.rooms[r] ?? [];
    const cap = layout.rooms[r].cap;
    const top = r === layout.summit;
    const out = layout.paths.flatMap((p, i) => (p.from === r ? [i] : []));
    title = ctx.room(r);
    lead = top ? S.topLead(climber) : cap === 1 ? S.postLead : S.roomLead(need(layout, r), cap);
    chips = [
      chip(
        "held",
        S.factSeats(held.length, cap, held.map((s) => (s === null ? neutral : ctx.who(s))).join(", ")),
        <>
          {held.map((s, k) =>
            s === null ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: neutrals have no id; their order is the room's
              <span key={k}>{skin.neutralGlyph}</span>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: a seat may sit here twice
              <Face key={k} ctx={ctx} i={s} />
            ),
          )}
          <b>
            {held.length}/{cap}
          </b>
        </>,
      ),
      top || cap === 1 ? null : votesChip(r),
      ...out.map((i) => {
        const p = layout.paths[i];
        const t = v.tokensOn[i];
        const what = p.back ? "🔒" : v.blocker === i ? skin.blockerGlyph : t ? null : "∅";
        return chip(
          `o${i}`,
          `↑ ${ctx.room(p.to)}: ${p.back ? `${skin.nouns.backPath}, locked` : v.blocker === i ? `${blocker} sits here` : (coinLine(i) ?? `no ${points}`)}`,
          <>
            <Rich ctx={ctx} text={`↑ ${ctx.icon(p.to)}`} /> {what ?? <CoinChip ctx={ctx} path={i} />}
          </>,
          "ph-fact-coin",
        );
      }),
    ];
    small = [top ? S.topNote(neutrals) : isEntry(layout, r) ? S.entryNote(skin.nouns.climbers) : ""].filter(Boolean);
  }
  return (
    <Sheet title={<Rich ctx={ctx} text={title} />} onClose={onClose}>
      <p className="ph-sheet-lead">
        <Rich ctx={ctx} text={lead} />
      </p>
      <div className="ph-sheet-facts">{chips}</div>
      {small.length > 0 && (
        <ul className="ph-sheet-small">
          {small.map((f) => (
            <li key={f}>
              <Rich ctx={ctx} text={f} />
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

// ---- votes ----

function VoteSummary({ ctx, vote, clock }: { ctx: Ctx; vote: PahunchVote; clock: Clock | null }) {
  const { v, skin, who } = ctx;
  const to = v.layout.paths[vote.path].to;
  const neutrals = count(v.rooms, vote.room, null);
  const yes = yesSoFar(vote);
  const voters = vote.answers.flatMap((a, s) => (count(v.rooms, vote.room, s) > 0 ? [{ s, a }] : []));
  // Read without words: the climber's face, the two rooms' icons, a pip per yes needed, and each
  // voter's face with what they said. The sentence is for screen readers and the log.
  const said = (s: number, a: number | null) =>
    s === v.turn ? "yes (own)" : a === null ? "thinking" : a === 0 ? "no" : `yes ×${a}`;
  return (
    <div className="ph-vote" aria-live="polite">
      <h2 className="ph-vote-move">
        <span className="ph-face" style={{ ["--seat" as string]: skin.seats[v.turn % skin.seats.length].color }}>
          <Avatar code={ctx.looks[v.turn] ?? ""} name={who(v.turn)} />
        </span>
        <span className="ph-vote-rooms" aria-hidden="true">
          <span className="ph-vote-icon">{ctx.icon(vote.room)}</span>
          <span className="ph-vote-arrow">➜</span>
          <span className="ph-vote-icon">{ctx.icon(to)}</span>
        </span>
        <span className="sr-only">
          {who(v.turn)} {v.turn === ctx.me ? "want" : "wants"} to move up: {ctx.room(vote.room)} to {ctx.room(to)}
        </span>
        {clock && <ClockRing clock={clock} />}
      </h2>
      <VoteUses ctx={ctx} vote={vote} />
      <p className="ph-pips" role="img" aria-label={`${yes} of ${vote.need} yes`}>
        {Array.from({ length: Math.max(vote.need, yes) }, (_, k) => (
          <span key={k} className={k < yes ? "on" : ""} />
        ))}
      </p>
      <ul className="ph-voters">
        {voters.map(({ s, a }) => {
          const n = count(v.rooms, vote.room, s);
          const mark = s === v.turn ? "⬆" : a === null ? "⏳" : a === 0 ? "✗" : "✓";
          const state = s === v.turn ? "own" : a === null ? "wait" : a === 0 ? "no" : "yes";
          return (
            <li
              key={s}
              className={`ph-voter ${state}`}
              style={{ ["--seat" as string]: skin.seats[s % skin.seats.length].color }}
              aria-label={`${who(s)}, ${n} in the room: ${said(s, a)}`}
            >
              <span className="ph-face">
                <Avatar code={ctx.looks[s] ?? ""} name={who(s)} />
                {n > 1 && <span className="ph-count">×{n}</span>}
                <span className="ph-said" aria-hidden="true">
                  {mark}
                  {a !== null && a > 1 && s !== v.turn ? a : ""}
                </span>
              </span>
            </li>
          );
        })}
        {neutrals > 0 && (
          <li
            className={`ph-voter neutral ${vote.bribed > 0 ? "yes" : "wait"}`}
            aria-label={`${neutrals} ${neutrals === 1 ? skin.nouns.neutral : skin.nouns.neutrals}: ${vote.bribed} paid`}
          >
            <span className="ph-face">
              <Avatar code={skin.neutralLook} name={skin.nouns.neutral} lips={skin.neutralLips} />
              {neutrals > 1 && <span className="ph-count">×{neutrals}</span>}
              <span className="ph-said ph-paid" aria-hidden="true">
                {vote.bribed}
              </span>
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

/** A coin as a chip: its value colour, its bonus mark; `crossed` when the climb leaves it. */
function CoinChip({ ctx, path, crossed }: { ctx: Ctx; path: number; crossed?: boolean }) {
  const t = ctx.v.tokensOn[path];
  if (!t) return <span className="ph-chip ph-none">∅</span>;
  const cls = `ph-chip v${Math.min(t.value, 5)} ${crossed ? "ph-crossed" : "ph-gain"}`;
  const body = (
    <>
      {t.value}
      {t.bonus && <small>{ctx.skin.bonuses[t.bonus].glyph}</small>}
    </>
  );
  return crossed ? <s className={cls}>{body}</s> : <span className={cls}>{body}</span>;
}

/**
 * What the climb in a vote uses, for everyone to see before they answer: each lent favour's glyph
 * and owner's face, and what it changes (the token taken instead, the piece taken along, the extra
 * seat).
 */
function VoteUses({ ctx, vote }: { ctx: Ctx; vote: PahunchVote }) {
  const { v, skin } = ctx;
  const uses = climbFavours(v, vote.path, vote.swap, vote.carry);
  if (uses.length === 0) return null;
  const to = v.layout.paths[vote.path].to;
  return (
    <ul className="ph-vote-uses" aria-label={S.votesFor}>
      {uses.map(({ kind, owner }) => {
        const f = skin.favours[kind];
        const name = owner === null ? "" : ctx.names[owner];
        let label: string;
        let body: ReactNode;
        if (kind === "swapToken" && vote.swap !== undefined) {
          label = S.usesSwap(name, v.tokensOn[vote.path]?.value ?? null, v.tokensOn[vote.swap]?.value ?? 0);
          body = (
            <>
              <CoinChip ctx={ctx} path={vote.path} crossed /> → <CoinChip ctx={ctx} path={vote.swap} />
            </>
          );
        } else if (kind === "carry" && vote.carry) {
          const c = vote.carry;
          label = S.usesCarry(name, c.t === "seat" ? ctx.who(c.seat) : skin.nouns.neutral);
          body = <>+ {c.t === "seat" ? <Face ctx={ctx} i={c.seat} /> : <Rich ctx={ctx} text={skin.nouns.neutral} />}</>;
        } else {
          label = S.usesSqueeze(name);
          body = <>{ctx.icon(to)} +1</>;
        }
        return (
          <li key={kind} className="ph-vote-use" title={label}>
            <span className="sr-only">{label}</span>
            <span aria-hidden="true" className="ph-vote-use-body">
              <span className="ph-fav-glyph">{f.glyph}</span>
              {owner !== null && <Face ctx={ctx} i={owner} />}
              {body}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function VoteBar({ ctx, vote, act }: { ctx: Ctx; vote: PahunchVote; act: (a: PahunchAction) => void }) {
  const { v, skin, me } = ctx;
  if (me === null) return null;
  const mine = count(v.rooms, vote.room, me);
  if (me !== v.turn) {
    if (!votersLeft(v, vote).includes(me)) return null;
    return (
      <div className="ph-moves" role="group" aria-label="Your vote">
        <div className="ph-pick-head">
          <b className="ph-turn">🗳️ Your vote</b>
          <span className="ph-pick-what">
            {mine} in {ctx.short(vote.room)} · a yes the climber takes earns 1 {skin.nouns.points}
          </span>
          <Tip>
            Your yes can be worth more than 1: ask the climber for a gift or a promise on the call before you answer.
            Saying no keeps a rival down.
          </Tip>
        </div>
        <VoteUses ctx={ctx} vote={vote} />
        <div className="ph-move-grid">
          {Array.from({ length: mine }, (_, k) => mine - k).map((n) => (
            <button key={n} className="btn ph-move" onClick={() => act({ type: "vote", yes: n })}>
              <b>{S.voteYes(mine > 1 ? n : 1)}</b>
              {/* What the yes lets happen: the way up, and a token taken instead of the path's own. */}
              <small className="ph-yes-what">
                {ctx.icon(vote.room)} ➜ {ctx.icon(v.layout.paths[vote.path].to)}
                {vote.swap !== undefined && (
                  <>
                    {" "}
                    · <CoinChip ctx={ctx} path={vote.path} crossed /> → <CoinChip ctx={ctx} path={vote.swap} />
                  </>
                )}
                {vote.carry && <> · {skin.favours.carry.glyph}</>}
              </small>
            </button>
          ))}
          <button className="btn ph-move" onClick={() => act({ type: "vote", yes: 0 })}>
            <b>{S.voteNo}</b>
          </button>
        </div>
      </div>
    );
  }
  const tokens = v.players[me]?.tokens ?? [];
  const enough = yesSoFar(vote) >= vote.need;
  // With enough yes in, a paid neutral only costs a token.
  const bribes = enough ? [] : bribeChoices(v, vote, tokens);
  return (
    <div className="ph-moves" role="group" aria-label="Your climb">
      <div className="ph-pick-head">
        <b className="ph-turn">↑ Your climb</b>
        <span className="ph-pick-what">
          {yesSoFar(vote)} of {vote.need} yes{enough ? "" : " · ask on the call"}
        </span>
        <Tip>
          Each yes you take earns its giver 1 {skin.nouns.points}; offer more on the call to win a vote. Once enough yes
          are in, take the ones you need and go: no need to wait for the rest. An {skin.nouns.neutral} always says yes
          for a token of {v.layout.minBribe} or more, but that token is gone.
        </Tip>
      </div>
      {enough && <TakeVotes key={`${vote.answers.join(",")}:${vote.bribed}`} ctx={ctx} vote={vote} act={act} />}
      <div className="ph-move-grid">
        {bribes.map((t) => (
          <button key={t} className="btn ph-move" onClick={() => act({ type: "bribe", token: t })}>
            <b>
              <Rich ctx={ctx} text={`🍬 Pay an ${skin.nouns.neutral}`} />
            </b>
            <small>a {t}, gone for good</small>
          </button>
        ))}
        <button className="btn ph-move" onClick={() => act({ type: "withdraw" })}>
          <b>✗ Give up</b>
          <small>{v.options.failEndsTurn ? "your turn ends" : "then pick another move"}</small>
        </button>
      </div>
    </div>
  );
}

/** Yes from other players the climb still needs, past the mover's own and the paid neutrals. */
function stillNeeded(vote: PahunchVote, mover: number): number {
  return Math.max(0, vote.need - (vote.answers[mover] ?? 0) - vote.bribed);
}

/**
 * With enough yes in, the mover takes exactly the needed ones: a face per voter who said yes,
 * tap to take (or, for several yes, cycle how many). Starts on the voters in seat order after
 * the mover, as the vote clock would pick.
 */
function TakeVotes({ ctx, vote, act }: { ctx: Ctx; vote: PahunchVote; act: (a: PahunchAction) => void }) {
  const { v, skin } = ctx;
  const mover = v.turn;
  const need = stillNeeded(vote, mover);
  const n = vote.answers.length;
  const order = Array.from({ length: n - 1 }, (_, k) => (mover + 1 + k) % n);
  const givers = order.filter((s) => (vote.answers[s] ?? 0) > 0);
  const [take, setTake] = useState<number[]>(() => {
    const out = Array<number>(n).fill(0);
    let left = need;
    for (const s of givers) {
      out[s] = Math.min(vote.answers[s] ?? 0, left);
      left -= out[s];
    }
    return out;
  });
  const sum = take.reduce((a, b) => a + b, 0);
  const cycle = (s: number) => setTake(take.map((t, i) => (i === s ? (t + 1) % ((vote.answers[s] ?? 0) + 1) : t)));
  const left = votersLeft(v, vote).length;
  return (
    <div className="ph-take">
      <p className="ph-take-head">
        <b>
          ✓ {sum}/{need}
        </b>{" "}
        <small>{left > 0 ? `take them now, or wait for ${left} more` : "pick whose yes earn the 1s"}</small>
      </p>
      <div className="ph-take-who" role="group" aria-label="Whose yes to take">
        {givers.map((s) => {
          const given = vote.answers[s] ?? 0;
          return (
            <button
              key={s}
              type="button"
              className={`ph-give-who${take[s] > 0 ? " on" : ""}`}
              style={{ ["--seat" as string]: skin.seats[s % skin.seats.length].color }}
              aria-pressed={take[s] > 0}
              aria-label={`${ctx.names[s]}: take ${take[s]} of ${given} yes`}
              onClick={() => cycle(s)}
            >
              <span className="ph-face">
                <Avatar code={ctx.looks[s] ?? ""} name={ctx.names[s]} />
              </span>
              <span className="ph-give-name">✓ {given > 1 ? `${take[s]}/${given}` : take[s] > 0 ? "+1 🪙" : "—"}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="btn ph-move ph-take-go"
        disabled={sum !== need}
        onClick={() => act({ type: "take", votes: take })}
      >
        <b>↑ Go up</b>
        <small>{sum === need ? "the picked yes earn 1 each" : `take exactly ${need}`}</small>
      </button>
    </div>
  );
}

// ---- tokens ----

/** What a deal sheet opens on: give, ask for tokens, or offer a swap; to whom; a gift's count. */
export type DealMode = "give" | "ask" | "swap";
export interface DealInit {
  mode: DealMode;
  to?: number;
  count?: number;
}

/** Values a token can have: what a swap may ask for. */
const VALUES = [1, 2, 3, 4, 5];
/** The most tokens one ask names (`MAX_PLEA` in the rules). */
const MAX_PLEA = 9;

const tokensWord = (n: number) => (n === 1 ? "1 token" : `${n} tokens`);

function Chips({ values, onTap, label }: { values: number[]; onTap?: (k: number) => void; label: string }) {
  return (
    <span className="ph-tokens" role="group" aria-label={label}>
      {values.map((t, k) =>
        onTap ? (
          <button
            key={k}
            type="button"
            className={`ph-chip v${Math.min(t, 5)}`}
            onClick={() => onTap(k)}
            aria-label={`Remove ${t}`}
          >
            {t}
          </button>
        ) : (
          <span key={k} className={`ph-chip v${Math.min(t, 5)}`}>
            {t === 0 ? "?" : t}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * Tokens between players: give them, ask for some (a count: values are hidden), or offer a swap
 * (any deal; the supply never makes change). Opened on a mode; the tabs switch it.
 */
function DealSheet({
  ctx,
  init,
  act,
  onClose,
}: {
  ctx: Ctx;
  init: DealInit;
  act: (a: PahunchAction) => void;
  onClose: () => void;
}) {
  const { v, skin, me, names } = ctx;
  const tokens = (me !== null && v.players[me]?.tokens) || [];
  const others = names.flatMap((_, i) => (i === me ? [] : [i]));
  const [mode, setMode] = useState<DealMode>(init.mode);
  const [to, setTo] = useState(init.to ?? others[0] ?? 0);
  // Picks are places in `tokens`; a token arriving re-sorts them, so picks hold only for the
  // tokens they were made on. A gift for an ask starts on the smallest tokens asked for.
  const held = tokens.join(",");
  const [pick, setPick] = useState<{ held: string; ks: number[] }>({
    held,
    ks: tokens.slice(0, init.count ?? 0).map((_, k) => k),
  });
  const picked = pick.held === held ? pick.ks : [];
  const setPicked = (ks: number[]) => setPick({ held, ks });
  const chosen = picked.map((k) => tokens[k]);
  const [count, setCount] = useState(1);
  const [want, setWant] = useState<number[]>([]);
  const done = (a: PahunchAction) => {
    act(a);
    onClose();
  };
  const { points } = skin.nouns;
  const name = names[to];
  const myPlea = v.pleas.find((p) => p.by === me && p.of === to);
  const myOffer = v.offers.find((o) => o.by === me && o.to === to);
  const theirPlea = v.pleas.find((p) => p.by === to && p.of === me);
  const modes: { m: DealMode; label: string }[] = [
    { m: "give", label: "🎁 Give" },
    { m: "ask", label: "🙏 Ask" },
    { m: "swap", label: "⇄ Swap" },
  ];
  const lead = {
    give: `Hand ${points} tokens over. A gift is final.`,
    ask: `Ask a player for ${points} tokens.`,
    swap: "Offer your tokens for theirs.",
  }[mode];
  const yours = (
    <div className="ph-tokens" role="group" aria-label={mode === "give" ? "Tokens to give" : "Your tokens to swap"}>
      {tokens.map((t, k) => (
        <button
          key={k}
          type="button"
          className={`ph-chip v${Math.min(t, 5)} ${picked.includes(k) ? "on" : ""}`}
          aria-pressed={picked.includes(k)}
          onClick={() => setPicked(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k])}
        >
          {t}
        </button>
      ))}
      {tokens.length === 0 && <span className="muted">You have no tokens.</span>}
    </div>
  );
  const recall = (deal: "plea" | "offer") => (
    <button type="button" className="btn" onClick={() => done({ type: "recall", to, deal })}>
      ↩ Take it back
    </button>
  );
  return (
    <Sheet title="🪙 Tokens" label={`${points} between players`} onClose={onClose}>
      <div className="ph-deal-modes" role="group" aria-label="Kind of deal">
        {modes.map(({ m, label }) => (
          <button
            key={m}
            type="button"
            className={`btn ${m === mode ? "on" : ""}`}
            aria-pressed={m === mode}
            onClick={() => setMode(m)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="ph-sheet-lead">{lead}</p>
      <div className="ph-give-to" role="group" aria-label="With">
        {others.map((i) => (
          <button
            key={i}
            type="button"
            className={`ph-give-who${i === to ? " on" : ""}`}
            style={{ ["--seat" as string]: skin.seats[i % skin.seats.length].color }}
            aria-pressed={i === to}
            onClick={() => setTo(i)}
          >
            <span className="ph-face">
              <Avatar code={ctx.looks[i] ?? ""} name={names[i]} />
            </span>
            <span className="ph-give-name">{names[i]}</span>
          </button>
        ))}
      </div>
      {mode === "give" && (
        <>
          {theirPlea && (
            <p className="ph-deal-note">
              🙏 <Face ctx={ctx} i={to} /> {name} asked you for {tokensWord(theirPlea.count)}.
            </p>
          )}
          {yours}
          <div className="row">
            <button
              type="button"
              className="btn primary"
              disabled={chosen.length === 0}
              onClick={() => done({ type: "give", to, tokens: chosen })}
            >
              {chosen.length === 0
                ? "Pick tokens to give"
                : `🎁 Give ${tokensWord(chosen.length)} (${score(chosen)} ${points}) to ${name}`}
            </button>
          </div>
        </>
      )}
      {mode === "ask" &&
        (myPlea ? (
          <div className="row">
            <p className="ph-deal-note">
              ⏳ You asked {name} for {tokensWord(myPlea.count)}.
            </p>
            {recall("plea")}
          </div>
        ) : (
          <>
            <div className="ph-stepper" role="group" aria-label="How many tokens">
              <button
                type="button"
                className="btn"
                disabled={count <= 1}
                onClick={() => setCount(count - 1)}
                aria-label="One fewer"
              >
                −
              </button>
              <b aria-live="polite">🪙 × {count}</b>
              <button
                type="button"
                className="btn"
                disabled={count >= MAX_PLEA}
                onClick={() => setCount(count + 1)}
                aria-label="One more"
              >
                +
              </button>
            </div>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => done({ type: "plead", of: to, count })}>
                🙏 Ask {name} for {tokensWord(count)}
              </button>
            </div>
          </>
        ))}
      {mode === "swap" &&
        (myOffer ? (
          <div className="row">
            <p className="ph-deal-note">
              ⏳ <Chips values={myOffer.give} label="You give" /> ⇄ <Chips values={myOffer.want} label="You get" />
            </p>
            {recall("offer")}
          </div>
        ) : (
          <>
            <h3 className="ph-deal-h">↗ You give</h3>
            {yours}
            <h3 className="ph-deal-h">↙ You get</h3>
            <div className="ph-tokens" role="group" aria-label="Add a token you want">
              {VALUES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`ph-chip v${t} ph-want-add`}
                  onClick={() => setWant([...want, t].sort((a, b) => a - b))}
                  aria-label={`Add a ${t}`}
                >
                  +{t}
                </button>
              ))}
            </div>
            <p className="ph-deal-note">
              {want.length > 0 ? (
                <Chips values={want} label="You want" onTap={(k) => setWant(want.filter((_, x) => x !== k))} />
              ) : (
                <span className="muted">Tap the values you want.</span>
              )}
            </p>
            <div className="row">
              <button
                type="button"
                className="btn primary"
                disabled={chosen.length === 0 || want.length === 0}
                onClick={() => done({ type: "offer", to, give: chosen, want })}
              >
                {chosen.length === 0 || want.length === 0
                  ? "Pick both sides"
                  : `⇄ Offer ${name} ${chosen.join("+")} for ${want.join("+")}`}
              </button>
            </div>
          </>
        ))}
      <p className="muted small">
        {
          {
            give: "Any time. The others see that you gave, and how many tokens, but not their value.",
            ask: "Any time. Everyone sees the ask and its count. They answer with a gift (they pick which tokens) or say no; you can take it back until then.",
            swap: "Any time, any deal: equal value or not. Only you two see the values; the others see the counts. The supply never makes change.",
          }[mode]
        }
      </p>
    </Sheet>
  );
}

/** Asks and swap offers waiting on you: a gift or yes, or no. */
function DealBar({
  ctx,
  act,
  onGive,
}: {
  ctx: Ctx;
  act: (a: PahunchAction) => void;
  onGive: (init: DealInit) => void;
}) {
  const { v, me } = ctx;
  if (me === null) return null;
  const mine = v.players[me]?.tokens ?? [];
  const has = (want: number[]) => {
    const left = [...mine];
    return want.every((t) => {
      const at = left.indexOf(t);
      if (at < 0) return false;
      left.splice(at, 1);
      return true;
    });
  };
  const pleas = v.pleas.filter((p) => p.of === me);
  const offers = v.offers.filter((o) => o.to === me);
  if (pleas.length === 0 && offers.length === 0) return null;
  return (
    <>
      {pleas.map((p) => (
        <div key={`p${p.by}`} className="ph-moves ph-request" role="group" aria-label={`${ctx.names[p.by]} asks`}>
          <div className="ph-pick-head">
            <b className="ph-turn">🙏 Asked</b>
            <span className="ph-pick-what">
              <Face ctx={ctx} i={p.by} /> {ctx.names[p.by]} asks you for 🪙 × {p.count}
            </span>
          </div>
          <div className="ph-move-grid">
            <button
              type="button"
              className="btn ph-move"
              disabled={mine.length === 0}
              onClick={() => onGive({ mode: "give", to: p.by, count: p.count })}
            >
              <b>🎁 Give…</b>
              <small>{mine.length === 0 ? "you have none" : "you pick which"}</small>
            </button>
            <button
              type="button"
              className="btn ph-move"
              onClick={() => act({ type: "refuse", from: p.by, deal: "plea" })}
            >
              <b>✗ No</b>
              <small>give nothing</small>
            </button>
          </div>
        </div>
      ))}
      {offers.map((o) => {
        const can = has(o.want);
        return (
          <div
            key={`o${o.by}`}
            className="ph-moves ph-request"
            role="group"
            aria-label={`${ctx.names[o.by]} offers a swap`}
          >
            <div className="ph-pick-head">
              <b className="ph-turn">⇄ Swap</b>
              <span className="ph-pick-what ph-swap-what">
                <Face ctx={ctx} i={o.by} /> <Chips values={o.give} label="You get" /> ⇄ you{" "}
                <Chips values={o.want} label="You give" />
              </span>
            </div>
            <div className="ph-move-grid">
              <button
                type="button"
                className="btn ph-move"
                disabled={!can}
                onClick={() => act({ type: "accept", from: o.by })}
              >
                <b>✓ Swap</b>
                <small>{can ? `+${score(o.give)} −${score(o.want)}` : "you lack those tokens"}</small>
              </button>
              <button
                type="button"
                className="btn ph-move"
                onClick={() => act({ type: "refuse", from: o.by, deal: "offer" })}
              >
                <b>✗ No</b>
                <small>keep yours</small>
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Your open asks and offers, each with a ✕ to take it back; tap one to see it. */
function MyDeals({ ctx, act, onOpen }: { ctx: Ctx; act: (a: PahunchAction) => void; onOpen: (i: DealInit) => void }) {
  const { v, me } = ctx;
  const pleas = v.pleas.filter((p) => p.by === me);
  const offers = v.offers.filter((o) => o.by === me);
  if (pleas.length === 0 && offers.length === 0) return null;
  const chip = (key: string, to: number, mode: DealMode, deal: "plea" | "offer", body: ReactNode, label: string) => (
    <span key={key} className="ph-offer asked">
      <button
        type="button"
        className="ph-offer-name"
        onClick={() => onOpen({ mode, to })}
        aria-haspopup="dialog"
        aria-label={label}
      >
        {body} ⏳ <Face ctx={ctx} i={to} />
      </button>
      <button
        type="button"
        className="ph-offer-x"
        aria-label={`Take back: ${label}`}
        onClick={() => act({ type: "recall", to, deal })}
      >
        ✕
      </button>
    </span>
  );
  return (
    <div className="ph-on-offer" aria-label="Your open deals">
      {pleas.map((p) =>
        chip(
          `p${p.of}`,
          p.of,
          "ask",
          "plea",
          `🙏 🪙 × ${p.count}`,
          `You asked ${ctx.names[p.of]} for ${tokensWord(p.count)}`,
        ),
      )}
      {offers.map((o) =>
        chip(
          `o${o.to}`,
          o.to,
          "swap",
          "offer",
          <>
            ⇄ {o.give.join("+")} → {o.want.join("+")}
          </>,
          `You offered ${ctx.names[o.to]} ${o.give.join(" + ")} for ${o.want.join(" + ")}`,
        ),
      )}
    </div>
  );
}

// ---- the end ----

function End({
  ctx,
  room,
  send,
  isAdmin,
}: {
  ctx: Ctx;
  room: RoomInfo;
  send: (m: ClientMsg) => void;
  isAdmin: boolean;
}) {
  const { v, skin, names, me } = ctx;
  const scores = v.players.map((p) => score(p.tokens));
  const end = v.log.findLast((e) => e.t === "end");
  const by = end?.t === "end" ? end.by : undefined;
  // The seat's shape in its colour, as its pieces carry it on the board above.
  const mark = (i: number) => {
    const look = skin.seats[i % skin.seats.length];
    return (
      <span className="ph-mark" style={{ ["--seat" as string]: look.color, ["--seat-ink" as string]: look.ink }}>
        <SeatSwatch seat={i} />
      </span>
    );
  };
  if (v.winners.length > 0)
    return (
      <GameOver
        room={room}
        you={me}
        names={names}
        winners={v.winners}
        standings={standings(scores, v.winners)}
        mark={mark}
        format={(n) => `${n} ${skin.nouns.points}`}
        endedNote={
          <p className="muted ph-eligible">
            Only players with a {skin.nouns.climber} in the {ctx.room(v.layout.summit)} could win.
          </p>
        }
        isAdmin={isAdmin}
        admin={me !== null ? names[room.admin] : undefined}
        onRematch={() => send({ type: "rematch" })}
        onSetup={() => send({ type: "lobby" })}
      />
    );
  // No winner, so no podium, only where everyone stood: the admin ended it early, or the top room
  // filled with neutrals alone.
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  return (
    <div className="ph-ended">
      <h2>{by !== undefined ? "Game ended early" : "Nobody won"}</h2>
      <p>
        {by !== undefined ? (
          `${ctx.who(by)} ended the game. Nobody wins a game that stops before the ${ctx.room(v.layout.summit)} is full.`
        ) : (
          <Rich
            ctx={ctx}
            text={`The ${ctx.room(v.layout.summit)} filled with ${skin.nouns.neutrals} alone, so nobody wins.`}
          />
        )}
      </p>
      <ol className="also-ran">
        {order.map(({ s, i }) => (
          <li key={i}>
            <span>
              <Avatar code={room.seats[i]?.avatar ?? ""} name={names[i]} className="small" />
              {mark(i)}
              {ctx.who(i)}
            </span>
            <b>
              {s} {skin.nouns.points}
            </b>
          </li>
        ))}
      </ol>
      {isAdmin ? (
        <div className="row gameover-next">
          <button type="button" className="btn primary big" onClick={() => send({ type: "rematch" })}>
            Play again
          </button>
          <button type="button" className="btn big" onClick={() => send({ type: "lobby" })}>
            Change setup
          </button>
        </div>
      ) : (
        me !== null && <p className="muted">Waiting for {names[room.admin]} (admin) to start a new game.</p>
      )}
    </div>
  );
}

// ---- the log ----

/** The log newest first, the `last` lines of it; a run of the same line shows once, with its count. */
function LogList({ ctx, last, className }: { ctx: Ctx; last?: number; className?: string }) {
  const log = ctx.v.log;
  const rows: { t: string; text: string; n: number; key: number }[] = [];
  for (let i = log.length - 1; i >= Math.max(0, log.length - (last ?? log.length)); i--) {
    const text = logLine(log[i], ctx, log.slice(0, i + 1));
    const top = rows.at(-1);
    // Keyed by the run's first line, so a repeat counts up in place.
    if (top?.text === text) Object.assign(top, { n: top.n + 1, key: ctx.v.logStart + i });
    else rows.push({ t: log[i].t, text, n: 1, key: ctx.v.logStart + i });
  }
  return (
    <ol className={className}>
      {rows.map((r) => (
        <li key={r.key} className={`log-${r.t}`}>
          <Rich ctx={ctx} text={r.text} />
          {r.n > 1 && (
            <small className="ph-log-n" aria-label={S.logTimesLabel(r.n)}>
              {" "}
              {S.logTimes(r.n)}
            </small>
          )}
        </li>
      ))}
    </ol>
  );
}

/** One log line in words; `upTo` is the log up to and including it (a failed climb names its rooms). */
export function logLine(e: PahunchLog, ctx: Ctx, upTo: PahunchLog[]): string {
  const { v, skin, who, pts } = ctx;
  const paths = v.layout.paths;
  const { blocker, neutral } = skin.nouns;
  const route = (p: number) => `the ${ctx.room(paths[p].from)} to the ${ctx.room(paths[p].to)}`;
  const them = (i: number) => (i === ctx.me ? "you" : ctx.names[i]);
  switch (e.t) {
    case "start":
      return `${who(e.first)} ${e.first === ctx.me ? "go" : "goes"} first.`;
    case "enter":
      return `${who(e.p)} joined the ${ctx.room(e.room)}.`;
    case "climb": {
      const how = e.free ? "" : " with the votes";
      const took = e.took !== undefined ? ` and took ${pts(e.took)}` : e.token ? " and took a token" : "";
      return `${who(e.p)} moved up from ${route(e.path)}${how}${took}.`;
    }
    case "ask":
      return `${who(e.p)} asked to move up from ${route(e.path)}: ${e.need} votes needed.`;
    case "vote":
      return e.yes === 0
        ? `${who(e.p)} voted no.`
        : `${who(e.p)} voted yes${e.of > 1 ? ` with ${e.yes} of ${e.of}` : ""}.`;
    case "bribe":
      return `${who(e.p)} sent an ${neutral} ${skin.nouns.bribe}.`;
    case "reward":
      return `${who(e.p)} earned ${pts(e.ones)}.`;
    case "fail": {
      const ask = upTo.findLast((x) => x.t === "ask");
      const from = ask?.t === "ask" ? ` in the ${ctx.room(paths[ask.path].from)}` : "";
      return `The vote failed: ${who(e.p).toLowerCase() === "you" ? "you stay" : `${who(e.p)} stays`}${from}.`;
    }
    case "nudge":
      return `${who(e.p)} nudged an ${neutral} up from ${route(e.path)} and took ${pts(1)}.`;
    case "block":
      return `${who(e.p)} sent ${blocker} to the ${skin.nouns.path} from ${route(e.path)}.`;
    case "bonus": {
      const what = {
        block: `may also move ${blocker} this turn`,
        nudge: `may also nudge an ${neutral} up this turn`,
        favour: "gets a favour use back",
      }[e.kind];
      return `${who(e.p)} picked up ${skin.bonuses[e.kind].glyph} ${skin.bonuses[e.kind].name}: ${what}.`;
    }
    case "done":
      return `${who(e.p)} ended the turn.`;
    case "request": {
      const kind = v.players[e.owner]?.favour;
      const f = kind ? ` ${skin.favours[kind].glyph} ${skin.favours[kind].name}` : " favour";
      return `${who(e.p)} asked ${e.owner === ctx.me ? "you for your" : `${ctx.names[e.owner]} for their`}${f}.`;
    }
    case "decline":
      return `${who(e.p)} said no to lending ${e.p === ctx.me ? "your" : "their"} favour.`;
    case "favour":
      return `${who(e.user)} used ${e.owner === ctx.me ? "your" : `${ctx.names[e.owner]}’s`} ${skin.favours[e.kind].glyph} ${skin.favours[e.kind].name}.`;
    case "carry":
      return `${who(e.p)} brought ${e.who === null ? `an ${neutral}` : e.who === e.p ? `another ${skin.nouns.climber}` : e.who === ctx.me ? "you" : ctx.names[e.who]} along, from ${route(e.path)}.`;
    case "gift":
      return `${who(e.from)} gave ${them(e.to)} ${tokensWord(e.count)}.`;
    case "plea":
      return `${who(e.p)} asked ${them(e.of)} for ${tokensWord(e.count)}.`;
    case "offer":
      return `${who(e.p)} offered ${them(e.to)} a swap: ${tokensWord(e.give)} for ${e.want}.`;
    case "refuse":
      return `${who(e.p)} said no to ${e.to === ctx.me ? "your" : `${ctx.names[e.to]}’s`} ${e.deal === "plea" ? "ask" : "swap"}.`;
    case "recall":
      return `${who(e.p)} took back ${e.p === ctx.me ? "your" : "their"} ${e.deal === "plea" ? "ask to" : "swap with"} ${them(e.to)}.`;
    case "trade":
      return `${who(e.from)} swapped ${tokensWord(e.gave)} for ${e.got} of ${e.to === ctx.me ? "yours" : `${ctx.names[e.to]}’s`}.`;
    case "skip":
      return `${who(e.p)} ${e.p === ctx.me ? "were" : "was"} away: a random move was made.`;
    case "undo":
      return S.logUndo(who(e.p));
    case "end":
      return e.by !== undefined
        ? `${who(e.by)} ended the game early. Nobody wins.`
        : `${e.winners.map(who).join(" & ")} won.`;
  }
}
