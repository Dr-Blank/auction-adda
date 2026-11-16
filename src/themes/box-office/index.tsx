import type { JSX } from 'react';
import type { Card } from '../../generated/index.ts';
import { rng } from '../../rng.ts';
import type { CardSize, Theme } from '../types.ts';
import './poster.css';

// All names, titles and taglines here are invented for this game.
// Keep them fictional: no real people, films or studios.

// One title per card: the suit sizes are 12 / 13 / 14 / 15 / 16.
const TITLES: string[][] = [
  // Rocket Rathore — action: slow-motion explosions, cop logic, loud patriotism
  [
    'Inspector Sunglasses', 'Bina Brake Ki Jeep', 'Kaanoon Ka Thappad', 'Vardi On Vacation', 'Flyover Se Free Fall',
    'Ek Tha Hawaldar', 'Goli Se Bhi Tej', 'Chhutti Pe Commando', 'Baarood In My Biscuit', 'Helmet Pehno Villain',
    'Border Pe Bodybuilder', 'Dhamaka Junction',
  ],
  // Chahat Chandni — romance: mustard fields, missed trains, stubborn fathers, modern-desi mix-ups
  [
    'Ishq Wala Wifi', 'Mohabbat EMI Pe', 'Rishta Roaming', 'Baraat Bina Dulha', 'Pyaar Via Bluetooth',
    'Violin In Switzerland', 'Mandap Se U-Turn', 'Train Chhoot Gayi Bro', 'Bauji Maan Jao Please', 'Kundli Crash',
    'Chiffon Mein Chills', 'Sangeet Mein Sabotage', 'Left On Seen At Station',
  ],
  // Selvam Anna — mass hero: flying SUVs, optional gravity, interval-block hype
  [
    'Sumo Flying Squad', 'One Punch, Three Districts', 'Lungi Tornado', 'Villain Ka Visa Cancelled',
    'Interval Mein Toofan', '1000-Watt Thambi', 'Gravity-Free Madurai', 'Moustache Ka Mandate', 'Chashma Catcher',
    'Slow-Motion Samrat', 'Whistle Kingdom', 'Namma Ooru Boss', 'Mass Ka Baap', 'Anna Vandhaachu',
  ],
  // Babloo Bhaiya — comedy: middle-class panic, swapped suitcases, angry relatives, sequels to nothing
  [
    'Shaadi Mein Zaroor Khana', 'Mamaji On Mute', 'Welcome To Bakwaaspur', 'Dhoti Mein Disco', 'Fufaji Naraz Hain',
    'Part 3 (Part 2 Gayab Hai)', 'Dulha Exchange Offer', 'Suitcase Badal Gaya', 'Padosi Ki Bhains', 'Kiraya Maaf Karo',
    'Babloo Ka Startup', 'Chacha Chale Maldives', '404: Logic Not Found', 'Ghar Jamai Got Talent', 'Bijli Ka Bill',
  ],
  // Zoya Mirza — art-house: slow, literal, aggressively festival-bound
  [
    'A Ceiling Fan in Fog', 'Seven Minutes of Staring', 'Chappal on a Wet Staircase', '4:3 Aspect Ratio of Pain',
    'Waiting for the Autowalla', 'Tea Without Sugar', 'Life Without Plot', 'Silence, Part IV', 'The Unboiled Milk',
    'Whispering to a Brick', 'Do Boond Sannata', 'Ek Khali Kursi', 'Pigeon, Undecided', 'Buffering: A Memoir',
    'The Shadow of a Steel Tumbler', 'Nine Hours in Sepia',
  ],
];

const TAGLINES: string[][] = [
  [
    'Physics resigned on day one.', 'One jeep. Fourteen flips.', 'He doesn’t reload. He glares.',
    'This time it is personal. Again.', 'One man. Zero brakes.',
  ],
  [
    'Two hearts. One stubborn father.', 'Wind machines worked overtime.', 'She missed the train. He bought the station.',
    'Love, on instalments.', 'Two hearts. One bad network.',
  ],
  [
    'Sumos fly when he blinks.', 'Interval block lasts 45 minutes.', 'Even the villain clapped.',
    'First day. First show. First row.', 'Even gravity salutes.',
  ],
  [
    'Three uncles. One suitcase. Zero brain cells.', 'Fufaji is still angry.',
    'A comedy of errors, mostly by the scriptwriter.', 'No uncle was harmed.', 'Family tree. Fully shaken.',
  ],
  [
    '4 hours. 12 lines of dialogue.', 'Jury cried (from sleep).', 'Nothing happens. In 4:3.', 'Winner, some festival.',
    'Silence, with subtitles.',
  ],
];

