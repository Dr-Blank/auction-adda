import { Fragment, useEffect, useState } from "react";
import { GAME_LIST } from "../games/index.ts";
import type { GameClient, Skin } from "../games/types.ts";
import type { ClientMsg, RoomInfo, RoomSettings, ThemeId } from "../generated/index.ts";
import { Avatar, LookButton } from "./Avatar.tsx";
import { Brand } from "./Brand.tsx";
import { CheckIcon, CopyIcon, LockIcon, PencilIcon, QrIcon, ShareIcon, TrophyIcon } from "./Icons.tsx";
import type { Reaction, RoomState } from "./net.ts";
import { savedName, saveName, saveSettings, saveTheme, useSavedLook } from "./net.ts";
import { Qr } from "./Qr.tsx";
import { Floats, ReactBar, ReactionPicker } from "./Reactions.tsx";
import { Sheet } from "./Sheet.tsx";

interface Props {
  state: RoomState;
  send: (m: ClientMsg) => void;
  join: (room: string, name?: string) => void;
  /** The room's game, and its theme's look. */
  game: GameClient;
  skin: Skin;
  reactions: Reaction[];
}

/** The themes as radio cards; picking one picks its game. With more than one game, by game. */
export function ThemePicker({ value, onChange }: { value: string; onChange: (id: ThemeId) => void }) {
  return (
    <fieldset>
      <legend>Theme</legend>
      {GAME_LIST.map((g) => (
        <Fragment key={g.id}>
          {GAME_LIST.length > 1 && <h3 className="theme-game">{g.title}</h3>}
          {g.themes.map((id) => {
            const skin = g.skin(id);
            return (
              <label key={id} className={`theme-pick ${value === id ? "on" : ""}`}>
                <input type="radio" name="theme" checked={value === id} onChange={() => onChange(id)} />
                <span>
                  <b>{skin.title}</b>
                  <small>{skin.tagline}</small>
                </span>
              </label>
            );
          })}
        </Fragment>
      ))}
    </fieldset>
  );
}

/** A button for something that cannot be taken back: the first press asks, the second does it. */
export function ConfirmButton(props: {
  label: string;
  /** What happens, as a question ("End the game for everyone?"). */
  ask: string;
  yes: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button type="button" className={`btn small ${props.className ?? ""}`} onClick={() => setAsking(true)}>
        {props.label}
      </button>
    );
  return (
    <span className="confirm" role="group" aria-label={props.ask}>
      <span>{props.ask}</span>
      <button
        type="button"
        className="btn small danger"
        onClick={() => {
          setAsking(false);
          props.onConfirm();
        }}
      >
        {props.yes}
      </button>
      <button type="button" className="btn small" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

/** Copies `text`; `copied` is true for a moment afterwards. */
function useCopy(text: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  return [
    copied,
    () =>
      navigator.clipboard?.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }),
  ];
}

