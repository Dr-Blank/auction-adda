import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ROUNDS } from "../config.ts";
import type {
  Action,
  AuctionType,
  AuctionView,
  Card,
  ClientMsg,
  LogEntry,
  RoomInfo,
  View,
} from "../generated/index.ts";
import type { Theme } from "../themes/types.ts";
import { Avatar } from "./Avatar.tsx";
import { BidBox, BidClock } from "./BidBox.tsx";
import { Brand } from "./Brand.tsx";
import { dealNote, groupLog, hammerOrder, rail, reducedMotion } from "./derive.ts";
import { PHONE, useCountUp, useMedia } from "./hooks.ts";
import { BidTimer, ConfirmButton, RoomCode, RoomSettingsPanel, ShareLink, WatcherList } from "./Lobby.tsx";
import type { RoomState } from "./net.ts";
import { savedAvatar, savedName, saveName } from "./net.ts";
import { Premiere } from "./Premiere.tsx";
import { AuctionTypes, Rules } from "./Rules.tsx";
import { Ruling } from "./Ruling.tsx";
import type { Bubble } from "./Seats.tsx";
import { Seat, Seats } from "./Seats.tsx";
import { Sheet } from "./Sheet.tsx";
import { StarChart } from "./StarChart.tsx";
import { isMuted, play, setMuted } from "./sound.ts";

interface Props {
  state: RoomState;
  send: (m: ClientMsg) => void;
  theme: Theme;
}

const canPair = (double: Card, second: Card) =>
  second.id !== double.id && second.suit === double.suit && second.type !== "double";

const sameLot = (x: AuctionView | null, y: AuctionView | null) =>
  !!x && !!y && x.auctioneer === y.auctioneer && x.kind === y.kind && x.cards[0].id === y.cards[0].id;

/** How far the game is: one ring segment per round, filled once scored; the one being played glows. */
function RoundRing({ done }: { done: number }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  const seg = c / ROUNDS;
  return (
    <svg className="round-ring" viewBox="0 0 22 22" width="22" height="22" aria-hidden="true">
      {Array.from({ length: ROUNDS }, (_, i) => (
        <circle
          key={i}
          cx="11"
          cy="11"
          r={r}
          className={i < done ? "done" : i === done ? "now" : ""}
          strokeDasharray={`${seg - 2.2} ${c}`}
          strokeDashoffset={-i * seg - 1.1}
          transform="rotate(-90 11 11)"
        />
      ))}
    </svg>
  );
}

/** A finished lot, shown on the stage for a moment before the next one. */
interface Moment {
  key: number;
  e: Extract<LogEntry, { t: "sold" | "free" | "shelved" }>;
  /** Sealed auctions: every bid, revealed. */
  bids: number[] | null;
}

