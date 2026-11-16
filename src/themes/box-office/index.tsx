import type { JSX } from 'react';
import type { Card } from '../../generated/index.ts';
import { rng } from '../../rng.ts';
import type { CardLook, CardSize, Genre, SuitSkin, ThemeDef } from '../types.ts';
import './poster.css';

// All names, titles and taglines here are invented for this game.
// Keep them fictional: no real people, films or studios.
// Genres keep their index (art and portraits go by it): add new ones at the end.

const GENRES: Genre[] = [
  {
    // action: slow-motion explosions, cop logic, loud patriotism
    names: ['Rocket Rathore', 'Toofan Thakur', 'Bijli Bhullar', 'Major Fauladi'],
    labels: ['Action', 'Dhamaka', 'Cop drama'],
    titles: [
      'Inspector Sunglasses', 'Bina Brake Ki Jeep', 'Kaanoon Ka Thappad', 'Vardi On Vacation', 'Flyover Se Free Fall',
      'Ek Tha Hawaldar', 'Goli Se Bhi Tej', 'Chhutti Pe Commando', 'Baarood In My Biscuit', 'Helmet Pehno Villain',
      'Border Pe Bodybuilder', 'Dhamaka Junction', 'Thana Mein Tsunami', 'Siren Ki Kasam', 'Encounter Before Lunch',
      'Jeep Uchhal Gayi',
    ],
    taglines: [
      'Physics resigned on day one.', 'One jeep. Fourteen flips.', 'He doesn’t reload. He glares.',
      'This time it is personal. Again.', 'One man. Zero brakes.',
    ],
    color: '#e2542b', ink: '#fff', glyph: '✸',
  },
  {
    // romance: mustard fields, missed trains, stubborn fathers, modern-desi mix-ups
    names: ['Chahat Chandni', 'Mehek Malhotra', 'Roshni Rai', 'Sonali Sawan'],
    labels: ['Romance', 'Rom-com', 'Love story'],
    titles: [
      'Ishq Wala Wifi', 'Mohabbat EMI Pe', 'Rishta Roaming', 'Baraat Bina Dulha', 'Pyaar Via Bluetooth',
      'Violin In Switzerland', 'Mandap Se U-Turn', 'Train Chhoot Gayi Bro', 'Bauji Maan Jao Please', 'Kundli Crash',
      'Chiffon Mein Chills', 'Sangeet Mein Sabotage', 'Left On Seen At Station', 'Dupatta Dhoka', 'Mehendi Mein Missed Call',
      'Pyaar Pending Hai',
    ],
    taglines: [
      'Two hearts. One stubborn father.', 'Wind machines worked overtime.', 'She missed the train. He bought the station.',
      'Love, on instalments.', 'Two hearts. One bad network.',
    ],
    color: '#e0457b', ink: '#fff', glyph: '♥',
  },
  {
    // mass hero: flying SUVs, optional gravity, interval-block hype
    names: ['Selvam Anna', 'Rudra Raja', 'Kaali Kannan', 'Periya Pandi'],
    labels: ['Mass hero', 'Masala', 'Mass entertainer'],
    titles: [
      'Sumo Flying Squad', 'One Punch, Three Districts', 'Lungi Tornado', 'Villain Ka Visa Cancelled',
      'Interval Mein Toofan', '1000-Watt Thambi', 'Gravity-Free Madurai', 'Moustache Ka Mandate', 'Chashma Catcher',
      'Slow-Motion Samrat', 'Whistle Kingdom', 'Namma Ooru Boss', 'Mass Ka Baap', 'Anna Vandhaachu', 'Dhoti Dynamite',
      'Villain Retired Hurt',
    ],
    taglines: [
      'Sumos fly when he blinks.', 'Interval block lasts 45 minutes.', 'Even the villain clapped.',
      'First day. First show. First row.', 'Even gravity salutes.',
    ],
    color: '#e9a91f', ink: '#2a1a00', glyph: '☀',
  },
  {
    // comedy: middle-class panic, swapped suitcases, angry relatives, sequels to nothing
    names: ['Babloo Bhaiya', 'Pappu Pandey', 'Chintu Chaturvedi', 'Lallan Lal'],
    labels: ['Comedy', 'Family comedy', 'Slapstick'],
    titles: [
      'Shaadi Mein Zaroor Khana', 'Mamaji On Mute', 'Welcome To Bakwaaspur', 'Dhoti Mein Disco', 'Fufaji Naraz Hain',
      'Part 3 (Part 2 Gayab Hai)', 'Dulha Exchange Offer', 'Suitcase Badal Gaya', 'Padosi Ki Bhains', 'Kiraya Maaf Karo',
      'Babloo Ka Startup', 'Chacha Chale Maldives', '404: Logic Not Found', 'Ghar Jamai Got Talent', 'Bijli Ka Bill',
      'Shaadi Mein Load Shedding',
    ],
    taglines: [
      'Three uncles. One suitcase. Zero brain cells.', 'Fufaji is still angry.',
      'A comedy of errors, mostly by the scriptwriter.', 'No uncle was harmed.', 'Family tree. Fully shaken.',
    ],
    color: '#27a88c', ink: '#fff', glyph: '●',
  },
  {
    // art-house: slow, literal, aggressively festival-bound
    names: ['Zoya Mirza', 'Ira Sengupta', 'Meera Kaul', 'Tara Dasgupta'],
    labels: ['Art-house', 'Festival drama', 'Parallel cinema'],
    titles: [
      'A Ceiling Fan in Fog', 'Seven Minutes of Staring', 'Chappal on a Wet Staircase', '4:3 Aspect Ratio of Pain',
      'Waiting for the Autowalla', 'Tea Without Sugar', 'Life Without Plot', 'Silence, Part IV', 'The Unboiled Milk',
      'Whispering to a Brick', 'Do Boond Sannata', 'Ek Khali Kursi', 'Pigeon, Undecided', 'Buffering: A Memoir',
      'The Shadow of a Steel Tumbler', 'Nine Hours in Sepia',
    ],
    taglines: [
      '4 hours. 12 lines of dialogue.', 'Jury cried (from sleep).', 'Nothing happens. In 4:3.', 'Winner, some festival.',
      'Silence, with subtitles.',
    ],
    color: '#6f76e8', ink: '#fff', glyph: '☾',
  },
  {
    // brain rot: vertical video, nine-second plots, the algorithm as co-writer
    names: ['Reel Raju', 'Viral Vicky', 'Sigma Shukla', 'Rizz Rathod', 'Meme Mehra'],
    labels: ['Brain rot', 'Reels cinema', 'Doomscroll'],
    titles: [
      'Skibidi Shaadi', 'Sigma Grindset Returns', 'NPC Ki Prem Kahani', 'Reel Lambi, Story Choti', 'Delulu Is The Solulu',
      'Mewing Mein Mohabbat', 'Aura Minus Hazaar', 'Infinite Scroll', 'Chat, Is This Real?', 'Bhai Ne Bola Karne Ka',
      'Swipe Up For Climax', 'Main Character Syndrome', 'Seen At 2:47 AM', 'Unskippable Ad', 'Low Battery, High Drama',
      'Trending For 4 Minutes',
    ],
    taglines: [
      'Watch at 2x. Understand nothing.', 'Based on a 9-second reel.', 'No plot. Only aura.', 'Like, share, regret.',
      'Your attention span called. It left.',
    ],
    color: '#8cc21a', ink: '#1a2400', glyph: '∞',
  },
];

