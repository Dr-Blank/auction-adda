// The parts of a table page every game shares: the your-move cue, the docked action bar, the room
// menu, the notices above the table and the podium at the end. A game's table puts its own stage,
// hand and log between them.

import type { ReactNode, RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ClientMsg, RoomInfo } from "../generated/index.ts";
import { Avatar } from "./Avatar.tsx";
import { reducedMotion, useCountUp } from "./hooks.ts";
import { CrownIcon, FreezeIcon, ResumeIcon } from "./Icons.tsx";
import {
  AdminAway,
  ConfirmButton,
  Rename,
  RoomCode,
  RoomSettingsPanel,
  ShareLink,
  WatcherList,
  Wins,
} from "./Lobby.tsx";
import type { RoomState } from "./net.ts";
import { savedAvatar, savedName, saveName } from "./net.ts";
import { Sheet } from "./Sheet.tsx";
import { isMuted, play, setMuted } from "./sound.ts";

/** The app's name, in the tab title. */
const APP = "Game Adda";

/**
 * While you owe a move: a sound once, and the tab title says so. In another tab the title
 * flashes, so the tab strip shows it; back here it holds still.
 */
export function useYourMove(owing: boolean): void {
  useEffect(() => {
    const yours = `● Your move — ${APP}`;
    if (owing) play("turn");
    let flash = 0;
    const show = () => {
      clearInterval(flash);
      document.title = owing ? yours : APP;
      if (!owing || !document.hidden) return;
      let on = true;
      flash = window.setInterval(() => {
        on = !on;
        document.title = on ? yours : "○ YOUR MOVE";
      }, 1000);
    };
    show();
    document.addEventListener("visibilitychange", show);
    return () => {
      clearInterval(flash);
      document.removeEventListener("visibilitychange", show);
      document.title = APP;
    };
  }, [owing]);
}

/**
 * Phones dock the action bar to the bottom edge while you owe a move. Its height varies (bid box,
 * two buttons, a sentence), so it is measured: the hand sits right above it and the page ends
 * clear of it. Set on the root, not the table: the toasts live outside the table and must also
 * clear it. Put the returned ref on the action bar.
 */
export function useDock(docked: boolean): RefObject<HTMLDivElement | null> {
  const dockEl = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    const dock = dockEl.current;
    if (!dock || !docked) {
      root.setProperty("--dock", "0px");
      return () => root.removeProperty("--dock");
    }
    const measure = () =>
      root.setProperty("--dock", `${getComputedStyle(dock).position === "fixed" ? dock.offsetHeight : 0}px`);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(dock);
    addEventListener("resize", measure);
    return () => {
      watch.disconnect();
      removeEventListener("resize", measure);
      root.removeProperty("--dock");
    };
  }, [docked]);
  return dockEl;
}

/** How long each seat has been away now (`null` = here); re-renders every second while anyone is. */
export function useAwayFor(state: RoomState): (seat: number) => number | null {
  const { room } = state;
  const anyAway = room.seats.some((s) => !s.connected);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!anyAway) return;
    const timer = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(timer);
  }, [anyAway]);
  return (i: number) => {
    const ms = room.seats[i].awayMs;
    return ms === null ? null : ms + (Date.now() - state.receivedAt);
  };
}

/** "m:ss" for an away time. */
export function awayClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What the viewer (`me`) may do about seat `i` as admin, and how the seat's connection reads. */
export function seatRights(room: RoomInfo, me: number | null, i: number, away: number | null, over: boolean) {
  const seat = room.seats[i];
  const isAdmin = me !== null && room.admin === me && i !== me;
  return {
    // Skip and free seat: the admin's, once the player has been away long enough.
    canAct: isAdmin && !seat.bot && away !== null && away >= room.skipAfterMs,
    // A bot standing in for a player shows as disconnected; one that took a kicked player's seat does not.
    standIn: seat.bot && !seat.connected,
    canBot: isAdmin && !over && !seat.connected && !seat.bot,
    canKick: isAdmin && !over && !(seat.bot && seat.connected),
    // A bot seat the admin may open for someone with the link (the bot plays until they take it), or close again.
    canFree: isAdmin && !over && seat.bot && !seat.open,
    canKeep: isAdmin && !over && seat.bot && seat.open,
    // The banner above the table offers the role to everyone; the seat sheet does too.
    adminAway: me !== null && me !== i && room.admin === i && away !== null && away >= room.adminClaimMs,
    status: seat.bot
      ? seat.open
        ? "Bot playing · seat open"
        : "Bot playing"
      : seat.open
        ? "Seat open"
        : `Away ${awayClock(away ?? 0)}`,
  };
}

