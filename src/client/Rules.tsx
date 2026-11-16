import { CARD_TABLE, DEALS, ROUNDS, SUIT_LIMIT, TOKENS } from '../config.ts';
import type { AuctionType } from '../generated/index.ts';
import type { Theme } from '../themes/types.ts';

const TYPES: AuctionType[] = ['open', 'once', 'sealed', 'fixed', 'double'];

/** What each auction type means: the icon as printed on the cards, its name, the short form and the full rule. */
export function AuctionTypes({ theme, current }: { theme: Theme; current?: AuctionType | null }) {
  const { card } = theme.nouns;
  return (
    <div className="types">
      <p className="hint">
        The icon on a {card} is how it is auctioned. The winner pays the seller; a seller who wins their own auction pays the bank.
      </p>
      <dl>
        {TYPES.map((t) => (
          <div key={t} className={t === current ? 'current' : ''}>
            <dt>
              <b className="type-chip">{theme.auctionIcons[t]}</b>
              <span>
                <b>
                  {theme.auctionLabels[t]}
                  {t === current && <em className="live">now</em>}
                </b>
                <small>{theme.auctionBriefs[t]}</small>
              </span>
            </dt>
            <dd>{theme.auctionHints[t]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The whole deck and the deal schedule: fixed facts of the game, not what is left in the deck now.
 * `n` = players in this game, marked in the deal table.
 */
export function Deck({ theme, n }: { theme: Theme; n?: number }) {
  const { cards, suit, round } = theme.nouns;
  const sizes = CARD_TABLE.map((row) => TYPES.reduce((sum, t) => sum + row[t], 0));
  const total = sizes.reduce((x, y) => x + y, 0);
  const counts = Object.keys(DEALS).map(Number);
  return (
    <div className="deck-info">
      <p className="hint">
        {total} {cards} in the game. Each {suit} has this many of each auction type:
      </p>
      <div className="scroll-x">
        <table className="results deck-table">
          <thead>
            <tr>
              <th className="left">{cap(suit)}</th>
              {TYPES.map((t) => (
                <th key={t} title={theme.auctionLabels[t]}>
                  <span className="type-icon">{theme.auctionIcons[t]}</span>
                </th>
              ))}
              <th>All</th>
            </tr>
          </thead>
          <tbody>
            {CARD_TABLE.map((row, s) => (
              <tr key={s}>
                <th className="left">
                  <span className="suit-chip" style={{ ['--suit' as string]: theme.suits[s].color, ['--suit-ink' as string]: theme.suits[s].ink }}>
                    {theme.suits[s].glyph} {theme.suits[s].name}
                  </span>
                </th>
                {TYPES.map((t) => (
                  <td key={t}>{row[t]}</td>
                ))}
                <td>
                  <b>{sizes[s]}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        {cap(cards)} dealt to each player at the start of each {round}. Unplayed {cards} carry over; the rest are never dealt.
      </p>
      <div className="scroll-x">
        <table className="results deck-table">
          <thead>
            <tr>
              <th className="left">Players</th>
              {theme.roundNames.map((name) => (
                <th key={name}>{name}</th>
              ))}
              <th>Never dealt</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((k) => (
              <tr key={k} className={k === n ? 'current' : ''}>
                <th className="left">
                  {k}
                  {k === n && <em className="live">this game</em>}
                </th>
                {DEALS[k].map((d, r) => (
                  <td key={r}>{d === 0 ? '—' : r === 0 ? d : `+${d}`}</td>
                ))}
                <td>{total - k * DEALS[k].reduce((x, y) => x + y, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Icons: {TYPES.map((t) => `${theme.auctionIcons[t]} ${theme.auctionLabels[t]}`).join(' · ')}.</p>
    </div>
  );
}

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

export function Rules({ theme, n }: { theme: Theme; n?: number }) {
  const { card, cards, suit, round } = theme.nouns;
  return (
    <>
    <details className="rules">
      <summary>How to play</summary>
      <ul>
        <li>
          On your turn, put one {card} from your hand up for auction. The winner pays <b>you</b>; if you win your own auction, you pay
          the bank.
        </li>
        <li>
          The {round} ends the moment card number {SUIT_LIMIT} of one {suit} is played. That {card} is not sold.
        </li>
        <li>
          The three {suit}s with the most {cards} played that {round} score {TOKENS.map((t) => theme.money(t)).join(' / ')} per {card}{' '}
          ({theme.rankLabels.join(' / ')}). Ties go to the {suit} higher on the chart.
        </li>
        <li>
          The bank then buys every {card} you bought this {round} at its {suit}’s value: this {round}’s score{' '}
          <b>plus that {suit}’s scores from earlier {round}s</b>. A {suit} outside the top three pays nothing, whatever it earned before.
        </li>
        <li>
          {ROUNDS} {round}s. Most {round}s start with new {cards} dealt to everyone (see “The deck and the deal”); unplayed{' '}
          {cards} stay in your hand. Most money at the end wins.
        </li>
      </ul>
      <dl>
        {TYPES.map((t) => (
          <div key={t}>
            <dt>
              <b className="type-icon">{theme.auctionIcons[t]}</b> {theme.auctionLabels[t]}
            </dt>
            <dd>{theme.auctionHints[t]}</dd>
          </div>
        ))}
      </dl>
    </details>
    <details className="rules">
      <summary>The deck and the deal</summary>
      <Deck theme={theme} n={n} />
    </details>
    </>
  );
}
