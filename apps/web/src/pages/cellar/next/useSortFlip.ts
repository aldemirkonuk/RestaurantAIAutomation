/**
 * The cocktail list's rows slide to their new place when a column is sorted
 * (FLIP: First and Last measured, Inverted with a transform, then Played), 180 ms on the house curve. Only
 * `transform` moves, so nothing is laid out again. Under reduced motion no
 * animation is made at all: no slide and no fade (MOTIONS.md, ADR 0112). Only
 * rows already on the page move; one that has just arrived does not, and one that
 * left is simply gone. A filter or the search changing the row set plays the same slide.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion, settle, type MotionToken } from '../../../lib/mudavym/motion';

export const SORT_FLIP: MotionToken = { easing: settle.easing, ms: 180 };
/** When more rows than this move, none slides: a part-slide has some rows crossing others in place, so it is all or nothing (r108). */
export const FLIP_ROW_CAP = 60;

const pageTop = (el: Element) => el.getBoundingClientRect().top + (typeof window === 'undefined' ? 0 : window.scrollY);

/**
 * `before()` is called in the click that changes the sort, so it reads where
 * each row is now; the layout effect after the new order is drawn reads where
 * it went and plays the difference.
 */
export function useSortFlip(body: RefObject<HTMLElement | null>, sortKey: string): { before: () => void } {
  const was = useRef<Map<string, number> | null>(null);
  useLayoutEffect(() => {
    const from = was.current;
    was.current = null;
    const el = body.current;
    if (!from || !el || prefersReducedMotion() || typeof Element.prototype.animate !== 'function') return;
    const moved: Array<[HTMLElement, number]> = [];
    el.querySelectorAll<HTMLElement>('tr[data-row]').forEach((row) => {
      const start = from.get(row.dataset.row as string);
      if (start == null) return;
      const delta = start - pageTop(row);
      if (Math.abs(delta) >= 1) moved.push([row, delta]);
    });
    if (moved.length > FLIP_ROW_CAP) return;
    for (const [row, delta] of moved) {
      row.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: SORT_FLIP.ms, easing: SORT_FLIP.easing });
    }
  }, [body, sortKey]);
  return {
    before: () => {
      const el = body.current;
      if (!el) return;
      const m = new Map<string, number>();
      el.querySelectorAll<HTMLElement>('tr[data-row]').forEach((row) => m.set(row.dataset.row as string, pageTop(row)));
      was.current = m;
    },
  };
}
