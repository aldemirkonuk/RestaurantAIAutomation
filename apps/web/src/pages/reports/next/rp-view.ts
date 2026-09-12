/**
 * The one shape every analysis reduces to before it is drawn.
 *
 * Pass one gave each register its own component, which meant each register
 * also owned its own chart. The founder asked for the opposite: *"we should
 * ask them either to change the type of graph or to change the graph or the
 * data analysis itself"* — a cutting whose drawing and whose subject are both
 * the reader's choice. That is only possible if every analysis speaks one
 * language, so each catalogue entry turns its payload into an `AnalysisView`
 * and the renderer decides how to draw it.
 *
 * Two properties of this shape are load-bearing rather than convenient:
 *
 *  1. **`say` outranks every drawing.** When the true answer must be said and
 *     not drawn — no POS check has ever landed, every weekday reads zero, no
 *     model would fit — the builder sets `say` and NOTHING is plotted, whatever
 *     graph type the reader picked. An empty axis claims the restaurant did
 *     nothing; a sentence says which register is empty. One rule, enforced in
 *     one place, instead of eleven components each remembering it.
 *  2. **A missing series is not an empty series.** `cats`, `points` and
 *     `matrix` are absent when the analysis cannot be drawn that way at all;
 *     an individual `value: null` inside them is a gap in a series that exists.
 *     The plots skip nulls (`connectNulls={false}`, a blank heat cell) rather
 *     than resting them on the floor at zero.
 */

import type { ReactNode } from 'react';

/** One point of a categorical or dated series. `null` is a gap, never a zero. */
export interface Cat {
  label: string;
  value: number | null;
  /** A model's expectation for the same slot — drawn dashed, never solid. */
  projected?: number | null;
  /** Long form for the tooltip when `label` is abbreviated for the axis. */
  full?: string;
}

/** A rule drawn across a plot, and the words for why it is there. */
export interface Ref {
  y?: number;
  x?: string | number;
  label: string;
}

export interface CatSeries {
  data: Cat[];
  xLabel: string;
  yLabel: string;
  /** The noun a tooltip puts after the number — "taken", "bottles/day". */
  unit: string;
  /** How a value is written out in the tooltip. */
  format: (v: number) => string;
  /** Reference lines the SERVER produced. Never one we computed here. */
  refs?: Ref[];
  /** True when `projected` carries a second, dashed series. */
  projectedLabel?: string;
}

export interface Point {
  x: number;
  y: number;
  name: string;
}

export interface PointSeries {
  data: Point[];
  xLabel: string;
  yLabel: string;
  formatX: (v: number) => string;
  formatY: (v: number) => string;
  refX?: number | null;
  refY?: number | null;
}

/** One cell of a heat map. `value: null` means no row was recorded for it. */
export interface Cell {
  row: string;
  col: string;
  value: number | null;
  /** What the cell is, in words, for its tooltip and its accessible name. */
  title: string;
}

export interface MatrixSeries {
  rows: string[];
  cols: string[];
  cells: Cell[];
  xLabel: string;
  yLabel: string;
  unit: string;
  format: (v: number) => string;
}

export interface TableSpec {
  cols: Array<{ key: string; label: string; numeric?: boolean }>;
  rows: Array<{ key: string; cells: string[] }>;
  /** Printed under the table when it shows only part of a longer register. */
  more?: string;
}

/** One labelled figure of record. `value` is already formatted (or the dash). */
export interface Fig {
  label: string;
  value: string;
  /** Why it is a dash, shown on hover when it is one. */
  note?: string;
}

export interface AnalysisView {
  /** When set, this sentence IS the rendering. No chart is drawn. */
  say?: ReactNode;
  cats?: CatSeries;
  points?: PointSeries;
  matrix?: MatrixSeries;
  table?: TableSpec;
  /** Replaces the table rendering for an analysis whose rows are not a grid. */
  node?: ReactNode;
  figures: Fig[];
  /** Sentences printed under the drawing — caveats, counts, what is off-plot. */
  notes: ReactNode[];
  /** The SERVER's own `basis` strings, verbatim. Nulls are dropped. */
  basis: Array<string | null | undefined>;
}
