import { useEffect, useState } from "react";
import { SUITS } from "../config.ts";
import type { ClientMsg, RoomInfo, RoomSettings, ThemeId } from "../generated/index.ts";
import { castGenres } from "../themes/cast.ts";
import { getDef, THEME_IDS, THEMES } from "../themes/index.ts";
import type { Theme } from "../themes/types.ts";
import { Avatar, LookButton } from "./Avatar.tsx";
import { Brand } from "./Brand.tsx";
import { CheckIcon, CopyIcon, LockIcon } from "./Icons.tsx";
import type { RoomState } from "./net.ts";
import { savedName, saveGenres, saveName, saveSettings, saveTheme, saveTimer, useSavedLook } from "./net.ts";
import { Rules } from "./Rules.tsx";

interface Props {
  state: RoomState;
  send: (m: ClientMsg) => void;
  join: (room: string, name?: string) => void;
  theme: Theme;
}

/** The themes as radio cards. */
export function ThemePicker({ value, onChange }: { value: string; onChange: (id: ThemeId) => void }) {
  return (
    <fieldset>
      <legend>Theme</legend>
      {THEME_IDS.map((id) => (
        <label key={id} className={`theme-pick ${value === id ? "on" : ""}`}>
          <input type="radio" name="theme" checked={value === id} onChange={() => onChange(id)} />
          <span>
            <b>{THEMES[id].title}</b>
            <small>{THEMES[id].tagline}</small>
          </span>
        </label>
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

export function ShareLink({ code }: { code: string }) {
  const link = `${location.origin}/#${code}`;
  const [copied, copy] = useCopy(link);
  return (
    <div className="share">
      <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Room link" />
      <button className="btn" onClick={copy}>
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

/** A room code with a small button that copies just the code. */
export function RoomCode({ code }: { code: string }) {
  const [copied, copy] = useCopy(code);
  return (
    <span className="room-code">
      <b className="code">{code}</b>
      <button
        type="button"
        className={`copy-code ${copied ? "done" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          copy();
        }}
        title={copied ? "Copied" : "Copy room code"}
        aria-label={copied ? "Room code copied" : "Copy room code"}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </span>
  );
}

const FIRST_CHOICES = [0, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600];
const EXTEND_CHOICES = [3, 5, 8, 10, 15, 20, 30, 45, 60, 90, 120];
const secs = (n: number) => (n === 0 ? "No limit" : n < 60 || n % 60 ? `${n} s` : `${n / 60} min`);

/**
 * The open-auction clock: a long first stretch when a lot goes up (so nobody misses it), then a
 * short top-up after each bid. The admin picks both and their browser keeps them for next time.
 */
export function BidTimer({ room, me, send }: { room: RoomInfo; me: number | null; send: (m: ClientMsg) => void }) {
  const first = room.bidTimerS;
  const extend = room.bidExtendS;
  const set = (seconds: number, ext: number) => {
    saveTimer(seconds, ext);
    send({ type: "timer", seconds, extend: ext });
  };
  const pick = (value: number, choices: number[], onPick: (n: number) => void) =>
    room.admin === me ? (
      <select value={value} onChange={(e) => onPick(Number(e.target.value))}>
        {[...new Set([...choices, value])]
          .sort((x, y) => x - y)
          .map((n) => (
            <option key={n} value={n}>
              {secs(n)}
            </option>
          ))}
      </select>
    ) : (
      <b>{secs(value)}</b>
    );
  return (
    <div className="bid-timer">
      <h3>Open-auction clock</h3>
      <label>When a lot goes up {pick(first, FIRST_CHOICES, (n) => set(n, extend))}</label>
      {first > 0 && <label>After a bid, at least {pick(extend, EXTEND_CHOICES, (n) => set(first, n))}</label>}
      <small className="muted">
        {first === 0
          ? "Open auctions wait until every bidder says done. Good for tables that call results on voice."
          : `Players still in have ${secs(first)} once a lot goes up. A bid with less than ${secs(extend)} left tops the clock up to ${secs(extend)}. When it runs out, they are done.`}
      </small>
    </div>
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

/** This game's suits; the admin picks which genres play and can draw new names. */
export function CastPicker({
  room,
  me,
  send,
  theme,
}: {
  room: RoomInfo;
  me: number | null;
  send: (m: ClientMsg) => void;
  theme: Theme;
}) {
  const { genres } = getDef(room.theme);
  const playing = castGenres(genres.length, room.cast);
  // A pick of fewer than SUITS genres stays here until it is complete.
  const [draft, setDraft] = useState<number[] | null>(null);
  const isAdmin = room.admin === me;
  const chosen = draft ?? playing;
  const toggle = (g: number) => {
    const next = chosen.includes(g) ? chosen.filter((x) => x !== g) : [...chosen, g];
    if (next.length === SUITS) {
      setDraft(null);
      saveGenres(room.theme, next);
      send({ type: "cast", genres: next, reroll: false });
    } else if (next.length < SUITS) {
      setDraft(next);
    }
  };
  const { suit } = theme.nouns;
  const suits = `${suit}s`;
  return (
    <section className="cast">
      <h2>This game’s {suits}</h2>
      <ul className="cast-suits">
        {theme.suits.map((s, i) => (
          <li key={s.key}>
            {theme.renderSuit(i, 36)}
            <span>
              <b>{s.name}</b>
              <small>
                {s.glyph} {s.genre}
              </small>
            </span>
          </li>
        ))}
      </ul>
      {isAdmin && (
        <>
          {genres.length > SUITS && (
            <div className="cast-genres" role="group" aria-label={`Pick ${SUITS} ${suits}`}>
              {genres.map((g, i) => (
                <button
                  key={i}
                  className={`chip-btn ${chosen.includes(i) ? "on" : ""}`}
                  aria-pressed={chosen.includes(i)}
                  style={{ ["--suit" as string]: g.color, ["--suit-ink" as string]: g.ink }}
                  onClick={() => toggle(i)}
                >
                  {g.glyph} {g.labels[0]}
                </button>
              ))}
            </div>
          )}
          {draft && (
            <p className="muted small">
              Pick {SUITS - draft.length} more to make {SUITS}.
            </p>
          )}
          <div className="row">
            <button
              className="btn small"
              onClick={() => send({ type: "cast", genres: room.cast.genres, reroll: true })}
            >
              New names
            </button>
            {genres.length > SUITS && (
              <button
                className="btn small"
                onClick={() => {
                  setDraft(null);
                  saveGenres(room.theme, []);
                  send({ type: "cast", genres: [], reroll: true });
                }}
              >
                Random {suits}
              </button>
            )}
          </div>
        </>
      )}
      <p className="muted small">
        {room.cast.genres.length ? `The admin picked these ${suits}.` : `Picked at random from ${genres.length}.`} Every{" "}
        {suit} gets new names each game.
      </p>
    </section>
  );
}

export function Lobby({ state, send, join, theme }: Props) {
  const { room, you } = state;
  const [name, setName] = useState(savedName);
  const [look, setLook] = useSavedLook();
  const count = room.seats.length;
  const canStart = count >= room.minPlayers && count <= room.maxPlayers;
  const empty = Array.from({ length: room.maxPlayers - count });
  const isAdmin = you !== null && room.admin === you;
  const adminName = room.seats[room.admin]?.name;
  // An admin who has been away long enough can be replaced, or nobody could start the game.
  const adminAwayMs = room.seats[room.admin]?.awayMs ?? null;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (adminAwayMs === null) return;
    const timer = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(timer);
  }, [adminAwayMs === null]);
  const adminAway =
    you !== null &&
    !isAdmin &&
    adminAwayMs !== null &&
    adminAwayMs + (Date.now() - state.receivedAt) >= room.skipAfterMs;

  return (
    <main className="center-card lobby">
      <Brand as="h1" />
      <p className="muted">
        {theme.title} · room <RoomCode code={room.code} />
      </p>

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
            {i === you ? (
              <LookButton
                code={s.avatar}
                name={s.name}
                className={s.connected ? "on" : ""}
                onChange={(code) => {
                  setLook(code);
                  send({ type: "avatar", avatar: code });
                }}
              />
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
              {s.bot && <em> · bot</em>}
              {!s.connected && <em> · disconnected</em>}
            </span>
            {isAdmin && i !== you && (
              <button className="btn small" onClick={() => send({ type: "kick", seat: i })}>
                {s.bot ? "Remove" : "Kick"}
              </button>
            )}
            {adminAway && i === room.admin && (
              <button className="btn small" onClick={() => send({ type: "admin", seat: you! })}>
                Become admin
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
        starts the game and can fill empty seats with bots. Playing on voice? The admin can end an auction with the
        result the table agreed (and undo a wrong call). Hand the role over any time from the Room menu.
      </p>
      <details className="advanced">
        <summary>
          Advanced <small className="muted">room settings, clock, {theme.nouns.suit}s and names</small>
        </summary>
        {isAdmin && <p className="muted small">Your browser keeps what you pick here for the next room you create.</p>}
        <RoomSettingsPanel room={room} me={you} send={send} />
        <BidTimer room={room} me={you} send={send} />
        <CastPicker room={room} me={you} send={send} theme={theme} />
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
      ) : (
        <div className="row">
          <button
            className="btn primary big grow"
            disabled={!canStart || !isAdmin}
            onClick={() => send({ type: "start" })}
          >
            {!canStart
              ? `Waiting for players (${count}/${room.minPlayers} minimum)`
              : isAdmin
                ? `Start with ${count} players`
                : `Waiting for ${adminName} to start`}
          </button>
          <button className="btn" onClick={() => send({ type: "leave" })}>
            Leave
          </button>
        </div>
      )}
      {you !== null && <p className="muted small">Only the admin can start. Seats are locked once the game begins.</p>}
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

      <Rules theme={theme} />
    </main>
  );
}
