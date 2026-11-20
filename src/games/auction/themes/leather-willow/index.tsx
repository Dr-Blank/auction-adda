import type { JSX } from "react";
import type { Card } from "../../../../generated/index.ts";
import { rng } from "../../../../rng.ts";
import type { CardLook, CardSize, Genre, SuitSkin, ThemeDef } from "../types.ts";
import "./card.css";

// All franchise and player names here are invented for this game.
// Keep them fictional: no real players, teams, leagues or sponsors.
// Genres keep their index (roles and crests go by it): add new ones at the end.

const GENRES: Genre[] = [
  {
    names: ["Nilgiri Gaurs", "Coorg Planters", "Munnar Mist"],
    labels: ["Spin web", "Slow-bowling side"],
    titles: [
      "Googly Gopalan",
      "Doosra Devaraj",
      "Carrom Ball Kutty",
      "Arm Ball Appu",
      "Turn Thimmaiah",
      "Loop Lingappa",
      "Teesra Thomas",
      "Slider Subbu",
      "Drift Dinakar",
      "Rough Patch Ramaiah",
      "Leg-Slip Leela",
      "Maiden Over Mani",
      "Silly Point Seenu",
      "Dead Pitch Dorai",
      "Bat-Pad Belliappa",
      "Flight Fathima",
    ],
    taglines: [
      "Turns it on a highway.",
      "Four overs in three minutes.",
      "The batter is still looking for it.",
      "Reads the pitch like a newspaper.",
      "Flight, dip, wicket. Repeat.",
    ],
    color: "#2f5d43",
    ink: "#fff",
    glyph: "◆",
  },
  {
    names: ["Malabar Monsoons", "Konkan Cobras", "Ratnagiri Rollers"],
    labels: ["Pace attack", "Bouncer brigade"],
    titles: [
      "Bouncer Bhosale",
      "Yorker Yeshwant",
      "Bumper Bapat",
      "Seam Shetty",
      "Swing Sawant",
      "Reverse Rane",
      "Short Ball Shirodkar",
      "Toe Crusher Teli",
      "New Ball Naik",
      "Pace Pednekar",
      "Run-Up Rao",
      "Beamer Bhandari",
      "Wobble Seam Wagh",
      "Outswing Usha",
      "Inducker Iqbal",
      "Long Spell Lobo",
    ],
    taglines: [
      "150 clicks, no mercy.",
      "Runs in from the sightscreen.",
      "Helmets strongly advised.",
      "Swings it both ways, and the match.",
      "The keeper stands thirty yards back.",
    ],
    color: "#9e2b2b",
    ink: "#fff",
    glyph: "●",
  },
  {
    names: ["Deccan Admirals", "Coromandel Mariners", "Vizag Voyagers"],
    labels: ["Top-order class", "Anchors"],
    titles: [
      "Cover Drive Chari",
      "Straight Bat Somayajulu",
      "Leave Alone Lalitha",
      "Defensive Dasari",
      "Square Cut Srinivas",
      "Late Cut Lakkaraju",
      "Front Foot Farooq",
      "Back Foot Bhaskar",
      "Hundred Hari",
      "Nightwatchman Naidu",
      "Classy Kodandaram",
      "Strike Rotate Sudha",
      "Grind It Out Gopi",
      "Textbook Tirumala",
      "Patience Pothana",
      "Timing Tejaswini",
    ],
    taglines: [
      "Leaves 47 balls in a row. On purpose.",
      "Bats through the innings, and lunch.",
      "Textbook. Literally wrote one.",
      "Average 58. Strike rate: patience.",
      "Never met a wide worth chasing.",
    ],
    color: "#22395e",
    ink: "#fff",
    glyph: "▲",
  },
  {
    names: ["Thar Camels", "Jaisalmer Sandstorm", "Marwar Mavericks"],
    labels: ["Power hitters", "Six machine"],
    titles: [
      "Sixer Shekhawat",
      "Slog Sweep Sodha",
      "Maximum Mangilal",
      "Switch Hit Sankhla",
      "Roof Top Rajpurohit",
      "Lofted Lakhan",
      "Free Hit Bhati",
      "Scoop Shot Solanki",
      "Big Hitter Bhanwar",
      "Ramp Shot Rawat",
      "Death Over Devda",
      "Boundary Banna",
      "Muscle Meena",
      "Long-On Laxmi",
      "Pinch Hitter Purohit",
      "Dhamaka Dhakad",
    ],
    taglines: [
      "Lost twelve balls. In one over.",
      "Window insurance not included.",
      "Swings first, asks questions never.",
      "Allergic to dot balls.",
      "The stands have a catching net now.",
    ],
    color: "#b8862b",
    ink: "#1f1606",
    glyph: "■",
  },
  {
    names: ["Brahmaputra Rhinos", "Shillong Clouds", "Majuli Boatmen"],
    labels: ["Young guns", "Academy side"],
    titles: [
      "Under-19 Ujjal",
      "Debut Day Dolly",
      "Rookie Rongmei",
      "Net Bowler Nabam",
      "Academy Angom",
      "First Cap Phukan",
      "Fresh Legs Lalrin",
      "Prodigy Pator",
      "Trial Match Tamang",
      "Scholarship Sohkhlet",
      "Ballboy Barua",
      "Hostel Mess Hazarika",
      "Rising Star Rabha",
      "Wonderkid Wahlang",
      "Gap Year Gogoi",
      "Exam Season Engti",
    ],
    taglines: [
      "Debut tomorrow. Exams the day after.",
      "Fast, fearless, still in school.",
      "Asked the captain for an autograph.",
      "Raw talent, freshly unboxed.",
      "Bowling speed: high. Screen time: higher.",
    ],
    color: "#2f7a78",
    ink: "#fff",
    glyph: "✚",
  },
  {
    names: ["Doaba Tractors", "Patiala Pythons", "Sutlej Old Boys"],
    labels: ["Old guard", "Experience"],
    titles: [
      "Uncle Ji Uppal",
      "Retired Hurt Randhawa",
      "Comeback Kahlon",
      "Knee Brace Brar",
      "Farewell Tour Grewal",
      "Testimonial Toor",
      "Slow Single Sandhu",
      "Ice Pack Aulakh",
      "Veteran Virk",
      "One More Season Sekhon",
      "Grey Beard Garcha",
      "Physio Wala Pannu",
      "Benchmark Bains",
      "Old School Dhaliwal",
      "Tea-Time Tiwana",
      "Last Dance Lally",
    ],
    taglines: [
      "Has played in four eras of jersey.",
      "Runs singles in slow motion.",
      "Knows every umpire by first name.",
      "One more season. Every season.",
      "Experience: priceless. Knees: questionable.",
    ],
    // Not grey: a grey suit reads as plain or muted text.
    color: "#6b3a7a",
    ink: "#fff",
    glyph: "★",
  },
];

