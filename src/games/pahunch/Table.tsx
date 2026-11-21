import "./pahunch.css";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
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
import { Rename } from "../../client/Lobby.tsx";
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
import { Board, pathKind, seatShape } from "./Board.tsx";
import type { ClimbOption, Extras } from "./derive.ts";
import {
  askBlock,
  atTop,
  blockTargets,
  bribeChoices,
  carryTargets,
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

/** Milliseconds left on the room clock, ticking while it runs. */
function useClockLeft(state: RoomState): number | null {
  const { room } = state;
  const running = room.bidMsLeft !== null && room.frozenBy === null;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [running]);
  if (room.bidMsLeft === null) return null;
  return Math.max(0, room.bidMsLeft - (running ? Date.now() - state.receivedAt : 0));
}

/**
 * One button in the move bar: a verb, and a muted note saying where and for what. It either makes
 * a move (`action`) or picks something on the board (`goTo`: a room's way up, or Daddu).
 */
interface Move {
  key: string;
  verb: string;
  note: string;
  primary: boolean;
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

export function Table({ state, send, reactions }: TableProps) {
  const ctx = useCtx(state);
  const { v, skin, names, me } = ctx;
  const { room } = state;
  const act = (action: PahunchAction) => send({ type: "action", action });
  const owing = me !== null && v.pending.includes(me);
  useYourMove(owing);
  const awayFor = useAwayFor(state);
  const { frozen, canFreeze } = freezeRights(room, me, v.over);
  const [menu, setMenu] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [gift, setGift] = useState(false);
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
  // A new turn, vote or phase clears the pick.
  const moment = `${v.turn}:${v.vote === null}:${v.moved}`;
  useEffect(() => {
    if (moment) {
      setPickRaw(null);
      setExtras({});
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
        primary: true,
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
        primary: c.kind !== "ask",
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
        primary: false,
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
    primary: true,
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
      primary: c !== undefined && c.kind !== "ask",
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
                primary: false,
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
    const request = v.asked.includes(me) ? <RequestBar ctx={ctx} act={act} /> : null;
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
  const docked = owing && bar !== null;
  const dockEl = useDock(docked);
  const left = useClockLeft(state);

  const top = atTop(v);
  const capTop = v.layout.rooms[v.layout.summit]?.cap ?? 0;
  const status = v.over
    ? "Final result"
    : v.vote
      ? `${ctx.who(v.turn)} ${v.turn === me ? "are" : "is"} asking for votes`
      : `${ctx.who(v.turn)} to move`;

  return (
    <div className={`table ph-table ${docked ? "acting" : ""} ${frozen ? "frozen" : ""}`}>
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
            settings={<VoteClock room={room} me={me} send={send} />}
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

      <Players ctx={ctx} room={room} reactions={reactions} awayFor={awayFor} send={send} act={act} />

      <section className={`stage ph-stage ${owing ? "owing" : ""}`}>
        {v.over ? (
          <End ctx={ctx} room={room} send={send} isAdmin={isAdmin} />
        ) : (
          <>
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
              onRoom={onRoom}
              onPath={onPath}
              onBlocker={onBlocker}
            />
            <CoinKey ctx={ctx} />
          </>
        )}
      </section>

      <aside className="side ph-side">
        {v.vote && !v.over && <VoteSummary ctx={ctx} vote={v.vote} left={left} />}
        {me !== null && (
          <MyTray
            ctx={ctx}
            room={room}
            reactions={reactions}
            awayFor={awayFor}
            send={send}
            act={act}
            owing={owing}
            onGive={() => setGift(true)}
          />
        )}
        {bar && (
          <div ref={dockEl} className={`action-bar ph-bar ${owing ? "your-turn" : ""}`}>
            {bar}
          </div>
        )}
        <section className="recent" aria-label="Latest">
          <h2>Latest</h2>
          <ol>
            {v.log
              .slice(-5)
              .reverse()
              .map((e, i) => (
                <li key={i} className={`log-${e.t}`}>
                  <Rich ctx={ctx} text={logLine(e, ctx, v.log.slice(0, v.log.length - i))} />
                </li>
              ))}
          </ol>
          <button className="btn small ghost" onClick={() => setLogOpen(true)}>
            Full log
          </button>
        </section>
      </aside>

      {info && <BoardInfo ctx={ctx} pick={info} onClose={() => setInfo(null)} />}
      {logOpen && (
        <Sheet title="📜 What happened" onClose={() => setLogOpen(false)}>
          <ol className="log">
            {v.log
              .map((e, i) => (
                <li key={i} className={`log-${e.t}`}>
                  <Rich ctx={ctx} text={logLine(e, ctx, v.log.slice(0, i + 1))} />
                </li>
              ))
              .reverse()}
          </ol>
        </Sheet>
      )}
      {gift && me !== null && !v.over && (
        <GiftSheet
          ctx={ctx}
          onGive={(to, tokens) => {
            act({ type: "give", to, tokens });
            setGift(false);
          }}
          onClose={() => setGift(false)}
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
}

/** A seat's colour with its shape on it, as its pieces carry them on the board. */
function SeatSwatch({ seat }: { seat: number }) {
  return (
    <svg className="ph-swatch" viewBox="-1.6 -1.6 3.2 3.2" aria-hidden="true">
      <path d={seatShape(seat, 0, 0, 0.95)} />
    </svg>
  );
}

/** The other players' chips (a watcher sees everyone); your own seat is your tray. */
function Players(props: SeatProps) {
  const { ctx } = props;
  const shown = ctx.names.filter((_, i) => i !== ctx.me).length;
  // More than four chips do not fit one row on a phone; they go three to a row there.
  return (
    <section className={`seats ph-players${shown > 4 ? " many" : ""}`} aria-label="Players">
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
      {info && <SeatSheet ctx={ctx} room={room} awayFor={awayFor} send={send} i={i} onClose={() => setInfo(false)} />}
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
      <div className="ph-fav-facts">
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

/**
 * A small rule or a deal idea for new players: hidden behind 💡 until tapped, so it never gets in
 * the way of players who know the game.
 */
function Tip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
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

function MyTray(props: SeatProps & { act: (a: PahunchAction) => void; owing: boolean; onGive: () => void }) {
  const { ctx, room, reactions, awayFor, send, act, owing, onGive } = props;
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
          <button type="button" className="btn small ph-give" onClick={onGive}>
            🎁 Give
          </button>
        )}
        {!v.over && (
          <Tip>
            Only you see your {skin.nouns.points} until the end. Give tokens any time to seal a deal made on the call: a
            vote, a favour, a promise.
          </Tip>
        )}
      </div>
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
          className={`btn ${offered ? "" : "primary"}`}
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
      <Tip>
        A favour only helps someone else’s move, never your own. Offer it when it helps the mover, and agree on the call
        what they give you for it. You earn {pay} {skin.nouns.points} each time it is used.
      </Tip>
      {info && <FavourSheet ctx={ctx} owner={me} act={act} onClose={() => setInfo(false)} />}
    </div>
  );
}

// ---- your move ----

/**
 * The favours on offer to the mover (with a ✕ to turn one down, so no climb uses it), and those
 * they asked for (with a ✕ to take the request back).
 */
function OnOffer({ ctx, act }: { ctx: Ctx; act: (a: PahunchAction) => void }) {
  const { v, skin } = ctx;
  const list = onOffer(v);
  const asked = v.asked.flatMap((owner) => {
    const kind = v.players[owner]?.favour;
    return kind ? [{ owner, kind }] : [];
  });
  if (list.length === 0 && asked.length === 0) return null;
  return (
    <div className="ph-on-offer" aria-label="Favours for your move">
      {list.map(({ owner, kind }) => (
        <span key={owner} className="ph-offer">
          {skin.favours[kind].glyph} {skin.favours[kind].name} <Face ctx={ctx} i={owner} />
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
          {skin.favours[kind].glyph} {skin.favours[kind].name}{" "}
          <small role="img" aria-label={`asked ${ctx.names[owner]}, waiting`}>
            ⏳ <Face ctx={ctx} i={owner} />
          </small>
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
        <button type="button" className="btn primary ph-move" onClick={() => act({ type: "lend", on: true })}>
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
      className={`btn ph-move ${m.primary ? "primary" : ""} ${m.goTo ? "ph-then" : ""}`}
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
        ? "Use a glowing move, or end your turn"
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
      {(swaps.length > 0 || carries.length > 0) && (
        <div className="ph-favour-picks">
          {swaps.length > 0 && (
            <label>
              <span className="ph-act-label">{skin.favours.swapToken.glyph} Take</span>
              <select
                value={extras.swap ?? ""}
                onChange={(e) =>
                  setExtras({ ...extras, swap: e.target.value === "" ? undefined : Number(e.target.value) })
                }
              >
                <option value="">the {points} on the way</option>
                {swaps.map((p) => (
                  <option key={p} value={p}>
                    {v.tokensOn[p]?.value} from {route(p)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {carries.length > 0 && (
            <label>
              <span className="ph-act-label">{skin.favours.carry.glyph} Bring</span>
              <select
                value={carryKey(extras.carry)}
                onChange={(e) => setExtras({ ...extras, carry: carries.find((c) => carryKey(c) === e.target.value) })}
              >
                <option value="">nobody</option>
                {carries.map((c) => (
                  <option key={carryKey(c)} value={carryKey(c)}>
                    {c.t === "seat"
                      ? c.seat === ctx.me
                        ? `another of your ${climbers}`
                        : ctx.names[c.seat]
                      : `an ${neutral}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
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
        <button type="button" className="btn primary ph-done" onClick={() => act({ type: "done" })}>
          ⏭ End turn
        </button>
      )}
    </div>
  );
}

/** The blocker's move as a list, for the "All moves" view. */
function BlockPicker({ ctx, act }: { ctx: Ctx; act: (a: PahunchAction) => void }) {
  const { v, skin } = ctx;
  const targets = blockTargets(v);
  const [want, setTo] = useState(targets[0] ?? 0);
  // After a block the picked path is Daddu's own and no longer a target.
  const to = targets.includes(want) ? want : (targets[0] ?? 0);
  const route = (p: number) => `${ctx.short(v.layout.paths[p].from)} → ${ctx.short(v.layout.paths[p].to)}`;
  return (
    <div className="ph-all-room">
      <span className="ph-act-label">{skin.nouns.blocker}</span>
      <div className="ph-favour-picks">
        <label>
          <span className="ph-act-label">Send to</span>
          <select value={to} onChange={(e) => setTo(Number(e.target.value))}>
            {targets.map((p) => (
              <option key={p} value={p}>
                {route(p)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={() => act({ type: "block", path: to })}>
          <Rich ctx={ctx} text={`➜ Send ${skin.nouns.blocker}`} />
        </button>
      </div>
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
  const who = (s: number | null) => (s === null ? neutral : ctx.who(s));
  let title = "";
  let facts: string[] = [];
  if (pick.blocker && v.blocker !== null) {
    const p = layout.paths[v.blocker];
    const under = coinLine(v.blocker);
    title = `${skin.blockerGlyph} ${upper(blocker)}`;
    facts = [
      `${upper(blocker)} sits on the ${skin.nouns.path} from the ${ctx.room(p.from)} up to the ${ctx.room(p.to)}${under ? `, on ${under}` : ""}.`,
      `Anyone may climb past ${blocker} with no vote, but nobody takes the ${points} under him (unless ${skin.favours.coveredToken.glyph} ${skin.favours.coveredToken.name} is on offer).`,
      `On your turn, instead of moving a ${climber}, you may send ${blocker} to another ${skin.nouns.path} with ${points} on it. Never onto ${skin.nouns.backPath}. Tap him on your turn, then tap where he goes.`,
    ];
  } else if (pick.path !== undefined) {
    const i = pick.path;
    const p = layout.paths[i];
    const kind = pathKind(layout, i);
    const coin = coinLine(i);
    const bonus = v.tokensOn[i]?.bonus;
    title = `${ctx.short(p.from)} → ${ctx.short(p.to)}`;
    facts = [
      `A ${kind === "back" ? skin.nouns.backPath : skin.nouns.path} from the ${ctx.room(p.from)} up to the ${ctx.room(p.to)}.`,
      kind === "back"
        ? `Locked. Only when someone offers the mover ${skin.favours.backStairs.glyph} ${skin.favours.backStairs.name} may they climb it, with no vote. No ${points} lies here.${offers(v, "backStairs") ? " The key is on offer this turn." : ""}`
        : v.blocker === i
          ? `${upper(blocker)} sits here: climbing it needs no vote, and takes no ${points}.`
          : kind === "plain"
            ? `It leaves a post of one: climbing it needs no vote and takes no ${points}.`
            : `Climbing it takes ${need(layout, p.from)} yes votes from the ${ctx.room(p.from)}${coin ? `, and the climber takes the ${coin}` : ""}.`,
      bonus ? `${skin.bonuses[bonus].glyph} ${skin.bonuses[bonus].name}: ${skin.bonuses[bonus].effect}` : "",
      `An ${neutral} may be nudged up it too: no vote, and +1 ${points} for whoever nudges.`,
    ].filter(Boolean);
  } else if (pick.room !== undefined) {
    const r = pick.room;
    const held = v.rooms[r] ?? [];
    const cap = layout.rooms[r].cap;
    const top = r === layout.summit;
    const out = layout.paths.flatMap((p, i) => (p.from === r ? [i] : []));
    title = ctx.room(r);
    facts = [
      `${held.length} of ${cap} seats taken${held.length ? `: ${held.map(who).join(", ")}` : ""}.`,
      top
        ? `The game ends the moment it is full. Only players with a ${climber} here can win; ${neutrals} take seats but never win.`
        : isEntry(layout, r)
          ? `New ${skin.nouns.climbers} join here.`
          : "",
      top
        ? ""
        : cap === 1
          ? "A post of one: leaving it needs no vote."
          : `Leaving takes ${need(layout, r)} yes votes of its ${cap} seats.`,
      ...out.map((i) => {
        const p = layout.paths[i];
        const coin = coinLine(i);
        return `↑ ${ctx.room(p.to)}: ${
          p.back ? `${skin.nouns.backPath} 🔒` : v.blocker === i ? `${blocker} sits here` : coin ? coin : `no ${points}`
        }.`;
      }),
    ].filter(Boolean);
  }
  return (
    <Sheet title={<Rich ctx={ctx} text={title} />} onClose={onClose}>
      <ul className="seat-facts">
        {facts.map((f) => (
          <li key={f}>
            <Rich ctx={ctx} text={f} />
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

// ---- votes ----

function VoteSummary({ ctx, vote, left }: { ctx: Ctx; vote: PahunchVote; left: number | null }) {
  const { v, skin, who } = ctx;
  const to = v.layout.paths[vote.path].to;
  const neutrals = count(v.rooms, vote.room, null);
  const yes = yesSoFar(vote);
  const voters = vote.answers.flatMap((a, s) => (count(v.rooms, vote.room, s) > 0 ? [{ s, a }] : []));
  const secs = left === null ? null : Math.ceil(left / 1000);
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
        {secs !== null && (
          <span className="ph-clock" aria-label={`${secs} seconds left`}>
            ⏱ {secs}
          </span>
        )}
      </h2>
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
            {mine} in {ctx.short(vote.room)} · a needed yes earns 1 {skin.nouns.points}
          </span>
          <Tip>
            Your yes can be worth more than 1: ask the climber for a gift or a promise on the call before you answer.
            Saying no keeps a rival down.
          </Tip>
        </div>
        <div className="ph-move-grid">
          {Array.from({ length: mine }, (_, k) => mine - k).map((n) => (
            <button key={n} className="btn primary" onClick={() => act({ type: "vote", yes: n })}>
              ✓ Yes{mine > 1 ? ` ×${n}` : ""}
            </button>
          ))}
          <button className="btn" onClick={() => act({ type: "vote", yes: 0 })}>
            ✗ No
          </button>
        </div>
      </div>
    );
  }
  const tokens = v.players[me]?.tokens ?? [];
  const bribes = bribeChoices(v, vote, tokens);
  return (
    <div className="ph-moves" role="group" aria-label="Your climb">
      <div className="ph-pick-head">
        <b className="ph-turn">↑ Your climb</b>
        <span className="ph-pick-what">
          {yesSoFar(vote)} of {vote.need} yes · ask on the call
        </span>
        <Tip>
          Each needed yes earns its giver 1 {skin.nouns.points}; offer more on the call to win a vote. An{" "}
          {skin.nouns.neutral} always says yes for a token of {v.layout.minBribe} or more, but that token is gone.
        </Tip>
      </div>
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

// ---- tokens ----

function GiftSheet({
  ctx,
  onGive,
  onClose,
}: {
  ctx: Ctx;
  onGive: (to: number, tokens: number[]) => void;
  onClose: () => void;
}) {
  const { v, skin, me, names } = ctx;
  const tokens = (me !== null && v.players[me]?.tokens) || [];
  const others = names.flatMap((_, i) => (i === me ? [] : [i]));
  const [to, setTo] = useState(others[0] ?? 0);
  // Picks are places in `tokens`; a token arriving re-sorts them, so picks hold only for the
  // tokens they were made on.
  const held = tokens.join(",");
  const [pick, setPick] = useState<{ held: string; ks: number[] }>({ held, ks: [] });
  const picked = pick.held === held ? pick.ks : [];
  const setPicked = (ks: number[]) => setPick({ held, ks });
  const chosen = picked.map((k) => tokens[k]);
  return (
    <Sheet title={`🎁 Give ${skin.nouns.points}`} onClose={onClose}>
      <p className="muted">
        A gift is final and can be made at any time. The others see that you gave, and how many tokens, but not their
        value.
      </p>
      <label>
        To{" "}
        <select value={to} onChange={(e) => setTo(Number(e.target.value))}>
          {others.map((i) => (
            <option key={i} value={i}>
              {names[i]}
            </option>
          ))}
        </select>
      </label>
      <div className="ph-tokens" role="group" aria-label="Tokens to give">
        {tokens.map((t, k) => (
          <button
            key={k}
            className={`ph-chip v${Math.min(t, 5)} ${picked.includes(k) ? "on" : ""}`}
            aria-pressed={picked.includes(k)}
            onClick={() => setPicked(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k])}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="row">
        <button className="btn primary" disabled={chosen.length === 0} onClick={() => onGive(to, chosen)}>
          {chosen.length === 0
            ? "Pick tokens to give"
            : `🎁 Give ${chosen.length === 1 ? "1 token" : `${chosen.length} tokens`} (${score(chosen)} ${skin.nouns.points}) to ${names[to]}`}
        </button>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
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
  if (v.winners.length > 0)
    return (
      <GameOver
        room={room}
        you={me}
        names={names}
        winners={v.winners}
        standings={standings(scores, v.winners)}
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
          `${names[by]} ended the game. Nobody wins a game that stops before the ${ctx.room(v.layout.summit)} is full.`
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
              {names[i]}
              {i === me && <em> (you)</em>}
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

/** One log line in words; `upTo` is the log up to and including it (a failed climb names its rooms). */
export function logLine(e: PahunchLog, ctx: Ctx, upTo: PahunchLog[]): string {
  const { v, skin, who, pts } = ctx;
  const paths = v.layout.paths;
  const { blocker, neutral } = skin.nouns;
  const route = (p: number) => `the ${ctx.room(paths[p].from)} to the ${ctx.room(paths[p].to)}`;
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
      return `${who(e.from)} gave ${e.to === ctx.me ? "you" : ctx.names[e.to]} ${e.count} ${e.count === 1 ? "token" : "tokens"}.`;
    case "skip":
      return `${who(e.p)} ${e.p === ctx.me ? "were" : "was"} away: a random move was made.`;
    case "end":
      return e.by !== undefined
        ? `${who(e.by)} ended the game early. Nobody wins.`
        : `${e.winners.map(who).join(" & ")} won.`;
  }
}
