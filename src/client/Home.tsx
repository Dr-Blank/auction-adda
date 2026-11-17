import { useEffect, useState } from "react";
import { ROUNDS } from "../config.ts";
import type { ClientMsg, MyRoom, ThemeId } from "../generated/index.ts";
import { getDef, getTheme, THEME_IDS } from "../themes/index.ts";
import { LookButton } from "./Avatar.tsx";
import { Brand } from "./Brand.tsx";
import { RoomCode, ThemePicker } from "./Lobby.tsx";
import { savedName, savedPrefs, savedTheme, saveName, saveTheme, useSavedLook } from "./net.ts";

/** "3 days", "5 h", "12 min", "now": the largest whole unit. */
function span(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "a moment";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"}`;
}

function stageText(r: MyRoom): string {
  if (r.stage.t === "lobby") return "In the lobby";
  if (r.stage.t === "over") return "Game over";
  const theme = getTheme(r.theme);
  return `${theme.roundNames[r.stage.round]} · ${theme.nouns.round} ${r.stage.round + 1} of ${ROUNDS}`;
}

/** Rooms this browser has a seat in, admin rooms first, with when each expires. */
function MyRooms({ rooms }: { rooms: MyRoom[] }) {
  if (rooms.length === 0) return null;
  const ttl = rooms[0].idleMs + rooms[0].expiresInMs;
  return (
    <section className="my-rooms" aria-label="Your rooms">
      <h2>Your rooms</h2>
      <ul>
        {rooms.map((r) => {
          const soon = r.expiresInMs < 24 * 3600 * 1000;
          return (
            <li key={r.code} className="my-room">
              <span className="grow">
                <span className="my-room-head">
                  {r.admin && (
                    <span className="admin-mark" title="You are the admin">
                      ★
                    </span>
                  )}
                  <b>{getDef(r.theme).title}</b>
                  <RoomCode code={r.code} />
                </span>
                <small className="muted">
                  {stageText(r)} · {r.players.map((p, i) => (i === r.seat ? `${p} (you)` : p)).join(", ")}
                </small>
                <small className={soon ? "expiry soon" : "expiry muted"}>
                  Active {span(r.idleMs)} ago · deleted in {span(r.expiresInMs)}
                </small>
              </span>
              <a className="btn small" href={`#${r.code}`}>
                Rejoin
              </a>
            </li>
          );
        })}
      </ul>
      <p className="muted small">
        A room is deleted {span(ttl)} after anything last happened in it. Opening it and playing keeps it.
      </p>
    </section>
  );
}

export function Home({
  send,
  online,
  myRooms,
  listRooms,
}: {
  send: (m: ClientMsg) => void;
  online: boolean;
  myRooms: MyRoom[] | null;
  listRooms: () => void;
}) {
  useEffect(() => {
    if (online) listRooms();
  }, [online, listRooms]);
  const [name, setName] = useState(savedName);
  const [look, setLook] = useSavedLook();
  const [theme, setTheme] = useState<ThemeId>(() => THEME_IDS.find((id) => id === savedTheme()) ?? THEME_IDS[0]);
  const [code, setCode] = useState("");
  const cleanCode = code.trim().toUpperCase();

  return (
    <main className="center-card home">
      <Brand as="h1" />
      <p className="muted">
        An auction card game for 3–5 friends. Everyone joins from their own device; keep the voice chat going.
      </p>

      {myRooms && <MyRooms rooms={myRooms} />}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          saveName(name.trim());
          saveTheme(theme);
          send({ type: "create", theme, name, prefs: savedPrefs(theme), avatar: look });
        }}
      >
        <div className="you-row">
          <LookButton code={look} name={name.trim()} onChange={setLook} className="big" />
          <label>
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              placeholder="e.g. Chintu"
              autoFocus
            />
          </label>
        </div>
        <ThemePicker value={theme} onChange={setTheme} />
        <button className="btn primary big" disabled={!name.trim() || !online}>
          Create a room
        </button>
      </form>

      <form
        className="join-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^[A-Z0-9]{6}$/.test(cleanCode)) location.hash = cleanCode;
        }}
      >
        <label>
          Or join with a room code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            placeholder="ABC234"
            className="code-input"
          />
        </label>
        <button className="btn" disabled={!/^[A-Z0-9]{6}$/.test(cleanCode)}>
          Join
        </button>
      </form>

      <p className="muted">
        <small>
          Free software under the AGPL-3.0. <a href="https://github.com/Dr-Blank/auction-adda">Source code</a>
        </small>
      </p>
    </main>
  );
}
