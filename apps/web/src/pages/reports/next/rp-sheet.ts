/**
 * The sheet's vocabulary — which analyses can be laid on the paper, how a
 * cutting is drawn, and where the eight default ones lie before the reader
 * moves them.
 *
 * These are DESCRIPTORS, not rows: an id, a slot on a 12-column ruling, a way
 * of drawing. Nothing here asserts anything about a restaurant — every figure
 * comes from `useReportsNextData` through the catalogue in `rp-catalogue.tsx`.
 * The default arrangement is declared as a keyed map rather than an array of
 * `{ id, … }` objects so the shape cannot be mistaken for a table of seeded
 * rows (ADR 0051 / `scripts/check_no_seeded_defaults.py` S1).
 *
 * This file deliberately imports nothing: the catalogue imports these types,
 * so the ids must live below it, not beside it.
 */

/** Every analysis the sheet can show. The catalogue holds one entry per id. */
export const ANALYSIS_IDS = [
  'reading',
  'till',
  'goals',
  'bench',
  'pacing',
  'week',
  'ahead',
  'quadrants',
  'ledger',
  'seats',
  'service',
  'restock',
  'writing',
] as const;

export type AnalysisId = (typeof ANALYSIS_IDS)[number];

export function isAnalysisId(v: unknown): v is AnalysisId {
  return typeof v === 'string' && (ANALYSIS_IDS as readonly string[]).includes(v);
}

/**
 * How a cutting is drawn. A type is offered ONLY where it is truthful for that
 * analysis's data (the catalogue's `graphs` list decides), so this union is the
 * vocabulary, never the menu — see `rp-catalogue.tsx` for why each analysis
 * withholds the types it withholds.
 */
export const GRAPH_TYPES = [
  'line',
  'bars',
  'area',
  'heatmap',
  'scatter',
  'table',
  'figure',
] as const;

export type GraphType = (typeof GRAPH_TYPES)[number];

export function isGraphType(v: unknown): v is GraphType {
  return typeof v === 'string' && (GRAPH_TYPES as readonly string[]).includes(v);
}

/** The reader's word for each drawing. Sentence case: these are labels, not shouts. */
export const GRAPH_LABEL: Record<GraphType, string> = {
  line: 'Line',
  bars: 'Bars',
  area: 'Area',
  heatmap: 'Heat map',
  scatter: 'Scatter',
  table: 'Table',
  figure: 'One figure',
};

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One cutting as it lies on the sheet: what it shows, where, drawn how. */
export interface Cutting {
  id: AnalysisId;
  slot: Slot;
  graph: GraphType;
}

export interface SheetState {
  cuttings: Cutting[];
}

/**
 * The default arrangement — the founder's "some blocks moved". The reading
 * (the engine's own sentences) takes the head of the sheet because the verdict
 * asked for "more focus on the insights"; the writing desk is last because it
 * is honest about having no writer behind it.
 *
 * Three catalogue analyses (`seats`, `service`, `restock`) are NOT on the
 * default sheet. They are real endpoints with real cuttings, held off the first
 * screen so the default stays readable — "Add a cutting" while arranging puts
 * any of them on.
 */
export const DEFAULT_SLOTS: Record<AnalysisId, Slot> = {
  reading: { x: 0, y: 0, w: 7, h: 9 },
  till: { x: 7, y: 0, w: 5, h: 9 },
  goals: { x: 0, y: 9, w: 7, h: 11 },
  bench: { x: 7, y: 9, w: 5, h: 11 },
  pacing: { x: 0, y: 20, w: 4, h: 7 },
  week: { x: 4, y: 20, w: 4, h: 7 },
  ahead: { x: 8, y: 20, w: 4, h: 7 },
  quadrants: { x: 0, y: 27, w: 7, h: 8 },
  ledger: { x: 7, y: 27, w: 5, h: 8 },
  seats: { x: 0, y: 35, w: 6, h: 8 },
  service: { x: 6, y: 35, w: 6, h: 8 },
  restock: { x: 0, y: 43, w: 12, h: 8 },
  writing: { x: 0, y: 51, w: 12, h: 3 },
};

/** Which analyses lie on a sheet nobody has arranged yet. */
export const DEFAULT_ON: AnalysisId[] = [
  'reading',
  'till',
  'goals',
  'bench',
  'pacing',
  'week',
  'ahead',
  'quadrants',
  'ledger',
  'writing',
];

