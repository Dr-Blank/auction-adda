import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Theme } from '../themes/types.ts';
import { TOUCH } from './hooks.ts';

interface Props {
  min: number;
  max: number;
  start?: number;
  /** Verb on the main button: "Bid", "Seal", "Set price". */
  label: string;
  theme: Theme;
  onBid: (n: number) => void;
  /** Secondary action (pass, done) shown at the same height; Esc triggers it. */
  secondary?: { label: string; onClick: () => void };
  children?: ReactNode;
}

/** Amount picker with steppers and quick raises. Enter submits, Esc passes, ↑/↓ step by 1. */
export function BidBox({ min, max, start, label, theme, onBid, secondary, children }: Props) {
  const [text, setText] = useState(String(start ?? min));
  const n = Number(text);
  const valid = text.trim() !== '' && Number.isInteger(n);
  const ok = valid && n >= min && n <= max;
  const base = valid ? n : min;
  const clamp = (x: number) => Math.min(max, Math.max(min, x));
  const bump = (by: number) => setText(String(clamp(base + by)));
  // Currency around the number, taken from the theme ("₹0 cr" → "₹" and " cr").
  const [pre, post = ''] = theme.money(0).split('0');

  return (
    <form
      className="bidbox"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onBid(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && secondary) {
          e.preventDefault();
          secondary.onClick();
        }
      }}
    >
      <div className="bid-amount">
        <button type="button" className="step" disabled={base <= min} onClick={() => bump(-1)} aria-label="One less">
          −
        </button>
        <label className="amount">
          <span className="cur" aria-hidden="true">
            {pre}
          </span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={text}
            onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                bump(e.key === 'ArrowUp' ? 1 : -1);
              }
            }}
            aria-label={`${label} amount`}
            // Touch: no autofocus. The on-screen keyboard would cover the hand and the lot; the steppers bid without it.
            autoFocus={!matchMedia(TOUCH).matches}
            onFocus={(e) => e.target.select()}
          />
          <span className="cur" aria-hidden="true">
            {post}
          </span>
          <span className="of">of {theme.money(max)}</span>
        </label>
        <button type="button" className="step" disabled={base >= max} onClick={() => bump(1)} aria-label="One more">
          +
        </button>
      </div>
      <div className="quick">
        {[5, 10].map((by) => (
          <button type="button" key={by} className="chip-btn" disabled={base + by > max} onClick={() => bump(by)}>
            +{by}
          </button>
        ))}
        {min > 0 && (
          <button type="button" className="chip-btn" disabled={base === min} onClick={() => setText(String(min))}>
            min
          </button>
        )}
      </div>
      <div className="act-row">
        <button className="btn primary big" disabled={!ok}>
          {label}
          {ok ? ` ${theme.money(n)}` : ''} <kbd>Enter</kbd>
        </button>
        {secondary && (
          <button type="button" className="btn big" onClick={secondary.onClick}>
            {secondary.label} <kbd>Esc</kbd>
          </button>
        )}
      </div>
      {children}
    </form>
  );
}
