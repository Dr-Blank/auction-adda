import { saveTimer } from "../../client/net.ts";
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

/** Which board the next game is played on: one the admin picks, or a different one each game. */
export function BoardPicker({ room, me, send }: RoomProps) {
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

/** The lobby's setup for Pahunch: the board, then the vote clock. */
export function Setup({ room, me, send }: RoomProps) {
  return (
    <>
      <BoardPicker room={room} me={me} send={send} />
      <VoteClock room={room} me={me} send={send} />
    </>
  );
}
