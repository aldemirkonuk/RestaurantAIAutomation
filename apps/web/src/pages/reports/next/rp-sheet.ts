/**
 * The sheet's vocabulary — which cuttings exist, what each is called, and
 * where it lies before the reader moves it.
 *
 * These are DESCRIPTORS, not rows: an id, a name, a slot on a 12-column
 * ruling. Nothing here asserts anything about a restaurant — every figure
 * comes from `useReportsNextData`. They are declared as a keyed map rather
 * than an array of `{ id, … }` objects so the shape cannot be mistaken for a
 * table of seeded rows (ADR 0051 / `scripts/check_no_seeded_defaults.py` S1).
 */

export const REPORT_BLOCK_IDS = [
  'reading',
  'till',
  'pacing',
  'week',
  'quadrants',
  'ahead',
  'ledger',
  'writing',
] as const;

export type ReportBlockId = (typeof REPORT_BLOCK_IDS)[number];

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The default arrangement — the founder's "some blocks moved". The reading
 * (the engine's own sentences) takes the head of the sheet because the verdict
 * asked for "more focus on the insights"; the writing desk is last because it
 * is honest about having no writer behind it.
 */
export const DEFAULT_SHEET: Record<ReportBlockId, Slot> = {
  reading: { x: 0, y: 0, w: 7, h: 9 },
  till: { x: 7, y: 0, w: 5, h: 9 },
  pacing: { x: 0, y: 9, w: 4, h: 7 },
  week: { x: 4, y: 9, w: 4, h: 7 },
  ahead: { x: 8, y: 9, w: 4, h: 7 },
  quadrants: { x: 0, y: 16, w: 7, h: 8 },
  ledger: { x: 7, y: 16, w: 5, h: 8 },
  writing: { x: 0, y: 24, w: 12, h: 3 },
};

/**
 * `title` heads the cutting. `register` is the noun a failure line uses —
 * "the seasonality register could not be read" — so an error always names
 * what could not be read instead of rendering an empty chart.
 */
export const BLOCK_META: Record<ReportBlockId, { title: string; register: string }> = {
  reading: { title: 'The reading', register: 'insight register' },
  till: { title: 'Through the till', register: 'till register' },
  pacing: { title: 'Spend pacing', register: 'cashflow register' },
  week: { title: 'The week’s shape', register: 'seasonality register' },
  ahead: { title: 'What’s coming', register: 'forecast register' },
  quadrants: { title: 'Margin against movement', register: 'menu-engineering register' },
  ledger: { title: 'Figures of record', register: 'financial register' },
  writing: { title: 'The writing desk', register: 'report archive' },
};

/** The 12-column ruling the sheet is set on. */
export const SHEET_COLS = 12;
export const SHEET_ROW_HEIGHT = 34;
export const SHEET_MARGIN: [number, number] = [14, 14];