type Rights = ReturnType<typeof seatRights>;

/** The seat's connection as a sentence, for its info sheet. */
export function connectionFact(room: RoomInfo, i: number, name: string, away: number | null, rights: Rights): string {
  const seat = room.seats[i];
  return seat.bot && seat.open
    ? "🤖 A bot plays this seat until someone takes it over from the room link."
    : rights.standIn
      ? `🤖 A bot plays this seat at random until ${name} comes back.`
      : seat.bot
        ? "🤖 A bot: the server plays this seat at random."
        : seat.connected
          ? "Connected."
          : seat.open
            ? "Seat open: anyone with the room link can take it over."
            : `Away for ${awayClock(away ?? 0)}.`;
}

/** Under a seat that is away or open: its status and the admin's quick buttons. */
export function SeatAwayRow(props: {
  room: RoomInfo;
  i: number;
  owing: boolean;
  rights: Rights;
  send: (m: ClientMsg) => void;
}) {
  const { room, i, owing, rights, send } = props;
  const seat = room.seats[i];
  if (seat.connected && !seat.open) return null;
  return (
    <div className="away-row">
      <span className="muted small">{rights.status}</span>
      {rights.canBot && (
        <button
          className="btn small"
          onClick={() => send({ type: "bot", seat: i })}
          title="A bot plays until they come back"
        >
          Bot plays
        </button>
      )}
      {rights.canAct && owing && (
        <button className="btn small" onClick={() => send({ type: "skip", seat: i })}>
          Skip their move
        </button>
      )}
      {rights.canAct && !seat.open && (
        <button
          className="btn small"
          onClick={() => send({ type: "release", seat: i })}
          title="Lets someone else take over this seat from the room link"
        >
          Free seat
        </button>
      )}
    </div>
  );
}

/** In a seat's info sheet: what the admin (or anyone, for an away admin) can do about the seat. */
export function SeatSheetActions(props: {
  room: RoomInfo;
  me: number | null;
  i: number;
  owing: boolean;
  rights: Rights;
  send: (m: ClientMsg) => void;
  /** The kick asks first; kept by the seat, so it outlives the sheet. */
  kicking: boolean;
  setKicking: (on: boolean) => void;
}) {
  const { room, me, i, owing, rights, send, kicking, setKicking } = props;
  const { canAct, adminAway, canBot, canKick, canFree, canKeep } = rights;
  const seat = room.seats[i];
  return (
    <>
      {!seat.connected && (canAct || adminAway) && (
        <div className="row">
          {canAct && owing && (
            <button className="btn" onClick={() => send({ type: "skip", seat: i })}>
              Skip their move
            </button>
          )}
          {canAct && !seat.open && (
            <button className="btn" onClick={() => send({ type: "release", seat: i })}>
              Free seat (someone else can take it from the room link)
            </button>
          )}
          {adminAway && (
            <button className="btn" onClick={() => send({ type: "admin", seat: me! })}>
              Become admin
            </button>
          )}
        </div>
      )}
      {(canBot || canKick || canFree || canKeep) && (
        <div className="row">
          {canBot && (
            <button className="btn" onClick={() => send({ type: "bot", seat: i })}>
              Let a bot play until they come back
            </button>
          )}
          {canFree && (
            <button className="btn" onClick={() => send({ type: "release", seat: i })}>
              Free seat: the bot plays until someone takes it from the room link
            </button>
          )}
          {canKeep && (
            <button className="btn" onClick={() => send({ type: "bot", seat: i })}>
              Keep the bot (close the seat)
            </button>
          )}
          {canKick &&
            (kicking ? (
              <>
                <button className="btn primary" onClick={() => send({ type: "kick", seat: i })}>
                  Kick {seat.name}: a bot plays the seat for good
                </button>
                <button className="btn" onClick={() => setKicking(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => setKicking(true)}>
                Kick
              </button>
            ))}
        </div>
      )}
    </>
  );
}

/** Who may freeze or unfreeze now. */
export function freezeRights(room: RoomInfo, me: number | null, over: boolean) {
  const isAdmin = me !== null && room.admin === me;
  const frozen = room.frozenBy !== null && !over;
  return {
    frozen,
    canFreeze: me !== null && !over && (isAdmin || room.settings.freeze === "anyone"),
    canUnfreeze: frozen && me !== null && (isAdmin || me === room.frozenBy),
  };
}

/** The top-bar button that freezes the game, for whoever may. */
export function FreezeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="icon-btn"
      onClick={onClick}
      title="Freeze the game: the clock, the bots and all moves wait"
      aria-label="Freeze the game"
    >
      <FreezeIcon /> <span className="lbl">Freeze</span>
    </button>
  );
}

