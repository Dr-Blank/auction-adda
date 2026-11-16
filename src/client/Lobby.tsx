import { useEffect, useState } from 'react';
import type { ClientMsg, RoomInfo } from '../generated/index.ts';
import type { Theme } from '../themes/types.ts';
import { initials } from './derive.ts';
import { saveName, savedName } from './net.ts';
import type { RoomState } from './net.ts';
import { Rules } from './Rules.tsx';

interface Props {
  state: RoomState;
  send: (m: ClientMsg) => void;
  join: (room: string, name?: string) => void;
  theme: Theme;
}

export function ShareLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/#${code}`;
  return (
    <div className="share">
      <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Room link" />
      <button
        className="btn"
        onClick={() => {
          navigator.clipboard?.writeText(link).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}

const TIMER_CHOICES = [0, 10, 15, 20, 30, 45, 60];

/** The open-auction bid timer: the admin picks it, everyone else sees it. */
export function BidTimer({ room, me, send }: { room: RoomInfo; me: number | null; send: (m: ClientMsg) => void }) {
  const s = room.bidTimerS;
  const label = (n: number) => (n === 0 ? 'Off' : `${n} s`);
  return (
    <div className="bid-timer">
      <label>
        Open-auction timer{' '}
        {room.admin === me ? (
          <select value={s} onChange={(e) => send({ type: 'timer', seconds: Number(e.target.value) })}>
            {[...new Set([...TIMER_CHOICES, s])].sort((x, y) => x - y).map((n) => (
              <option key={n} value={n}>
                {label(n)}
              </option>
            ))}
          </select>
        ) : (
          <b>{label(s)}</b>
        )}
      </label>
      <small className="muted">
        {s === 0
          ? 'Open auctions wait until every bidder says done. Good for tables that call results on voice.'
          : `When a lot goes up, and again after every bid, players still in have ${s} s to bid; then they are done.`}
      </small>
    </div>
  );
}

export function Lobby({ state, send, join, theme }: Props) {
  const { room, you } = state;
  const [name, setName] = useState(savedName);
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
  const adminAway = you !== null && !isAdmin && adminAwayMs !== null && adminAwayMs + (Date.now() - state.receivedAt) >= room.skipAfterMs;

  return (
    <main className="center-card lobby">
      <h1 className="brand">Auction Adda</h1>
      <p className="muted">
        {theme.title} · room <b className="code">{room.code}</b>
      </p>

      <p>Paste this link in Discord. Everyone who opens it lands in this room.</p>
      <ShareLink code={room.code} />

      <h2>
        Players <small>({room.minPlayers}–{room.maxPlayers})</small>
      </h2>
      <ol className="lobby-seats">
        {room.seats.map((s, i) => (
          <li key={i} className={`${s.connected ? '' : 'away'} ${i === you ? 'me' : ''}`}>
            <span className={`avatar ${s.connected ? 'on' : ''}`} title={s.connected ? 'Connected' : 'Disconnected'}>
              {initials(s.name)}
            </span>
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
              <button className="btn small" onClick={() => send({ type: 'kick', seat: i })}>
                {s.bot ? 'Remove' : 'Kick'}
              </button>
            )}
            {adminAway && i === room.admin && (
              <button className="btn small" onClick={() => send({ type: 'admin', seat: you! })}>
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
              <button className="btn small" onClick={() => send({ type: 'bot' })}>
                Add a bot
              </button>
            )}
          </li>
        ))}
      </ol>
      <p className="admin-note">
        <span className="admin-mark">★</span> <b>{isAdmin ? 'You are' : `${adminName} is`} the room admin.</b> The admin starts the game
        and can fill empty seats with bots. Playing on voice? The admin can end an auction with the result the table agreed (and undo a
        wrong call). Hand the role over any time from the Room menu.
      </p>
      <BidTimer room={room} me={you} send={send} />

      {you === null ? (
        count < room.maxPlayers ? (
          <form
            className="join-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              saveName(name.trim());
              join(room.code, name);
            }}
          >
            <label>
              Your name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoFocus />
            </label>
            <button className="btn primary" disabled={!name.trim()}>
              Take a seat
            </button>
          </form>
        ) : (
          <p className="muted">The room is full. You can watch once the game starts.</p>
        )
      ) : (
        <div className="row">
          <button className="btn primary big grow" disabled={!canStart || !isAdmin} onClick={() => send({ type: 'start' })}>
            {!canStart
              ? `Waiting for players (${count}/${room.minPlayers} minimum)`
              : isAdmin
                ? `Start with ${count} players`
                : `Waiting for ${adminName} to start`}
          </button>
          <button className="btn" onClick={() => send({ type: 'leave' })}>
            Leave
          </button>
        </div>
      )}
      {you !== null && <p className="muted small">Only the admin can start. Seats are locked once the game begins.</p>}

      <Rules theme={theme} />
    </main>
  );
}
