/**
 * The spindle — sketch 103 · 1c, accepted by the founder 2026-09-06, and the
 * decision half of ADR 0112 · F9.
 *
 * "Modals stack because software finds it easy, and the reader pays for it in
 * lost bearings. A kitchen already solved this: tickets go on a spindle, in
 * order, all of them still readable edge-on."
 *
 * WHAT THIS FILE IS
 * -----------------
 * A counter with names. Every open `Sheet` under the provider registers its
 * spine word and its own leave path, in order. From that the primitive can do
 * three things it could not do before (finder B, D4 — the primitive had only a
 * `zIndex` and a counted scroll lock, so the cap could not even be STATED):
 *
 *   1. draw the depth as a named spine — "Order 118 › Öküzgözü › Answers" —
 *      where every level before the last is a control that closes back to it;
 *   2. refuse a fourth level IN WORDS on the paper the reader is looking at,
 *      never as a silent no-op and never as a fourth sheet — and keep the
 *      sentence's promise: the waiting sheet is admitted the moment a level
 *      is released, and the sentence goes when nothing is waiting;
 *   3. render the same three levels as detented bottom sheets with one
 *      breadcrumb on a phone (F9, one decision covering Apple's detents,
 *      Material's sheets and Vaul's snap points).
 *
 * WHY A PROVIDER AND NOT A MODULE COUNTER
 * ---------------------------------------
 * The scroll lock is a module-level counter because it is a fact about the
 * document. Depth is a fact about a PAGE: a test, a sandbox or a Storybook
 * story that mounts a Sheet on its own is not three levels deep in anything,
 * and a module counter would carry state between them. So the cap and the spine
 * exist only under `PageGate`, which is the one place that knows a real page is
 * on screen — and `useSheetStack()` returns `present: false` everywhere else,
 * where a Sheet behaves exactly as it always has.
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  SHEET_STACK_CAP,
  SHEET_STACK_REFUSAL,
  SheetStackContext,
  type SheetStackApi,
  type SheetStackEntry,
} from './sheetStackContext';

/* Types only: a value re-exported from a component file breaks Fast Refresh for
   every importer (`react-refresh/only-export-components`). The cap, the refusal
   sentence and `useSheetStack` are imported from `./sheetStackContext`. */
export type { SheetStackApi, SheetStackEntry } from './sheetStackContext';

export interface SheetStackProviderProps {
  children: ReactNode;
  /** Override the cap. Changing it is an ADR, not a page's call. */
  cap?: number;
}

export function SheetStackProvider({ children, cap = SHEET_STACK_CAP }: SheetStackProviderProps) {
  const [entries, setEntries] = useState<SheetStackEntry[]>([]);
  const [queue, setQueue] = useState<SheetStackEntry[]>([]);
  /* The lists as they stand DURING a commit. Two sheets can open in one pass
     and `entries` would still read empty for the second — the refs are what
     decide admission, and state is what renders it. */
  const live = useRef<SheetStackEntry[]>([]);
  const waitingRef = useRef<SheetStackEntry[]>([]);

  const publish = useCallback(() => {
    setEntries(live.current);
    setQueue(waitingRef.current);
  }, []);

  /** Admit waiting sheets, oldest first, while there is room. */
  const admitWaiting = useCallback(() => {
    while (live.current.length < cap && waitingRef.current.length > 0) {
      const [next, ...rest] = waitingRef.current;
      waitingRef.current = rest;
      live.current = [...live.current, next];
    }
  }, [cap]);

  const join = useCallback(
    (id: string, title: string, leave: () => void) => {
      if (live.current.some((e) => e.id === id)) {
        // A re-registration: update in place, keep depth.
        live.current = live.current.map((e) => (e.id === id ? { ...e, title, leave } : e));
      } else if (waitingRef.current.some((e) => e.id === id)) {
        waitingRef.current = waitingRef.current.map((e) =>
          e.id === id ? { ...e, title, leave } : e,
        );
      } else if (live.current.length >= cap) {
        waitingRef.current = [...waitingRef.current, { id, title, leave }];
      } else {
        live.current = [...live.current, { id, title, leave }];
      }
      publish();
      return () => {
        const wasAdmitted = live.current.some((e) => e.id === id);
        live.current = live.current.filter((e) => e.id !== id);
        waitingRef.current = waitingRef.current.filter((e) => e.id !== id);
        if (wasAdmitted) admitWaiting();
        publish();
      };
    },
    [cap, publish, admitWaiting],
  );

  const rename = useCallback(
    (id: string, title: string) => {
      const inLive = live.current.find((e) => e.id === id);
      const inQueue = waitingRef.current.find((e) => e.id === id);
      const entry = inLive ?? inQueue;
      if (!entry || entry.title === title) return;
      if (inLive) live.current = live.current.map((e) => (e.id === id ? { ...e, title } : e));
      else waitingRef.current = waitingRef.current.map((e) => (e.id === id ? { ...e, title } : e));
      publish();
    },
    [publish],
  );

  const waiting = useCallback((id: string) => queue.some((e) => e.id === id), [queue]);
  const admitted = useCallback((id: string) => live.current.some((e) => e.id === id), []);

  const closeTo = useCallback((index: number) => {
    // Top down, so each level's own leave path sees the state it expects. The
    // list is copied first: a clean level's close releases it synchronously in
    // some callers, and a mutating list would skip the level below it.
    const levels = live.current.slice(index + 1).reverse();
    for (const level of levels) level.leave();
  }, []);

  const value = useMemo<SheetStackApi>(
    () => ({
      present: true,
      entries,
      cap,
      refusal: queue.length > 0 ? SHEET_STACK_REFUSAL : null,
      join,
      rename,
      waiting,
      admitted,
      closeTo,
    }),
    [entries, cap, queue, join, rename, waiting, admitted, closeTo],
  );

  return <SheetStackContext.Provider value={value}>{children}</SheetStackContext.Provider>;
}

export default SheetStackProvider;
