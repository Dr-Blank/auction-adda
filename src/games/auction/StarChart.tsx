import { useEffect, useRef, useState } from "react";
import { COMPACT, useMedia } from "../../client/hooks.ts";
import { Sheet } from "../../client/Sheet.tsx";
import type { View } from "../../generated/index.ts";
import { SUIT_LIMIT, TOKENS } from "./config.ts";
import { countBySuit, provisionalValues, rankSuits } from "./derive.ts";
import type { Theme } from "./themes/types.ts";

/** How long the reel of a shelved star stays full and flashing after the round closes. */
const SHELVE_MS = 2200;

/**
 * One row per suit: how close it is to ending the round, what a card pays now, past tokens, and how many you hold.
 * On one-column screens it is a strip of five cells pinned to the top edge (numbers and pips only);
 * a tap opens the full rows with every explanation written out.
 */
export function StarChart({ g, theme }: { g: View; theme: Theme }) {
  const values = provisionalValues(g);
  const ranked = rankSuits(g.played);
  const inHand = countBySuit(g.hand);
  const seated = g.you !== null;
  const [history, setHistory] = useState<number | null>(null);
  const compact = useMedia(COMPACT);
  const [sheet, setSheet] = useState(false);

  // The 5th card ends the round and the counts reset at once; keep the full reel on screen for a moment.
  const [shelved, setShelved] = useState<number | null>(null);
  const seen = useRef(g.logStart + g.log.length);
  useEffect(() => {
    const fresh = g.log.slice(Math.max(0, seen.current - g.logStart));
    seen.current = g.logStart + g.log.length;
    const e = fresh.findLast((x) => x.t === "shelved");
    if (e?.t === "shelved") setShelved(e.suit);
  }, [g]);
  // The timer lives apart from the log watcher: later updates must not cancel it, or the flash never clears.
  useEffect(() => {
    if (shelved === null) return;
    const timer = setTimeout(() => setShelved(null), SHELVE_MS);
    return () => clearTimeout(timer);
  }, [shelved]);

  const { card, cards, round, suit: suitNoun } = theme.nouns;
  const Cards = cards.charAt(0).toUpperCase() + cards.slice(1);

  /** Everything the chart knows about one suit. */
  const facts = (suit: number) => {
    const s = theme.suits[suit];
    const isShelved = shelved === suit;
    const count = isShelved ? SUIT_LIMIT : g.played[suit];
    const hot = !isShelved && count === SUIT_LIMIT - 1;
    const rank = ranked.indexOf(suit);
    const past = g.tokens.slice(0, g.round).map((row, r) => ({ r, v: row[suit] }));
    const earned = past.filter((h) => h.v > 0);
    const pastText = past.length
      ? past.map((h) => `${theme.roundNames[h.r]}: ${h.v ? `+${h.v}` : "–"}`).join(" · ")
      : `No ${round} scored yet`;
    const tagTitle = isShelved
      ? `Shelved: the ${SUIT_LIMIT}th ${s.name} ${card} was played, which ends the ${round} at once.\n` +
        `That ${card} is not auctioned, but it still counts toward ${s.name}'s total for the chart.`
      : values[suit]
        ? `What one ${s.name} ${card} would pay if the ${round} ended now` +
          (rank >= 0
            ? `: ${theme.money(TOKENS[rank])} as ${theme.rankLabels[rank]}, plus its scores from earlier ${round}s`
            : "")
        : count
          ? `Flop: ${s.name} is outside the top three this ${round}, so ${cards} bought now would pay nothing`
          : `No ${s.name} ${cards} played this ${round} yet`;
    const tag = isShelved ? "Shelved" : values[suit] ? theme.money(values[suit]) : count ? "flop" : "–";
    return { s, isShelved, count, hot, rank, past, earned, pastText, tagTitle, tag, flat: !values[suit] && !isShelved };
  };

  const reel = (count: number) => (
    <span className="reel" aria-label={`${count} of ${SUIT_LIMIT} ${cards} this ${round}`}>
      {Array.from({ length: SUIT_LIMIT }, (_, i) => (
        <i key={i} className={i < count ? "on" : i === SUIT_LIMIT - 1 ? "last" : ""} />
      ))}
    </span>
  );

  /** The full rows. `expanded` (in the sheet) writes out what hover shows on a desktop. */
  const rows = (expanded: boolean) => (
    <ol className="star-rows">
      {theme.suits.map((_, suit) => {
        const f = facts(suit);
        const { s } = f;
        const open = history === suit;
        return (
          <li
            key={suit}
            className={`star-row ${f.hot ? "hot" : ""} ${f.flat ? "flat" : ""} ${f.isShelved ? "shelving" : ""} ${expanded ? "expanded" : ""}`}
            style={{ ["--suit" as string]: s.color }}
          >
            <span className="face">{theme.renderSuit(suit, 40)}</span>
            <span className="who">
              <b>{s.name}</b>
              <small>
                {s.glyph} {s.genre}
                {seated && inHand[suit] > 0 && <em className="held"> · {inHand[suit]} in your hand</em>}
              </small>
            </span>
            {reel(f.count)}
            <span className="tag" title={f.tagTitle}>
              {f.tag}
              {!f.isShelved && f.rank >= 0 && <small>{theme.rankLabels[f.rank]}</small>}
            </span>
            {f.past.length > 0 &&
              (expanded ? (
                <span className="trophies">
                  {f.earned.map((h) => (
                    <i key={h.r} className={`t${TOKENS.indexOf(h.v)}`}>
                      {h.v}
                    </i>
                  ))}
                  {f.earned.length === 0 && <i className="none">–</i>}
                </span>
              ) : (
                <button
                  className="trophies"
                  title={f.pastText.replaceAll(" · ", "\n")}
                  aria-expanded={open}
                  aria-label={`${s.name}, past ${round}s: ${f.pastText}`}
                  onClick={() => setHistory(open ? null : suit)}
                >
                  {f.earned.map((h) => (
                    <i key={h.r} className={`t${TOKENS.indexOf(h.v)}`}>
                      {h.v}
                    </i>
                  ))}
                  {f.earned.length === 0 && <i className="none">–</i>}
                </button>
              ))}
            {f.hot && <span className="warn">1 more ends the {round}</span>}
            {expanded && <span className="explain">{f.tagTitle}</span>}
            {(open || expanded) && <span className="past">{f.pastText}</span>}
          </li>
        );
      })}
    </ol>
  );

  const details = sheet && (
    <Sheet title={theme.nouns.chart} onClose={() => setSheet(false)}>
      <dl className="chart-key">
        <div>
          <dt>
            <span className="reel" aria-hidden="true">
              <i className="on" />
              <i className="on" />
              <i />
              <i />
              <i className="last" />
            </span>
          </dt>
          <dd>
            {Cards} of that {suitNoun} played this {round}. The {SUIT_LIMIT}th ends the {round} at once and is not sold.
          </dd>
        </div>
        <div>
          <dt>
            <b className="key-money">{theme.money(TOKENS[0])}</b>
          </dt>
          <dd>
            What one {card} of that {suitNoun} pays if the {round} ended now. The three most-played {suitNoun}s score{" "}
            {TOKENS.map((t) => theme.money(t)).join(" / ")}, plus what the {suitNoun} scored in earlier {round}s. Ties
            go to the {suitNoun} listed first. <b>flop</b> = outside the top three, pays nothing.
          </dd>
        </div>
        {seated && (
          <div>
            <dt>
              <em className="held">hand 2</em>
            </dt>
            <dd>
              {Cards} of that {suitNoun} in your own hand.
            </dd>
          </div>
        )}
      </dl>
      {rows(true)}
    </Sheet>
  );

  if (compact)
    return (
      <section className="star-race strip" aria-label={theme.nouns.chart}>
        <button
          className="chart-strip"
          onClick={() => setSheet(true)}
          aria-haspopup="dialog"
          aria-label={`${theme.nouns.chart}: open details`}
        >
          {theme.suits.map((_, suit) => {
            const f = facts(suit);
            return (
              <span
                key={suit}
                className={`star-cell ${f.hot ? "hot" : ""} ${f.flat ? "flat" : ""} ${f.isShelved ? "shelving" : ""}`}
                style={{ ["--suit" as string]: f.s.color }}
              >
                <span className="cell-who">
                  {theme.renderSuit(suit, 26)}
                  <b>{f.s.short}</b>
                </span>
                {reel(f.count)}
                <span className="cell-tag">{f.tag}</span>
                <span className="cell-held">{seated && inHand[suit] > 0 ? `hand ${inHand[suit]}` : ""}</span>
              </span>
            );
          })}
          <span className="strip-more" aria-hidden="true">
            <i className="i-dot">i</i>
          </span>
        </button>
        {details}
      </section>
    );

  return (
    <section className="star-race" aria-label={theme.nouns.chart}>
      <h2>
        <span className="chart-title">
          {theme.nouns.chart}
          <button
            className="info-btn tap-only"
            onClick={() => setSheet(true)}
            aria-label={`How to read the ${theme.nouns.chart}`}
          >
            <i className="i-dot">i</i>
          </button>
        </span>
        <small>
          {SUIT_LIMIT}th {card} of a {suitNoun} ends the {round}
        </small>
      </h2>
      {rows(false)}
      {details}
    </section>
  );
}
