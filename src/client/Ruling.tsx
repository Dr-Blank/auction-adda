import type React from "react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { ClientMsg, RoomInfo, View } from "../generated/index.ts";
import type { Theme } from "../themes/types.ts";
import { PHONE, useMedia } from "./hooks.ts";
import { Sheet } from "./Sheet.tsx";

interface Props {
  g: View;
  room: RoomInfo;
  theme: Theme;
  send: (m: ClientMsg) => void;
}

const store = {
  get: () => {
    try {
      return localStorage.getItem("aa:voice") === "1";
    } catch {
      return false;
    }
  },
  set: (on: boolean) => {
    try {
      localStorage.setItem("aa:voice", on ? "1" : "0");
    } catch {
      // not remembered
    }
  },
};

/**
 * Room admin only: end the running auction with what the table agreed on voice.
 * Two steps (pick, then confirm). A wrong call can be taken back with "Undo call" until anyone moves.
 */
export function Ruling({ g, room, theme, send }: Props) {
  const a = g.auction!;
  const names = room.seats.map((s, i) => (i === g.you ? "You" : s.name));
  const [open, setOpen] = useState(store.get);
  const suggest = () => a.highBidder ?? a.toAct ?? (a.auctioneer + 1) % g.n;
  const [winner, setWinner] = useState<number | "none">(suggest);
  const [price, setPrice] = useState(String(a.price ?? a.high));
  const [confirm, setConfirm] = useState(false);
  const lotKey = a.cards.map((c) => c.id).join("+");

  // A new lot or a new high bid resets the suggestion.
  useEffect(() => {
    setWinner(suggest());
    setPrice(String(a.price ?? a.high));
    setConfirm(false);
  }, [lotKey, a.high, a.highBidder, a.price, a.toAct]);

  const toggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const on = e.currentTarget.open;
    setOpen(on);
    store.set(on);
  };
  const head = (
    <summary>
      <span aria-hidden="true">🔨</span> Call it from voice <small>admin</small>
    </summary>
  );

  // Phones: one line on the stage that opens the controls in a sheet, so the lot, the hand and the
  // chart keep their room. Wide screens: a fold-out under the action bar.
  const phone = useMedia(PHONE);
  const [sheet, setSheet] = useState(false);
  useEffect(() => setSheet(false), [lotKey]);
  const wrap = (body: ReactNode) =>
    phone ? (
      <>
        <button className="ruling ruling-btn" onClick={() => setSheet(true)} aria-haspopup="dialog">
          <span aria-hidden="true">🔨</span> Call it from voice <small>admin</small>
        </button>
        {sheet && (
          <Sheet title="Call it from voice" onClose={() => setSheet(false)}>
            <div className="ruling-sheet">{body}</div>
          </Sheet>
        )}
      </>
    ) : (
      <details className="ruling" open={open} onToggle={toggle}>
        {head}
        {body}
      </details>
    );

  // A double waiting for a second card: the card would come from a hidden hand, so the only call is "nobody adds".
  if (a.kind === "offer") {
    const sum = `Nobody adds: ${names[a.auctioneer]} ${a.auctioneer === g.you ? "keep" : "keeps"} “${theme.cardTitle(a.cards[0])}” free`;
    return wrap(
      <div className="ruling-row">
        {confirm ? (
          <>
            <span className="ruling-sum">{sum}?</span>
            <button
              className="btn primary"
              onClick={() => {
                send({ type: "rule", winner: null, price: 0 });
                setConfirm(false);
                setSheet(false);
              }}
            >
              Confirm
            </button>
            <button className="btn" onClick={() => setConfirm(false)}>
              Back
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => setConfirm(true)}>
              Nobody adds…
            </button>
            <p className="hint">
              The second card must come from someone’s hand, so it cannot be called. Ask them to add it themselves.
            </p>
          </>
        )}
      </div>,
    );
  }

  const n = Number(price);
  const ok = winner === "none" || (price.trim() !== "" && Number.isInteger(n) && n >= 0);
  const lot = a.cards.map((c) => `“${theme.cardTitle(c)}”`).join(" + ");
  const summary =
    winner === "none"
      ? `No sale: ${names[a.auctioneer]} keeps ${lot} free`
      : `${names[winner]} ${winner === g.you ? "buy" : "buys"} ${lot} for ${theme.money(n)}${winner === a.auctioneer ? " (paid to the bank)" : ""}`;

  return wrap(
    confirm ? (
      <div className="ruling-row">
        <span className="ruling-sum">{summary}?</span>
        <button
          className="btn primary"
          onClick={() => {
            send({ type: "rule", winner: winner === "none" ? null : winner, price: winner === "none" ? 0 : n });
            setConfirm(false);
            setSheet(false);
          }}
        >
          Confirm
        </button>
        <button className="btn" onClick={() => setConfirm(false)}>
          Back
        </button>
      </div>
    ) : (
      <form
        className="ruling-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) setConfirm(true);
        }}
      >
        <label>
          Sold to
          <select
            value={winner}
            onChange={(e) => setWinner(e.target.value === "none" ? "none" : Number(e.target.value))}
          >
            {names.map((name, i) => (
              <option key={i} value={i}>
                {name}
                {i === a.auctioneer ? " (seller)" : ""}
              </option>
            ))}
            <option value="none">Nobody (seller keeps it free)</option>
          </select>
        </label>
        {winner !== "none" && (
          <label>
            for
            <input
              className="ruling-price"
              type="text"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </label>
        )}
        <button className="btn" disabled={!ok}>
          Call it…
        </button>
        <p className="hint">
          Ends this auction now, whatever the buttons say. Everyone sees that you called it. You can undo it until
          anyone moves.
        </p>
      </form>
    ),
  );
}