const ROLES = ["Batter", "Bowler", "All-rounder", "Wicket-keeper"] as const;
/** The role each franchise has more of. */
const LEANS = [1, 1, 0, 0, 2, 3];

/** Role and shirt number, fixed per card. */
function profile(card: Card, genre: number): { role: number; shirt: number } {
  const r = rng(card.id * 31 + 7);
  const role = r() < 0.5 ? LEANS[genre] : Math.floor(r() * ROLES.length);
  return { role, shirt: 1 + Math.floor(r() * 99) };
}

const PAPER = "#f4efe2";

/** The role as a line drawing, centred on (60, 62) of a 120 × 168 card. */
function Emblem({ role, team }: { role: number; team: string }): JSX.Element {
  const line = {
    fill: "none",
    stroke: team,
    strokeWidth: 2.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const bat = (
    <g transform="rotate(-35 60 62)">
      <rect x="53" y="40" width="14" height="44" rx="5" {...line} />
      <line x1="60" y1="40" x2="60" y2="24" {...line} strokeWidth="4" />
      <line x1="60" y1="47" x2="60" y2="78" {...line} strokeWidth="1" opacity="0.5" />
    </g>
  );
  const ball = (cx: number, cy: number, rad: number) => (
    <g>
      <circle cx={cx} cy={cy} r={rad} {...line} />
      <path
        d={`M${cx - rad * 0.35} ${cy - rad * 0.94} C${cx - rad * 0.05} ${cy - rad * 0.3} ${cx - rad * 0.05} ${cy + rad * 0.3} ${cx - rad * 0.35} ${cy + rad * 0.94}`}
        {...line}
        strokeWidth="1.2"
      />
      <path
        d={`M${cx + rad * 0.35} ${cy - rad * 0.94} C${cx + rad * 0.05} ${cy - rad * 0.3} ${cx + rad * 0.05} ${cy + rad * 0.3} ${cx + rad * 0.35} ${cy + rad * 0.94}`}
        {...line}
        strokeWidth="1.2"
        strokeDasharray="1.5 2"
      />
    </g>
  );
  if (role === 0) return bat;
  if (role === 1) return ball(60, 62, 20);
  if (role === 2)
    return (
      <>
        {bat}
        {ball(82, 82, 9)}
      </>
    );
  return (
    <g>
      {[46, 60, 74].map((x) => (
        <line key={x} x1={x} y1="44" x2={x} y2="88" {...line} />
      ))}
      <line x1="45" y1="40" x2="59" y2="40" {...line} strokeWidth="2" />
      <line x1="61" y1="40" x2="75" y2="40" {...line} strokeWidth="2" />
      <line x1="34" y1="88" x2="86" y2="88" {...line} strokeWidth="1" opacity="0.5" />
    </g>
  );
}

export const leatherWillow: ThemeDef = {
  id: "leather-willow",
  title: "Leather & Willow",
  tagline: "Bid for cricketers, back the right franchise, cash in when the tournament ends.",
  genres: GENRES,
  // A ground under lights: deep pitch green, ivory text.
  chrome: {
    "--bg": "#0d1611",
    "--felt": "#101c15",
    "--panel": "#15241b",
    "--panel-2": "#1d3126",
    "--raised": "#192b21",
    "--line": "#2d4638",
    "--text": "#f2ede0",
    "--muted": "#a3b2a5",
    "--glow": "#1f3a2b",
    "--glow-2": "#24402f",
    "--night": "#060b08",
    "--field": "#0a120d",
    "--shade-rgb": "12 22 16",
    "--accent": "#a9d4b5",
    "--accent-rgb": "169 212 181",
    "--accent-soft": "#d6ecd9",
    "--accent-line": "#6f9a7c",
    "--edge": "#4f7a5f",
    "--edge-2": "#5a7564",
    "--edge-3": "#33503f",
    "--deep": "#26402f",
    "--deep-2": "#1a2d21",
    "--dim": "#4e6155",
    "--dim-2": "#3d5446",
    // Card backs in cricket-ball leather.
    "--back-1": "#7a2e2a",
    "--back-2": "#5a201d",
  },
  money: (n) => `₹${n} cr`,
  auctionLabels: { double: "Package Deal" },
  roundNames: ["Monsoon Cup", "Diwali Trophy", "Winter Series", "Summer League"],
  rankLabels: ["Champions", "Runners-up", "Playoffs"],
  nouns: {
    card: "player",
    cards: "players",
    suit: "franchise",
    player: "Owner",
    chart: "Points Table",
    round: "tournament",
  },
  shelved: "Squad full! The 5th signing is stuck in paperwork for good.",
  sold: "Hammer down. SOLD!",
  renderSuit(s: SuitSkin, px: number) {
    const shield = "M24 3 L42 8.5 V24 C42 35 34.5 42 24 46 C13.5 42 6 35 6 24 V8.5 Z";
    const id = `crest-${s.key}`;
    return (
      <svg className="star-face" width={px} height={px} viewBox="0 0 48 48" role="img" aria-label={s.name}>
        <defs>
          <clipPath id={id}>
            <path d={shield} />
          </clipPath>
        </defs>
        <path d={shield} fill={s.color} />
        <rect
          x="-10"
          y="20"
          width="70"
          height="7"
          fill={PAPER}
          opacity="0.22"
          transform="rotate(-30 24 24)"
          clipPath={`url(#${id})`}
        />
        <path
          d={shield}
          fill="none"
          stroke={PAPER}
          strokeWidth="1.1"
          opacity="0.8"
          transform="translate(24 24) scale(0.86) translate(-24 -24)"
        />
        <text
          x="24"
          y="28.5"
          textAnchor="middle"
          fontSize="12.5"
          fontWeight="700"
          fill={s.ink}
          fontFamily="Georgia, 'Times New Roman', serif"
        >
          {s.short}
        </text>
        <circle cx="39" cy="39" r="7.5" fill={PAPER} stroke={s.color} strokeWidth="1.2" />
        <text x="39" y="42.4" textAnchor="middle" fontSize="9" fill={s.color} fontFamily="system-ui, sans-serif">
          {s.glyph}
        </text>
      </svg>
    );
  },
  renderCard(card: Card, size: CardSize, { suit, title, tagline, theme }: CardLook) {
    const { role, shirt } = profile(card, suit.key);
    return (
      <div
        className={`poster poster-${size} willow`}
        style={{ ["--team" as string]: suit.color, ["--team-ink" as string]: suit.ink }}
        title={`${title} — ${ROLES[role]}, ${suit.name} (${suit.genre}) — ${theme.auctionLabels[card.type]}`}
      >
        <svg className="poster-art" viewBox="0 0 120 168" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <rect x="5" y="5" width="110" height="158" fill="none" stroke={suit.color} strokeWidth="0.7" opacity="0.55" />
          <rect x="8" y="8" width="104" height="152" fill="none" stroke={suit.color} strokeWidth="0.35" opacity="0.4" />
          <text
            x="108"
            y="44"
            textAnchor="end"
            fontSize="34"
            fontWeight="700"
            fill={suit.color}
            opacity="0.1"
            fontFamily="Georgia, serif"
          >
            {shirt}
          </text>
          <g transform="translate(60 50) scale(0.8) translate(-60 -62)">
            <Emblem role={role} team={suit.color} />
          </g>
        </svg>
        <div className="poster-type">
          <b>{theme.auctionIcons[card.type]}</b>
          <span>{theme.auctionLabels[card.type]}</span>
        </div>
        <div className="poster-code">{suit.short}</div>
        <div className="poster-foot">
          <div className="poster-title">{title}</div>
          <div className="willow-role">
            {ROLES[role]} · No. {shirt}
          </div>
          <div className="poster-tag">{tagline}</div>
          <div className="poster-star">
            {suit.glyph} {suit.name}
          </div>
        </div>
      </div>
    );
  },
};
