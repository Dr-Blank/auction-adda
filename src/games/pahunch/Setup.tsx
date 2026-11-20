import { Toggle } from "../../client/Lobby.tsx";
import { saveSettings, saveTimer } from "../../client/net.ts";
import GAMES_JSON from "../../generated/games.json" with { type: "json" };
import type { ClientMsg, RoomInfo } from "../../generated/index.ts";
import type { RoomProps } from "../types.ts";

/** The boards, by index, as the server lists them. */
export const BOARDS: string[] = (GAMES_JSON.variants as Record<string, string[]>).pahunch ?? [];

const FIRST_CHOICES = [0, 15, 20, 30, 45, 60, 90, 120, 180, 300];
const EXTEND_CHOICES = [3, 5, 10, 15, 20, 30, 60];
const secs = (n: number) => (n === 0 ? "No limit" : n < 60 || n % 60 ? `${n} s` : `${n / 60} min`);

/**
 * The vote clock, on the room's clock: a stretch for each vote, topped up after every answer.
 * When it runs out, whoever has not answered says no. Off by default (tables on voice).
 */
export function VoteClock({ room, me, send }: { room: RoomInfo; me: number | null; send: (m: ClientMsg) => void }) {
  const first = room.bidTimerS;
  const extend = room.bidExtendS;
  const set = (seconds: number, ext: number) => {
    saveTimer(seconds, ext, "pahunch");
    send({ type: "timer", seconds, extend: ext });
  };
  const pick = (value: number, choices: number[], onPick: (n: number) => void, label: string) =>
    room.admin === me ? (
      <select value={value} onChange={(e) => onPick(Number(e.target.value))} aria-label={label}>
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
      <h3>Vote clock</h3>
      <label>For each vote {pick(first, FIRST_CHOICES, (n) => set(n, extend), "Vote clock")}</label>
      {first > 0 && (
        <label>
          After an answer, at least {pick(extend, EXTEND_CHOICES, (n) => set(first, n), "Time after an answer")}
        </label>
      )}
      <small className="muted">
        {first === 0
          ? "A vote waits until everyone has answered. Good for tables that talk it out on the call."
          : `Voters have ${secs(first)} to answer. When it runs out, whoever has not answered says no.`}
      </small>
    </div>
  );
}

/**
 * Which board the next game is played on: one the admin picks, or a different one each game.
 * Hidden while there is only one board.
 */
export function BoardPicker({ room, me, send }: RoomProps) {
  if (BOARDS.length < 2) return null;
  const isAdmin = room.admin === me;
  const random = room.variant === null;
  const current = random ? "A different board each game" : (BOARDS[room.variant ?? 0] ?? BOARDS[0] ?? "Classic");
  return (
    <div className="bid-timer">
      <h3>Board</h3>
      {isAdmin && BOARDS.length > 1 ? (
        <label>
          Play on{" "}
          <select
            value={random ? "random" : String(room.variant ?? 0)}
            onChange={(e) =>
              send({ type: "variant", variant: e.target.value === "random" ? null : Number(e.target.value) })
            }
          >
            {BOARDS.map((b, i) => (
              <option key={b} value={i}>
                {b}
              </option>
            ))}
            <option value="random">A different board each game</option>
          </select>
        </label>
      ) : (
        <p>
          <b>{current}</b>
        </p>
      )}
      <small className="muted">
        {BOARDS.length > 1 ? "Every board has its own rooms and ways up." : "More boards are coming."}
      </small>
    </div>
  );
}

/** The game's switches, as the server lists them (id, label, default). */
const OPTIONS = ((GAMES_JSON as { options?: Record<string, { id: string; label: string; default: boolean }[]> }).options
  ?.pahunch ?? []) as { id: string; label: string; default: boolean }[];

/** What each switch does. A switch without a line here is not shown yet. */
const HINTS: Record<string, string> = {
  failEndsTurn:
    "Off: after a vote fails you choose another move, but not a second vote out of that room. On: the turn passes at once.",
};

/** The game's own switches: the admin flips them in the lobby, everyone sees them. */
export function GameOptions({ room, me, send }: RoomProps) {
  const admin = room.admin === me;
  const shown = OPTIONS.filter((o) => HINTS[o.id]);
  if (shown.length === 0) return null;
  const set = (id: string, on: boolean) => {
    const settings = { ...room.settings, gameOptions: { ...room.settings.gameOptions, [id]: on } };
    saveSettings(settings);
    send({ type: "settings", settings });
  };
  return (
    <div className="room-settings">
      <h3>House rules</h3>
      {shown.map((o) => (
        <Toggle
          key={o.id}
          label={o.label}
          hint={HINTS[o.id] ?? ""}
          on={room.settings.gameOptions[o.id] ?? o.default}
          admin={admin}
          onChange={(on) => set(o.id, on)}
        />
      ))}
    </div>
  );
}

/** The lobby's setup for Pahunch: the board, the house rules, then the vote clock. */
export function Setup({ room, me, send }: RoomProps) {
  return (
    <>
      <BoardPicker room={room} me={me} send={send} />
      <GameOptions room={room} me={me} send={send} />
      <VoteClock room={room} me={me} send={send} />
    </>
  );
}
