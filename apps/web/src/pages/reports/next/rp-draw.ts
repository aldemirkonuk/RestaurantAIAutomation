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
import { useEffect, useRef, useState } from 'react';

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

/** Bars hold flat (`pending`) until in view, then rise once (`drawn`). `still` never moves: reduced motion, or no way to tell what is in view. */
export type DrawState = 'still' | 'pending' | 'drawn';

/** How much of the plot must be on screen before the bars rise. */
export const DRAW_AT = 0.4;

export function canDraw(): boolean {
  return typeof IntersectionObserver !== 'undefined' && !reducedMotion();
}

export function useDrawIn() {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<DrawState>(() => (canDraw() ? 'pending' : 'still'));
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
