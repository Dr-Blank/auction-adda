import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { reducedMotion } from './derive.ts';

/** One column: the chart becomes a strip pinned to the top edge. Matches the 960 px rules in styles.css. */
export const COMPACT = '(max-width: 960px)';
/** Phone: compact seats, stage and hand, and the action bar docked to the bottom edge. Matches the 700 px rules. */
export const PHONE = '(max-width: 700px)';
/** No hover (touch): nothing may be reachable by hover alone. */
export const TOUCH = '(hover: none)';

/** Whether a media query matches, kept up to date. */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const m = matchMedia(query);
      m.addEventListener('change', onChange);
      return () => m.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}

/** A number that rolls from its previous value to the new one. Instant with reduced motion. */
export function useCountUp(value: number, opts: { from?: number; delay?: number; duration?: number } = {}): number {
  const { delay = 0, duration = 700 } = opts;
  const [shown, setShown] = useState(opts.from ?? value);
  const prev = useRef(opts.from ?? value);

  useEffect(() => {
    const start = prev.current;
    prev.current = value;
    if (start === value) return;
    if (reducedMotion()) {
      setShown(value);
      return;
    }
    let raf = 0;
    const timer = setTimeout(() => {
      const t0 = performance.now();
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / duration);
        const eased = 1 - (1 - k) ** 3;
        setShown(Math.round(start + (value - start) * eased));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      setShown(value);
    };
  }, [value]);

  return shown;
}
