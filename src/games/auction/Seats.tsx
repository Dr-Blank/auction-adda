import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "../../client/Avatar.tsx";
import { connectionFact, SeatAwayRow, SeatSheetActions, seatRights } from "../../client/chrome.tsx";
import { COMPACT, TOUCH } from "../../client/hooks.ts";
import { Rename } from "../../client/Lobby.tsx";
import type { Reaction } from "../../client/net.ts";
import { Floats, ReactBar } from "../../client/Reactions.tsx";
import { Sheet } from "../../client/Sheet.tsx";
import type { Card, ClientMsg, RoomInfo, View } from "../../generated/index.ts";
import { aroundTable, countBySuit, doing, hammerOrder, lastWords, purchases } from "./derive.ts";
import type { Theme } from "./themes/types.ts";

export interface Bubble {
  text: string;
  key: number;
}

interface SeatProps {
  g: View;
  room: RoomInfo;
  theme: Theme;
  bubbles: (Bubble | null)[];
  reactions: Reaction[];
  awayFor: (seat: number) => number | null;
  send: (m: ClientMsg) => void;
}

/**
 * The other players, facing you across the table: clockwise from your left, so turn order reads
 * left to right. Your own seat sits by your hand (see `Seat` in Table). Spectators see everyone here.
 */
export function Seats(props: SeatProps) {
  const order = aroundTable(props.g.n, props.g.you);
  const m = order.length;
  return (
    <section className={`seats ${m >= 3 ? "arc" : ""}`} aria-label="Players">
      {order.map((i, k) => (
        <Seat key={i} {...props} i={i} arc={Math.sin((Math.PI * (k + 0.5)) / m)} />
      ))}
    </section>
  );
}

