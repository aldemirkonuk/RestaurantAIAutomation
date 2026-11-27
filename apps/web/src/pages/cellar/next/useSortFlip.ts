/**
 * The cocktail list's rows slide to their new place when a column is sorted
 * (FLIP: First and Last measured, Inverted with a transform, then Played), 180 ms on the house curve. Only
 * `transform` moves, so nothing is laid out again. Under reduced motion no
 * animation is made at all: no slide and no fade (MOTIONS.md, ADR 0112). Only
 * rows already on the page move; one that has just arrived does not, unless `enter` is set: then
 * it fades in (opacity 0 to 1, 150 ms, ease-out), with no stagger. A removed row is simply gone.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion, settle, type MotionToken } from '../../../lib/mudavym/motion';

export const SORT_FLIP: MotionToken = { easing: settle.easing, ms: 180 };
export const ENTER_FADE: MotionToken = { easing: 'ease-out', ms: 150 };

export interface FlipOptions {
  /** The rows to move; defaults to the cocktail list's table rows. */
  selector?: string;
  /** Fade in a row that was not there before (Plan prep's lists). */
  enter?: boolean;
}

const pageTop = (el: Element) => el.getBoundingClientRect().top + (typeof window === 'undefined' ? 0 : window.scrollY);

/**
 * `before()` is called in the click that changes the sort, so it reads where
 * each row is now; the layout effect after the new order is drawn reads where
 * it went and plays the difference.
 */
export function useSortFlip(body: RefObject<HTMLElement | null>, sortKey: string, opts: FlipOptions = {}): { before: () => void } {
  const selector = opts.selector ?? 'tr[data-row]';
  const enter = opts.enter === true;
  const was = useRef<Map<string, number> | null>(null);
  useLayoutEffect(() => {
    const from = was.current;
    was.current = null;
    const el = body.current;
    if (!from || !el || prefersReducedMotion() || typeof Element.prototype.animate !== 'function') return;
    el.querySelectorAll<HTMLElement>(selector).forEach((row) => {
      const start = from.get(row.dataset.row as string);
      if (start == null) {
        if (enter) row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ENTER_FADE.ms, easing: ENTER_FADE.easing });
        return;
      }
      const delta = start - pageTop(row);
      if (Math.abs(delta) < 1) return;
      row.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: SORT_FLIP.ms, easing: SORT_FLIP.easing });
    });
  }, [body, sortKey, selector, enter]);
  return {
    before: () => {
      const el = body.current;
      if (!el) return;
      const m = new Map<string, number>();
      el.querySelectorAll<HTMLElement>(selector).forEach((row) => m.set(row.dataset.row as string, pageTop(row)));
      was.current = m;
    },
  };
}
