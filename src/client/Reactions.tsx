import { useEffect, useRef, useState } from "react";
import type { ClientMsg, RoomInfo, RoomSettings } from "../generated/index.ts";
import { SmileIcon } from "./Icons.tsx";
import type { Reaction } from "./net.ts";

/** What the admin can pick from (and anything already in the room's set). */
const CHOICES = [
  "👏",
  "😂",
  "😮",
  "🔥",
  "😬",
  "🙏",
  "🎉",
  "😭",
  "🤔",
  "😎",
  "💸",
  "🤑",
  "🙈",
  "👀",
  "💀",
  "❤️",
  "👍",
  "👎",
  "🤝",
  "😤",
];
const MAX = 8;

/** A button that opens the room's reactions; each tap floats one over your seat for everyone. */
export function ReactBar({ room, send }: { room: RoomInfo; send: (m: ClientMsg) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("pointerdown", away);
    addEventListener("keydown", key);
    return () => {
      removeEventListener("pointerdown", away);
      removeEventListener("keydown", key);
    };
  }, [open]);
  const set = room.settings.reactions;
  if (set.length === 0) return null;
  return (
    <div className="react-bar" ref={box}>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="React: float an emoji over your seat"
        aria-label="React"
      >
        <SmileIcon /> <span className="lbl">React</span>
      </button>
      {open && (
        <div className="react-pop" role="group" aria-label="Reactions">
          {set.map((e) => (
            <button key={e} type="button" className="react-btn" onClick={() => send({ type: "react", emoji: e })}>
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The reactions floating over one seat. */
export function Floats({ reactions, seat }: { reactions: Reaction[]; seat: number }) {
  return (
    <>
      {reactions
        .filter((r) => r.seat === seat)
        .map((r, k) => (
          <span key={r.key} className="reaction" style={{ ["--k" as string]: k % 3 }} aria-hidden="true">
            {r.emoji}
          </span>
        ))}
    </>
  );
}

/** The admin picks the room's reactions (up to eight; none turns them off). */
export function ReactionPicker({
  room,
  admin,
  set,
}: {
  room: RoomInfo;
  admin: boolean;
  set: (patch: Partial<RoomSettings>) => void;
}) {
  const on = room.settings.reactions;
  const toggle = (e: string) => set({ reactions: on.includes(e) ? on.filter((x) => x !== e) : [...on, e] });
  return (
    <div className="reaction-set">
      <span>
        <b>Reactions</b>
        {!admin && <em>: {on.length ? on.join(" ") : "off"}</em>}
      </span>
      <small className="muted">
        {admin
          ? `Players float these over their seat. Pick up to ${MAX}; none turns reactions off.`
          : "Players float these over their seat."}
      </small>
      {admin && (
        <div className="reaction-choices" role="group" aria-label="Reactions on offer">
          {[...new Set([...CHOICES, ...on])].map((e) => (
            <button
              key={e}
              type="button"
              className={`chip-btn ${on.includes(e) ? "on" : ""}`}
              aria-pressed={on.includes(e)}
              disabled={!on.includes(e) && on.length >= MAX}
              onClick={() => toggle(e)}
            >
              {e}
            </button>
          ))}
          {on.length > 0 && (
            <button type="button" className="btn small" onClick={() => set({ reactions: [] })}>
              Turn off
            </button>
          )}
        </div>
      )}
    </div>
  );
}