export function Table({ state, send, theme }: Props) {
  const g = state.game!;
  const me = g.you;
  const { room } = state;
  const a = g.auction;
  const names = room.seats.map((s) => s.name);
  const who = (i: number) => (i === me ? "You" : names[i]);
  const myMoney = me === null ? 0 : (g.players[me].money ?? 0);
  const act = (action: Action) => send({ type: "action", action });
  const list = (seats: number[]) => seats.map((i) => (i === me ? "you" : names[i])).join(", ");

  // ---- selection in hand ----
  const [sel, setSel] = useState<number | null>(null);
  const [sel2, setSel2] = useState<number | null>(null);
  const myPlay = !g.over && !a && g.turn === me;
  const myOffer = a?.kind === "offer" && a.toAct === me;
  useEffect(() => {
    setSel(null);
    setSel2(null);
  }, [myPlay, myOffer, g.round]);
  const selCard = g.hand.find((c) => c.id === sel) ?? null;
  const selSecond = g.hand.find((c) => c.id === sel2) ?? null;
  const pairing = myPlay && selCard?.type === "double" ? selCard : myOffer ? a!.cards[0] : null;

  function clickCard(c: Card): void {
    if (myPlay) {
      if (selCard?.type === "double" && canPair(selCard, c)) setSel2(sel2 === c.id ? null : c.id);
      else {
        setSel(sel === c.id ? null : c.id);
        setSel2(null);
      }
    } else if (myOffer && canPair(a!.cards[0], c)) {
      setSel(sel === c.id ? null : c.id);
    }
  }

  // ---- "your move" cue ----
  const owing = me !== null && g.pending.includes(me);
  useEffect(() => {
    document.title = owing ? "● Your move — Auction Adda" : "Auction Adda";
    if (owing) play("turn");
    return () => {
      document.title = "Auction Adda";
    };
  }, [owing]);

  // ---- events: speech bubbles, sold moments, sounds ----
  const [bubbles, setBubbles] = useState<(Bubble | null)[]>(() => Array(g.n).fill(null));
  const [moment, setMoment] = useState<Moment | null>(null);
  const seen = useRef(g.logStart + g.log.length);
  const prevAuction = useRef<AuctionView | null>(a);
  const bubbleKey = useRef(0);
  const lastSeen = useRef(JSON.stringify(g.log.at(-1)));
  useEffect(() => {
    const total = g.logStart + g.log.length;
    const last = JSON.stringify(g.log.at(-1));
    // An admin undo rolls the log back and adds one line, so the log can stop growing yet change.
    const rolledBack = total <= seen.current && last !== lastSeen.current;
    const fresh = rolledBack ? g.log.slice(-1) : g.log.slice(Math.max(0, seen.current - g.logStart));
    seen.current = total;
    lastSeen.current = last;
    const before = prevAuction.current;
    prevAuction.current = a;

    const said: [number, string][] = [];
    if (a && before && sameLot(a, before)) {
      a.bidsIn.forEach((x, i) => x && !before.bidsIn[i] && said.push([i, "✉ Sealed"]));
      a.done.forEach((x, i) => x && !before.done[i] && said.push([i, "Done"]));
    }
    let sound: Parameters<typeof play>[0] | null = null;
    let bids: number[] | null = null;
    for (const e of fresh) {
      if (e.t === "bid") {
        said.push([e.p, theme.money(e.amount)]);
        if (e.p !== me) sound ??= "bid";
      } else if (e.t === "pass") {
        said.push([e.p, "Pass"]);
        if (e.p !== me) sound ??= "pass";
      } else if (e.t === "decline") {
        said.push([e.p, "No"]);
      } else if (e.t === "price") {
        said.push([e.p, `${theme.money(e.amount)}?`]);
      } else if (e.t === "sealed") {
        bids = e.bids;
      } else if (e.t === "sold" || e.t === "free" || e.t === "shelved") {
        setMoment({ key: ++bubbleKey.current, e, bids });
        bids = null;
        sound = e.t === "shelved" ? "pass" : "gavel";
      } else if (e.t === "undo") {
        setMoment(null);
        said.push([e.by, "↶ Undo"]);
        sound = "pass";
      }
    }
    if (sound) play(sound);
    if (said.length === 0) return;
    const keys = said.map(() => ++bubbleKey.current);
    setBubbles((old) => {
      const next = old.slice();
      said.forEach(([seat, text], k) => (next[seat] = { text, key: keys[k] }));
      return next;
    });
    const timer = setTimeout(() => setBubbles((old) => old.map((b) => (b && keys.includes(b.key) ? null : b))), 2200);
    return () => clearTimeout(timer);
  }, [g]);

  // ---- round summary overlay ----
  const [seenSummaries, setSeenSummaries] = useState(g.summaries.length);
  useEffect(() => {
    if (g.summaries.length < seenSummaries) setSeenSummaries(g.summaries.length);
  }, [g.summaries.length]);
  const summary = g.summaries.length > seenSummaries ? g.summaries[g.summaries.length - 1] : null;

  // ---- cards dealt at a round start ----
  // Kept out of the hand until the last lot's moment and the results are closed, then they fly in.
  // Marked "new" until the first auction you take part in with a card from your hand is over.
  const [fresh, setFresh] = useState<number[]>([]);
  const [dealing, setDealing] = useState(false);
  const lastHand = useRef({ round: g.round, ids: g.hand.map((c) => c.id) });
  /** A card has left your hand since the deal; the tags go once that auction is over. */
  const handPlayed = useRef(false);
  useEffect(() => {
    const before = lastHand.current;
    const ids = g.hand.map((c) => c.id);
    lastHand.current = { round: g.round, ids };
    if (g.round > before.round) {
      const added = ids.filter((id) => !before.ids.includes(id));
      handPlayed.current = false;
      setFresh(added);
      setDealing(added.length > 0);
      return;
    }
    if (g.round < before.round) {
      setFresh([]);
      setDealing(false);
      return;
    }
    if (ids.length < before.ids.length) handPlayed.current = true;
    if (handPlayed.current && !g.auction) {
      handPlayed.current = false;
      setFresh([]);
    }
  }, [g]);
  const showDeal = dealing && !summary && !moment;
  /** Dealt cards wait off the table while the results are still up. */
  const hand = dealing && !showDeal ? g.hand.filter((c) => !fresh.includes(c.id)) : g.hand;
  const newInHand = hand.filter((c) => fresh.includes(c.id)).length;
  useEffect(() => {
    if (!showDeal) return;
    play("deal");
    const timer = setTimeout(() => setDealing(false), 900 + fresh.length * 90);
    return () => clearTimeout(timer);
  }, [showDeal]);

  // ---- absent players ----
  const anyAway = room.seats.some((s) => !s.connected);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!anyAway) return;
    const timer = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(timer);
  }, [anyAway]);
  const awayFor = (i: number) => {
    const ms = room.seats[i].awayMs;
    return ms === null ? null : ms + (Date.now() - state.receivedAt);
  };
  /** The open-auction clock: when everyone still in becomes done. */
  const bidClock =
    room.bidMsLeft !== null && room.bidMsWindow !== null
      ? { deadline: state.receivedAt + room.bidMsLeft, total: room.bidMsWindow }
      : null;

  // ---- chrome ----
  const [menu, setMenu] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [muted, setMutedState] = useState(isMuted);
  const [inspect, setInspect] = useState<Card | null>(null);
  const shownMoney = useCountUp(myMoney);
  const phone = useMedia(PHONE);
  /** The auction-types sheet: `true` = open, or the type to mark as the one running now. */
  const [types, setTypes] = useState<AuctionType | true | null>(null);
  /** The auction type as a heading. On touch a tap on it (or its ⓘ) opens what every type means. */
  const kindLabel = (t: AuctionType, live: boolean) => (
    <div className="kind-label" title={theme.auctionHints[t]} onClick={() => phone && setTypes(live ? t : true)}>
      <span className="type-icon">{theme.auctionIcons[t]}</span> {theme.auctionLabels[t]}
      <button
        className="info-btn tap-only"
        onClick={() => setTypes(live ? t : true)}
        aria-label={`${theme.auctionLabels[t]}: how auction types work`}
      >
        <i className="i-dot">i</i>
      </button>
    </div>
  );

  const lot = (cards: Card[]) => (
    <>
      {cards.map((c, i) => (
        <span key={c.id}>
          {i > 0 && " + "}
          <span className="lot-name" style={{ borderColor: theme.suits[c.suit].color }}>
            {theme.cardTitle(c)}
          </span>
        </span>
      ))}
    </>
  );

  // ---- stage ----
  function stage(): { body: ReactNode; bar: ReactNode } {
    const nextSeller = hammerOrder(g)[1];
    const next =
      nextSeller === undefined ? null : (
        <span className="next-seller" title="The hammer passes clockwise to the next player who still has cards">
          {" "}
          · Next seller: <b>{who(nextSeller)}</b>
        </span>
      );
    if (g.over)
      return {
        body: (
          <GameOver
            g={g}
            names={names}
            theme={theme}
            isAdmin={me !== null && room.admin === me}
            admin={me !== null ? names[room.admin] : undefined}
            onRematch={() => send({ type: "rematch" })}
            onSetup={() => send({ type: "lobby" })}
          />
        ),
        bar: null,
      };

    if (!a) {
      if (!myPlay)
        return {
          body: (
            <div className="idle">
              <Avatar code={room.seats[g.turn].avatar} name={names[g.turn]} className="big" />
              <div>
                <p className="status">
                  <b>{names[g.turn]}</b> is choosing a {theme.nouns.card} to put up for auction…
                </p>
                {next && <p className="seller">{next}</p>}
              </div>
            </div>
          ),
          bar: null,
        };
      if (!selCard)
        return {
          body: (
            <div className="idle">
              <p className="status your-move big-prompt">
                Your move: pick a {theme.nouns.card} from your hand to auction ↓
              </p>
            </div>
          ),
          bar: null,
        };
      const preview = (
        <div className="lot-row">
          <div className="lot-posters">
            <div key={selCard.id}>{theme.renderCard(selCard, "lg")}</div>
            {selCard.type === "double" &&
              (selSecond ? (
                <div key={selSecond.id}>{theme.renderCard(selSecond, "lg")}</div>
              ) : (
                <div className="slot-empty">+ ?</div>
              ))}
          </div>
          <div className="lot-info">
            {kindLabel((selSecond ?? selCard).type, false)}
            <p className="hint">
              {selCard.type === "double"
                ? `${theme.auctionLabels.double}: pick a second ${theme.suits[selCard.suit].name} ${theme.nouns.card} from your hand to sell both together. Played alone, the others may add one and take the money; if nobody does, you keep it for free.`
                : theme.auctionHints[selCard.type]}
            </p>
          </div>
        </div>
      );
      const bar =
        selCard.type !== "double" ? (
          <button className="btn primary big" onClick={() => act({ type: "play", card: selCard.id })}>
            Auction “{theme.cardTitle(selCard)}”
          </button>
        ) : selSecond ? (
          <button
            className="btn primary big"
            onClick={() => act({ type: "play", card: selCard.id, second: selSecond.id })}
          >
            Auction both · {theme.auctionLabels[selSecond.type]}
          </button>
        ) : (
          <button className="btn primary big" onClick={() => act({ type: "play", card: selCard.id })}>
            Play “{theme.cardTitle(selCard)}” alone
          </button>
        );
      return { body: preview, bar: <div className="act-row">{bar}</div> };
    }

    const kind = a.kind === "offer" ? "double" : a.kind;
    const stops = rail(g);
    const price = (() => {
      if (a.kind === "open" || a.kind === "once") {
        if (a.highBidder === null) return <div className="price muted-price">No bids yet</div>;
        return (
          <div className="price">
            <b key={a.high} className="pop">
              {theme.money(a.high)}
            </b>
            <span>{a.highBidder === me ? "You lead" : `${names[a.highBidder]} leads`}</span>
          </div>
        );
      }
      if (a.kind === "sealed") {
        const k = a.bidsIn.filter(Boolean).length;
        return (
          <div className="price muted-price">
            {k} of {g.n} bids sealed
          </div>
        );
      }
      if (a.kind === "fixed") {
        if (a.price === null)
          return (
            <div className="price muted-price">
              {who(a.auctioneer)} {a.auctioneer === me ? "set" : "is setting"} the price…
            </div>
          );
        return (
          <div className="price">
            <b>{theme.money(a.price)}</b>
            <span>take it or leave it</span>
          </div>
        );
      }
      return (
        <div className="price muted-price">
          Who adds a second {theme.suits[a.cards[0].suit].name} {theme.nouns.card}?
        </div>
      );
    })();

    const body = (
      <div className="lot-row">
        <div className="lot-posters">
          {a.cards.map((c) => (
            <div key={c.id}>{theme.renderCard(c, "lg")}</div>
          ))}
          {a.kind === "offer" && <div className="slot-empty">+ ?</div>}
        </div>
        <div className="lot-info">
          {kindLabel(kind, true)}
          {price}
          <div className="seller">
            🔨 {a.kind === "offer" ? `${who(a.auctioneer)} played it alone` : `Seller: ${who(a.auctioneer)}`}
            {next}
            <span className="hint"> · {theme.auctionHints[kind]}</span>
          </div>
          <ol className={`rail rail-${a.kind}`} aria-label="Order round the table">
            {stops.map((st) => (
              <li key={st.seat} className={`stop ${st.state} ${st.seat === me ? "me" : ""}`}>
                <Avatar code={room.seats[st.seat].avatar} name={names[st.seat]} className="small" />
                <span className="stop-name">
                  {who(st.seat)}
                  {st.seller && " 🔨"}
                </span>
                <span className="stop-state">
                  {st.state === "now"
                    ? a.kind === "fixed" && a.price !== null
                      ? `${theme.money(a.price)}?`
                      : a.kind === "offer"
                        ? "+ ?"
                        : a.kind === "fixed"
                          ? "pricing"
                          : "to bid"
                    : st.state === "lead"
                      ? `${theme.money(st.amount!)} ▲`
                      : st.state === "bid"
                        ? theme.money(st.amount!)
                        : st.state === "passed"
                          ? a.kind === "offer"
                            ? "no"
                            : "pass"
                          : st.state === "done"
                            ? "done"
                            : st.state === "sealed"
                              ? "✉"
                              : a.kind === "sealed"
                                ? "…"
                                : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );

    const waiting = <p className="status">Waiting for {list(g.pending.filter((i) => i !== me))}…</p>;
    let bar: ReactNode = me === null ? null : waiting;

    if (me === null) {
      bar = null;
    } else if (a.kind === "open") {
      const clock = bidClock ? <BidClock {...bidClock} /> : null;
      if (a.highBidder === me) {
        bar = (
          <p className="status">
            You lead with {theme.money(a.high)}. Waiting for {list(g.pending)}… {clock}
          </p>
        );
      } else {
        // A player who cannot outbid still says "done" themselves; the others must not see why.
        const done = a.done[me]
          ? undefined
          : {
              label: a.highBidder === null ? "No bid" : "Done",
              onClick: () => act({ type: "done", seenHigh: a.high }),
              clock,
            };
        bar =
          myMoney > a.high ? (
            <BidBox
              key={a.high}
              min={a.high + 1}
              max={myMoney}
              label="Bid"
              theme={theme}
              onBid={(amount) => act({ type: "bid", amount, seenHigh: a.high })}
              secondary={done}
            >
              {a.done[me] && (
                <p className="hint">
                  You are done: raises do not bring you back. Bid to come back in. Waiting for {list(g.pending)}…{" "}
                  {clock}
                </p>
              )}
            </BidBox>
          ) : (
            <div className="act-row">
              <p className="status">You cannot outbid {theme.money(a.high)}. Only you can see that.</p>
              {done ? (
                <button className="btn big timed" onClick={done.onClick}>
                  {done.label} {clock}
                </button>
              ) : (
                clock
              )}
            </div>
          );
      }
    } else if (a.kind === "once" && a.toAct === me) {
      const pass = { label: "Pass", onClick: () => act({ type: "pass" }) };
      bar =
        myMoney > a.high ? (
          <BidBox
            min={a.high + 1}
            max={myMoney}
            label="Bid"
            theme={theme}
            onBid={(amount) => act({ type: "bid", amount })}
            secondary={pass}
          />
        ) : (
          <div className="act-row">
            <p className="status">You cannot outbid {theme.money(a.high)}. Only you can see that.</p>
            <button className="btn big" onClick={pass.onClick}>
              Pass
            </button>
          </div>
        );
    } else if (a.kind === "sealed") {
      bar =
        a.yourBid === null ? (
          <BidBox min={0} max={myMoney} label="Seal" theme={theme} onBid={(amount) => act({ type: "sealed", amount })}>
            <p className="hint">Seal {theme.money(0)} to pass. You cannot change it once sealed.</p>
          </BidBox>
        ) : (
          <p className="status">
            Your sealed bid: <b>{theme.money(a.yourBid)}</b>. Waiting for {list(g.pending)}…
          </p>
        );
    } else if (a.kind === "fixed" && a.price === null && a.auctioneer === me) {
      bar = (
        <BidBox
          min={0}
          max={myMoney}
          start={Math.min(10, myMoney)}
          label="Set price"
          theme={theme}
          onBid={(amount) => act({ type: "price", amount })}
        >
          <p className="hint">If nobody buys at your price, you pay it to the bank and keep the lot.</p>
        </BidBox>
      );
    } else if (a.kind === "fixed" && a.price !== null && a.toAct === me) {
      bar = (
        <div className="act-row">
          <button className="btn primary big" disabled={myMoney < a.price} onClick={() => act({ type: "accept" })}>
            Buy for {theme.money(a.price)}
          </button>
          <button className="btn big" onClick={() => act({ type: "pass" })}>
            Pass
          </button>
        </div>
      );
    } else if (myOffer) {
      bar = (
        <div className="act-row">
          {selCard ? (
            <button className="btn primary big" onClick={() => act({ type: "add", card: selCard.id })}>
              Add “{theme.cardTitle(selCard)}” · {theme.auctionLabels[selCard.type]}
            </button>
          ) : g.hand.some((c) => canPair(a.cards[0], c)) ? (
            <p className="status your-move">
              Add a second {theme.suits[a.cards[0].suit].name} {theme.nouns.card}? Pick a highlighted one from your
              hand. You become the seller and take the money.
            </p>
          ) : (
            <p className="status">
              You have no {theme.suits[a.cards[0].suit].name} {theme.nouns.card} to add. Only you can see that.
            </p>
          )}
          <button className="btn big" onClick={() => act({ type: "decline" })}>
            Decline
          </button>
        </div>
      );
    }
    return { body, bar };
  }

  const openSeats = room.seats.flatMap((s, i) => (s.open ? [i] : []));
  const { body, bar } = stage();
  const isAdmin = me !== null && room.admin === me;

  // Phones dock the action bar to the bottom edge while you owe a move. Its height varies (bid box,
  // two buttons, a sentence), so measure it: the hand sits right above it and the page ends clear of it.
  const tableEl = useRef<HTMLDivElement>(null);
  const dockEl = useRef<HTMLDivElement>(null);
  const docked = owing && !!bar;
  useLayoutEffect(() => {
    const table = tableEl.current;
    const dock = dockEl.current;
    if (!table) return;
    if (!dock || !docked) {
      table.style.setProperty("--dock", "0px");
      return;
    }
    const measure = () =>
      table.style.setProperty("--dock", `${getComputedStyle(dock).position === "fixed" ? dock.offsetHeight : 0}px`);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(dock);
    addEventListener("resize", measure);
    return () => {
      watch.disconnect();
      removeEventListener("resize", measure);
    };
  }, [docked]);
  const recent = g.log
    .filter((e) => e.t === "sold" || e.t === "free" || e.t === "shelved" || e.t === "round" || e.t === "undo")
    .slice(-4)
    .reverse();

  // Hand grouped by star.
  const groups = theme.suits
    .map((_, suit) => ({ suit, cards: hand.filter((c) => c.suit === suit) }))
    .filter((x) => x.cards.length > 0);

  return (
    <div ref={tableEl} className={`table ${docked ? "acting" : ""}`}>
      <header className="topbar">
        <Brand />
        <span className="round">
          <RoundRing done={g.over ? ROUNDS : g.round} />
          {g.over ? (
            "Final result"
          ) : (
            <>
              <b>{theme.roundNames[g.round]}</b> · {theme.nouns.round} {g.round + 1} of {ROUNDS}
            </>
          )}
        </span>
        <span className="grow" />
        {g.summaries.length > 0 && (
          <button
            className="icon-btn"
            onClick={() => setSeenSummaries(g.summaries.length - 1)}
            title="Last results"
            aria-label="Last results"
          >
            🏆 <span className="lbl">Last results</span>
          </button>
        )}
        <button className="icon-btn" onClick={() => setLogOpen(true)} title="Auction log" aria-label="Auction log">
          ☰ <span className="lbl">Log</span>
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            setMuted(!muted);
            setMutedState(!muted);
          }}
          title={muted ? "Sound off" : "Sound on"}
          aria-label={muted ? "Turn sound on" : "Turn sound off"}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <button
          className="icon-btn"
          onClick={() => setMenu(!menu)}
          aria-expanded={menu}
          title="Room and rules"
          aria-label="Room and rules"
        >
          ? <span className="lbl">Room</span>
        </button>
        {menu && (
          <RoomMenu
            room={room}
            me={me}
            names={names}
            theme={theme}
            send={send}
            over={g.over}
            onClose={() => setMenu(false)}
          />
        )}
      </header>

      {me === null && <Spectator openSeats={openSeats} left={state.left} names={names} send={send} />}
      {me !== null && openSeats.length > 0 && (
        <div className="notice">
          <span>A seat is free. Send this link to whoever takes over:</span>
          <ShareLink code={room.code} />
        </div>
      )}

      <Seats g={g} room={room} theme={theme} bubbles={bubbles} awayFor={awayFor} send={send} />

      <section className={`stage ${owing ? "owing" : ""} ${a ? `stage-${a.kind}` : ""}`}>
        {body}
        {bar && (
          <div ref={dockEl} className={`action-bar ${owing ? "your-turn" : ""}`}>
            {bar}
          </div>
        )}
        {isAdmin && a && !g.over && <Ruling g={g} room={room} theme={theme} send={send} />}
        {isAdmin && room.canUndo && <UndoCall g={g} theme={theme} send={send} />}
        {moment && (
          <SoldMoment
            key={moment.key}
            m={moment}
            names={names}
            me={me}
            theme={theme}
            onUndo={isAdmin && room.canUndo ? () => send({ type: "undo" }) : null}
            onDone={() => setMoment(null)}
          />
        )}
      </section>

      {me !== null && (
        <section className={`hand-panel ${myPlay || myOffer ? "owing" : ""}`}>
          <div className="hand-head">
            <Seat g={g} room={room} theme={theme} bubbles={bubbles} awayFor={awayFor} send={send} i={me} />
            <h2>
              Your hand <small>{hand.length}</small>
            </h2>
            {newInHand > 0 && (
              <span
                className={`dealt-note ${showDeal ? "dealing" : ""}`}
                title={`Dealt at the start of ${theme.roundNames[g.round]}`}
              >
                +{newInHand} new
              </span>
            )}
            {myPlay && !selCard && <span className="your-move">Pick one to auction</span>}
            {myOffer && <span className="your-move">Pick a matching {theme.nouns.card} to add</span>}
            <button
              className="info-btn tap-only"
              onClick={() => setTypes(true)}
              aria-label="What the auction icons mean"
            >
              <i className="i-dot">i</i> <span>Icons</span>
            </button>
            <span className="grow" />
            <span className="money" title="Your money (only you can see it)">
              {theme.money(shownMoney)}
            </span>
          </div>
          <div className="hand">
            {hand.length === 0 && <span className="muted">No {theme.nouns.cards} left. You can still bid.</span>}
            {groups.map(({ suit, cards }) => (
              <div key={suit} className="hand-group" style={{ ["--suit" as string]: theme.suits[suit].color }}>
                <span className="group-label">
                  {theme.suits[suit].glyph} {theme.suits[suit].short} <b>×{cards.length}</b>
                </span>
                <div className="fan">
                  {cards.map((c) => {
                    const eligible = pairing ? canPair(pairing, c) : false;
                    const clickable = myPlay || (myOffer && eligible);
                    const dealt = fresh.indexOf(c.id);
                    const cls = [
                      "hand-card",
                      dealt >= 0 ? "fresh" : "",
                      dealt >= 0 && showDeal ? "deal-in" : "",
                      c.id === sel || c.id === sel2 ? "selected" : "",
                      eligible ? "eligible" : "",
                      pairing && !eligible && c.id !== sel ? "dim" : "",
                      clickable ? "clickable" : "inspectable",
                    ].join(" ");
                    // Not playable now: a tap opens a large view instead (touch has no hover lift).
                    return (
                      <button
                        key={c.id}
                        className={cls}
                        style={dealt >= 0 ? { ["--i" as string]: dealt } : undefined}
                        onClick={() => (clickable ? clickCard(c) : setInspect(c))}
                        aria-label={`${dealt >= 0 ? "New: " : ""}${theme.cardTitle(c)}, ${theme.suits[c.suit].name}, ${theme.auctionLabels[c.type]}${clickable ? "" : " (view)"}`}
                      >
                        {theme.renderCard(c, phone ? "sm" : "md")}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <aside className="side">
        <StarChart g={g} theme={theme} />
        <section className="recent" aria-label="Latest">
          <h2>Latest</h2>
          <ol>
            {recent.map((e, i) => (
              <li key={i} className={`log-${e.t}`}>
                <LogLine e={e} names={names} me={me} theme={theme} lot={lot} />
              </li>
            ))}
          </ol>
          <button className="btn small ghost" onClick={() => setLogOpen(true)}>
            Full log
          </button>
        </section>
      </aside>

      {logOpen && <LogDrawer g={g} names={names} me={me} theme={theme} lot={lot} onClose={() => setLogOpen(false)} />}
      {types && (
        <Sheet title="Auction types" onClose={() => setTypes(null)}>
          <AuctionTypes theme={theme} current={types === true ? null : types} />
        </Sheet>
      )}
      {inspect && <Inspect card={inspect} theme={theme} onClose={() => setInspect(null)} />}
      {/* Results wait for the sold / shelved moment, so the last lot is seen before the round closes. */}
      {summary && !moment && (
        <Premiere s={summary} g={g} names={names} theme={theme} onClose={() => setSeenSummaries(g.summaries.length)} />
      )}
    </div>
  );
}

interface MomentProps {
  m: Moment;
  names: string[];
  me: number | null;
  theme: Theme;
  /** Admin, right after their own call: take it back from the moment itself. */
  onUndo: (() => void) | null;
  onDone: () => void;
}

function SoldMoment({ m, names, me, theme, onUndo, onDone }: MomentProps) {
  const posters = useRef<HTMLDivElement>(null);
  const { e } = m;
  const buyer = e.t === "sold" ? e.to : e.t === "free" ? e.p : null;

  useEffect(() => {
    const still = reducedMotion();
    const timers = [setTimeout(onDone, still ? 1500 : 2000)];
    if (!still && buyer !== null) {
      timers.push(
        setTimeout(() => {
          const el = posters.current;
          const target = document.querySelector(`[data-owned="${buyer}"]`);
          if (!el || !target) return;
          const from = el.getBoundingClientRect();
          const to = target.getBoundingClientRect();
          const dx = to.left + 20 - (from.left + from.width / 2);
          const dy = to.top + to.height / 2 - (from.top + from.height / 2);
          el.animate(
            [
              { transform: "translate(0, 0) scale(1)", opacity: 1 },
              { transform: `translate(${dx}px, ${dy}px) scale(0.12)`, opacity: 0.2 },
            ],
            { duration: 650, easing: "cubic-bezier(.55,0,.7,.2)", fill: "forwards" },
          );
        }, 1150),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, []);

  const who = (i: number) => (i === me ? "You" : names[i]);
  const stamp = e.t === "sold" ? "Sold" : e.t === "free" ? "No bids" : "Shelved";
  const line =
    e.t === "sold"
      ? e.to === e.from
        ? `${who(e.to)} · ${theme.money(e.price)} to the bank`
        : `${who(e.to)} · ${theme.money(e.price)} to ${who(e.from)}`
      : e.t === "free"
        ? `${who(e.p)} ${e.p === me ? "keep" : "keeps"} it free`
        : theme.shelved;
  const by = e.t !== "shelved" && e.by !== undefined ? e.by : null;

  return (
    <div className={`moment moment-${e.t}`} onClick={onDone} role="status">
      <div className="moment-posters" ref={posters}>
        {e.cards.map((c) => (
          <div key={c.id}>{theme.renderCard(c, "md")}</div>
        ))}
        <span className="stamp">{stamp}</span>
      </div>
      <div className="moment-info">
        {e.t === "sold" && <p className="moment-cry">{theme.sold}</p>}
        <p className="moment-line">{line}</p>
        {by !== null && <p className="hint">Called by {who(by)} from voice</p>}
        {by !== null && onUndo && (
          <button
            className="btn small undo-btn"
            onClick={(ev) => {
              ev.stopPropagation();
              onUndo();
            }}
          >
            ↶ Undo call
          </button>
        )}
        {m.bids && (
          <ol className="envelopes">
            {m.bids.map((b, i) => (
              <li
                key={i}
                className={i === buyer && e.t === "sold" ? "won" : ""}
                style={{ animationDelay: `${i * 0.08}s` }}
              >
                <span className="env">{theme.money(b)}</span>
                <small>{who(i)}</small>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function RoomMenu(props: {
  room: RoomInfo;
  me: number | null;
  names: string[];
  theme: Theme;
  send: (m: ClientMsg) => void;
  onClose: () => void;
  over: boolean;
}) {
  const { room, me, names, theme, send, onClose } = props;
  // Only a connected player can take the role.
  const eligible = room.seats.flatMap((s, i) => (i !== me && !s.bot && s.connected ? [i] : []));
  const [picked, setTo] = useState<number | null>(null);
  const to = picked !== null && eligible.includes(picked) ? picked : eligible[0];
  return (
    <div className="menu" role="dialog" aria-label="Room">
      <div className="menu-head">
        <span>
          Room <RoomCode code={room.code} />
        </span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <ShareLink code={room.code} />
      <div className="menu-admin">
        <p>
          <span className="admin-mark">★</span> Admin: <b>{room.admin === me ? "you" : names[room.admin]}</b>
          <br />
          <small className="muted">
            Can end an auction with a result agreed on voice (“Call it from voice” on the stage).
          </small>
        </p>
        {room.admin === me && to !== undefined && (
          <div className="row">
            <select value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label="New admin">
              {eligible.map((i) => (
                <option key={i} value={i}>
                  {names[i]}
                </option>
              ))}
            </select>
            <button className="btn small" onClick={() => send({ type: "admin", seat: to })}>
              Make admin
            </button>
          </div>
        )}
      </div>
      <WatcherList room={room} me={me} send={send} />
      <RoomSettingsPanel room={room} me={me} send={send} />
      <BidTimer room={room} me={me} send={send} />
      {me !== null && !props.over && (
        <div className="menu-danger">
          <ConfirmButton
            label="Leave my seat"
            ask="Leave the game? A bot plays your seat; you can take it back from this browser."
            yes="Leave"
            onConfirm={() => {
              send({ type: "leave" });
              onClose();
            }}
          />
        </div>
      )}
      {room.admin === me && (
        <div className="menu-danger">
          {!props.over && (
            <ConfirmButton
              label="End game now"
              ask="End the game for everyone? The money as it stands decides."
              yes="End game"
              onConfirm={() => {
                send({ type: "end" });
                onClose();
              }}
            />
          )}
          <ConfirmButton
            label="Close room"
            ask="Delete this room for everyone?"
            yes="Close room"
            onConfirm={() => send({ type: "close" })}
          />
        </div>
      )}
      <Rules theme={theme} n={names.length} />
    </div>
  );
}

function LogDrawer(props: {
  g: View;
  names: string[];
  me: number | null;
  theme: Theme;
  lot: (cards: Card[]) => ReactNode;
  onClose: () => void;
}) {
  const { g, names, me, theme, lot, onClose } = props;
  const groups = groupLog(g.log, g.logStart);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="drawer-back" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Auction log">
        <div className="menu-head">
          <h2>Auction log</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <ol className="log">
          {groups.map((grp) => (
            <li key={grp.key} className={`log-${grp.head.t}`}>
              {grp.steps.length > 0 ? (
                <details open={grp.open}>
                  <summary>
                    {grp.open && <span className="live">now</span>}
                    <LogLine e={grp.head} names={names} me={me} theme={theme} lot={lot} />
                  </summary>
                  <ol className="steps">
                    {grp.steps.map((s, k) => (
                      <li key={k} className={`log-${s.t}`}>
                        <LogLine e={s} names={names} me={me} theme={theme} lot={lot} />
                      </li>
                    ))}
                  </ol>
                </details>
              ) : (
                <LogLine e={grp.head} names={names} me={me} theme={theme} lot={lot} />
              )}
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

interface LineProps {
  e: LogEntry;
  names: string[];
  me: number | null;
  theme: Theme;
  lot: (cards: Card[]) => ReactNode;
}

/** One log entry as a sentence. Your own seat reads "You" (with the verb to match), as on the seats. */
function LogLine({ e, names, me, theme, lot }: LineProps) {
  const name = (i: number, lower = false) => (i === me ? (lower ? "you" : "You") : names[i]);
  const n = (i: number, lower = false) => <b className={i === me ? "you" : undefined}>{name(i, lower)}</b>;
  /** `v(seat, 'buys', 'buy')`: third person for others, second person for you. */
  const v = (i: number, they: string, you: string) => (i === me ? you : they);
  const called = (by?: number) => (by === undefined ? null : <em className="called"> (called by {name(by, true)})</em>);
  switch (e.t) {
    case "round":
      return (
        <>
          {theme.roundNames[e.round]} begins. {dealNote(theme, names.length, e.round)} {n(e.first)}{" "}
          {v(e.first, "goes", "go")} first.
        </>
      );
    case "play":
      return (
        <>
          {n(e.p)} {v(e.p, "auctions", "auction")} {lot(e.cards)} · {theme.auctionLabels[e.kind]}
        </>
      );
    case "offer":
      return (
        <>
          {n(e.p)} {v(e.p, "plays", "play")} {lot(e.cards)} alone ({theme.auctionLabels.double})
        </>
      );
    case "bid":
      return (
        <>
          {n(e.p)} {v(e.p, "bids", "bid")} {theme.money(e.amount)}
        </>
      );
    case "pass":
      return (
        <>
          {n(e.p)} {v(e.p, "passes", "pass")}
        </>
      );
    case "decline":
      return (
        <>
          {n(e.p)} {v(e.p, "adds", "add")} nothing
        </>
      );
    case "price":
      return (
        <>
          {n(e.p)} {v(e.p, "sets", "set")} the price at {theme.money(e.amount)}
        </>
      );
    case "sealed":
      return <>Bids revealed: {e.bids.map((b, i) => `${name(i)} ${theme.money(b)}`).join(", ")}</>;
    case "sold":
      return e.to === e.from ? (
        <>
          {n(e.to)} {v(e.to, "keeps", "keep")} {lot(e.cards)}, paying the bank {theme.money(e.price)}
          {called(e.by)}
        </>
      ) : (
        <>
          {n(e.to)} {v(e.to, "buys", "buy")} {lot(e.cards)} from {n(e.from, true)} for {theme.money(e.price)}
          {called(e.by)}
        </>
      );
    case "free":
      return (
        <>
          {n(e.p)} {v(e.p, "takes", "take")} {lot(e.cards)} for free{called(e.by)}
        </>
      );
    case "shelved":
      return (
        <>
          {n(e.p)} {v(e.p, "plays", "play")} {lot(e.cards)}. {theme.shelved}
        </>
      );
    case "undo":
      return (
        <>
          {n(e.by)} {v(e.by, "takes", "take")} back the call on {lot(e.cards)}. The auction is open again.
        </>
      );
    case "skip":
      return (
        <>
          {n(e.p)} {v(e.p, "is", "are")} away; {e.p === me ? "your" : "their"} move was skipped
        </>
      );
    case "score":
      return <>{theme.roundNames[e.round]} is scored.</>;
    case "end":
      return (
        <>
          Game over. {e.winners.map((i) => name(i)).join(" and ")}{" "}
          {e.winners.length > 1 ? "share the win" : v(e.winners[0], "wins", "win")}.
        </>
      );
  }
}

/** Admin: take back the result just called, until anyone moves. */
function UndoCall({ g, theme, send }: { g: View; theme: Theme; send: (m: ClientMsg) => void }) {
  const called = g.log.findLast((e) => e.t === "sold" || e.t === "free");
  const title =
    called && (called.t === "sold" || called.t === "free")
      ? called.cards.map((c) => `“${theme.cardTitle(c)}”`).join(" + ")
      : "the last lot";
  return (
    <div className="undo-call">
      <span>You called {title}. Wrong? Take it back before anyone moves.</span>
      <button className="btn small" onClick={() => send({ type: "undo" })}>
        ↶ Undo call
      </button>
    </div>
  );
}

/** A large view of a hand card that cannot be played right now (touch has no hover lift). */
function Inspect({ card, theme, onClose }: { card: Card; theme: Theme; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  const s = theme.suits[card.suit];
  return (
    <div className="overlay inspect" onClick={onClose} role="dialog" aria-label={theme.cardTitle(card)}>
      <div className="inspect-card" onClick={(e) => e.stopPropagation()}>
        {theme.renderCard(card, "lg")}
        <div className="inspect-info">
          <p className="kind-label">
            <span className="type-icon">{theme.auctionIcons[card.type]}</span> {theme.auctionLabels[card.type]}
          </p>
          <p style={{ color: s.color }}>
            {s.glyph} {s.name} · {s.genre}
          </p>
          <p className="hint">{theme.auctionHints[card.type]}</p>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function GameOver(props: {
  g: View;
  names: string[];
  theme: Theme;
  isAdmin: boolean;
  /** Name of the admin, shown to the other players while they wait for a rematch. */
  admin?: string;
  onRematch: () => void;
  onSetup: () => void;
}) {
  const { g, names, theme } = props;
  const order = g.players.map((p, i) => ({ i, money: p.money ?? 0 })).sort((x, y) => y.money - x.money);
  const end = g.log.findLast((e) => e.t === "end");
  const endedBy = end?.t === "end" ? end.by : undefined;
  return (
    <div className="gameover">
      {endedBy != null && (
        <p className="ended-early">
          {names[endedBy]} ended the game during {theme.roundNames[g.round] ?? `${theme.nouns.round} ${g.round + 1}`}.
          The money as it stood decides; that {theme.nouns.round} was not scored.
        </p>
      )}
      <h2>
        {g.winners.map((i) => names[i]).join(" & ")} {g.winners.length > 1 ? "share the win" : "wins"}!
      </h2>
      <ol>
        {order.map(({ i, money }) => (
          <li key={i} className={g.winners.includes(i) ? "winner" : ""}>
            <span>
              {names[i]}
              {i === g.you && <em> (you)</em>}
            </span>
            <b>{theme.money(money)}</b>
          </li>
        ))}
      </ol>
      {props.isAdmin ? (
        <div className="row gameover-next">
          <button type="button" className="btn primary big" onClick={props.onRematch}>
            Play again
          </button>
          <button
            type="button"
            className="btn big"
            onClick={props.onSetup}
            title="Back to the lobby with the same players: change the theme, cast, clock or players"
          >
            Change setup
          </button>
        </div>
      ) : (
        props.admin && <p className="muted">Waiting for {props.admin} (admin) to start a new game.</p>
      )}
    </div>
  );
}

function Spectator({
  openSeats,
  left,
  names,
  send,
}: {
  openSeats: number[];
  /** The seat this browser left to a bot. */
  left: number | null;
  names: string[];
  send: (m: ClientMsg) => void;
}) {
  const [name, setName] = useState(savedName);
  if (left !== null)
    return (
      <div className="notice">
        <span>You left your seat ({names[left]}); a bot is playing it.</span>
        <button className="btn primary small" onClick={() => send({ type: "back" })}>
          Take my seat back
        </button>
      </div>
    );
  if (openSeats.length === 0)
    return <div className="notice">You are watching this game. Hands and money stay hidden.</div>;
  return (
    <div className="notice">
      <span>A seat is free. Take it over:</span>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="Your name" />
      {openSeats.map((i) => (
        <button
          key={i}
          className="btn primary small"
          disabled={!name.trim()}
          onClick={() => {
            saveName(name.trim());
            send({ type: "claim", seat: i, name, avatar: savedAvatar() });
          }}
        >
          Take {names[i]}’s seat
        </button>
      ))}
    </div>
  );
}
