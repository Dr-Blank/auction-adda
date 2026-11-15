import { useEffect, useState } from 'react';
import { TOKENS } from '../config.ts';
import type { Card, RoundSummary, Sale, View } from '../generated/index.ts';
import type { Theme } from '../themes/types.ts';
import { reducedMotion } from './derive.ts';
import { TOUCH, useCountUp } from './hooks.ts';
import { play } from './sound.ts';

interface Props {
  s: RoundSummary;
  g: View;
  names: string[];
  theme: Theme;
  onClose: () => void;
}

const STEP = 0.8; // seconds between reveals

/**
 * Round end as a premiere night: flops dim, then the ranked stars are revealed from Hit up to
 * Blockbuster, then each player's films turn into money. Skippable; static with reduced motion.
 */
export function Premiere({ s, g, names, theme, onClose }: Props) {
  const [instant, setInstant] = useState(reducedMotion);
  const [details, setDetails] = useState(false);
  const reveal = s.ranked.slice().reverse(); // Hit first, Blockbuster last
  const flops = theme.suits.map((_, i) => i).filter((i) => !s.ranked.includes(i));
  const payAt = (reveal.length + 1) * STEP;

  useEffect(() => {
    if (instant) return;
    const timers = [
      setTimeout(() => s.ranked.length && play('fanfare'), reveal.length * STEP * 1000),
      setTimeout(() => play('cash'), payAt * 1000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [instant]);

  const delay = (sec: number) => (instant ? undefined : { animationDelay: `${sec}s` });

  return (
    <div className="overlay" onClick={onClose}>
      <div className={`modal premiere ${instant ? 'instant' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Round results">
        <header>
          <small>Premiere night</small>
          <h2>{theme.roundNames[s.round]} results</h2>
        </header>

        <div className="marquee">
          {reveal.map((suit, k) => {
            const rank = s.ranked.indexOf(suit);
            return (
              <div key={suit} className={`billing r${rank}`} style={{ ...delay((k + 1) * STEP), ['--suit' as string]: theme.suits[suit].color }}>
                {theme.renderSuit(suit, rank === 0 ? 72 : 56)}
                <b>{theme.rankLabels[rank]}</b>
                <span>{theme.suits[suit].name}</span>
                <small>
                  {s.counts[suit]} {theme.nouns.cards} · +{TOKENS[rank]}
                </small>
                <em>{theme.money(s.values[suit])} each</em>
              </div>
            );
          })}
          {s.ranked.length === 0 && <p className="muted">Nothing ranked this {theme.nouns.round}.</p>}
        </div>
        {flops.length > 0 && (
          <p className="flops">
            Flops:{' '}
            {flops.map((i) => (
              <span key={i}>
                {theme.suits[i].glyph} {theme.suits[i].name} ({s.counts[i]})
              </span>
            ))}
          </p>
        )}

        <ol className="payouts">
          {s.sold.map((cards, i) => (
            <li key={i} className="payout" style={delay(payAt + i * 0.15)}>
              <span>
                {names[i]}
                {i === g.you && <em> (you)</em>}
              </span>
              <span className="film-groups">
                {bySuit(cards, s.values).map(({ suit, cards: films }) => {
                  const each = s.values[suit];
                  const what = `${films.length} × ${theme.suits[suit].name}`;
                  return (
                    <span
                      key={suit}
                      className={`film-group ${each ? '' : 'worthless'}`}
                      title={each ? `${what} × ${theme.money(each)} = ${theme.money(each * films.length)}` : `${what}: flop, pays nothing`}
                    >
                      <span className="mini-posters">
                        {films.map((c) => (
                          <span key={c.id}>{theme.renderCard(c, 'sm')}</span>
                        ))}
                      </span>
                      <small>{each ? `+${theme.money(each * films.length)}` : 'Flop'}</small>
                    </span>
                  );
                })}
              </span>
              <Earned value={s.payouts[i]} delay={instant ? 0 : (payAt + i * 0.15) * 1000} money={theme.money} />
            </li>
          ))}
        </ol>

        {details && <Details s={s} g={g} names={names} theme={theme} />}

        <div className="row">
          {/* Touch: no autofocus, which would scroll a tall results sheet past the reveal to this button. */}
          <button className="btn primary big grow" onClick={onClose} autoFocus={!matchMedia(TOUCH).matches}>
            {g.over ? 'See final result' : `On to ${theme.roundNames[g.round]}`}
          </button>
          {!instant && (
            <button className="btn" onClick={() => setInstant(true)}>
              Skip
            </button>
          )}
          <button className="btn" onClick={() => setDetails(!details)}>
            {details ? 'Hide' : 'Details'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Earned({ value, delay, money }: { value: number; delay: number; money: (n: number) => string }) {
  const shown = useCountUp(value, { from: 0, delay, duration: 900 });
  return <b className="earned">+{money(shown)}</b>;
}

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** A player's films grouped by star: paying stars first (best first), flops last. */
function bySuit(cards: Card[], values: number[]): { suit: number; cards: Card[] }[] {
  const groups = new Map<number, Card[]>();
  for (const c of cards) groups.set(c.suit, [...(groups.get(c.suit) ?? []), c]);
  return [...groups]
    .map(([suit, cards]) => ({ suit, cards }))
    .sort((x, y) => values[y.suit] - values[x.suit] || x.suit - y.suit);
}

/** The viewer's own round as a ledger: what each film cost and paid back, and what others paid them. */
function YourRound({ s, me, names, theme }: { s: RoundSummary; me: number; names: string[]; theme: Theme }) {
  const sales = s.sales ?? [];
  const bought = sales.filter((x) => x.to === me);
  const sold = sales.filter((x) => x.from === me && x.to !== me);
  const worth = (lot: Sale) => lot.cards.reduce((sum, c) => sum + s.values[c.suit], 0);
  const spent = bought.reduce((sum, x) => sum + x.price, 0);
  const fromPlayers = sold.reduce((sum, x) => sum + x.price, 0);
  const net = s.payouts[me] + fromPlayers - spent;
  const signed = (n: number) => `${n < 0 ? '−' : '+'}${theme.money(Math.abs(n))}`;
  const tone = (n: number) => (n > 0 ? 'gain' : n < 0 ? 'loss' : '');

  const buyers = new Map<number, number>();
  for (const x of sold) buyers.set(x.to, (buyers.get(x.to) ?? 0) + x.price);

  const film = (lot: Sale) => (
    <span className="films">
      {lot.cards.map((c) => (
        <span key={c.id} className="film-name">
          <i className="suit-dot" style={{ ['--suit' as string]: theme.suits[c.suit].color, color: theme.suits[c.suit].ink }} aria-hidden>
            {theme.suits[c.suit].glyph}
          </i>
          {theme.cardTitle(c)}
        </span>
      ))}
    </span>
  );

  return (
    <section className="your-round">
      <h3>Your {theme.nouns.round}</h3>
      <dl className="ledger">
        <div>
          <dt>Paid for {theme.nouns.cards}</dt>
          <dd>{signed(-spent)}</dd>
        </div>
        <div>
          <dt>Your {theme.nouns.cards} earned</dt>
          <dd>{signed(s.payouts[me])}</dd>
        </div>
        <div>
          <dt>Sold to others</dt>
          <dd>{signed(fromPlayers)}</dd>
        </div>
        <div className="net">
          <dt>Net</dt>
          <dd className={tone(net)}>{signed(net)}</dd>
        </div>
      </dl>

      {bought.length > 0 && (
        <div className="scroll-x">
          <table className="results ledger-table">
            <thead>
              <tr>
                <th className="left">You bought</th>
                <th className="left">From</th>
                <th>Paid</th>
                <th>Earned</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {bought.map((lot, k) => (
                <tr key={k}>
                  <td className="left">{film(lot)}</td>
                  <td className="left muted">{lot.price === 0 ? 'Free' : lot.from === me ? 'Bank' : names[lot.from]}</td>
                  <td>{theme.money(lot.price)}</td>
                  <td>{worth(lot) ? theme.money(worth(lot)) : <span className="muted">Flop</span>}</td>
                  <td className={tone(worth(lot) - lot.price)}>{signed(worth(lot) - lot.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sold.length > 0 && (
        <div className="scroll-x">
          <table className="results ledger-table">
            <thead>
              <tr>
                <th className="left">You sold</th>
                <th className="left">To</th>
                <th>You got</th>
                <th>It paid them</th>
              </tr>
            </thead>
            <tbody>
              {sold.map((lot, k) => (
                <tr key={k}>
                  <td className="left">{film(lot)}</td>
                  <td className="left muted">{names[lot.to]}</td>
                  <td className="gain">{theme.money(lot.price)}</td>
                  <td className="muted">{worth(lot) ? theme.money(worth(lot)) : 'Flop'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {buyers.size > 1 && (
            <p className="by-player muted">
              By {theme.nouns.player.toLowerCase()}:{' '}
              {[...buyers].map(([seat, total], k) => (
                <span key={seat}>
                  {k > 0 && ' · '}
                  {names[seat]} {theme.money(total)}
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      {bought.length === 0 && sold.length === 0 && <p className="muted">You did not buy or sell anything this {theme.nouns.round}.</p>}
    </section>
  );
}

function Details({ s, g, names, theme }: Omit<Props, 'onClose'>) {
  return (
    <>
      {g.you !== null && s.sales && <YourRound s={s} me={g.you} names={names} theme={theme} />}
      <h3 className="details-head">Whole table</h3>
      <table className="results">
        <thead>
          <tr>
            <th className="left">{cap(theme.nouns.suit)}</th>
            <th>Played</th>
            <th>Result</th>
            <th>Each {theme.nouns.card} pays</th>
          </tr>
        </thead>
        <tbody>
          {theme.suits.map((suit, i) => {
            const rank = s.ranked.indexOf(i);
            return (
              <tr key={i} className={rank < 0 ? 'flop' : ''}>
                <th className="left">
                  {suit.glyph} {suit.name}
                </th>
                <td>{s.counts[i]}</td>
                <td>{rank < 0 ? '—' : `${theme.rankLabels[rank]} +${TOKENS[rank]}`}</td>
                <td>{s.values[i] ? <b>{theme.money(s.values[i])}</b> : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <table className="results">
        <thead>
          <tr>
            <th className="left">{theme.nouns.player}</th>
            <th>{cap(theme.nouns.cards)}</th>
            <th>Earned</th>
          </tr>
        </thead>
        <tbody>
          {s.sold.map((cards, i) => (
            <tr key={i}>
              <th className="left">
                {names[i]}
                {i === g.you && <em> (you)</em>}
              </th>
              <td>{cards.length}</td>
              <td>
                <b>{theme.money(s.payouts[i])}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