const PALETTES: [string, string, string][] = [
  ['#3b0d0c', '#e2542b', '#ffd27a'],
  ['#4a0f33', '#e0457b', '#ffd6e4'],
  ['#4a2a05', '#e9a91f', '#fff2c2'],
  ['#073b36', '#27a88c', '#d8fff0'],
  ['#161a4d', '#5b62d6', '#dfe2ff'],
  ['#1d2a05', '#8cc21a', '#f3ffc4'],
];

function Art({ card, genre }: { card: Card; genre: number }): JSX.Element {
  const r = rng(card.id * 97 + 13);
  const [, mid, light] = PALETTES[genre];
  const between = (a: number, b: number) => a + r() * (b - a);
  const shapes: JSX.Element[] = [];

  if (genre === 0) {
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
  } else if (genre === 1) {
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
  } else if (genre === 2) {
    // mass hero: rising sun rays
    const cx = between(45, 75);
    for (let i = 0; i < 11; i++) {
      const a0 = Math.PI + (i / 11) * Math.PI;
      const a1 = a0 + Math.PI / 22;
      const p = (a: number) => `${(cx + Math.cos(a) * 200).toFixed(1)},${(118 + Math.sin(a) * 200).toFixed(1)}`;
      shapes.push(<polygon key={i} points={`${cx},118 ${p(a0)} ${p(a1)}`} fill={light} opacity="0.45" />);
    }
    shapes.push(<circle key="s" cx={cx} cy="118" r={between(24, 32)} fill={light} opacity="0.95" />);
  } else if (genre === 3) {
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
  } else if (genre === 4) {
    // art-house: a moon and quiet lines
    shapes.push(<circle key="m" cx={between(30, 90)} cy={between(45, 75)} r={between(14, 22)} fill={light} opacity="0.9" />);
    for (let i = 0; i < 6; i++) {
      const y = 100 + i * 9 + between(-2, 2);
      shapes.push(<line key={i} x1={between(0, 30)} y1={y} x2={between(80, 120)} y2={y} stroke={light} strokeWidth="1.2" opacity={0.7 - i * 0.08} />);
    }
    shapes.push(<rect key="f" x="8" y="8" width="104" height="152" fill="none" stroke={light} strokeWidth="0.8" opacity="0.5" />);
  } else {
    // brain rot: a stack of tilted phone screens, mid-scroll
    for (let i = 0; i < 4; i++) {
      const x = between(18, 52);
      const y = 18 + i * 30 + between(-6, 6);
      shapes.push(
        <rect
          key={i}
          x={x}
          y={y}
          width="46"
          height="76"
          rx="7"
          transform={`rotate(${between(-14, 14).toFixed(0)} ${x + 23} ${y + 38})`}
          fill={i === 3 ? light : mid}
          stroke={light}
          strokeWidth="1"
          opacity={i === 3 ? 0.9 : 0.35 + i * 0.12}
        />,
      );
    }
  }
  return (
    <svg className="poster-art" viewBox="0 0 120 168" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {shapes}
    </svg>
  );
}

