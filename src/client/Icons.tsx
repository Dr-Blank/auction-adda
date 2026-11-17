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

export const CheckIcon = () => (
  <svg {...base} className="icon">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