/** One player: who is up, who sells, how many cards they hold and the films they have bought. */
export function Seat({
  g,
  room,
  theme,
  bubbles,
  reactions,
  awayFor,
  send,
  i,
  arc = 1,
}: SeatProps & { i: number; arc?: number }) {
  const me = g.you;
  const a = g.auction;
  const words = lastWords(g);
  const seat = room.seats[i];
  const p = g.players[i];
  const away = awayFor(i);
  const rights = seatRights(room, me, i, away, g.over);
  const [kicking, setKicking] = useState(false);
  const owing = g.pending.includes(i);
  const now = doing(g, i);
  // The hammer: who sells now (or is choosing what to sell), and where it goes after this lot.
  const hammer = hammerOrder(g);
  const holds = hammer[0] === i;
  const sellsNext = hammer.length > 1 && hammer[1] === i;
  const sellsIn = hammer.indexOf(i);
  const w = words[i];
  const out = (a?.kind === "open" && a.done[i]) || w?.t === "pass" || w?.t === "decline";
  const winner = g.over && g.winners.includes(i);
  const name = i === me ? "You" : seat.name;
  const cls = [
    "seat",
    i === me ? "me" : "",
    owing ? "owing" : "",
    seat.connected ? "" : "away",
    out ? "out" : "",
    winner ? "winner" : "",
  ];
  const [info, setInfo] = useState(false);
  const names = room.seats.map((s, k) => (k === me ? "you" : s.name));

  // Everything the seat says through icons and tooltips, as sentences (for the info sheet).
  const { card, cards, round } = theme.nouns;
  const facts: string[] = [];
  if (winner) facts.push(`👑 ${name} won the game.`);
  if (holds)
    facts.push(
      a
        ? `🔨 ${name} ${i === me ? "are" : "is"} selling this lot.`
        : `🔨 ${name} ${i === me ? "are" : "is"} choosing a ${card} to sell.`,
    );
  else if (sellsIn > 0)
    facts.push(
      `🔨 ${name} ${i === me ? "sell" : "sells"} ${sellsIn === 1 ? "next" : `in ${sellsIn} lots`}. The hammer passes clockwise to the next player who still has ${cards}.`,
    );
  if (now) facts.push(`${name} ${i === me ? "owe" : "owes"} a move now (${now}).`);
  else if (out)
    facts.push(
      `${name} ${i === me ? "are" : "is"} out of this auction (${w?.t === "decline" ? "declined" : a?.kind === "open" ? "done" : "passed"}).`,
    );
  if (room.admin === i) facts.push(`★ Room admin: can end an auction with a result agreed on voice.`);
  if (i !== me) facts.push(`${p.handCount} ${p.handCount === 1 ? card : cards} in hand.`);
  facts.push(
    g.over && p.money !== null
      ? `Final money: ${theme.money(p.money)}.`
      : i === me
        ? `Your money: ${theme.money(p.money ?? 0)}. Only you can see it.`
        : `Money stays hidden until the game ends.`,
  );
  facts.push(connectionFact(room, i, name, away, rights));

  return (
    <div
      className={cls.join(" ")}
      data-seat={i}
      style={{ ["--arc" as string]: arc.toFixed(3) }}
      // Touch: the whole seat is the tap target (the avatar button alone is too small a target on a phone).
      onClick={(e) => {
        if ((e.target as Element).closest("button, a, input, select")) return;
        if (matchMedia(`${COMPACT}, ${TOUCH}`).matches) setInfo(true);
      }}
    >
      <div className="avatar-wrap">
        <button
          className="avatar-btn"
          onClick={() => setInfo(true)}
          aria-haspopup="dialog"
          aria-label={`About ${name === "You" ? "your seat" : name}`}
        >
          <Avatar
            code={seat.avatar}
            name={seat.name}
            className={seat.connected ? "on" : ""}
            title={seat.connected ? "Connected" : "Disconnected"}
          />
        </button>
        {holds && (
          <span className="role" title={a ? "Seller" : `Choosing a ${theme.nouns.card} to sell`}>
            🔨
          </span>
        )}
        {winner && (
          <span className="role" title="Winner">
            👑
          </span>
        )}
        {bubbles[i] && (
          <span key={bubbles[i]!.key} className="bubble">
            {bubbles[i]!.text}
          </span>
        )}
        <Floats reactions={reactions} seat={i} />
        {i === me && <ReactBar room={room} send={send} side />}
      </div>
      <div className="seat-body">
        <div className="seat-name">
          {name}
          {room.admin === i && (
            <span className="admin-mark" title="Room admin: can call results agreed on voice">
              ★
            </span>
          )}
          {seat.bot && (
            <span title="A bot plays this seat" aria-label="bot">
              {" "}
              🤖
            </span>
          )}
          {now ? (
            <span className="mark now">{now}</span>
          ) : (
            out && <span className="mark">{w?.t === "decline" ? "no" : a?.kind === "open" ? "done" : "pass"}</span>
          )}
        </div>
        {(sellsNext || (i === me && sellsIn > 1)) && (
          <div className="seat-tag" title="The hammer passes clockwise to the next player who still has cards">
            {i !== me ? "Sells next" : sellsNext ? "You sell next" : `You sell in ${sellsIn} lots`}
          </div>
        )}
        {i !== me && (
          <div className="seat-line">
            <span className="backs" title={`${p.handCount} ${theme.nouns.cards} in hand`}>
              {Array.from({ length: Math.min(p.handCount, 5) }, (_, k) => (
                <i key={k} />
              ))}
              <b>{p.handCount}</b>
            </span>
            {g.over && p.money !== null && <b className="final-money">{theme.money(p.money)}</b>}
          </div>
        )}
        <Owned g={g} seat={i} name={name} names={names} theme={theme} />
        <SeatAwayRow room={room} i={i} owing={owing} rights={rights} send={send} />
      </div>
      {info && (
        <Sheet
          title={
            <>
              <Avatar code={seat.avatar} name={seat.name} className="small" />{" "}
              {i === me ? `You (${seat.name})` : seat.name}
            </>
          }
          label={`About ${name === "You" ? "your seat" : name}`}
          onClose={() => setInfo(false)}
        >
          {i === me && room.settings.rename && (
            <p className="rename-row">
              Your name: <b>{seat.name}</b> <Rename name={seat.name} send={send} />
            </p>
          )}
          <ul className="seat-facts">
            {facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <SeatSheetActions
            room={room}
            me={me}
            i={i}
            owing={owing}
            rights={rights}
            send={send}
            kicking={kicking}
            setKicking={setKicking}
          />
          <h3 className="details-head">
            Bought this {round} · {p.bought.length} {p.bought.length === 1 ? card : cards}
          </h3>
          {p.bought.length === 0 ? (
            <p className="muted">Nothing yet.</p>
          ) : (
            <BoughtList g={g} seat={i} names={names} theme={theme} />
          )}
        </Sheet>
      )}
    </div>
  );
}

/** The films a seat bought this round as posters, each with what was paid and to whom. */
function BoughtList({ g, seat, names, theme }: { g: View; seat: number; names: string[]; theme: Theme }) {
  const paid = purchases(g);
  const how = (c: Card) => {
    const x = paid.get(c.id);
    if (!x) return "";
    const pair = x.lot > 1 ? " for the pair" : "";
    if (x.paid === null) return "free";
    if (x.paid === seat) return `${theme.money(x.price)}${pair} to the bank`;
    return `${theme.money(x.price)}${pair} to ${names[x.paid]}`;
  };
  return (
    <ul className="bought-list">
      {g.players[seat].bought.map((c) => (
        <li key={c.id}>
          {theme.renderCard(c, "sm")}
          <span className="bp-text">
            <b>{theme.cardTitle(c)}</b>
            <small style={{ color: theme.suits[c.suit].color }}>
              {theme.suits[c.suit].glyph} {theme.suits[c.suit].name}
            </small>
            <small>{how(c)}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The films a seat has bought this round, as small stacks of cards by star. Hover, focus or tap
 * opens them out into the actual posters with what was paid.
 */
function Owned({
  g,
  seat,
  name,
  names,
  theme,
}: {
  g: View;
  seat: number;
  name: string;
  names: string[];
  theme: Theme;
}) {
  const cards = g.players[seat].bought;
  const counts = countBySuit(cards);
  const [open, setOpen] = useState<"hover" | "pinned" | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden" });
  // Moving the pointer from the stack to the panel crosses a gap; a short delay keeps it open.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const enter = () => {
    clearTimeout(timer.current);
    setOpen((o) => o ?? "hover");
  };
  const leave = () => {
    timer.current = setTimeout(() => setOpen((o) => (o === "hover" ? null : o)), 160);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  // Place the panel under the stack (or above it near the bottom of the screen), inside the viewport.
  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = pop.current.offsetWidth;
    const h = pop.current.offsetHeight;
    const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
    const below = r.bottom + 8 + h <= innerHeight || r.top < h + 16;
    setPos(below ? { left, top: r.bottom + 8 } : { left, top: r.top - h - 8 });
  }, [open, cards.length]);

  // A pinned panel closes on a tap elsewhere, Escape or scroll.
  useEffect(() => {
    if (open !== "pinned") return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) setOpen(null);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    const close = () => setOpen(null);
    addEventListener("pointerdown", away);
    addEventListener("keydown", key);
    addEventListener("scroll", close, true);
    return () => {
      removeEventListener("pointerdown", away);
      removeEventListener("keydown", key);
      removeEventListener("scroll", close, true);
    };
  }, [open]);

  const empty = cards.length === 0;
  const summary = empty
    ? `${name} ${name === "You" ? "have" : "has"} bought no ${theme.nouns.cards} this ${theme.nouns.round}`
    : `${name} bought ${cards.length} ${cards.length === 1 ? theme.nouns.card : theme.nouns.cards}: ` +
      counts.flatMap((n, s) => (n ? [`${n} ${theme.suits[s].name}`] : [])).join(", ");

  if (empty)
    return (
      <div className="owned" data-owned={seat} aria-label={summary} title={summary}>
        <span className="mini-card empty" aria-hidden="true" />
      </div>
    );

  return (
    <>
      <button
        ref={btn}
        className={`owned ${open ? "open" : ""}`}
        data-owned={seat}
        aria-label={summary}
        aria-expanded={!!open}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={() => setOpen((o) => o ?? "hover")}
        onBlur={(e) => !pop.current?.contains(e.relatedTarget as Node) && setOpen((o) => (o === "hover" ? null : o))}
        onClick={() => setOpen((o) => (o === "pinned" ? null : "pinned"))}
      >
        {counts.map((n, suit) =>
          n ? (
            <span
              key={suit}
              className={`mini-card n${Math.min(n, 3)}`}
              style={{ ["--suit" as string]: theme.suits[suit].color, color: theme.suits[suit].ink }}
            >
              <span className="mc-glyph">{theme.suits[suit].glyph}</span>
              <span className="mc-short">{theme.suits[suit].short}</span>
              {n > 1 && <b className="mc-count">{n}</b>}
            </span>
          ) : null,
        )}
      </button>
      {/* In a portal: a transformed seat would otherwise trap the fixed panel beneath the stage. */}
      {open &&
        createPortal(
          <div
            ref={pop}
            className="bought-pop"
            style={pos}
            role="dialog"
            aria-label={summary}
            onMouseEnter={enter}
            onMouseLeave={leave}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>
              {name} bought{" "}
              <small>
                this {theme.nouns.round} · {cards.length} {cards.length === 1 ? theme.nouns.card : theme.nouns.cards}
              </small>
            </h3>
            <BoughtList g={g} seat={seat} names={names} theme={theme} />
          </div>,
          document.body,
        )}
    </>
  );
}
