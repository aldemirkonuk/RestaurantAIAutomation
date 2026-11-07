/**
 * Bars and a line on one set of points (founder /goal 2026-11-07: "each graph
 * bar graph and their combinations"). Pure — no React, no recharts — so the
 * three rules that make the drawing honest can be tested without a canvas:
 *
 *  1. **One axis per unit.** Two measures share the left axis only when their
 *     `unit` is the same word. A count of days drawn against bottles a day on
 *     one scale would make the smaller look like nothing, so a different unit
 *     gets its own axis on the right, named in words. Never a guess from the
 *     size of the numbers.
 *  2. **A gap is a gap.** `null` stays `null` all the way to the chart. The bar
 *     is absent and the line breaks; neither rests on zero ("nobody rang
 *     anything up" and "a quiet day" must not look alike).
 *  3. **The picker cannot name a measure twice.** Choosing for the bars what
 *     the line shows swaps them, so there is never a bar and a line of the same
 *     thing.
 *
 * Which measures a cutting offers is the register's business (`CatSeries.
 * measures`); a cutting with only one measure returns `null` here and the
 * drawing says it cannot be drawn this way, like every other missing shape.
 */

import type { CatSeries, Measure } from './rp-view';

/** The key of the series' own measure (`Cat.value`), named by `yLabel`/`unit`. */
export const PRIMARY_KEY = 'value';

export interface ComboPick {
  /** `Measure.key` drawn as bars. */
  bars: string;
  /** `Measure.key` drawn as the line. */
  line: string;
}

export interface ComboRow {
  label: string;
  full: string;
  bar: number | null;
  line: number | null;
}

export interface ComboPlan {
  /** Every measure the reader may pick from, primary first. */
  measures: Measure[];
  pick: ComboPick;
  bars: Measure;
  line: Measure;
  /** True when the two units differ, so the line gets its own right-hand axis. */
  split: boolean;
  rows: ComboRow[];
}

/** The primary measure, then the register's extras. `null` when only one exists. */
export function comboMeasures(series: CatSeries): Measure[] | null {
  const extras = (series.measures ?? []).filter((m) => m.key !== PRIMARY_KEY);
  if (extras.length === 0) return null;
  const primary: Measure = {
    key: PRIMARY_KEY,
    label: series.measureLabel ?? series.yLabel,
    unit: series.unit,
    format: series.format,
    values: series.data.map((d) => d.value),
  };
  return [primary, ...extras];
}

/** The reader's pick where it names real, different measures; the defaults otherwise. */
export function resolvePick(measures: Measure[], want?: Partial<ComboPick>): ComboPick {
  const has = (k?: string): k is string => !!k && measures.some((m) => m.key === k);
  const bars = has(want?.bars) ? want!.bars! : measures[0].key;
  const line =
    has(want?.line) && want!.line !== bars
      ? want!.line!
      : (measures.find((m) => m.key !== bars) ?? measures[0]).key;
  return { bars, line };
}

/** Put `key` on `side`; if the other side already shows it, the two trade places. */
export function choose(pick: ComboPick, side: keyof ComboPick, key: string): ComboPick {
  if (pick[side] === key) return pick;
  const other: keyof ComboPick = side === 'bars' ? 'line' : 'bars';
  return pick[other] === key ? { ...pick, [side]: key, [other]: pick[side] } : { ...pick, [side]: key };
}

export function planCombo(series: CatSeries, want?: Partial<ComboPick>): ComboPlan | null {
  const measures = comboMeasures(series);
  if (!measures) return null;
  const pick = resolvePick(measures, want);
  const bars = measures.find((m) => m.key === pick.bars) as Measure;
  const line = measures.find((m) => m.key === pick.line) as Measure;
  return {
    measures,
    pick,
    bars,
    line,
    split: bars.unit !== line.unit,
    rows: series.data.map((d, i) => ({
      label: d.label,
      full: d.full ?? d.label,
      bar: bars.values[i] ?? null,
      line: line.values[i] ?? null,
    })),
  };
}
