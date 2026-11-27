/**
 * How a plot arrives (N-15, r58). Two small facts the drawings share and one
 * hook, kept out of `rp-plot.tsx` so the reduced-motion branch is one place:
 *
 *  - `reducedMotion()` — the reader's own setting, read once per use;
 *  - `tipMotion()` — what recharts' hover detail does when it moves: it slides
 *    to the next point in 120 ms, or, for a reader who asked for no motion,
 *    not at all;
 *  - `useDrawIn()` — bars rise from the baseline ONCE, when 40% of the plot
 *    has come into view, so a chart below the fold does not spend its entrance
 *    where nobody can see it.
 *
 * Only transform and opacity ever move (reports-next.css, `rp-grow`), so none
 * of this touches layout.
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';

/** The reader asked their system for less motion. A browser that cannot say is read as "no preference". */
export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** The tooltip's own motion: a 120 ms slide on the house curve, off under reduced motion. */
export function tipMotion(): { isAnimationActive: boolean; animationDuration: number; animationEasing: 'ease-out' } {
  return { isAnimationActive: !reducedMotion(), animationDuration: 120, animationEasing: 'ease-out' };
}

/**
 * Bars hold flat (`pending`) until in view, then rise once (`drawn`), then rest
 * (`settled`: painted where they are, nothing animates). `still` never moves:
 * reduced motion, or no way to tell what is in view.
 */
export type DrawState = 'still' | 'pending' | 'drawn' | 'settled';

/** The rise, in ms: the longest stagger sweep (160) plus one bar's own 360. The stylesheet's numbers, kept in step by a test. */
export const RISE_MS = 520;

/**
 * Which cutting and drawing a plot belongs to (`<cutting id>:<graph>`). A plot
 * whose key has already risen this page session starts `settled`, so a rotate,
 * a resize or a remount of the same drawing does not replay the entrance.
 */
export const DrawKey = createContext<string | null>(null);

const risen = new Set<string>();
/** Forget what has risen (tests only). */
export function forgetRisen(): void {
  risen.clear();
}

/** How much of the plot must be on screen before the bars rise. */
export const DRAW_AT = 0.4;

export function canDraw(): boolean {
  return typeof IntersectionObserver !== 'undefined' && !reducedMotion();
}

export function useDrawIn() {
  const ref = useRef<HTMLDivElement>(null);
  const key = useContext(DrawKey);
  const startOf = (k: string | null): DrawState =>
    k != null && risen.has(k) ? 'settled' : canDraw() ? 'pending' : 'still';
  const [state, setState] = useState<DrawState>(() => startOf(key));
  // Draw as Area -> Bars keeps this same plot mounted (one tree position), so
  // a new key is read here, not only on mount: a drawing never seen rises.
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setState(startOf(key));
  }
  useEffect(() => {
    if (state !== 'drawn') return;
    if (key != null) risen.add(key);
    // Not `animationend`: an area or a line has no bars and would never fire it.
    const t = setTimeout(() => setState('settled'), RISE_MS);
    return () => clearTimeout(t);
  }, [state, key]);
  useEffect(() => {
    if (state !== 'pending') return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState('drawn');
          io.disconnect();
        }
      },
      { threshold: DRAW_AT },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [state]);
  return { ref, state };
}