const PALETTES: [string, string, string][] = [
  ['#3b0d0c', '#e2542b', '#ffd27a'],
  ['#4a0f33', '#e0457b', '#ffd6e4'],
  ['#4a2a05', '#e9a91f', '#fff2c2'],
  ['#073b36', '#27a88c', '#d8fff0'],
  ['#161a4d', '#5b62d6', '#dfe2ff'],
];

function Art({ card }: { card: Card }): JSX.Element {
  const r = rng(card.id * 97 + 13);
  const [, mid, light] = PALETTES[card.suit];
  const between = (a: number, b: number) => a + r() * (b - a);
  const shapes: JSX.Element[] = [];

  if (card.suit === 0) {
    // action: starburst and speed slashes
    const cx = between(40, 80);
    const cy = between(70, 100);
    const pts = Array.from({ length: 18 }, (_, i) => {
      const rad = i % 2 ? between(18, 26) : between(38, 52);
      const ang = (i / 18) * Math.PI * 2;
      return `${(cx + Math.cos(ang) * rad).toFixed(1)},${(cy + Math.sin(ang) * rad).toFixed(1)}`;
    });
    shapes.push(<polygon key="b" points={pts.join(' ')} fill={light} opacity="0.85" />);
    for (let i = 0; i < 4; i++) {
      const y = between(10, 150);
      shapes.push(<line key={i} x1="-10" y1={y + 30} x2="130" y2={y - 30} stroke={mid} strokeWidth={between(2, 7)} opacity="0.55" />);
    }
  } else if (card.suit === 1) {
    // romance: hearts
    for (let i = 0; i < 5; i++) {
      const s = i === 0 ? between(2.2, 2.8) : between(0.5, 1.1);
      const x = i === 0 ? between(45, 75) : between(10, 110);
      const y = i === 0 ? between(72, 92) : between(15, 150);
      shapes.push(
        <path
          key={i}
          transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)}) rotate(${between(-20, 20).toFixed(0)})`}
          d="M0 6 C-14 -6 -6 -16 0 -8 C6 -16 14 -6 0 6 Z"
          fill={i === 0 ? light : mid}
          opacity={i === 0 ? 0.9 : 0.6}
        />,
      );
    }
  } else if (card.suit === 2) {
    // mass hero: rising sun rays
    const cx = between(45, 75);
    for (let i = 0; i < 11; i++) {
      const a0 = Math.PI + (i / 11) * Math.PI;
      const a1 = a0 + Math.PI / 22;
      const p = (a: number) => `${(cx + Math.cos(a) * 200).toFixed(1)},${(118 + Math.sin(a) * 200).toFixed(1)}`;
      shapes.push(<polygon key={i} points={`${cx},118 ${p(a0)} ${p(a1)}`} fill={light} opacity="0.45" />);
    }
    shapes.push(<circle key="s" cx={cx} cy="118" r={between(24, 32)} fill={light} opacity="0.95" />);
  } else if (card.suit === 3) {
    // comedy: confetti bubbles
    for (let i = 0; i < 14; i++) {
      shapes.push(
        <circle
          key={i}
          cx={between(5, 115)}
          cy={between(10, 158)}
          r={between(3, 16)}
          fill={i % 3 ? mid : light}
          opacity={between(0.4, 0.9)}
        />,
      );
    }
  } else {
    // art-house: a moon and quiet lines
    shapes.push(<circle key="m" cx={between(30, 90)} cy={between(45, 75)} r={between(14, 22)} fill={light} opacity="0.9" />);
    for (let i = 0; i < 6; i++) {
      const y = 100 + i * 9 + between(-2, 2);
      shapes.push(<line key={i} x1={between(0, 30)} y1={y} x2={between(80, 120)} y2={y} stroke={light} strokeWidth="1.2" opacity={0.7 - i * 0.08} />);
    }
    shapes.push(<rect key="f" x="8" y="8" width="104" height="152" fill="none" stroke={light} strokeWidth="0.8" opacity="0.5" />);
  }
  return (
    <svg className="poster-art" viewBox="0 0 120 168" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {shapes}
    </svg>
  );
}

/** Hair and accessories per star; all drawn on a 48 × 48 grid around a head at (24, 21). */
const STYLES: ((dark: string, light: string) => JSX.Element)[] = [
  // Rocket Rathore: spiky crop and aviators
  (dark, light) => (
    <>
      <path d="M14 18 L16 9 L20 13 L23 6 L26 12 L30 7 L32 13 L35 10 L34 19 Z" fill={dark} />
      <rect x="16.5" y="19" width="6.5" height="3.6" rx="1.4" fill={dark} />
      <rect x="25" y="19" width="6.5" height="3.6" rx="1.4" fill={dark} />
      <line x1="23" y1="20" x2="25" y2="20" stroke={dark} strokeWidth="1" />
      <path d="M8 48 L12 36 L24 33 L36 36 L40 48 Z" fill={light} opacity="0.35" />
    </>
  ),
  // Chahat Chandni: long hair and a bindi
  (dark) => (
    <>
      <path d="M12 40 C10 20 14 8 24 8 C34 8 38 20 36 40 L31 40 C33 26 30 18 24 16 C18 18 15 26 17 40 Z" fill={dark} />
      <circle cx="24" cy="17.5" r="1.1" fill="#fff" opacity="0.9" />
    </>
  ),
  // Selvam Anna: thick moustache and a side parting
  (dark) => (
    <>
      <path d="M14 19 C14 10 20 8 25 8 C31 8 34 12 34 19 C31 13 26 12 21 13 C18 14 16 16 14 19 Z" fill={dark} />
      <path d="M18 26 C21 24 23 25 24 26 C25 25 27 24 30 26 C28 28 25 27 24 27 C23 27 20 28 18 26 Z" fill={dark} />
    </>
  ),
  // Babloo Bhaiya: round glasses and a tuft
  (dark) => (
    <>
      <path d="M17 12 C19 7 23 9 24 6 C25 9 29 7 31 12 C27 10 21 10 17 12 Z" fill={dark} />
      <circle cx="20" cy="21" r="3.2" fill="none" stroke={dark} strokeWidth="1.2" />
      <circle cx="28" cy="21" r="3.2" fill="none" stroke={dark} strokeWidth="1.2" />
      <line x1="23.2" y1="21" x2="24.8" y2="21" stroke={dark} strokeWidth="1.2" />
    </>
  ),
  // Zoya Mirza: bob and a beret
  (dark) => (
    <>
      <path d="M14 30 C12 18 16 10 24 10 C32 10 36 18 34 30 L31 30 C32 22 29 16 24 16 C19 16 16 22 17 30 Z" fill={dark} />
      <ellipse cx="22" cy="10" rx="10" ry="3.4" fill={dark} />
      <circle cx="22" cy="6.8" r="1.4" fill={dark} />
    </>
  ),
];

export const boxOffice: Theme = {
  id: 'box-office',
  title: 'Box Office',
  tagline: 'Buy films, back the right star, sell them when the season ends.',
  money: (n) => `₹${n} cr`,
  suits: [
    { name: 'Rocket Rathore', short: 'RR', genre: 'Action', color: '#e2542b', ink: '#fff', glyph: '✸' },
    { name: 'Chahat Chandni', short: 'CC', genre: 'Romance', color: '#e0457b', ink: '#fff', glyph: '♥' },
    { name: 'Selvam Anna', short: 'SA', genre: 'Mass hero', color: '#e9a91f', ink: '#2a1a00', glyph: '☀' },
    { name: 'Babloo Bhaiya', short: 'BB', genre: 'Comedy', color: '#27a88c', ink: '#fff', glyph: '●' },
    { name: 'Zoya Mirza', short: 'ZM', genre: 'Art-house', color: '#6f76e8', ink: '#fff', glyph: '☾' },
  ],
  auctionLabels: {
    open: 'Open Auction',
    once: 'Once Around',
    sealed: 'Sealed Bid',
    fixed: 'Fixed Price',
    double: 'Double Feature',
  },
  auctionHints: {
    open: 'Anyone can raise at any time. Done takes you out until you bid again. It sells when everyone else is done or the bid timer runs out.',
    once: 'One bid each, going round the table. The seller bids last.',
    sealed: 'Everyone bids in secret, once. Highest wins; a tie goes to the seller, then clockwise.',
    fixed: 'The seller names a price. First player round the table to accept buys it; if nobody does, the seller pays.',
    double: 'Add a second film of the same star; both sell together using the second film’s auction.',
  },
  auctionBriefs: {
    open: 'Anyone raises, any time',
    once: 'One bid each, in turn',
    sealed: 'One secret bid each',
    fixed: 'Seller names the price',
    double: 'Sells with a second film',
  },
  auctionIcons: { open: '⇈', once: '↻', sealed: '✉', fixed: '=', double: '×2' },
  roundNames: ['Sankranti', 'Summer', 'Eid', 'Diwali'],
  rankLabels: ['All-Time Blockbuster', 'Superhit', 'Semi-Hit'],
  nouns: { card: 'film', cards: 'films', suit: 'star', player: 'Producer', chart: 'Box Office Chart', round: 'season' },
  shelved: 'Overexposed! The 5th film is stuck with the Censor Board forever.',
  sold: 'Ek baar… do baar… teen baar — SOLD!',
  cardTitle: (card) => TITLES[card.suit][card.n % TITLES[card.suit].length],
  renderSuit(suit: number, px: number) {
    const s = boxOffice.suits[suit];
    const [dark, mid, light] = PALETTES[suit];
    const id = `star-bg-${suit}`;
    return (
      <svg className="star-face" width={px} height={px} viewBox="0 0 48 48" role="img" aria-label={s.name}>
        <defs>
          <radialGradient id={id} cx="50%" cy="35%" r="70%">
            <stop offset="0" stopColor={light} />
            <stop offset="0.55" stopColor={mid} />
            <stop offset="1" stopColor={dark} />
          </radialGradient>
        </defs>
        <circle cx="24" cy="24" r="24" fill={`url(#${id})`} />
        <path d="M6 48 C8 38 15 33 24 33 C33 33 40 38 42 48 Z" fill={dark} />
        <rect x="21" y="27" width="6" height="7" rx="2" fill="#c98f6b" />
        <ellipse cx="24" cy="21" rx="8" ry="9.5" fill="#d9a07a" />
        {STYLES[suit](dark, light)}
        <circle cx="39" cy="39" r="8" fill={dark} stroke={light} strokeWidth="1.2" />
        <text x="39" y="42.6" textAnchor="middle" fontSize="10" fill={light} fontFamily="system-ui, sans-serif">
          {s.glyph}
        </text>
      </svg>
    );
  },
  renderCard(card: Card, size: CardSize = 'md') {
    const suit = boxOffice.suits[card.suit];
    const [dark, mid, light] = PALETTES[card.suit];
    const title = boxOffice.cardTitle(card);
    const tag = TAGLINES[card.suit][card.n % TAGLINES[card.suit].length];
    return (
      <div
        className={`poster poster-${size}`}
        style={{ background: `linear-gradient(165deg, ${mid} 0%, ${dark} 70%)`, color: light }}
        title={`${title} — ${suit.name} (${suit.genre}) — ${boxOffice.auctionLabels[card.type]}`}
      >
        <Art card={card} />
        <div className="poster-type" style={{ background: light, color: dark }}>
          <b>{boxOffice.auctionIcons[card.type]}</b>
          <span>{boxOffice.auctionLabels[card.type]}</span>
        </div>
        <div className="poster-code">{suit.short}</div>
        <div className="poster-foot" style={{ background: `linear-gradient(to top, ${dark} 55%, transparent)` }}>
          <div className="poster-title">{title}</div>
          <div className="poster-tag">{tag}</div>
          <div className="poster-star">
            {suit.name} <i>· {suit.short}</i>
          </div>
        </div>
      </div>
    );
  },
};
