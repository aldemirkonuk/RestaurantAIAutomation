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
  pacing: { x: 0, y: 9, w: 4, h: 7 },
  week: { x: 4, y: 9, w: 4, h: 7 },
  ahead: { x: 8, y: 9, w: 4, h: 7 },
  quadrants: { x: 0, y: 16, w: 7, h: 8 },
  ledger: { x: 7, y: 16, w: 5, h: 8 },
  seats: { x: 0, y: 24, w: 6, h: 8 },
  service: { x: 6, y: 24, w: 6, h: 8 },
  restock: { x: 0, y: 32, w: 12, h: 8 },
  writing: { x: 0, y: 40, w: 12, h: 3 },
};

/** Which analyses lie on a sheet nobody has arranged yet. */
export const DEFAULT_ON: AnalysisId[] = [
  'reading',
  'till',
  'pacing',
  'week',
  'ahead',
  'quadrants',
  'ledger',
  'writing',
];

/** The 12-column ruling the sheet is set on. */
export const SHEET_COLS = 12;
export const SHEET_ROW_HEIGHT = 34;
export const SHEET_MARGIN: [number, number] = [14, 14];
