/**
 * The catalogue — every analysis this page can lay on the sheet.
 *
 *   "…we should ask them either to change the type of graph or to change the
 *    graph or the data analysis itself. Meaning, if it was showing the wine
 *    analysis, then maybe people don\u2019t want it — they\u2019re going to select from
 *    that aspect."          — the founder's review of the first pass, 2026-09-03
 *
 * Eleven entries, defined in `rp-registers-trade.tsx` and
 * `rp-registers-house.tsx` and assembled here. Every one of them is an endpoint
 * the gateway actually serves, cited below by `analytics.controller.ts` line,
 * plus the writing desk, which has no endpoint and says so. Nothing here is
 * aspirational: an analysis that is not in this file cannot be put on the
 * sheet, and an analysis in this file is one HTTP call away from a figure.
 *
 * TWO RULES DECIDE WHAT THE READER IS OFFERED
 * -------------------------------------------
 *  1. **`graphs` lists only the drawings that are true of that data.** The
 *     week's shape has no heat map because seasonality returns one dimension,
 *     not two. Figures of record has no bars because its eight figures are in
 *     four different units and a bar chart would compare dollars with days.
 *     A type the data cannot support is not greyed out — it is not offered, and
 *     `graphNote` says in one line why, so the absence is legible rather than
 *     mysterious. (DESIGN-FOUNDATION §6 says of `/reports`: do not copy
 *     "Lightspeed's chart-type picker — a spreadsheet in disguise". The picker
 *     the founder asked for is not that one: this is not "draw anything any
 *     way", it is "this register can honestly be read these ways".)
 *  2. **`say` beats every drawing.** When the honest rendering of a true answer
 *     is a sentence — no POS check has ever landed, every weekday reads zero,
 *     no model would fit — the view sets `say` and NOTHING is plotted, whatever
 *     type the reader chose. See `rp-view.ts`.
 */

import type { AnalysisId, GraphType } from './rp-sheet';
import type { AnalysisSpec } from './rp-spec';
import { ahead, pacing, reading, till, week } from './rp-registers-trade';
import { ledger, quadrants, restock, seats, service, writing } from './rp-registers-house';

export type { AnalysisSpec, ViewCtx } from './rp-spec';
export type {
  AheadRegister,
  PacingRegister,
  ReadingRow,
  TillWindow,
  WeekRegister,
} from './rp-registers-trade';
export type {
  LedgerRegister,
  QuadrantItem,
  QuadrantRegister,
  RestockRegister,
  SeatsRegister,
  ServiceRegister,
} from './rp-registers-house';

/* ─────────────────────────────────────────────────────── the catalogue ── */

/**
 * Declared as a keyed map, not an array of `{ id, … }` objects, so the shape
 * cannot be read as a table of seeded rows (ADR 0051 / S1). Every path below
 * is a route on `apps/api-gateway/src/analytics/analytics.controller.ts`:
 * insights :292 · pos-revenue :671 · cashflow :644 · seasonality :634 ·
 * forecast :209 · menu-engineering :614 · financial :126 ·
 * table-performance :425 · waiters :443 · inventory-science :156. (Every line
 * re-grepped from the `@Get(...)` decorators on 2026-09-03.)
 */
export const CATALOGUE: Record<AnalysisId, AnalysisSpec> = {
  reading,
  till,
  pacing,
  week,
  ahead,
  quadrants,
  ledger,
  seats,
  service,
  restock,
  writing,
};

/** The drawing a cutting falls back to when its stored one is no longer true. */
export function defaultGraph(id: AnalysisId): GraphType {
  return CATALOGUE[id].graphs[0] ?? 'table';
}

/** A stored graph type is only honoured while the analysis still supports it. */
export function graphOrDefault(id: AnalysisId, graph: GraphType): GraphType {
  return CATALOGUE[id].graphs.includes(graph) ? graph : defaultGraph(id);
}
