/**
 * Opening a good no longer waits on three cold reads. A pointer that rests on
 * a row or card for 150 ms, or keyboard focus that stays on one that long,
 * puts the drawer's first reads in the cache: figures, nutrition (only a good
 * that has contents) and used-in. A flyover shorter than that fetches
 * nothing. A touch or pen has no hover: its pointerdown warms the good with no
 * dwell (a 50 ms guard that a scroll cancels), once per good per 5 s. Skipped
 * when the browser asks to save data, and while a prefetch for the same good is
 * already running. No visual change.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { figuresQuery, nutritionQuery, usedInQuery } from './item-queries';

export const PREFETCH_INTENT_MS = 150;
/** A finger has no hover: a touch warms at once, but a scroll that starts on a row must not. */
export const TOUCH_GUARD_MS = 50;
export const TOUCH_SLOP_PX = 10;
export const TOUCH_REPEAT_MS = 5000;

// The list's table rows carry `data-row-id` on the title button only, so a
// pointer resting on any other cell of the row reads the row's button too.
const rowIdOf = (el: EventTarget | null): string | null => {
  const node = el as HTMLElement | null;
  const own = node?.closest?.('[data-row-id]') ?? node?.closest?.('tr')?.querySelector('[data-row-id]');
  return own?.getAttribute('data-row-id') ?? null;
};

function saveData(): boolean {
  try {
    return (navigator as unknown as { connection?: { saveData?: boolean } }).connection?.saveData === true;
  } catch {
    return false;
  }
}

/** A list mounted without a cache (a bare test mount) has nothing to warm; it must not throw. */
function useOptionalQueryClient() {
  try {
    return useQueryClient();
  } catch {
    return null;
  }
}

/** `kindOf` says what a good is, so a supply (no nutrition to state) is not asked for any. */
export function useItemPrefetch(restaurantId: string | null | undefined, kindOf: (id: string) => string | null | undefined) {
  const qc = useOptionalQueryClient();
  const timer = useRef<number | null>(null);
  const pending = useRef<string | null>(null);
  const inflight = useRef(new Set<string>());
  const touched = useRef(false);
  const touch = useRef<{ id: string; x: number; y: number; timer: number } | null>(null);
  const lastTouchWarm = useRef(new Map<string, number>());

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const disarm = useCallback(() => {
    if (touch.current) window.clearTimeout(touch.current.timer);
    touch.current = null;
  }, []);
  useEffect(() => disarm, [disarm]);

  const fetchFor = useCallback(
    (id: string) => {
      if (!qc || !restaurantId || inflight.current.has(id) || saveData()) return;
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

  const warmTouch = useCallback(
    (id: string) => {
      const now = Date.now();
      const last = lastTouchWarm.current.get(id);
      if (last !== undefined && now - last < TOUCH_REPEAT_MS) return;
      lastTouchWarm.current.set(id, now);
      fetchFor(id);
    },
    [fetchFor],
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
      disarm();
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      const id = rowIdOf(e.target);
      if (id === null) return;
      const timer = window.setTimeout(() => {
        touch.current = null;
        warmTouch(id);
      }, TOUCH_GUARD_MS);
      touch.current = { id, x: e.clientX, y: e.clientY, timer };
    },
    /** A finger that travels is scrolling the list, not choosing a row. */
    onPointerMove: (e: React.PointerEvent) => {
      const t = touch.current;
      if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) > TOUCH_SLOP_PX) disarm();
    },
    /** A lift inside the slop is a tap: warm now, the sheet opens on the click that follows. */
    onPointerUp: () => {
      const t = touch.current;
      if (!t) return;
      disarm();
      warmTouch(t.id);
    },
    onPointerCancel: () => disarm(),
    /** Keyboard focus; a tap's focus on a touch device is not intent. */
    onFocusRow: (e: React.FocusEvent) => {
      if (!touched.current) intend(rowIdOf(e.target));
    },
    onBlurRow: () => clear(),
  };
}