/**
 * Analyses that did not exist when a stored sheet was written.
 *
 * `encodeSheet` writes EVERY id, on or off, so an id missing from a stored
 * blob can only mean "this analysis did not exist when that sheet was saved".
 * Those, and only those, are put back on: a reader who deliberately took a
 * cutting off keeps it off, and a reader who ruled off a sheet before the goals
 * desk existed is not left without the one the founder asked to be visible.
 */
export const IDS_ADDED_IN_V3: AnalysisId[] = ['goals', 'bench'];

/** The 12-column ruling the sheet is set on. */
export const SHEET_COLS = 12;
export const SHEET_ROW_HEIGHT = 34;
export const SHEET_MARGIN: [number, number] = [14, 14];

/**
 * A cutting's floor. Named here rather than inline in `Sheet.tsx` because the
 * keyboard path (`rp-arrange.ts`) has to enforce the same one — the pointer
 * path gets it from react-grid-layout's own min-size constraint, and a
 * keyboard resize that could shrink past it would be a different interaction
 * wearing the same name.
 */
export const SHEET_MIN_W = 3;
export const SHEET_MIN_H = 3;

/**
 * The responsive ruling, shared by the grid and by the keyboard.
 *
 * `Sheet.tsx` hands these to react-grid-layout; `rp-arrange.ts` reads them
 * back through the library's OWN `getBreakpointFromWidth`, so a keyboard move
 * on a narrow screen lands on the same ruling a dragged one would.
 */
export const SHEET_BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
export const SHEET_BREAKPOINT_COLS = {
  lg: SHEET_COLS,
  md: SHEET_COLS,
  sm: 6,
  xs: 4,
  xxs: 2,
};

/* ─────────────────────────────────────────── named house layouts ───────── */

/**
 * *"A house layout, not an empty one"* — DESIGN-FOUNDATION §6 for `/reports`,
 * filed **need it: now**, and the shape the founder's *"editable for
 * personalized screens"* asks for: you start from the house's arrangement for
 * the job in front of you, then edit it into your own.
 *
 * A layout is a LIST OF IDS and nothing else. It carries no geometry of its
 * own: `packSlots` lays each cutting out at the size it is declared above,
 * left to right, wrapping at the ruling. That is deliberate on two counts —
 * a hand-written slot table would be four more places for a width to drift,
 * and a table of `{ id, x, y, w, h }` literals is exactly the shape
 * `scripts/check_no_seeded_defaults.py` S1 exists to refuse.
 *
 * Applying one writes the DRAFT, never the saved sheet. It is a starting
 * point; "Rule it off" is still what commits it.
 */
export const HOUSE_LAYOUT_IDS = ['house', 'service', 'buying', 'month'] as const;

export type HouseLayoutId = (typeof HOUSE_LAYOUT_IDS)[number];

export const HOUSE_LAYOUT_TITLE: Record<HouseLayoutId, string> = {
  house: 'The house sheet',
  service: 'Before service',
  buying: 'Buying week',
  month: 'Month end',
};

export const HOUSE_LAYOUT_NOTE: Record<HouseLayoutId, string> = {
  house: 'Everything the house reads by default.',
  service: 'What the room is about to do, and who is on it.',
  buying: 'What is running out, what it costs, and how hard buying is running.',
  month: 'What the capital did, and where each goal finished.',
};

export const HOUSE_LAYOUT_CUTTINGS: Record<HouseLayoutId, AnalysisId[]> = {
  house: DEFAULT_ON,
  service: ['reading', 'till', 'week', 'seats', 'service'],
  buying: ['restock', 'pacing', 'ahead', 'quadrants', 'reading'],
  month: ['ledger', 'goals', 'bench', 'till', 'quadrants', 'writing'],
};

/**
 * Lay a list of cuttings out on the ruling, left to right, wrapping when the
 * next one will not fit. Each keeps the size it is declared with above, so the
 * only thing a layout decides is WHICH cuttings and in WHAT ORDER.
 */
export function packSlots(ids: AnalysisId[], cols = SHEET_COLS): Record<string, Slot> {
  const slots: Record<string, Slot> = {};
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const id of ids) {
    const { w: declaredW, h } = DEFAULT_SLOTS[id];
    const w = Math.min(declaredW, cols);
    if (x + w > cols) {
      y += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    slots[id] = { x, y, w, h };
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }
  return slots;
}