/** The top-bar sound switch, remembered per browser. */
export function MuteButton() {
  const [muted, setMutedState] = useState(isMuted);
  return (
    <button
      className="icon-btn"
      onClick={() => {
        setMuted(!muted);
        setMutedState(!muted);
      }}
      title={muted ? "Sound off" : "Sound on"}
      aria-label={muted ? "Turn sound on" : "Turn sound off"}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}

/**
 * Above the table: the frozen game, the spectator's options, an away admin, a free seat to pass
 * on. `hidden` tells a spectator what they cannot see ("Hands and money stay hidden.").
 */
export function TableNotices(props: {
  state: RoomState;
  send: (m: ClientMsg) => void;
  names: string[];
  over: boolean;
  hidden: string;
}) {
  const { state, send, names } = props;
  const { room, you: me } = state;
  const { frozen, canUnfreeze } = freezeRights(room, me, props.over);
  const openSeats = room.seats.flatMap((s, i) => (s.open ? [i] : []));
  return (
    <div className="notices">
      {frozen && room.frozenBy !== null && (
        <div className="notice frozen-notice">
          <FreezeIcon />
          <span>
            {room.frozenBy === me ? "You" : <b>{names[room.frozenBy]}</b>} froze the game. The clock, the bots and all
            moves wait.
          </span>
          {canUnfreeze && (
            <button className="btn primary small" onClick={() => send({ type: "freeze", on: false })}>
              <ResumeIcon /> Unfreeze
            </button>
          )}
        </div>
      )}
      {me === null && (
        <Spectator openSeats={openSeats} left={state.left} names={names} send={send} hidden={props.hidden} />
      )}
      <AdminAway state={state} send={send} />
      {me !== null && openSeats.length > 0 && (
        <div className="notice">
          <span>A seat is free. Send this link to whoever takes over:</span>
          <ShareLink code={room.code} />
        </div>
      )}
    </div>
  );
}

function Spectator({
  openSeats,
  left,
  names,
  send,
  hidden,
}: {
  openSeats: number[];
  /** The seat this browser left to a bot. */
  left: number | null;
  names: string[];
  send: (m: ClientMsg) => void;
  hidden: string;
}) {
  const [name, setName] = useState(savedName);
  if (left !== null)
    return (
      <div className="notice">
        <span>You left your seat ({names[left]}); a bot is playing it.</span>
        <button className="btn primary small" onClick={() => send({ type: "back" })}>
          Take my seat back
        </button>
      </div>
    );
  if (openSeats.length === 0) return <div className="notice">You are watching this game. {hidden}</div>;
  return (
    <div className="notice">
      <span>A seat is free. Take it over:</span>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="Your name" />
      {openSeats.map((i) => (
        <button
          key={i}
          className="btn primary small"
          disabled={!name.trim()}
          onClick={() => {
            saveName(name.trim());
            send({ type: "claim", seat: i, name, avatar: savedAvatar() });
          }}
        >
          Take {names[i]}’s seat
        </button>
      ))}
    </div>
  );
}

/**
 * The Room menu during a game: the link, your name, the admin role, watchers, settings, leaving
 * and ending. The game adds its own settings (`settings`, after the room's) and its rules.
 */
export function RoomMenu(props: {
  room: RoomInfo;
  me: number | null;
  names: string[];
  send: (m: ClientMsg) => void;
  onClose: () => void;
  over: boolean;
  /** What the admin can do in this game, under their name. */
  adminHint: string;
  /** The question before the admin ends the game ("End the game for everyone? …"). */
  endAsk: string;
  settings?: ReactNode;
  rules: ReactNode;
}) {
  const { room, me, names, send, onClose } = props;
  // Only a connected player can take the role.
  const eligible = room.seats.flatMap((s, i) => (i !== me && !s.bot && s.connected ? [i] : []));
  const [picked, setTo] = useState<number | null>(null);
  const to = picked !== null && eligible.includes(picked) ? picked : eligible[0];
  return (
    <Sheet
      title={
        <>
          Room <RoomCode code={room.code} />
        </>
      }
      label="Room"
      onClose={onClose}
    >
      <ShareLink code={room.code} />
      {me !== null && room.settings.rename && (
        <p className="rename-row">
          Your name: <b>{names[me]}</b> <Rename name={names[me]} send={send} />
        </p>
      )}
      <div className="menu-admin">
        <p>
          <span className="admin-mark">★</span> Admin: <b>{room.admin === me ? "you" : names[room.admin]}</b>
          <br />
          <small className="muted">{props.adminHint}</small>
        </p>
        {room.admin === me && to !== undefined && (
          <div className="row">
            <select value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label="New admin">
              {eligible.map((i) => (
                <option key={i} value={i}>
                  {names[i]}
                </option>
              ))}
            </select>
            <button className="btn small" onClick={() => send({ type: "admin", seat: to })}>
              Make admin
            </button>
          </div>
        )}
      </div>
      <WatcherList room={room} me={me} send={send} />
      <RoomSettingsPanel room={room} me={me} send={send} />
      {props.settings}
      {me !== null && !props.over && (
        <div className="menu-danger">
          <ConfirmButton
            label="Leave my seat"
            ask="Leave the game? A bot plays your seat; you can take it back from this browser."
            yes="Leave"
            onConfirm={() => {
              send({ type: "leave" });
              onClose();
            }}
          />
        </div>
      )}
      {room.admin === me && (
        <div className="menu-danger">
          {!props.over && (
            <ConfirmButton
              label="End game now"
              ask={props.endAsk}
              yes="End game"
              onConfirm={() => {
                send({ type: "end" });
                onClose();
              }}
            />
          )}
          <ConfirmButton
            label="Close room"
            ask="Delete this room for everyone?"
            yes="Close room"
            onConfirm={() => send({ type: "close" })}
          />
        </div>
      )}
      {props.rules}
    </Sheet>
  );
}

/** One seat's final standing. */
export interface Standing {
  i: number;
  score: number;
  place: number;
}

/** Places from the top: winners first, then by score; equal score (and equal standing) shares a place. */
export function standings(scores: number[], winners: number[]): Standing[] {
  const won = (i: number) => winners.includes(i);
  const order = scores
    .map((score, i) => ({ i, score }))
    .sort((x, y) => Number(won(y.i)) - Number(won(x.i)) || y.score - x.score);
  const out: Standing[] = [];
  order.forEach((o, k) => {
    const prev = out[k - 1];
    const tied = prev && prev.score === o.score && won(prev.i) === won(o.i);
    out.push({ ...o, place: tied ? prev.place : k + 1 });
  });
  return out;
}

/** When each step rises (first, second, third): third, then second, then first. Its score counts up as it lands. */
const RISE_MS = [650, 350, 0];

function PodiumStep(props: {
  i: number;
  score: number;
  place: number;
  /** Position on the podium: 0 first, 1 second, 2 third. */
  step: number;
  room: RoomInfo;
  you: number | null;
  format: (n: number) => string;
  series: boolean;
}) {
  const { i, place, step, room } = props;
  const seat = room.seats[i];
  const delay = RISE_MS[step] ?? 0;
  const score = useCountUp(props.score, { from: 0, delay: delay + 250, duration: 1200 });
  return (
    <li className={`place place-${step + 1}`} style={{ ["--d" as string]: `${delay}ms` }}>
      {place === 1 && (
        <span className="crown" title="Winner">
          <CrownIcon />
        </span>
      )}
      <Avatar code={seat?.avatar ?? ""} name={seat?.name ?? ""} />
      <span className="who">
        {seat?.name}
        {i === props.you && <em> (you)</em>}
      </span>
      <b className="money">{props.format(score)}</b>
      {props.series && <Wins n={seat?.wins ?? 0} />}
      <span className="block" aria-label={`Place ${place}`}>
        {place}
      </span>
    </li>
  );
}

/** Paper falling over the podium, once. Its look is drawn when it mounts, so a re-render keeps it still. */
function Confetti() {
  const [bits] = useState(() =>
    Array.from({ length: 42 }, (_, k) => ({
      left: Math.random() * 100,
      delay: 900 + Math.random() * 900,
      fall: 2200 + Math.random() * 1400,
      spin: Math.round(Math.random() * 720 - 360),
      drift: Math.round(Math.random() * 80 - 40),
      hue: k % 5,
    })),
  );
  if (reducedMotion()) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, k) => (
        <i
          key={k}
          className={`c${b.hue}`}
          style={{
            left: `${b.left}%`,
            animationDelay: `${b.delay}ms`,
            animationDuration: `${b.fall}ms`,
            ["--spin" as string]: `${b.spin}deg`,
            ["--drift" as string]: `${b.drift}px`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * The final result: confetti, the winners, a podium for the top three and the rest below, each
 * with their score (`format` writes it) and, after the first game, the room's tally. The admin
 * gets a rematch and a way back to the lobby.
 */
export function GameOver(props: {
  room: RoomInfo;
  you: number | null;
  names: string[];
  winners: number[];
  standings: Standing[];
  format: (n: number) => string;
  /** Why the game ended early, when the admin ended it. */
  endedNote: ReactNode;
  isAdmin: boolean;
  /** Name of the admin, shown to the other players while they wait for a rematch. */
  admin?: string;
  onRematch: () => void;
  onSetup: () => void;
}) {
  const { room, names, format } = props;
  const order = props.standings;
  const top = order.slice(0, 3);
  // Second, first, third, left to right.
  const podium = [top[1], top[0], top[2]].flatMap((o) => (o ? [{ ...o, step: top.indexOf(o) }] : []));
  const rest = order.slice(3);
  // After one game the tally only repeats the podium.
  const series = room.games > 1;
  return (
    <div className="gameover">
      <Confetti />
      {props.endedNote}
      <h2>
        {props.winners.map((i) => names[i]).join(" & ")} {props.winners.length > 1 ? "share the win" : "wins"}!
      </h2>
      {series && (
        <p className="muted series-note">Game {room.games} in this room. The trophies count each seat's wins.</p>
      )}
      <ol className="podium">
        {podium.map((o) => (
          <PodiumStep key={o.i} {...o} room={room} you={props.you} format={format} series={series} />
        ))}
      </ol>
      {rest.length > 0 && (
        <ol className="also-ran" start={4}>
          {rest.map(({ i, score, place }) => (
            <li key={i} value={place}>
              <span>
                {room.seats[i]?.name}
                {i === props.you && <em> (you)</em>}
              </span>
              <b>{format(score)}</b>
              {series && <Wins n={room.seats[i]?.wins ?? 0} />}
            </li>
          ))}
        </ol>
      )}
      {props.isAdmin ? (
        <div className="row gameover-next">
          <button type="button" className="btn primary big" onClick={props.onRematch}>
            Play again
          </button>
          <button
            type="button"
            className="btn big"
            onClick={props.onSetup}
            title="Back to the lobby with the same players: change the theme, cast, clock or players"
          >
            Change setup
          </button>
        </div>
      ) : (
        props.admin && <p className="muted">Waiting for {props.admin} (admin) to start a new game.</p>
      )}
    </div>
  );
}