/** The room link: copy it, hand it to the phone's share sheet, or show it as a QR code. */
export function ShareLink({ code }: { code: string }) {
  const link = `${location.origin}/#${code}`;
  const [copied, copy] = useCopy(link);
  const [qr, setQr] = useState(false);
  const canShare = typeof navigator.share === "function";
  return (
    <div className="share">
      <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Room link" />
      <button className="btn" onClick={copy}>
        {copied ? "Copied" : "Copy link"}
      </button>
      {canShare && (
        <button
          className="btn share-btn"
          onClick={() =>
            navigator
              .share({ title: "Auction Adda", text: `Join my Auction Adda room ${code}`, url: link })
              .catch(() => {})
          }
          title="Send the link with another app"
          aria-label="Share the room link"
        >
          <ShareIcon />
        </button>
      )}
      <button
        className="btn share-btn"
        onClick={() => setQr(true)}
        title="Show the link as a QR code"
        aria-label="Show the room link as a QR code"
      >
        <QrIcon />
      </button>
      {qr && (
        <Sheet
          title={
            <>
              Room <RoomCode code={code} />
            </>
          }
          label={`Room ${code}`}
          onClose={() => setQr(false)}
        >
          <div className="qr-box">
            <Qr text={link} label={`QR code for ${link}`} />
            <p className="muted">Point a phone camera here to open the room.</p>
            <p className="qr-link">
              <code>{link}</code>
              <CopyButton text={link} what="room link" />
            </p>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** Games won in this room, with a trophy. */
export function Wins({ n }: { n: number }) {
  return (
    <span className="wins" title={`${n} ${n === 1 ? "game" : "games"} won in this room`}>
      <TrophyIcon /> {n}
    </span>
  );
}

/** A small button that copies `text` (`what` names it: "room code"). */
function CopyButton({ text, what }: { text: string; what: string }) {
  const [copied, copy] = useCopy(text);
  return (
    <button
      type="button"
      className={`copy-code ${copied ? "done" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        copy();
      }}
      title={copied ? "Copied" : `Copy ${what}`}
      aria-label={copied ? `${what} copied` : `Copy ${what}`}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

/** A room code with a small button that copies just the code. */
export function RoomCode({ code }: { code: string }) {
  return (
    <span className="room-code">
      <b className="code">{code}</b>
      <CopyButton text={code} what="room code" />
    </span>
  );
}

/** A pencil that turns into a name field, while the admin lets players rename themselves. */
export function Rename({ name, send }: { name: string; send: (m: ClientMsg) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null)
    return (
      <button
        type="button"
        className="icon-btn rename-btn"
        onClick={() => setDraft(name)}
        title="Change your name"
        aria-label="Change your name"
      >
        <PencilIcon />
      </button>
    );
  const save = () => {
    const next = draft.trim();
    if (next && next !== name) {
      saveName(next);
      send({ type: "rename", name: next });
    }
    setDraft(null);
  };
  return (
    <form
      className="rename"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
        maxLength={20}
        aria-label="Your name"
        autoFocus
      />
      <button className="btn small primary" disabled={!draft.trim()}>
        Save
      </button>
      <button type="button" className="btn small" onClick={() => setDraft(null)}>
        Cancel
      </button>
    </form>
  );
}

/** An on/off setting: a switch for the admin, the state for everyone else. */
function Toggle(props: { label: string; hint: string; on: boolean; admin: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={`toggle ${props.on ? "on" : ""}`}>
      <input
        type="checkbox"
        role="switch"
        checked={props.on}
        disabled={!props.admin}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>
        <span>
          <b>{props.label}</b>
          {!props.admin && <em>: {props.on ? "on" : "off"}</em>}
        </span>
        <small className="muted">{props.hint}</small>
      </span>
    </label>
  );
}

/**
 * The admin's switches for how the room plays, in the lobby and the Room menu. Everyone sees them;
 * the admin's browser keeps them for the next room they create.
 */
export function RoomSettingsPanel({
  room,
  me,
  send,
}: {
  room: RoomInfo;
  me: number | null;
  send: (m: ClientMsg) => void;
}) {
  const admin = room.admin === me;
  const set = (patch: Partial<RoomSettings>) => {
    const settings = { ...room.settings, ...patch };
    saveSettings(settings);
    send({ type: "settings", settings });
  };
  return (
    <div className="room-settings">
      <h3>Room settings</h3>
      <Toggle
        label="Lock room"
        hint="Nobody new takes a seat. People with the link can still watch."
        on={room.settings.locked}
        admin={admin}
        onChange={(locked) => set({ locked })}
      />
      <Toggle
        label="Anyone may freeze"
        hint="Every player can freeze the game, which stops the clock, the bots and all moves. Whoever froze it, or the admin, lets it run again."
        on={room.settings.freeze === "anyone"}
        admin={admin}
        onChange={(on) => set({ freeze: on ? "anyone" : "admin" })}
      />
      <Toggle
        label="Players may rename"
        hint="Everyone with a seat can change their name, in the lobby and during the game."
        on={room.settings.rename}
        admin={admin}
        onChange={(rename) => set({ rename })}
      />
      <Toggle
        label="New seats each round"
        hint="Seats are drawn at random when a game starts. With this on, they are drawn again at the start of every round."
        on={room.settings.shuffleEachRound}
        admin={admin}
        onChange={(shuffleEachRound) => set({ shuffleEachRound })}
      />
      <ReactionPicker room={room} admin={admin} set={set} />
    </div>
  );
}

/**
 * People watching, and people the admin kicked or removed (greyed when they are not here). The
 * admin can send a watcher out or let a kicked or removed person back in.
 */
export function WatcherList({ room, me, send }: { room: RoomInfo; me: number | null; send: (m: ClientMsg) => void }) {
  if (room.watchers.length === 0) return null;
  const admin = room.admin === me;
  const here = room.watchers.filter((w) => w.id !== null).length;
  return (
    <section className="watchers">
      <h3>
        Watching <small className="muted">({here})</small>
      </h3>
      <ul>
        {room.watchers.map((w, i) => (
          <li key={w.id ?? `ban${w.ban}`} className={w.id === null ? "offline" : ""}>
            <span className="grow">
              {w.name || "Guest"}
              {w.ban !== null && <em> · kicked, no seat</em>}
              {w.id === null && <em> · not here</em>}
            </span>
            {admin && w.ban !== null && (
              <button type="button" className="btn small" onClick={() => send({ type: "unban", ban: w.ban! })}>
                Let back in
              </button>
            )}
            {admin && w.ban === null && w.id !== null && (
              <ConfirmButton
                key={i}
                label="Remove"
                ask={`Send ${w.name || "this guest"} out of the room?`}
                yes="Remove"
                onConfirm={() => send({ type: "remove", watcher: w.id! })}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The admin has been away a while: every player may take the role, and shortly after, the server
 * hands it to the first player still here.
 */
export function AdminAway({ state, send }: { state: RoomState; send: (m: ClientMsg) => void }) {
  const { room, you } = state;
  const awayMs = room.seats[room.admin]?.awayMs ?? null;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (awayMs === null) return;
    const timer = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(timer);
  }, [awayMs === null]);
  if (you === null || you === room.admin || awayMs === null) return null;
  const away = awayMs + (Date.now() - state.receivedAt);
  if (away < room.adminClaimMs) return null;
  const left = Math.max(0, Math.ceil((room.adminAutoMs - away) / 1000));
  const next = room.seats.findIndex((s) => !s.bot && s.connected);
  return (
    <div className="notice admin-away" role="status">
      <span>
        <span className="admin-mark">★</span> {room.seats[room.admin]?.name} (admin) is away.{" "}
        {next >= 0 && (
          <span className="muted">
            {next === you ? "You get" : `${room.seats[next]?.name} gets`} the role in {left} s.
          </span>
        )}
      </span>
      <button className="btn primary small" onClick={() => send({ type: "admin", seat: you })}>
        Become admin
      </button>
    </div>
  );
}

/** The admin's start button. With players not ready yet, the first press asks first. */
function StartRow({ room, canStart, send }: { room: RoomInfo; canStart: boolean; send: (m: ClientMsg) => void }) {
  const [asking, setAsking] = useState(false);
  const count = room.seats.length;
  const waiting = room.seats.filter((s, i) => i !== room.admin && !s.ready).map((s) => s.name);
  const ready = count - 1 - waiting.length;
  if (asking && canStart && waiting.length > 0)
    return (
      <div className="row start-anyway" role="group" aria-label="Start anyway?">
        <span className="grow">
          <b>{waiting.join(", ")}</b> {waiting.length === 1 ? "is" : "are"} not ready yet.
        </span>
        <button
          className="btn primary"
          onClick={() => {
            setAsking(false);
            send({ type: "start" });
          }}
        >
          Start anyway
        </button>
        <button className="btn" onClick={() => setAsking(false)}>
          Wait
        </button>
      </div>
    );
  return (
    <div className="row">
      <button
        className="btn primary big grow"
        disabled={!canStart}
        onClick={() => (waiting.length > 0 ? setAsking(true) : send({ type: "start" }))}
      >
        {!canStart
          ? `Waiting for players (${count}/${room.minPlayers} minimum)`
          : waiting.length > 0
            ? `Start with ${count} players · ${ready} of ${count - 1} ready`
            : `Start with ${count} players · all ready`}
      </button>
      <button className="btn" onClick={() => send({ type: "leave" })}>
        Leave
      </button>
    </div>
  );
}

export function Lobby({ state, send, join, game, skin, reactions }: Props) {
  const { room, you } = state;
  const [name, setName] = useState(savedName);
  const [look, setLook] = useSavedLook();
  const count = room.seats.length;
  const canStart = count >= room.minPlayers && count <= room.maxPlayers;
  const empty = Array.from({ length: room.maxPlayers - count });
  const isAdmin = you !== null && room.admin === you;
  const adminName = room.seats[room.admin]?.name;

  return (
    <main className="center-card lobby">
      <Brand as="h1" />
      <p className="muted">
        {skin.title} · room <RoomCode code={room.code} />
      </p>

      <AdminAway state={state} send={send} />
      <p>Paste this link in Discord. Everyone who opens it lands in this room.</p>
      <ShareLink code={room.code} />

      {isAdmin && (
        <ThemePicker
          value={room.theme}
          onChange={(id) => {
            saveTheme(id);
            send({ type: "theme", theme: id });
          }}
        />
      )}

      <h2>
        Players{" "}
        <small>
          ({room.minPlayers}–{room.maxPlayers})
          {room.games > 0 && ` · ${room.games} ${room.games === 1 ? "game" : "games"} played`}
        </small>
        {room.settings.locked && (
          <span className="locked-mark" title="The admin locked the room: no new seats">
            <LockIcon /> locked
          </span>
        )}
      </h2>
      <ol className="lobby-seats">
        {room.seats.map((s, i) => (
          <li key={i} className={`${s.connected ? "" : "away"} ${i === you ? "me" : ""}`}>
            <Floats reactions={reactions} seat={i} />
            {i === you ? (
              <span className="avatar-wrap">
                <LookButton
                  code={s.avatar}
                  name={s.name}
                  className={s.connected ? "on" : ""}
                  onChange={(code) => {
                    setLook(code);
                    send({ type: "avatar", avatar: code });
                  }}
                />
                <ReactBar room={room} send={send} />
              </span>
            ) : (
              <Avatar
                code={s.avatar}
                name={s.name}
                className={s.connected ? "on" : ""}
                title={s.connected ? "Connected" : "Disconnected"}
              />
            )}
            <span className="grow">
              <b>{s.name}</b>
              {room.admin === i && (
                <span className="admin-mark" title="Room admin">
                  ★
                </span>
              )}
              {i === you && <em> (you)</em>}
              {i === you && room.settings.rename && <Rename name={s.name} send={send} />}
              {s.bot && <em> · bot</em>}
              {!s.connected && <em> · disconnected</em>}
              {room.games > 0 && (
                <>
                  {" "}
                  <Wins n={s.wins} />
                </>
              )}
            </span>
            {i !== room.admin &&
              (s.ready ? (
                <span className="ready-mark on" title="Ready to play">
                  <CheckIcon /> ready
                </span>
              ) : (
                <span className="ready-mark">not ready</span>
              ))}
            {isAdmin && i !== you && (
              <button className="btn small" onClick={() => send({ type: "kick", seat: i })}>
                {s.bot ? "Remove" : "Kick"}
              </button>
            )}
          </li>
        ))}
        {empty.map((_, i) => (
          <li key={`e${i}`} className="empty">
            <span className="avatar empty" aria-hidden="true" />
            <span className="grow">Empty seat</span>
            {isAdmin && i === 0 && (
              <button className="btn small" onClick={() => send({ type: "bot" })}>
                Add a bot
              </button>
            )}
          </li>
        ))}
      </ol>
      <WatcherList room={room} me={you} send={send} />
      <p className="admin-note">
        <span className="admin-mark">★</span> <b>{isAdmin ? "You are" : `${adminName} is`} the room admin.</b> The admin
        starts the game and can fill empty seats with bots. {game.adminNote} Hand the role over any time from the Room
        menu.
      </p>
      <details className="advanced">
        <summary>
          Advanced <small className="muted">room settings, {game.setupSummary(room)}</small>
        </summary>
        {isAdmin && <p className="muted small">Your browser keeps what you pick here for the next room you create.</p>}
        <RoomSettingsPanel room={room} me={you} send={send} />
        <game.Setup room={room} me={you} send={send} />
      </details>

      {you === null ? (
        room.settings.locked ? (
          <p className="muted">
            {adminName} locked this room, so no new seats. You can watch here and once the game starts.
          </p>
        ) : count < room.maxPlayers ? (
          <form
            className="join-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              saveName(name.trim());
              join(room.code, name);
            }}
          >
            <div className="you-row">
              <LookButton code={look} name={name.trim()} onChange={setLook} />
              <label>
                Your name
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoFocus />
              </label>
            </div>
            <button className="btn primary" disabled={!name.trim()}>
              Take a seat
            </button>
          </form>
        ) : (
          <p className="muted">The room is full. You can watch once the game starts.</p>
        )
      ) : isAdmin ? (
        <StartRow room={room} canStart={canStart} send={send} />
      ) : (
        <div className="row">
          <button
            className={`btn big grow ${room.seats[you]?.ready ? "ready" : "primary"}`}
            aria-pressed={room.seats[you]?.ready}
            onClick={() => send({ type: "ready", on: !room.seats[you]?.ready })}
          >
            {room.seats[you]?.ready ? (
              <>
                <CheckIcon /> Ready · waiting for {adminName} to start
              </>
            ) : (
              "I’m ready"
            )}
          </button>
          <button className="btn" onClick={() => send({ type: "leave" })}>
            Leave
          </button>
        </div>
      )}
      {you !== null && (
        <p className="muted small">
          {isAdmin ? "You start when everyone is ready (or before, if you must)." : "The admin starts the game."} Seats
          are drawn at random when the game begins, and nobody new sits down after that.
        </p>
      )}
      {isAdmin && (
        <div className="row room-danger">
          <ConfirmButton
            label="Close room"
            ask="Delete this room for everyone?"
            yes="Close room"
            onConfirm={() => send({ type: "close" })}
          />
        </div>
      )}

      <game.Rules room={room} />
    </main>
  );
}
