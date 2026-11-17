/** Small line icons. They draw in `currentColor`, so each theme's colours apply. */

const base = {
  viewBox: "0 0 24 24",
  width: "1em",
  height: "1em",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export const CopyIcon = () => (
  <svg {...base} className="icon">
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
  </svg>
);

export const LockIcon = () => (
  <svg {...base} className="icon">
    <rect x="5" y="11" width="14" height="9.5" rx="2.5" />
    <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
  </svg>
);

/** Freeze: the game stands still. */
export const FreezeIcon = () => (
  <svg {...base} className="icon">
    <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
    <path d="M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5" />
  </svg>
);

/** Play on after a freeze. */
export const ResumeIcon = () => (
  <svg {...base} className="icon">
    <path d="M8 5.5v13l10.5-6.5z" />
  </svg>
);

/** Edit a name. */
export const PencilIcon = () => (
  <svg {...base} className="icon">
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
    <path d="M13.5 6.5l4 4" />
  </svg>
);

/** React with an emoji. */
export const SmileIcon = () => (
  <svg {...base} className="icon">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 14a4.2 4.2 0 0 0 7 0" />
    <path d="M9.5 9.8h0M14.5 9.8h0" strokeWidth="2.6" />
  </svg>
);

/** Send with another app (the phone's share sheet). */
export const ShareIcon = () => (
  <svg {...base} className="icon">
    <circle cx="17.5" cy="5.5" r="2.5" />
    <circle cx="6.5" cy="12" r="2.5" />
    <circle cx="17.5" cy="18.5" r="2.5" />
    <path d="M8.7 10.7l6.6-3.9M8.7 13.3l6.6 3.9" />
  </svg>
);

/** Show as a QR code. */
export const QrIcon = () => (
  <svg {...base} className="icon">
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 20h1M20 14v1" />
  </svg>
);

/** Cards dealt. */
export const CardsIcon = () => (
  <svg {...base} className="icon">
    <rect x="9" y="4.5" width="10" height="14" rx="2" transform="rotate(10 14 11.5)" />
    <rect x="5" y="5.5" width="10" height="14" rx="2" transform="rotate(-8 10 12.5)" fill="var(--panel)" />
  </svg>
);

/** Games won in the room. */
export const TrophyIcon = () => (
  <svg {...base} className="icon">
    <path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z" />
    <path d="M7.5 6H4.5a3 3 0 0 0 3 4M16.5 6h3a3 3 0 0 1-3 4" />
    <path d="M12 13.5V17M8.5 20h7M9.5 20l.5-3h4l.5 3" />
  </svg>
);

/** The winner. */
export const CrownIcon = () => (
  <svg {...base} className="icon">
    <path d="M4 8l4 4 4-6.5 4 6.5 4-4-1.6 9.5H5.6z" />
    <path d="M6 20.5h12" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...base} className="icon">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
