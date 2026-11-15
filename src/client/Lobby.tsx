import { useState } from 'react';
import type { ClientMsg } from '../protocol.ts';
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

export function Lobby({ state, send, join, theme }: Props) {
  const { room, you } = state;
  const [name, setName] = useState(savedName);
  const count = room.seats.length;
  const canStart = count >= room.minPlayers && count <= room.maxPlayers;
  const empty = Array.from({ length: room.maxPlayers - count });

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
              {!s.connected && <em> · disconnected</em>}
            </span>
            {you !== null && i !== you && !s.connected && (
              <button className="btn small" onClick={() => send({ type: 'release', seat: i })}>
                Remove
              </button>
            )}
          </li>
        ))}
        {empty.map((_, i) => (
          <li key={`e${i}`} className="empty">
            <span className="avatar empty" aria-hidden="true" />
            <span className="grow">Empty seat</span>
          </li>
        ))}
      </ol>
      <p className="admin-note">
        <span className="admin-mark">★</span> <b>{room.admin === you ? 'You are' : `${room.seats[room.admin]?.name} is`} the room admin.</b>{' '}
        Playing on voice? The admin can end an auction with the result the table agreed (and undo a wrong call). Hand the role over any
        time from the Room menu.
      </p>

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
          <button className="btn primary big grow" disabled={!canStart} onClick={() => send({ type: 'start' })}>
            {canStart ? `Start with ${count} players` : `Waiting for players (${count}/${room.minPlayers} minimum)`}
          </button>
          <button className="btn" onClick={() => send({ type: 'leave' })}>
            Leave
          </button>
        </div>
      )}
      {you !== null && <p className="muted small">Anyone seated can start. Seats are locked once the game begins.</p>}

      <Rules theme={theme} />
    </main>
  );
}
