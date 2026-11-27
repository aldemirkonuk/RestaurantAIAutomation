/**
 * Which cuttings have nothing to draw, and what a sparkline may be drawn from.
 *
 * Both read the SAME view a cutting draws (`spec.view`), so the page cannot
 * claim a cutting is empty, or plot a series, that the cutting itself would
 * not. Nothing here is computed from a second source, and nothing is invented:
 * a register that is loading or refused is neither "empty" nor a line.
 */

import { CATALOGUE, graphOrDefault } from "./rp-catalogue";
import { readsRegister, type ViewCtx } from "./rp-spec";
import type { AnalysisId, GraphType } from "./rp-sheet";
import type { AnalysisView } from "./rp-view";
import type { Register } from "./useReportsNextData";
import type { MutableRefObject } from "react";

/** Rows a collapsed (empty) cutting keeps: 2 x 34 + 14 = 82 px of ruling, drawn 72 px tall. */
export const STRIP_ROWS = 2;

/**
 * True when the answer has no drawing of the chosen shape in it: the register
 * could not honestly be drawn that way at all. The cutting says so in a
 * sentence (`Undrawable`) rather than an empty frame.
 */
export function cannotDraw(view: AnalysisView, graph: GraphType): boolean {
  if (view.say) return false;
  switch (graph) {
    case "line":
    case "area":
    case "bars":
      return !view.cats;
    case "combo":
      return !view.cats?.measures?.length;
    case "scatter":
      return !view.points;
    case "heatmap":
      return !view.matrix;
    case "figure":
      return view.figures.length === 0;
    case "table":
    default:
      return !view.node && !view.table;
  }
}

/**
 * True when the register has been read, was not refused, and its honest
 * answer is a sentence (`view.say`, or a shape it cannot be drawn as) with no
 * drawing behind it. A loading or failed register keeps its full card: it has
 * a retry to show. The week that reads zero is a strip too (r73 c3 need 11):
 * its own "No pours read this week" line is the strip's sentence.
 */
export function isStrip(
  id: AnalysisId,
  register: Register<unknown> | undefined,
  ctx: ViewCtx,
  graph?: GraphType,
): boolean {
  const spec = CATALOGUE[id];
  if (!readsRegister(spec)) return false;
  // A cutting that takes a window keeps its picker in reach: a longer window
  // is exactly what could give an empty one something to draw.
  if (spec.takesWindow) return false;
  if (
    !register ||
    register.loading ||
    register.failure ||
    register.data === undefined
  )
    return false;
  try {
    const view = spec.view(register.data, ctx);
    if (view.say != null) return true;
    return graph != null && cannotDraw(view, graphOrDefault(id, graph));
  } catch {
    return false;
  }
}

export interface SparkSeries {
  id: AnalysisId;
  title: string;
  values: number[];
  /** The last recorded value, written the way the cutting writes it. */
  last: string;
  /** What the line is of, from the series' own words. */
  of: string;
}

/** The two registers whose shape reads in a glance: takings by day and the week's pattern. */
export const SPARK_IDS = [
  "till",
  "week",
] as const satisfies readonly AnalysisId[];

/**
 * A series is drawn only when it has at least two RECORDED points: a gap
 * (`null`) is skipped, never rested at zero, and one point is not a line.
 */
export function sparkOf(
  id: AnalysisId,
  register: Register<unknown> | undefined,
  ctx: ViewCtx,
): SparkSeries | null {
  const spec = CATALOGUE[id];
  if (
    !register ||
    register.loading ||
    register.failure ||
    register.data === undefined
  )
    return null;
  try {
    const view = spec.view(register.data, ctx);
    if (view.say || !view.cats) return null;
    const values = view.cats.data
      .map((d) => d.value)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (values.length < 2) return null;
    return {
      id,
      title: spec.title,
      values,
      last: view.cats.format(values[values.length - 1]),
      of: view.cats.yLabel,
    };
  } catch {
    return null;
  }
}

/** The last whole read of a windowed register and the days it answered. */
export type LastRead = { data: unknown; days: number } | null;

/**
 * What a windowed card DRAWS right now (ADR 0020): the register's own answer, or,
 * while a newly picked window is read, the last whole read with its own days (the
 * stand-in, never for a first read). Cutting draws from this and the page sizes
 * the phone till's held row from the same answer, so a hold cannot fall to 0
 * while the card still shows the prior row (r107 reports fix on #2178).
 * Updates `last` as a render-time ref, as Cutting always has.
 */
export function drawnRegister(
  takesWindow: boolean,
  register: Register<unknown> | undefined,
  ctx: ViewCtx,
  last: MutableRefObject<LastRead>,
): { standIn: NonNullable<LastRead> | null; data: unknown; ctx: ViewCtx } {
  if (takesWindow && register && !register.loading && !register.failure && register.data !== undefined)
    last.current = { data: register.data, days: ctx.days };
  const standIn =
    takesWindow && register?.loading && !register.failure && last.current && last.current.days !== ctx.days
      ? last.current
      : null;
  return {
    standIn,
    data: standIn ? standIn.data : register?.data,
    ctx: standIn ? { ...ctx, days: standIn.days } : ctx,
  };
}
