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
 * it went and plays the difference. A slide still running when the sort is
 * pressed again is cancelled BEFORE the new place is read: its transform sits
 * in both reads and would cancel out, so the new slide would start from where
 * the row was laid out, not from where it was seen, and jump by the residue.
 */
export function useSortFlip(body: RefObject<HTMLElement | null>, sortKey: string): { before: () => void } {
  const was = useRef<{ key: string; rows: Map<string, number> } | null>(null);
  const drawn = useRef(sortKey);
  // Runs after every render, not only when the key changes: a snapshot is for the very next render, and
  // one that renders no row change (a search keystroke that keeps the same rows) is dropped here, so it
  // cannot play later against a different change (a refetch that adds a row).
  const running = useRef<Map<string, Animation>>(new Map());
  useLayoutEffect(() => {
    const snap = was.current;
    was.current = null;
    drawn.current = sortKey;
    const el = body.current;
    if (!snap || snap.key === sortKey || !el || prefersReducedMotion() || typeof Element.prototype.animate !== 'function') return;
    // `snap` was read with each running slide applied; read the new place without it.
    running.current.forEach((a) => a.cancel());
    running.current.clear();
    const moved: Array<[HTMLElement, number]> = [];
    el.querySelectorAll<HTMLElement>('tr[data-row]').forEach((row) => {
      const start = snap.rows.get(row.dataset.row as string);
      if (start == null) return;
      const delta = start - pageTop(row);
      if (Math.abs(delta) >= 1) moved.push([row, delta]);
    });
    if (moved.length > FLIP_ROW_CAP) return;
    for (const [row, delta] of moved) {
      const slide = row.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: SORT_FLIP.ms, easing: SORT_FLIP.easing });
      if (slide) running.current.set(row.dataset.row as string, slide);
    }
  });
  return {
    before: () => {
      const el = body.current;
      if (!el) return;
      const m = new Map<string, number>();
      el.querySelectorAll<HTMLElement>('tr[data-row]').forEach((row) => m.set(row.dataset.row as string, pageTop(row)));
      was.current = { key: drawn.current, rows: m };
    },
  };
}
