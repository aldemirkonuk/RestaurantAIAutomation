/**
 * Opening a good no longer waits on three cold reads. A pointer that rests on
 * a row or card for 150 ms, or keyboard focus that stays on one that long,
 * puts the drawer's first reads in the cache: figures, nutrition (only a good
 * that has contents) and used-in. A flyover shorter than that fetches
 * nothing. Skipped for touch, when the browser asks to save data, and while a
 * prefetch for the same good is already running. No visual change.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { figuresQuery, nutritionQuery, usedInQuery } from './item-queries';

export const PREFETCH_INTENT_MS = 150;

const rowIdOf = (el: EventTarget | null): string | null =>
  (el as HTMLElement | null)?.closest?.('[data-row-id]')?.getAttribute('data-row-id') ?? null;

function saveData(): boolean {
  try {
    return (navigator as unknown as { connection?: { saveData?: boolean } }).connection?.saveData === true;
  } catch {
    return false;
  }
}

/** `kindOf` says what a good is, so a supply (no nutrition to state) is not asked for any. */
export function useItemPrefetch(restaurantId: string | null | undefined, kindOf: (id: string) => string | null | undefined) {
  const qc = useQueryClient();
  const timer = useRef<number | null>(null);
  const pending = useRef<string | null>(null);
  const inflight = useRef(new Set<string>());
  const touched = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const fetchFor = useCallback(
    (id: string) => {
      if (!restaurantId || inflight.current.has(id) || saveData()) return;
      inflight.current.add(id);
      const jobs = [qc.prefetchQuery(figuresQuery(restaurantId, id)), qc.prefetchQuery(usedInQuery(restaurantId, id))];
      if (kindOf(id) !== 'supply') jobs.push(qc.prefetchQuery(nutritionQuery(restaurantId, id)));
      void Promise.allSettled(jobs).then(() => inflight.current.delete(id));
    },
    [qc, restaurantId, kindOf],
  );

  const intend = useCallback(
    (id: string | null) => {
      if (id === null) return clear();
      if (pending.current === id) return;
      clear();
      pending.current = id;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        pending.current = null;
        fetchFor(id);
      }, PREFETCH_INTENT_MS);
    },
    [clear, fetchFor],
  );

  return {
    onPointerOver: (e: React.PointerEvent) => {
      touched.current = e.pointerType === 'touch';
      if (!touched.current) intend(rowIdOf(e.target));
    },
    onPointerOut: (e: React.PointerEvent) => {
      const to = rowIdOf(e.relatedTarget);
      if (to === null || to !== pending.current) clear();
    },
    onPointerDown: (e: React.PointerEvent) => {
      touched.current = e.pointerType === 'touch';
    },
    /** Keyboard focus; a tap's focus on a touch device is not intent. */
    onFocusRow: (e: React.FocusEvent) => {
      if (!touched.current) intend(rowIdOf(e.target));
    },
    onBlurRow: () => clear(),
  };
}
