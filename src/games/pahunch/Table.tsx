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
  PahunchLog,
  PahunchView,
  PahunchVote,
  RoomInfo,
} from "../../generated/index.ts";
import type { TableProps } from "../types.ts";
import { Board } from "./Board.tsx";
import type { ClimbOption } from "./derive.ts";
import { atTop, bribeChoices, climbs, count, enterRooms, nudges, score, votersLeft, yesSoFar } from "./derive.ts";
import { Rules } from "./Rules.tsx";
import { VoteClock } from "./Setup.tsx";
import type { PahunchSkin } from "./skin.ts";
import { roomName, skinFor } from "./skin.ts";

interface Ctx {
  v: PahunchView;
  skin: PahunchSkin;
  names: string[];
  me: number | null;
  /** "You" for the viewer, else the name. */
  who: (i: number) => string;
  room: (r: number) => string;
  pts: (n: number) => string;
}

function useCtx(state: RoomState): Ctx {
  const v = state.game as PahunchView;
  const { room } = state;
  const skin = skinFor(room.theme);
  const names = room.seats.map((s) => s.name);
  const me = v.you;
  return {
    v,
    skin,
    names,
    me,
    who: (i) => (i === me ? "You" : (names[i] ?? `Seat ${i + 1}`)),
    room: (r) => roomName(skin, v.layout.board, r, v.layout.summit),
    pts: (n) => `${n} ${skin.nouns.points}`,
  };
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
  const [sel, setSel] = useState<{ room?: number; path?: number } | null>(null);
  const isAdmin = me !== null && room.admin === me;

  // A new turn or vote clears the selection; a reward to you rings.
  const seen = useRef(v.logStart + v.log.length);
  useEffect(() => {
    const total = v.logStart + v.log.length;
    const fresh = v.log.slice(Math.max(0, seen.current - v.logStart));
    seen.current = total;
    if (fresh.some((e) => e.t === "reward" && e.p === me)) play("cash");
    else if (fresh.some((e) => e.t === "climb")) play("bid");
    if (fresh.some((e) => e.t === "end")) play("fanfare");
  }, [v.log, v.logStart, me]);
  const moment = `${v.turn}:${v.vote === null}`;
  useEffect(() => {
    if (moment) setSel(null);
  }, [moment]);

  const myTurn = me !== null && !v.over && v.vote === null && v.turn === me;
  const myClimbs = myTurn ? climbs(v, me) : [];
  const myEnters = myTurn ? enterRooms(v, me) : [];
  const myNudges = myTurn ? nudges(v) : [];
  const liveRooms = new Set<number>([
    ...myEnters,
    ...myClimbs.map((c) => v.layout.paths[c.path].from),
    ...myNudges.map((p) => v.layout.paths[p].from),
  ]);
  const livePaths = new Set<number>([...myClimbs.map((c) => c.path), ...myNudges]);

  let bar: ReactNode = null;
  if (!v.over && me !== null) {
    if (v.vote) bar = <VoteBar ctx={ctx} vote={v.vote} act={act} />;
    else if (myTurn)
      bar = (
        <MoveBar ctx={ctx} sel={sel} setSel={setSel} climbs={myClimbs} enters={myEnters} nudges={myNudges} act={act} />
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
            rules={<Rules skin={skin} n={v.n} />}
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

      <Players ctx={ctx} room={room} reactions={reactions} awayFor={awayFor} send={send} />

      <section className={`stage ph-stage ${owing ? "owing" : ""}`}>
        {v.over ? (
          <End ctx={ctx} room={room} send={send} isAdmin={isAdmin} />
        ) : (
          <>
            {v.vote && <VoteSummary ctx={ctx} vote={v.vote} left={left} />}
            <Board
              v={v}
              skin={skin}
              names={names}
              liveRooms={liveRooms}
              livePaths={livePaths}
              selected={sel}
              onRoom={(r) => myTurn && setSel(sel?.room === r ? null : { room: r })}
              onPath={(p) => myTurn && setSel(sel?.path === p ? null : { path: p })}
            />
            {!myTurn && !v.vote && (
              <p className="muted ph-wait">
                {v.turn === me ? "" : `${names[v.turn]} is choosing a move.`} Deals happen on the call; gifts of{" "}
                {skin.nouns.points} go any time.
              </p>
            )}
          </>
        )}
        {bar && (
          <div ref={dockEl} className={`action-bar ${owing ? "your-turn" : ""}`}>
            {bar}
          </div>
        )}
      </section>

      <aside className="side ph-side">
        {me !== null && <Purse ctx={ctx} onGive={() => setGift(true)} />}
        <section className="recent" aria-label="Latest">
          <h2>Latest</h2>
          <ol>
            {v.log
              .slice(-6)
              .reverse()
              .map((e, i) => (
                <li key={i} className={`log-${e.t}`}>
                  {logLine(e, ctx, v.log)}
                </li>
              ))}
          </ol>
          <button className="btn small ghost" onClick={() => setLogOpen(true)}>
            Full log
          </button>
        </section>
      </aside>

      {logOpen && (
        <Sheet title="What happened" onClose={() => setLogOpen(false)}>
          <ol className="log">
            {v.log
              .map((e, i) => (
                <li key={i} className={`log-${e.t}`}>
                  {logLine(e, ctx, v.log.slice(0, i + 1))}
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

function Players(props: {
  ctx: Ctx;
  room: RoomInfo;
  reactions: Reaction[];
  awayFor: (seat: number) => number | null;
  send: (m: ClientMsg) => void;
}) {
  const { ctx } = props;
  return (
    <section className="seats ph-players" aria-label="Players">
      {ctx.names.map((_, i) => (
        <PlayerChip key={i} {...props} i={i} />
      ))}
    </section>
  );
}

function PlayerChip({
  ctx,
  room,
  reactions,
  awayFor,
  send,
  i,
}: {
  ctx: Ctx;
  room: RoomInfo;
  reactions: Reaction[];
  awayFor: (seat: number) => number | null;
  send: (m: ClientMsg) => void;
  i: number;
}) {
  const { v, skin, me } = ctx;
  const seat = room.seats[i];
  const p = v.players[i];
  const away = awayFor(i);
  const rights = seatRights(room, me, i, away, v.over);
  const [info, setInfo] = useState(false);
  const [kicking, setKicking] = useState(false);
  const owing = v.pending.includes(i);
  const look = skin.seats[i % skin.seats.length];
  const atTheTop = count(v.rooms, v.layout.summit, i);
  const onBoard = v.rooms.reduce((n, r) => n + r.filter((x) => x === i).length, 0) - atTheTop;
  const name = i === me ? "You" : seat.name;
  const winner = v.over && v.winners.includes(i);
  const mark = owing ? (v.vote && i !== v.turn ? "votes" : "to move") : null;
  const { climber, climbers, points } = skin.nouns;
  const facts = [
    winner ? `👑 ${name} won the game.` : null,
    owing ? `${name} ${i === me ? "owe" : "owes"} a move now (${mark}).` : null,
    room.admin === i ? "★ Room admin." : null,
    `${p.hand} ${p.hand === 1 ? climber : climbers} still to place, ${onBoard} on the way up, ${atTheTop} in the ${ctx.room(v.layout.summit)}.`,
    p.tokens
      ? `${i === me ? "Your" : `${seat.name}’s`} ${points}: ${score(p.tokens)} (${p.tokens.length} tokens)${i === me && !v.over ? ". Only you can see it." : "."}`
      : `${points} stays hidden until the game ends.`,
    connectionFact(room, i, name, away, rights),
  ].filter((f): f is string => f !== null);

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
        <span className="ph-swatch" aria-hidden="true">
          {(seat.name.trim()[0] ?? "?").toUpperCase()}
        </span>
        <Floats reactions={reactions} seat={i} />
        {i === me && <ReactBar room={room} send={send} side />}
      </div>
      <div className="seat-body">
        <div className="seat-name">
          {name}
          {room.admin === i && <span className="admin-mark">★</span>}
          {seat.bot && <span aria-label="bot"> 🤖</span>}
          {winner && <span title="Winner"> 👑</span>}
          {mark && <span className="mark now">{mark}</span>}
        </div>
        <div className="seat-line ph-counts">
          <span title={`${climbers} still to place`}>✋ {p.hand}</span>
          <span title={`${climbers} in the ${ctx.room(v.layout.summit)}`}>▲ {atTheTop}</span>
          {p.tokens && (
            <b className="ph-points" title={points}>
              {score(p.tokens)} {points}
            </b>
          )}
        </div>
        <SeatAwayRow room={room} i={i} owing={owing} rights={rights} send={send} />
      </div>
      {info && (
        <Sheet
          title={
            <>
              <Avatar code={seat.avatar} name={seat.name} className="small" />{" "}
              {i === me ? `You (${seat.name})` : seat.name}
            </>
          }
          label={`About ${i === me ? "your seat" : seat.name}`}
          onClose={() => setInfo(false)}
        >
          {i === me && room.settings.rename && (
            <p className="rename-row">
              Your name: <b>{seat.name}</b> <Rename name={seat.name} send={send} />
            </p>
          )}
          <ul className="seat-facts">
            {facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
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
        </Sheet>
      )}
    </div>
  );
}

// ---- your move ----

function climbNote(ctx: Ctx, c: ClimbOption): string {
  const { v, skin } = ctx;
  const token = v.tokensOn[c.path];
  if (c.kind === "blocked") return `the ${skin.nouns.blocker} lets you through, no ${skin.nouns.points}`;
  const gain = token !== null && (v.layout.rooms[v.layout.paths[c.path].from]?.cap ?? 0) > 1 ? ` · +${token}` : "";
  if (c.kind === "own") return `your ${skin.nouns.climbers} carry the vote${gain}`;
  return `needs ${c.need} votes, you have ${c.own}${gain}`;
}

function MoveBar(props: {
  ctx: Ctx;
  sel: { room?: number; path?: number } | null;
  setSel: (s: null) => void;
  climbs: ClimbOption[];
  enters: number[];
  nudges: number[];
  act: (a: PahunchAction) => void;
}) {
  const { ctx, sel, act } = props;
  const { v, skin } = ctx;
  const paths = v.layout.paths;
  const inSel = (path: number) =>
    !sel || sel.path === path || (sel.room !== undefined && paths[path].from === sel.room);
  const enters = props.enters.filter((r) => !sel || sel.room === r);
  const ups = props.climbs.filter((c) => inSel(c.path));
  const nudge = props.nudges.filter(inSel);
  const blockAt = sel?.path !== undefined && sel.path !== v.blocker ? sel.path : null;
  const [blockTo, setBlockTo] = useState<number>(() => (v.blocker === 0 ? 1 : 0));
  const route = (path: number) => `${ctx.room(paths[path].from)} → ${ctx.room(paths[path].to)}`;
  const nothing = enters.length + ups.length + nudge.length === 0 && blockAt === null;
  const { climber } = skin.nouns;
  // On a phone the full list would cover the board: it stays folded until you tap the board or ask for it.
  const [unfolded, setUnfolded] = useState(false);
  const folded = !sel && !unfolded;

  return (
    <div className={`ph-moves ${folded ? "folded" : ""}`}>
      <p className="status">
        <b>Your move.</b>{" "}
        {sel
          ? nothing
            ? "Nothing to do there. Pick another room or path."
            : "Pick one:"
          : `Tap a lit room or path on the board, or pick here. One move a turn.`}
        {sel && (
          <button
            className="btn small ghost"
            onClick={() => {
              props.setSel(null);
              setUnfolded(true);
            }}
          >
            Show all
          </button>
        )}
      </p>
      {folded && (
        <button type="button" className="btn ph-unfold" onClick={() => setUnfolded(true)}>
          List every move
        </button>
      )}
      {enters.length > 0 && (
        <div className="act-row" role="group" aria-label={`Add a ${climber}`}>
          <span className="ph-act-label">Add a {climber} to</span>
          {enters.map((r) => (
            <button key={r} className="btn" onClick={() => act({ type: "enter", room: r })}>
              {ctx.room(r)}
            </button>
          ))}
        </div>
      )}
      {ups.length > 0 && (
        <div className="act-row" role="group" aria-label="Move up">
          <span className="ph-act-label">Move up</span>
          {ups.map((c) => (
            <button
              key={c.path}
              className={`btn ${c.kind === "ask" ? "" : "primary"}`}
              onClick={() => act({ type: "climb", path: c.path })}
            >
              {route(c.path)} <small>({climbNote(ctx, c)})</small>
            </button>
          ))}
        </div>
      )}
      {nudge.length > 0 && (
        <div className="act-row" role="group" aria-label={`Nudge an ${skin.nouns.neutral}`}>
          <span className="ph-act-label">
            Nudge an {skin.nouns.neutral} up (+1 {skin.nouns.points})
          </span>
          {nudge.map((p) => (
            <button key={p} className="btn" onClick={() => act({ type: "nudge", path: p })}>
              {route(p)}
            </button>
          ))}
        </div>
      )}
      <div className="act-row" role="group" aria-label={`Move the ${skin.nouns.blocker}`}>
        {blockAt !== null ? (
          <button className="btn" onClick={() => act({ type: "block", path: blockAt })}>
            Send the {skin.nouns.blocker} to {route(blockAt)}
          </button>
        ) : (
          !sel && (
            <>
              <span className="ph-act-label">Send the {skin.nouns.blocker} to</span>
              <select value={blockTo} onChange={(e) => setBlockTo(Number(e.target.value))} aria-label="Path">
                {paths.map((_, p) =>
                  p === v.blocker ? null : (
                    <option key={p} value={p}>
                      {route(p)}
                    </option>
                  ),
                )}
              </select>
              <button className="btn" onClick={() => act({ type: "block", path: blockTo })}>
                Send
              </button>
            </>
          )
        )}
      </div>
    </div>
  );
}

// ---- votes ----

function VoteSummary({ ctx, vote, left }: { ctx: Ctx; vote: PahunchVote; left: number | null }) {
  const { v, skin, who } = ctx;
  const to = v.layout.paths[vote.path].to;
  const neutrals = count(v.rooms, vote.room, null);
  const yes = yesSoFar(vote);
  const voters = vote.answers.flatMap((a, s) => (count(v.rooms, vote.room, s) > 0 ? [{ s, a }] : []));
  return (
    <div className="ph-vote" aria-live="polite">
      <h2>
        {who(v.turn)} {v.turn === ctx.me ? "want" : "wants"} to move up from the {ctx.room(vote.room)} to the{" "}
        {ctx.room(to)}
      </h2>
      <p className="ph-tally">
        <b>{yes}</b> yes so far, <b>{vote.need}</b> needed
        {left !== null && <span className="ph-clock"> · ⏱ {Math.ceil(left / 1000)} s</span>}
      </p>
      <ul className="ph-voters">
        {voters.map(({ s, a }) => (
          <li key={s} style={{ ["--seat" as string]: skin.seats[s % skin.seats.length].color }}>
            <span className="ph-dot" aria-hidden="true" />
            {who(s)} ×{count(v.rooms, vote.room, s)}:{" "}
            {s === v.turn ? "yes (own)" : a === null ? <em>thinking…</em> : a === 0 ? "no" : `yes ×${a}`}
          </li>
        ))}
        {neutrals > 0 && (
          <li className="neutral">
            <span className="ph-dot" aria-hidden="true" />
            {neutrals} {neutrals === 1 ? skin.nouns.neutral : skin.nouns.neutrals}: {vote.bribed} paid
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
      <div className="act-row" role="group" aria-label="Your vote">
        <span className="status">
          <b>Your vote.</b> {mine === 1 ? `Your ${skin.nouns.climber} is` : `Your ${mine} ${skin.nouns.climbers} are`}{" "}
          in the {ctx.room(vote.room)}. A needed yes earns you 1 {skin.nouns.points}.
        </span>
        {Array.from({ length: mine }, (_, k) => mine - k).map((n) => (
          <button key={n} className="btn primary" onClick={() => act({ type: "vote", yes: n })}>
            Yes{mine > 1 ? ` ×${n}` : ""}
          </button>
        ))}
        <button className="btn" onClick={() => act({ type: "vote", yes: 0 })}>
          No
        </button>
      </div>
    );
  }
  const tokens = v.players[me]?.tokens ?? [];
  const bribes = bribeChoices(v, vote, tokens);
  return (
    <div className="act-row" role="group" aria-label="Your climb">
      <span className="status">
        <b>Your climb.</b> Ask on the call; offers are yours to make.{" "}
        {bribes.length > 0 &&
          `An ${skin.nouns.neutral} says yes for ${skin.nouns.bribe}: one token of ${v.layout.minBribe} or more, gone for good.`}
      </span>
      {bribes.map((t) => (
        <button key={t} className="btn" onClick={() => act({ type: "bribe", token: t })}>
          Pay an {skin.nouns.neutral} {t}
        </button>
      ))}
      <button className="btn" onClick={() => act({ type: "withdraw" })}>
        Give up (turn ends)
      </button>
    </div>
  );
}

// ---- tokens ----

function Purse({ ctx, onGive }: { ctx: Ctx; onGive: () => void }) {
  const { v, skin, me } = ctx;
  const tokens = (me !== null && v.players[me]?.tokens) || [];
  return (
    <section className="ph-purse" aria-label={`Your ${skin.nouns.points}`}>
      <h2>
        Your {skin.nouns.points} <b>{score(tokens)}</b>
      </h2>
      <div className="ph-tokens">
        {tokens.length === 0 && <span className="muted">None yet.</span>}
        {tokens.map((t, k) => (
          <span key={k} className={`ph-chip v${Math.min(t, 5)}`}>
            {t}
          </span>
        ))}
      </div>
      <p className="muted small">
        {v.over ? "Everyone’s tokens show now." : "Only you see these until the game ends."}
      </p>
      {!v.over && tokens.length > 0 && (
        <button className="btn small" onClick={onGive}>
          Give tokens…
        </button>
      )}
    </section>
  );
}

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
  const [picked, setPicked] = useState<number[]>([]);
  const chosen = picked.map((k) => tokens[k]);
  return (
    <Sheet title={`Give ${skin.nouns.points}`} onClose={onClose}>
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
            : `Give ${chosen.length === 1 ? "1 token" : `${chosen.length} tokens`} (${score(chosen)} ${skin.nouns.points}) to ${names[to]}`}
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
  // Ended early: no winner and no podium, only where everyone stood.
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  return (
    <div className="ph-ended">
      <h2>Game ended early</h2>
      <p>
        {by !== undefined ? `${names[by]} ended the game.` : "The game was ended."} Nobody wins a game that stops before
        the {ctx.room(v.layout.summit)} is full.
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
      return `${who(e.p)} sent an ${skin.nouns.neutral} ${skin.nouns.bribe}.`;
    case "reward":
      return `${who(e.p)} earned ${pts(e.ones)}.`;
    case "fail": {
      const ask = upTo.findLast((x) => x.t === "ask");
      const from = ask?.t === "ask" ? ` in the ${ctx.room(paths[ask.path].from)}` : "";
      return `The vote failed: ${who(e.p).toLowerCase() === "you" ? "you stay" : `${who(e.p)} stays`}${from}.`;
    }
    case "nudge":
      return `${who(e.p)} nudged an ${skin.nouns.neutral} up from ${route(e.path)} and took ${pts(1)}.`;
    case "block":
      return `${who(e.p)} sent the ${skin.nouns.blocker} to the way from ${route(e.path)}.`;
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