/** Hair and accessories per genre; all drawn on a 48 × 48 grid around a head at (24, 21). */
const STYLES: ((dark: string, light: string) => JSX.Element)[] = [
  // action: spiky crop and aviators
  (dark, light) => (
    <>
      <path d="M14 18 L16 9 L20 13 L23 6 L26 12 L30 7 L32 13 L35 10 L34 19 Z" fill={dark} />
      <rect x="16.5" y="19" width="6.5" height="3.6" rx="1.4" fill={dark} />
      <rect x="25" y="19" width="6.5" height="3.6" rx="1.4" fill={dark} />
      <line x1="23" y1="20" x2="25" y2="20" stroke={dark} strokeWidth="1" />
      <path d="M8 48 L12 36 L24 33 L36 36 L40 48 Z" fill={light} opacity="0.35" />
    </>
  ),
  // romance: long hair and a bindi
  (dark) => (
    <>
      <path d="M12 40 C10 20 14 8 24 8 C34 8 38 20 36 40 L31 40 C33 26 30 18 24 16 C18 18 15 26 17 40 Z" fill={dark} />
      <circle cx="24" cy="17.5" r="1.1" fill="#fff" opacity="0.9" />
    </>
  ),
  // mass hero: thick moustache and a side parting
  (dark) => (
    <>
      <path d="M14 19 C14 10 20 8 25 8 C31 8 34 12 34 19 C31 13 26 12 21 13 C18 14 16 16 14 19 Z" fill={dark} />
      <path d="M18 26 C21 24 23 25 24 26 C25 25 27 24 30 26 C28 28 25 27 24 27 C23 27 20 28 18 26 Z" fill={dark} />
    </>
  ),
  // comedy: round glasses and a tuft
  (dark) => (
    <>
      <path d="M17 12 C19 7 23 9 24 6 C25 9 29 7 31 12 C27 10 21 10 17 12 Z" fill={dark} />
      <circle cx="20" cy="21" r="3.2" fill="none" stroke={dark} strokeWidth="1.2" />
      <circle cx="28" cy="21" r="3.2" fill="none" stroke={dark} strokeWidth="1.2" />
      <line x1="23.2" y1="21" x2="24.8" y2="21" stroke={dark} strokeWidth="1.2" />
    </>
  ),
  // art-house: bob and a beret
  (dark) => (
    <>
      <path d="M14 30 C12 18 16 10 24 10 C32 10 36 18 34 30 L31 30 C32 22 29 16 24 16 C19 16 16 22 17 30 Z" fill={dark} />
      <ellipse cx="22" cy="10" rx="10" ry="3.4" fill={dark} />
      <circle cx="22" cy="6.8" r="1.4" fill={dark} />
    </>
  ),
  // brain rot: messy fringe and big headphones
  (dark, light) => (
    <>
      <path d="M15 17 C14 9 19 7 24 7 C30 7 34 10 33 17 L30 13 L27 16 L24 12 L21 16 L18 13 Z" fill={dark} />
      <path d="M13 22 C13 10 35 10 35 22" fill="none" stroke={dark} strokeWidth="2" />
      <rect x="11" y="19" width="4.5" height="7" rx="2" fill={dark} />
      <rect x="32.5" y="19" width="4.5" height="7" rx="2" fill={dark} />
      <rect x="21" y="36" width="6" height="9" rx="1.2" fill={light} opacity="0.8" />
    </>
  ),
];

