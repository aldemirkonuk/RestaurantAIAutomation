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
 * spine word and its own `onClose`, in order. From that the primitive can do
 * three things it could not do before (finder B, D4 — the primitive had only a
 * `zIndex` and a counted scroll lock, so the cap could not even be STATED):
 *
 *   1. draw the depth as a named spine — "Order 118 › Öküzgözü › Answers" —
 *      where every level before the last is a control that closes back to it;
 *   2. refuse a fourth level IN WORDS on the paper the reader is looking at,
 *      never as a silent no-op and never as a fourth sheet;
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

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/** ADR 0112 · F9: "stacked sheets are capped at three with a breadcrumb". */
export const SHEET_STACK_CAP = 3;

export const SHEET_STACK_REFUSAL =
  'Three sheets are open. Close one to open this.';

export interface SheetStackEntry {
  id: string;
  /** The word on the spine. The sheet's own title. */
  title: string;
  /** Leave this level — the sheet's own `onClose`. */
  close: () => void;
}

export interface SheetStackApi {
  /** False when no provider is above: no cap, no spine, no breadcrumb. */
  present: boolean;
  entries: SheetStackEntry[];
  cap: number;
  /** The sentence a refused level put on the paper, or null. */
  refusal: string | null;
  /**
   * Ask for a level. Returns a release function for the effect's cleanup.
   * A sheet that is refused is NOT on the spindle and renders nothing — the
   * sentence goes onto the top sheet instead, which is where the reader's eye
   * already is.
   */
  join: (id: string, title: string, close: () => void) => () => void;
  /** Is this id holding a level? */
  holds: (id: string) => boolean;
  /** Close every level above `index`, top down. */
  closeTo: (index: number) => void;
}

const NO_STACK: SheetStackApi = {
  present: false,
  entries: [],
  cap: SHEET_STACK_CAP,
  refusal: null,
  join: () => () => {},
  holds: () => true,
  closeTo: () => {},
};

const SheetStackContext = createContext<SheetStackApi>(NO_STACK);

export function useSheetStack(): SheetStackApi {
  return useContext(SheetStackContext);
}

export interface SheetStackProviderProps {
  children: ReactNode;
  /** Override the cap. Changing it is an ADR, not a page's call. */
  cap?: number;
}

export function SheetStackProvider({ children, cap = SHEET_STACK_CAP }: SheetStackProviderProps) {
  const [entries, setEntries] = useState<SheetStackEntry[]>([]);
  const [refusedIds, setRefusedIds] = useState<string[]>([]);
  /* The list as it stands DURING a commit. Two sheets can open in one pass and
     `entries` would still read empty for the second — the ref is what decides
     admission, and state is what renders it. */
  const live = useRef<SheetStackEntry[]>([]);

  const join = useCallback(
    (id: string, title: string, close: () => void) => {
      if (live.current.some((e) => e.id === id)) {
        // A re-registration (the title changed): update in place, keep depth.
        live.current = live.current.map((e) => (e.id === id ? { ...e, title, close } : e));
        setEntries(live.current);
      } else if (live.current.length >= cap) {
        setRefusedIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
      } else {
        live.current = [...live.current, { id, title, close }];
        setEntries(live.current);
      }
      return () => {
        live.current = live.current.filter((e) => e.id !== id);
        setEntries(live.current);
        setRefusedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids));
      };
    },
    [cap],
  );

  const holds = useCallback((id: string) => entries.some((e) => e.id === id), [entries]);

  const closeTo = useCallback(
    (index: number) => {
      // Top down, so each level's own `onClose` sees the state it expects.
      for (let i = live.current.length - 1; i > index; i -= 1) live.current[i]?.close();
    },
    [],
  );

  const value = useMemo<SheetStackApi>(
    () => ({
      present: true,
      entries,
      cap,
      refusal: refusedIds.length > 0 ? SHEET_STACK_REFUSAL : null,
      join,
      holds,
      closeTo,
    }),
    [entries, cap, refusedIds, join, holds, closeTo],
  );

  return <SheetStackContext.Provider value={value}>{children}</SheetStackContext.Provider>;
}

export default SheetStackProvider;
