import type { JSX } from 'react';
import type { Card } from '../../generated/index.ts';
import { rng } from '../../rng.ts';
import type { CardLook, CardSize, Genre, SuitSkin, ThemeDef } from '../types.ts';
import './poster.css';

// All names, titles and taglines here are invented for this game.
// Keep them fictional: no real people, films or studios.
// Genres keep their index (art and portraits go by it): add new ones at the end.

/**
 * One tone per genre, drawn like a two-ink print: a deep `ground`, the genre's `hue` (also its suit
 * colour everywhere else) and a pale `tint`. The hues sit at about the same lightness and chroma, so
 * no star shouts louder than another; `ink` is the text colour that reads on the hue.
 */
interface Tone {
  ground: string;
  hue: string;
  tint: string;
  ink: string;
}

const TONES: Tone[] = [
  { ground: '#1e0f0c', hue: '#d0583f', tint: '#f7dccf', ink: '#fff' }, // cinnabar
  { ground: '#1f0d17', hue: '#c9577f', tint: '#f8d9e5', ink: '#fff' }, // rose
  // Ochre, not gold: gold on this table means you.
  { ground: '#1d1207', hue: '#c9852c', tint: '#f6e2c4', ink: '#221303' }, // ochre
  { ground: '#071b17', hue: '#2f9c84', tint: '#d2efe5', ink: '#03211b' }, // jade
  { ground: '#10122a', hue: '#6a6fcb', tint: '#dfe0fa', ink: '#fff' }, // iris
  { ground: '#141a07', hue: '#9cbd34', tint: '#eaf3c8', ink: '#1a2303' }, // chartreuse
];

const tone = (key: number): Pick<Genre, 'color' | 'ink'> => ({ color: TONES[key].hue, ink: TONES[key].ink });

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
    ...tone(0), glyph: '✸',
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
    ...tone(1), glyph: '♥',
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
    ...tone(2), glyph: '☀',
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
    ...tone(3), glyph: '●',
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
    ...tone(4), glyph: '☾',
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
    ...tone(5), glyph: '∞',
  },
];

const f = (n: number) => n.toFixed(1);

/**
 * The key art: one quiet geometric figure per genre in the hue and the tint, placed by the card's
 * own seed, on a 120 × 168 sheet. The lower third stays calm: the billing block sits there.
 */