export const boxOffice: ThemeDef = {
  id: 'box-office',
  title: 'Box Office',
  tagline: 'Buy films, back the right star, sell them when the season ends.',
  genres: GENRES,
  money: (n) => `₹${n} cr`,
  auctionLabels: { double: 'Double Feature' },
  roundNames: ['Sankranti', 'Summer', 'Eid', 'Diwali'],
  rankLabels: ['All-Time Blockbuster', 'Superhit', 'Semi-Hit'],
  nouns: { card: 'film', cards: 'films', suit: 'star', player: 'Producer', chart: 'Box Office Chart', round: 'season' },
  shelved: 'Overexposed! The 5th film is stuck with the Censor Board forever.',
  renderSuit(s: SuitSkin, px: number) {
    const [dark, mid, light] = PALETTES[s.key];
    const id = `star-bg-${s.key}`;
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
        {STYLES[s.key](dark, light)}
        <circle cx="39" cy="39" r="8" fill={dark} stroke={light} strokeWidth="1.2" />
        <text x="39" y="42.6" textAnchor="middle" fontSize="10" fill={light} fontFamily="system-ui, sans-serif">
          {s.glyph}
        </text>
      </svg>
    );
  },
  renderCard(card: Card, size: CardSize, { suit, title, tagline, theme }: CardLook) {
    const [dark, mid, light] = PALETTES[suit.key];
    return (
      <div
        className={`poster poster-${size}`}
        style={{ background: `linear-gradient(165deg, ${mid} 0%, ${dark} 70%)`, color: light }}
        title={`${title} — ${suit.name} (${suit.genre}) — ${theme.auctionLabels[card.type]}`}
      >
        <Art card={card} genre={suit.key} />
        <div className="poster-type" style={{ background: light, color: dark }}>
          <b>{theme.auctionIcons[card.type]}</b>
          <span>{theme.auctionLabels[card.type]}</span>
        </div>
        <div className="poster-code">{suit.short}</div>
        <div className="poster-foot" style={{ background: `linear-gradient(to top, ${dark} 55%, transparent)` }}>
          <div className="poster-title">{title}</div>
          <div className="poster-tag">{tagline}</div>
          <div className="poster-star">
            {suit.name} <i>· {suit.short}</i>
          </div>
        </div>
      </div>
    );
  },
};
