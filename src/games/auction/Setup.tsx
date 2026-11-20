import { useState } from "react";
import { saveGenres, saveTimer } from "../../client/net.ts";
import type { ClientMsg, RoomInfo } from "../../generated/index.ts";
import type { RoomProps } from "../types.ts";
import { SUITS } from "./config.ts";
import { castGenres } from "./themes/cast.ts";
import { getDef, getTheme } from "./themes/index.ts";
import type { Theme } from "./themes/types.ts";

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

/** The lobby's setup for an auction: the open-auction clock, then the suits. */
export function Setup({ room, me, send }: RoomProps) {
  return (
    <>
      <BidTimer room={room} me={me} send={send} />
      <CastPicker room={room} me={me} send={send} theme={getTheme(room.theme, room.cast)} />
    </>
  );
}