function Art({ card, genre }: { card: Card; genre: number }): JSX.Element {
  const r = rng(card.id * 97 + 13);
  const { hue, tint } = TONES[genre];
  const between = (a: number, b: number) => a + r() * (b - a);
  const glow = `bo-glow-${genre}`;
  const shapes: JSX.Element[] = [];

  if (genre === 0) {
    // action: a blast, its shockwaves, and speed lines cutting through
    const cx = between(42, 78);
    const cy = between(50, 66);
    const R = between(17, 22);
    for (let i = 0; i < 4; i++) {
      const rad = R + 8 + i * 9 + between(-1.5, 1.5);
      shapes.push(<circle key={`w${i}`} cx={f(cx)} cy={f(cy)} r={f(rad)} fill="none" stroke={tint} strokeWidth={0.8 - i * 0.14} opacity={0.55 - i * 0.11} />);
    }
    shapes.push(<circle key="core" cx={f(cx)} cy={f(cy)} r={f(R)} fill={`url(#${glow})`} />);
    const slope = Math.tan(between(-0.5, -0.3));
    for (let i = 0; i < 5; i++) {
      const y = between(8, 104);
      shapes.push(<line key={`l${i}`} x1="-4" y1={f(y)} x2="124" y2={f(y + slope * 128)} stroke={i % 2 ? tint : hue} strokeWidth={f(between(0.3, 1.1))} opacity={f(between(0.25, 0.6))} />);
    }
    for (let i = 0; i < 7; i++) {
      const a = between(0, Math.PI * 2);
      const d = R + between(4, 30);
      const s = between(0.8, 2);
      shapes.push(<rect key={`s${i}`} x={f(cx + Math.cos(a) * d - s / 2)} y={f(cy + Math.sin(a) * d - s / 2)} width={f(s)} height={f(s)} transform={`rotate(45 ${f(cx + Math.cos(a) * d)} ${f(cy + Math.sin(a) * d)})`} fill={tint} opacity="0.85" />);
    }
  } else if (genre === 1) {
    // romance: two circles that meet, the meeting lit up, and a few drifting petals
    const cx = 60 + between(-6, 6);
    const cy = between(52, 62);
    const R = between(20, 24);
    const d = R * between(0.42, 0.58);
    const h = Math.sqrt(R * R - d * d);
    shapes.push(<circle key="halo" cx={f(cx)} cy={f(cy)} r={f(R + d + 9)} fill="none" stroke={tint} strokeWidth="0.4" opacity="0.3" />);
    shapes.push(<circle key="a" cx={f(cx - d)} cy={f(cy)} r={f(R)} fill={hue} opacity="0.6" />);
    shapes.push(<circle key="b" cx={f(cx + d)} cy={f(cy)} r={f(R)} fill="none" stroke={tint} strokeWidth="0.8" opacity="0.9" />);
    shapes.push(<path key="lens" d={`M${f(cx)} ${f(cy - h)} A${f(R)} ${f(R)} 0 0 1 ${f(cx)} ${f(cy + h)} A${f(R)} ${f(R)} 0 0 1 ${f(cx)} ${f(cy - h)} Z`} fill={tint} opacity="0.92" />);
    for (let i = 0; i < 5; i++) {
      const [px, py] = [between(12, 108), between(10, 100)];
      shapes.push(
        <ellipse key={`p${i}`} cx={f(px)} cy={f(py)} rx="2.4" ry="1" transform={`rotate(${between(-60, 60).toFixed(0)} ${f(px)} ${f(py)})`} fill={i % 2 ? tint : hue} opacity={f(between(0.4, 0.75))} />,
      );
    }
  } else if (genre === 2) {
    // mass hero: an art-deco sunrise, the cinema-hall facade kind
    const cx = 60;
    const base = between(94, 100);
    const R = between(20, 26);
    const N = 18;
    for (let i = 0; i < N; i++) {
      const a0 = Math.PI + (i / N) * Math.PI;
      const a1 = a0 + Math.PI / N / 2;
      const p = (a: number) => `${f(cx + Math.cos(a) * 170)},${f(base + Math.sin(a) * 170)}`;
      shapes.push(<polygon key={`r${i}`} points={`${cx},${f(base)} ${p(a0)} ${p(a1)}`} fill={i % 2 ? hue : tint} opacity={i % 2 ? 0.32 : 0.12} />);
    }
    for (let i = 1; i <= 2; i++) shapes.push(<circle key={`c${i}`} cx={cx} cy={f(base)} r={f(R + i * 5)} fill="none" stroke={tint} strokeWidth="0.6" opacity={0.6 - i * 0.18} />);
    shapes.push(<circle key="sun" cx={cx} cy={f(base)} r={f(R)} fill={`url(#${glow})`} />);
    shapes.push(<line key="hz" x1="0" y1={f(base)} x2="120" y2={f(base)} stroke={tint} strokeWidth="0.5" opacity="0.5" />);
  } else if (genre === 3) {
    // comedy: a neat grid of dots where a few have tripped and fallen
    const fell = new Set<number>();
    while (fell.size < 4) fell.add(Math.floor(between(0, 30)));
    for (let i = 0; i < 30; i++) {
      const x = 20 + (i % 6) * 16;
      const y = 16 + Math.floor(i / 6) * 15;
      if (!fell.has(i)) {
        shapes.push(<circle key={`d${i}`} cx={x} cy={y} r="1.7" fill={tint} opacity="0.5" />);
        continue;
      }
      const nx = x + between(-9, 9);
      const ny = y + between(14, 34);
      const big = between(3.5, 7);
      shapes.push(<circle key={`e${i}`} cx={x} cy={y} r="1.7" fill="none" stroke={tint} strokeWidth="0.5" opacity="0.45" />);
      shapes.push(<path key={`t${i}`} d={`M${x} ${y + 2} Q${f(x + (nx - x) * 0.1)} ${f(ny - big)} ${f(nx)} ${f(ny - big - 1)}`} fill="none" stroke={tint} strokeWidth="0.5" strokeDasharray="1 1.6" opacity="0.5" />);
      shapes.push(<circle key={`b${i}`} cx={f(nx)} cy={f(ny)} r={f(big)} fill={i % 2 ? hue : tint} opacity="0.9" />);
    }
  } else if (genre === 4) {
    // art-house: a moon, a long horizon, its reflection, one small figure
    const cx = between(34, 86);
    const cy = between(32, 50);
    const R = between(8, 12);
    const hz = between(84, 92);
    shapes.push(<circle key="halo" cx={f(cx)} cy={f(cy)} r={f(R + 6)} fill="none" stroke={tint} strokeWidth="0.4" opacity="0.35" />);
    shapes.push(<circle key="m" cx={f(cx)} cy={f(cy)} r={f(R)} fill={tint} opacity="0.92" />);
    shapes.push(<line key="hz" x1="0" y1={f(hz)} x2="120" y2={f(hz)} stroke={tint} strokeWidth="0.5" opacity="0.6" />);
    for (let i = 0; i < 5; i++) {
      const w = R * 2 * (1 - i * 0.16);
      const y = hz + 4 + i * 3.6;
      shapes.push(<line key={`w${i}`} x1={f(cx - w / 2)} y1={f(y)} x2={f(cx + w / 2)} y2={f(y)} stroke={tint} strokeWidth="0.8" opacity={0.55 - i * 0.09} />);
    }
    const fx = between(16, 104);
    shapes.push(<rect key="fig" x={f(fx)} y={f(hz - 6.5)} width="1.4" height="6.5" fill={hue} />);
    shapes.push(<circle key="head" cx={f(fx + 0.7)} cy={f(hz - 7.8)} r="1" fill={hue} />);
  } else {
    // brain rot: a vertical feed caught mid-scroll
    const x = 43 + between(-5, 5);
    const tilt = between(-5, 5);
    shapes.push(<rect key="up" x={f(x + between(-3, 3))} y="-36" width="34" height="56" rx="6" fill="none" stroke={tint} strokeWidth="0.7" opacity="0.4" />);
    shapes.push(<rect key="down" x={f(x + between(-3, 3))} y="94" width="34" height="56" rx="6" fill="none" stroke={tint} strokeWidth="0.7" opacity="0.4" />);
    shapes.push(
      <g key="now" transform={`rotate(${f(tilt)} ${f(x + 17)} 56)`}>
        <rect x={f(x)} y="28" width="34" height="56" rx="6" fill={hue} opacity="0.9" />
        <rect x={f(x)} y="28" width="34" height="56" rx="6" fill="none" stroke={tint} strokeWidth="0.8" />
        <path d={`M${f(x + 14)} 49 L${f(x + 23)} 55 L${f(x + 14)} 61 Z`} fill={tint} />
        <rect x={f(x + 5)} y="76" width="24" height="1" rx="0.5" fill={tint} opacity="0.35" />
        <rect x={f(x + 5)} y="76" width={f(between(4, 22))} height="1" rx="0.5" fill={tint} />
      </g>,
    );
    for (let i = 0; i < 3; i++) shapes.push(<circle key={`i${i}`} cx={f(x + 44)} cy={44 + i * 8} r="1.6" fill={tint} opacity="0.6" />);
    shapes.push(<rect key="bar" x="108" y="16" width="0.8" height="76" fill={tint} opacity="0.2" />);
    shapes.push(<rect key="thumb" x="107.6" y={f(between(16, 78))} width="1.6" height="14" rx="0.8" fill={tint} opacity="0.75" />);
  }
  return (
    <svg className="poster-art" viewBox="0 0 120 168" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id={glow} cx="50%" cy="42%" r="60%">
          <stop offset="0" stopColor={tint} />
          <stop offset="0.6" stopColor={hue} />
          <stop offset="1" stopColor={hue} stopOpacity="0.85" />
        </radialGradient>
      </defs>
      {shapes}
    </svg>
  );
}

