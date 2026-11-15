import { ROUNDS, SUIT_LIMIT, TOKENS } from '../config.ts';
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

export function Rules({ theme }: { theme: Theme }) {
  const { card, cards, suit, round } = theme.nouns;
  return (
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
          {ROUNDS} {round}s. Unplayed {cards} stay in your hand. Most money at the end wins.
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
  );
}
