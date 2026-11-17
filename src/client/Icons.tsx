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

export const CheckIcon = () => (
  <svg {...base} className="icon">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