/** A hairline frame with clipped deco corners and the star's glyph; drawn over the billing block. */
function Frame({ genre, glyph }: { genre: number; glyph: string }): JSX.Element {
  const { tint } = TONES[genre];
  const c = 4;
  const [a, b, x2, y2] = [5, 5, 115, 163];
  const pts = `${a + c},${b} ${x2 - c},${b} ${x2},${b + c} ${x2},${y2 - c} ${x2 - c},${y2} ${a + c},${y2} ${a},${y2 - c} ${a},${b + c}`;
  return (
    <svg className="bo-frame" viewBox="0 0 120 168" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={pts} fill="none" stroke={tint} strokeWidth="0.5" opacity="0.4" vectorEffect="non-scaling-stroke" />
      <text x="109" y="16" textAnchor="end" fontSize="8" fill={tint} opacity="0.75" fontFamily="system-ui, sans-serif">
        {glyph}
      </text>
    </svg>
  );
}

/** Hair and accessories per genre; all drawn on a 48 × 48 grid around a head at (24, 21). */
const STYLES: ((dark: string, light: string, hue: string) => JSX.Element)[] = [
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
  (dark, _light, hue) => (
    <>
      <path d="M12 40 C10 20 14 8 24 8 C34 8 38 20 36 40 L31 40 C33 26 30 18 24 16 C18 18 15 26 17 40 Z" fill={dark} />
      <circle cx="24" cy="17.5" r="1.1" fill={hue} />
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
  // Premiere night: midnight ink, so the gold that marks you reads as its complement; the velvet of
  // the curtain on the card backs; periwinkle (not gold, not a star hue) for someone else's move.
  chrome: {
    '--bg': '#0b0d13',
    '--felt': '#0f121a',
    '--panel': '#151923',
    '--panel-2': '#1d2230',
    '--raised': '#181c27',
    '--line': '#2b3141',
    '--text': '#f3eee4',
    '--muted': '#9ca2b3',
    '--glow': '#1b2132',
    '--glow-2': '#252c44',
    '--night': '#05060a',
    '--field': '#090b11',
    '--shade-rgb': '11 13 19',
    '--accent': '#a9b6ff',
    '--accent-rgb': '169 182 255',
    '--accent-soft': '#d5dcff',
    '--accent-line': '#7480b8',
    '--edge': '#56607e',
    '--edge-2': '#596173',
    '--edge-3': '#333a4e',
    '--deep': '#283049',
    '--deep-2': '#1a1f2e',
    '--dim': '#4a5064',
    '--dim-2': '#3c4256',
    '--back-1': '#7a1f2b',
    '--back-2': '#55121c',
  },
  money: (n) => `₹${n} cr`,
  auctionLabels: { double: 'Double Feature' },
  roundNames: ['Sankranti', 'Summer', 'Eid', 'Diwali'],
  rankLabels: ['All-Time Blockbuster', 'Superhit', 'Semi-Hit'],
  nouns: { card: 'film', cards: 'films', suit: 'star', player: 'Producer', chart: 'Box Office Chart', round: 'season' },
  shelved: 'Overexposed! The 5th film is stuck with the Censor Board forever.',
  renderSuit(s: SuitSkin, px: number) {
    // A cameo printed in the star's two inks: tint face, ground hair and shoulders, a side light.
    const { ground, hue, tint } = TONES[s.key];
    const bg = `bo-cameo-${s.key}`;
    const face = `bo-face-${s.key}`;
    return (
      <svg className="star-face" width={px} height={px} viewBox="0 0 48 48" role="img" aria-label={s.name}>
        <defs>
          <radialGradient id={bg} cx="35%" cy="25%" r="80%">
            <stop offset="0" stopColor={hue} />
            <stop offset="1" stopColor={ground} />
          </radialGradient>
          <clipPath id={face}>
            <ellipse cx="24" cy="21" rx="8" ry="9.5" />
          </clipPath>
        </defs>
        <circle cx="24" cy="24" r="24" fill={`url(#${bg})`} />
        <path d="M6 48 C8 38 15 33 24 33 C33 33 40 38 42 48 Z" fill={ground} />
        <rect x="21" y="27" width="6" height="7" rx="2" fill={tint} opacity="0.78" />
        <ellipse cx="24" cy="21" rx="8" ry="9.5" fill={tint} />
        <rect x="26.5" y="10" width="8" height="22" fill={hue} opacity="0.28" clipPath={`url(#${face})`} />
        {STYLES[s.key](ground, tint, hue)}
        <circle cx="24" cy="24" r="23.3" fill="none" stroke={tint} strokeWidth="0.8" opacity="0.35" />
        <circle cx="39" cy="39" r="7.6" fill={hue} stroke={ground} strokeWidth="1.4" />
        <text x="39" y="42.4" textAnchor="middle" fontSize="9" fill={s.ink} fontFamily="system-ui, sans-serif">
          {s.glyph}
        </text>
      </svg>
    );
  },
  renderCard(card: Card, size: CardSize, { suit, title, tagline, theme }: CardLook) {
    const { ground, hue, tint } = TONES[suit.key];
    return (
      <div
        className={`poster poster-${size} bo`}
        style={{ ['--g' as string]: ground, ['--h' as string]: hue, ['--t' as string]: tint }}
        title={`${title} — ${suit.name} (${suit.genre}) — ${theme.auctionLabels[card.type]}`}
      >
        <Art card={card} genre={suit.key} />
        <div className="poster-type">
          <b>{theme.auctionIcons[card.type]}</b>
          <span>{theme.auctionLabels[card.type]}</span>
        </div>
        <div className="poster-code">{suit.short}</div>
        <div className="poster-foot">
          <div className="bo-billing">{suit.name}</div>
          <div className="poster-title">{title}</div>
          <div className="bo-rule" />
          <div className="poster-tag">{tagline}</div>
        </div>
        <Frame genre={suit.key} glyph={suit.glyph} />
      </div>
    );
  },
};
