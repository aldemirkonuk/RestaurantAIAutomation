/**
 * The spindle's contract — what a Sheet may ask of the page it is on.
 *
 * Split from `SheetStack.tsx` so the component file exports only a component
 * (the repo's `react-refresh/only-export-components` rule; `dayStripDates.ts`
 * is the same split). The provider, and why depth is a page fact rather than a
 * document one, are in `SheetStack.tsx`.
 */

import { createContext, useContext } from 'react';

/** ADR 0112 · F9: "stacked sheets are capped at three with a breadcrumb". */
export const SHEET_STACK_CAP = 3;

export const SHEET_STACK_REFUSAL =
  'Three sheets are open. Close one to open this.';

export interface SheetStackEntry {
  id: string;
  /** The word on the spine. The sheet's own title. */
  title: string;
  /**
   * Leave this level by the sheet's own leave path — a clean sheet closes, a
   * dirty one TEARS (1b), so a spine jump never throws a draft away silently.
   */
  leave: () => void;
}

export interface SheetStackApi {
  /** False when no provider is above: no cap, no spine, no breadcrumb. */
  present: boolean;
  entries: SheetStackEntry[];
  cap: number;
  /**
   * The sentence on the paper while at least one sheet is waiting for a level,
   * or null. It is derived from the queue, never remembered, so it cannot
   * outlive its truth.
   */
  refusal: string | null;
  /**
   * Ask for a level. Returns a release function for the effect's cleanup.
   *
   * A sheet that finds the spindle full is QUEUED, not dropped: it renders
   * nothing, the sentence goes onto the top sheet (where the reader's eye
   * already is), and the moment any level is released the oldest waiting sheet
   * is admitted. "Close one to open this" is therefore a promise the provider
   * keeps rather than a sentence that stays on the paper after it stopped
   * being true.
   */
  join: (id: string, title: string, leave: () => void) => () => void;
  /** Rename a level (admitted or waiting) without changing its position. */
  rename: (id: string, title: string) => void;
  /** Is this id waiting for a level? Render-time: read from state. */
  waiting: (id: string) => boolean;
  /**
   * Is this id holding a level RIGHT NOW? Effect-time: read from the live list,
   * which is ahead of state during the commit in which a sheet joins.
   */
  admitted: (id: string) => boolean;
  /** Leave every level above `index`, top down, each by its own leave path. */
  closeTo: (index: number) => void;
}

export const NO_STACK: SheetStackApi = {
  present: false,
  entries: [],
  cap: SHEET_STACK_CAP,
  refusal: null,
  join: () => () => {},
  rename: () => {},
  waiting: () => false,
  admitted: () => true,
  closeTo: () => {},
};

export const SheetStackContext = createContext<SheetStackApi>(NO_STACK);

export function useSheetStack(): SheetStackApi {
  return useContext(SheetStackContext);
}
