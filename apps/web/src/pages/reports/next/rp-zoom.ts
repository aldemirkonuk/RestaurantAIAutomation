/**
 * "Draw only these days" (r110 g1): the full-screen till zoomed to a marked
 * stretch, so every day of it is drawn instead of the highest of each run.
 *
 * Pure on purpose. The zoom is a slice of the one series the register built,
 * never a second read: `data`, every measure and the stretch callbacks move
 * together, so the bars, the combo line, the dashed prior and the stretch
 * readout inside the zoom all name the same days they named outside it.
 */
import type { CatSeries } from './rp-view';

/** A marked stretch this long or longer offers the zoom; one day is a tooltip, not a stretch. */
export const ZOOM_MIN_DAYS = 2;

/**
 * Whether a full-screen drawing offers the zoom at all: only a series that
 * offers a stretch (the till, never on a withheld read) and only at day grain
 * (a week or month bar already holds every day of its bucket).
 */
export function zoomOffered(series: CatSeries): boolean {
  return series.stretch != null && series.xLabel === 'day' && series.data.length >= ZOOM_MIN_DAYS;
}

/** The slots `a..b` (either order) clamped to the series, low to high; null when fewer than two days. */
export function zoomSpan(series: CatSeries, a: number, b: number): [number, number] | null {
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(series.data.length - 1, Math.max(a, b));
  return hi - lo + 1 >= ZOOM_MIN_DAYS ? [lo, hi] : null;
}

/**
 * The series cut to slots `lo..hi`, inclusive. Each Cat keeps its own `prior`
 * and `projected`, so the compare stays aligned day by day; each measure is
 * sliced the same way; the stretch callbacks are re-indexed by `+lo`, so slot
 * 0 of the zoom is slot `lo` of the window. A reference rule that names a day
 * outside the zoom is dropped; a rule across the plot (`y`) stays.
 */
export function zoomSeries(series: CatSeries, lo: number, hi: number): CatSeries {
  const data = series.data.slice(lo, hi + 1);
  const labels = new Set(data.map((d) => d.label));
  const { stretch, stretchFrom, measures, refs } = series;
  return {
    ...series,
    data,
    ...(measures ? { measures: measures.map((m) => ({ ...m, values: m.values.slice(lo, hi + 1) })) } : {}),
    ...(refs ? { refs: refs.filter((r) => r.x == null || labels.has(String(r.x))) } : {}),
    ...(stretch ? { stretch: (a: number, b: number) => stretch(a + lo, b + lo) } : {}),
    ...(stretchFrom ? { stretchFrom: (a: number) => stretchFrom(a + lo) } : {}),
  };
}

/** The caption's tail inside a zoom: "41 of 365 days, Oct 3 to Nov 12". */
export function zoomNote(series: CatSeries, lo: number, hi: number): string {
  return `${hi - lo + 1} of ${series.data.length} days, ${series.data[lo]?.label ?? ''} to ${series.data[hi]?.label ?? ''}`;
}

/** The way back: "All 365 days". */
export function zoomAllLabel(series: CatSeries): string {
  return `All ${series.data.length} days`;
}

/**
 * What a zoom belongs to. A window (its length and its ends), a grain (the
 * x-axis noun), a Draw as or a withheld read changes it, and a zoom held
 * under another key is dropped rather than carried over.
 */
export function zoomKey(series: CatSeries, kind: string): string {
  const d = series.data;
  return [kind, series.xLabel, d.length, d[0]?.label ?? '', d[d.length - 1]?.label ?? '', series.stretch ? 's' : '-'].join('|');
}
