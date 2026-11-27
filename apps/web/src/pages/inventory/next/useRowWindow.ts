/**
 * Draw only the rows near the screen (r104 g2).
 *
 * A house of 1,117 goods put 1,117 table rows, each with cells, a price
 * control and press styles, in the page on open; the phone's cards did the
 * same. The list stays whole (select-all, the footer's counts, sorting and
 * CSV all read the whole list, never the DOM); only what is drawn is windowed.
 *
 * The page scrolls, not the table, so the window is read from where the
 * list's top sits against the viewport. Rows are a known height (the table's
 * row is 56 px and a group head 30 px; a phone card is measured), so the rows
 * not drawn are held as one blank block above and one below and the scroll
 * bar keeps its length. Twelve rows either side are drawn beyond the screen so
 * a fast scroll or an arrow key lands on a drawn row.
 *
 * A row that must be drawn wherever the window is (the one a link opened, the
 * one holding keyboard focus) widens the window to reach it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export const WINDOW_OVERSCAN = 12;
/** A focused row farther than this from the window is let go rather than drawing everything between. */
const PIN_REACH = 100;

export interface RowWindow {
  /** First drawn row, and one past the last. */
  start: number;
  end: number;
  /** Height of the blank block standing for the rows above and below. */
  before: number;
  after: number;
  /** Draw this row now (a link or key reached for one outside the window). */
  jumpTo: (index: number) => void;
}

/** offsets[i] = y where row i's block begins (its own group head, when it has one, is part of the block); offsets[n] = the list's height. */
export function rowOffsets(n: number, rowH: number, groupH: number, startsGroup: (i: number) => boolean): number[] {
  const out = new Array<number>(n + 1);
  let y = 0;
  for (let i = 0; i < n; i += 1) {
    out[i] = y;
    if (startsGroup(i)) y += groupH;
    y += rowH;
  }
  out[n] = y;
  return out;
}

/** The first index whose row ends below `y`. */
function rowAt(offsets: number[], n: number, y: number): number {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] > y) hi = mid;
    else lo = mid + 1;
  }
  return Math.max(0, lo);
}

function viewport(): number {
  return typeof window === 'undefined' || !window.innerHeight ? 800 : window.innerHeight;
}

export function windowAround(offsets: number[], n: number, top: number, bottom: number): [number, number] {
  if (n === 0) return [0, 0];
  const first = rowAt(offsets, n, top);
  const last = rowAt(offsets, n, Math.max(top, bottom));
  return [Math.max(0, first - WINDOW_OVERSCAN), Math.min(n, last + 1 + WINDOW_OVERSCAN)];
}

export function useRowWindow(opts: {
  n: number;
  offsets: number[];
  /** The element whose top is the list's top. */
  listRef: RefObject<HTMLElement | null>;
  /** A row to have drawn at the first paint (the one a link opened). */
  anchor: number | null;
  /** The row holding keyboard focus, or -1. */
  focused: number;
}): RowWindow {
  const { n, offsets, listRef, anchor, focused } = opts;
  const [range, setRange] = useState<[number, number]>(() => {
    const h = viewport();
    if (anchor !== null && anchor >= 0 && anchor < n) {
      const mid = offsets[anchor];
      return windowAround(offsets, n, mid - h / 2, mid + h / 2);
    }
    return windowAround(offsets, n, 0, h);
  });
  const frame = useRef(0);
  const live = useRef({ n, offsets });
  live.current = { n, offsets };

  const read = useCallback(() => {
    const el = listRef.current;
    const { n: count, offsets: offs } = live.current;
    if (!el) return;
    const top = -el.getBoundingClientRect().top;
    const next = windowAround(offs, count, top, top + viewport());
    setRange((cur) => (cur[0] === next[0] && cur[1] === next[1] ? cur : next));
  }, [listRef]);

  // The list changed (a filter, a sort, a search): read the screen again. Not
  // at the first paint when a row was asked for: the page has yet to scroll to
  // it, and reading the top of the page would let it go again.
  const first = useRef(true);
  useLayoutEffect(() => {
    const held = first.current && anchor !== null && anchor >= 0;
    first.current = false;
    if (!held) read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, offsets, read]);

  useEffect(() => {
    const onMove = () => {
      if (frame.current) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = 0;
        read();
      });
    };
    window.addEventListener('scroll', onMove, { passive: true });
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove);
      window.removeEventListener('resize', onMove);
      if (frame.current) window.cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [read]);

  const jumpTo = useCallback((index: number) => {
    const { n: count, offsets: offs } = live.current;
    if (index < 0 || index >= count) return;
    const h = viewport();
    setRange(windowAround(offs, count, offs[index] - h / 2, offs[index] + h / 2));
  }, []);

  let [start, end] = range;
  start = Math.min(start, n);
  end = Math.min(Math.max(end, start), n);
  if (focused >= 0 && focused < n && focused >= start - PIN_REACH && focused < end + PIN_REACH) {
    start = Math.min(start, focused);
    end = Math.max(end, focused + 1);
  }
  return { start, end, before: offsets[start] ?? 0, after: Math.max(0, (offsets[n] ?? 0) - (offsets[end] ?? 0)), jumpTo };
}
