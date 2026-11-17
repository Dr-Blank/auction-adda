import type { CSSProperties } from "react";
import { DEALS, ROUNDS, SUIT_LIMIT, TOKENS } from "../config.ts";
import type { View } from "../generated/index.ts";
import type { Theme } from "../themes/types.ts";
import { provisionalValues } from "./derive.ts";
import { CardsIcon, CheckIcon } from "./Icons.tsx";
import { Sheet } from "./Sheet.tsx";

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * The whole game on one page: how a round runs, then every round in turn with the cards dealt
 * for this many players, what each finished round paid, how the current one stands, and what
 * carries over from one to the next.
 */
export function Seasons({ g, theme, onClose }: { g: View; theme: Theme; onClose: () => void }) {
  const { card, cards, suit, round } = theme.nouns;
  const deals = DEALS[g.n] ?? [];
  const last = theme.roundNames[ROUNDS - 1];
  return (
    <Sheet title={`The ${round}s`} onClose={onClose}>
      <ol className="season-steps" aria-label={`How a ${round} runs`}>
        <li>
          <b>Deal</b>
          <span>New {cards} for everyone</span>
        </li>
        <li>
          <b>Play</b>
          <span>
            Until one {suit}’s {ordinal(SUIT_LIMIT)} {card}
          </span>
        </li>
        <li>
          <b>Score</b>
          <span>
            Top three {suit}s pay {TOKENS.map((t) => theme.money(t)).join(" / ")} per {card}, plus earlier scores
          </span>
        </li>
      </ol>
      <ol className="seasons">
        {theme.roundNames.map((name, r) => {
          const state = g.over
            ? r <= g.round
              ? "done"
              : "skipped"
            : r < g.round
              ? "done"
              : r === g.round
                ? "now"
                : "ahead";
          const deal = deals[r] ?? 0;
          const sum = g.summaries.find((s) => s.round === r);
          return (
            <li key={name} className={`season ${state}`} aria-current={state === "now" ? "step" : undefined}>
              <span className="season-dot" aria-hidden="true">
                {sum ? <CheckIcon /> : r + 1}
              </span>
              <div className="season-body">
                <h3>
                  {name}
                  {state === "now" && <em className="live">now</em>}
                  {state === "skipped" && <em className="muted"> · not played</em>}
                </h3>
                <p className="season-deal">
                  <CardsIcon />{" "}
                  {r === 0
                    ? `${deal} ${cards} each`
                    : deal > 0
                      ? `+${deal} new ${cards} each`
                      : `No new ${cards}: play what is left in hand`}
                </p>
                {sum ? (
                  <Scored g={g} theme={theme} r={r} />
                ) : state === "now" ? (
                  <Race g={g} theme={theme} />
                ) : (
                  state === "done" && <p className="muted small">Ended early: not scored.</p>
                )}
              </div>
              {r < ROUNDS - 1 && (
                <p className="carry">
                  Carried into {theme.roundNames[r + 1]}: unplayed {cards}, and each {suit}’s scores.
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <p className="season-end">After {last} is scored, the most money wins.</p>
    </Sheet>
  );
}

/** A finished round: the suits that scored, what one card of each paid, and what you were paid. */
function Scored({ g, theme, r }: { g: View; theme: Theme; r: number }) {
  const sum = g.summaries.find((s) => s.round === r);
  if (!sum) return null;
  const mine = g.you !== null ? sum.payouts[g.you] : null;
  return (
    <div className="season-scored">
      <ul>
        {sum.ranked.map((s, k) => (
          <li key={s}>
            <SuitChip theme={theme} s={s} /> <span className="muted">{theme.rankLabels[k]}</span>{" "}
            <b>{theme.money(sum.values[s] ?? 0)}</b> <span className="muted">per {theme.nouns.card}</span>
          </li>
        ))}
      </ul>
      {mine != null && (
        <p className="small">
          The bank paid you <b>{theme.money(mine)}</b>.
        </p>
      )}
    </div>
  );
}

/** The round being played: how close each suit is to ending it, and what one card would pay now. */
function Race({ g, theme }: { g: View; theme: Theme }) {
  const pays = provisionalValues(g);
  const order = g.played.map((n, s) => ({ s, n })).sort((x, y) => y.n - x.n);
  const { cards, card } = theme.nouns;
  return (
    <div className="season-race">
      <p className="race-head muted small">
        <span>{cap(cards)} played</span>
        <span>One {card} pays now</span>
      </p>
      <ul aria-label={`${cap(cards)} played per ${theme.nouns.suit}`}>
        {order.map(({ s, n }) => (
          <li key={s}>
            <SuitChip theme={theme} s={s} />
            <span className="pips" role="img" aria-label={`${n} of ${SUIT_LIMIT} played`}>
              {Array.from({ length: SUIT_LIMIT }, (_, k) => (
                <i key={k} className={k < n ? "on" : ""} style={suitVars(theme, s)} />
              ))}
            </span>
            <b className={pays[s] > 0 ? "" : "muted"}>{pays[s] > 0 ? theme.money(pays[s]) : "–"}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

const suitVars = (theme: Theme, s: number) =>
  ({ ["--suit" as string]: theme.suits[s].color, ["--suit-ink" as string]: theme.suits[s].ink }) as CSSProperties;

function SuitChip({ theme, s }: { theme: Theme; s: number }) {
  return (
    <span className="suit-chip" style={suitVars(theme, s)}>
      {theme.suits[s].glyph} {theme.suits[s].name}
    </span>
  );
}

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
