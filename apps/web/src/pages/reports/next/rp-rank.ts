/**
 * Ranked bars (r110 g2): how many are drawn, from which end, and every tie.
 *
 * A register that ranks (wines by margin, tables and servers by takings,
 * goods by stockout risk) used to cut its own list with `slice(0, 12)`. That
 * drew part of a tie and dropped the rest by row order, never said how many
 * rows it left out, and could not show the other end at all: the wines that
 * do not earn their place were never drawable. The register now hands over
 * every ranked row, and the drawing cuts it here, in one place, by one rule.
 */
import type { Cat, CatSeries, Measure } from './rp-view';

export type RankEnd = 'high' | 'low';

/**
 * Two values are tied when they are the same computed figure to within
 * floating-point noise: one part in a billion, the gateway's own `sameValue`
 * (ADR 0272). Two figures that merely PRINT alike are not tied.
 */
export function same(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

export interface RankCut {
  data: Cat[];
  measures?: Measure[];
  /** Rows drawn. */
  shown: number;
  /** Rows ranked. */
  total: number;
  /** A tie at the edge ran past `max` and was cut there in the register's order. */
  tieCut: boolean;
}

/**
 * The first `n` rows from the chosen end, and every row tied with the edge
 * row (ADR 0272). Highest is largest first; Lowest is smallest first, from the
 * left. A row with no value is unranked and sits last from either end. A tie
 * at 0 is never extended: it is the rows with nothing to rank. Measures are
 * cut with the bars, so a combo line stays on the same rows. Never more than
 * `max` rows (the most a drawing carries), so a ranking is never thinned.
 */
export function rankSlice(
  rows: readonly Cat[],
  measures: readonly Measure[] | undefined,
  n: number,
  end: RankEnd,
  max: number = Number.POSITIVE_INFINITY,
): RankCut {
  const sign = end === 'high' ? -1 : 1;
  const order = rows
    .map((_, i) => i)
    .sort((i, j) => {
      const a = rows[i].value;
      const b = rows[j].value;
      if (a == null || b == null) return a == null ? (b == null ? i - j : 1) : -1;
      return same(a, b) ? i - j : sign * (a - b);
    });
  let stop = Math.min(n, order.length);
  let tieCut = false;
  if (stop > 0 && stop < order.length) {
    const edge = rows[order[stop - 1]].value;
    if (edge != null && !same(edge, 0)) {
      while (stop < order.length && same(rows[order[stop]].value, edge)) stop++;
    }
  }
  if (stop > max) {
    stop = max;
    tieCut = true;
  }
  const kept = order.slice(0, stop);
  return {
    data: kept.map((i) => rows[i]),
    ...(measures ? { measures: measures.map((m) => ({ ...m, values: kept.map((i) => m.values[i] ?? null) })) } : {}),
    shown: kept.length,
    total: rows.length,
    tieCut,
  };
}

/** "12 of 37 wines, highest margin first"; null when every row is drawn. */
export function rankCaption(cut: RankCut, rank: NonNullable<CatSeries['rank']>, end: RankEnd): string | null {
  if (cut.shown >= cut.total) return null;
  return `${cut.shown} of ${cut.total} ${rank.noun}, ${end === 'high' ? 'highest' : 'lowest'} ${rank.by} first${
    cut.tieCut ? '; a tie runs on past the last bar' : ''
  }`;
}

/**
 * The series a ranked drawing draws: on a card the register's cap, in full
 * screen up to `max`. A series that does not rank is returned as it is.
 */
export function ranked(
  series: CatSeries,
  end: RankEnd,
  cap: number,
  max: number,
): { series: CatSeries; caption: string | null; cut: boolean } {
  const rank = series.rank;
  if (!rank) return { series, caption: null, cut: false };
  const cut = rankSlice(series.data, series.measures, cap, end, max);
  return {
    series: { ...series, data: cut.data, ...(cut.measures ? { measures: cut.measures } : {}) },
    caption: rankCaption(cut, rank, end),
    cut: cut.shown < cut.total,
  };
}
