/**
 * "Read a stretch" on the till (r108 g3): the reader marks a run of days on
 * the drawing and is told what that run took, in one line.
 *
 * Pure on purpose — the sums are money of record and are pinned here, not in
 * the drawing. The invariants:
 *
 *  1. Taken is the sum of the days whose takings are KNOWN. A day the server
 *     sent with no figure is never a 0: the line says over how many days the
 *     sum runs and how many the till could not state. A day absent from the
 *     series rang no check (the series is sparse on purpose), so it adds
 *     nothing and is not an unknown.
 *  2. Checks are said only when every day of the stretch carries its count.
 *  3. The average check is Σ taken ÷ Σ checks over the stretch, never the
 *     mean of each day's average (unequal days would weigh a quiet Monday the
 *     same as a full Saturday). It needs every day's takings and checks known.
 *  4. Money goes through the house formatter (`moneyIn`), never a bare `$`.
 *  5. Days are the gateway's house-day keys (ADR 0296), read as sent; the
 *     client never re-buckets a timestamp into a day.
 *  6. A withheld read (`salesWithheld`) offers no stretch at all.
 *  7. With compare on the stretch reads the window shown, and the prior is
 *     said only when every aligned prior day is known (the DD-r105-1 split).
 */
import { countOf, parseDateStr, type moneyIn } from './rp-format';
import type { TillWindow } from './rp-registers-trade';

type Money = ReturnType<typeof moneyIn>;

/* ─────────────────────────────────────────────────── the picking state ─── */

/**
 * Where the reader is in marking a stretch. `anchor`/`end` are slot indices
 * into the drawing's rows. `settled` false with an anchor is the single-pointer
 * path half done: one day tapped, the last day still to tap (WCAG 2.5.7).
 */
export interface StretchState {
  anchor: number | null;
  end: number | null;
  /** A press is down. */
  down: boolean;
  /** The press has crossed to another day since it went down. */
  moved: boolean;
  /** The press went down on a half-made stretch: its release completes it. */
  second: boolean;
  settled: boolean;
}

export const NO_STRETCH: StretchState = {
  anchor: null,
  end: null,
  down: false,
  moved: false,
  second: false,
  settled: false,
};

export type StretchEvent =
  | { type: 'down'; at: number }
  | { type: 'move'; at: number }
  | { type: 'up'; at?: number }
  | { type: 'clear' };

export function stretchStep(s: StretchState, e: StretchEvent): StretchState {
  switch (e.type) {
    case 'clear':
      return NO_STRETCH;
    case 'down':
      // A press on a half-made stretch picks its last day; any other press starts over.
      if (s.anchor != null && !s.settled && !s.down)
        return { ...s, end: e.at, down: true, moved: false, second: true };
      return { anchor: e.at, end: e.at, down: true, moved: false, second: false, settled: false };
    case 'move':
      if (!s.down || e.at === s.end) return s;
      return { ...s, end: e.at, moved: true };
    case 'up': {
      if (!s.down) return s;
      const end = e.at ?? s.end;
      // A tap that did not travel opens the single-pointer path: this is the first day.
      if (!s.moved && !s.second) return { ...s, end, down: false };
      return { ...s, end, down: false, moved: false, second: false, settled: true };
    }
  }
}

/** The marked slots, low to high, or null with nothing marked. */
export function stretchSpan(s: StretchState): [number, number] | null {
  if (s.anchor == null || s.end == null) return null;
  return s.anchor <= s.end ? [s.anchor, s.end] : [s.end, s.anchor];
}

/* ───────────────────────────────────────────────────────── the reading ─── */

/** "Tue, Nov 4" — the weekday beside the day, so a stretch's edges are unmistakable. */
export function dayWords(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return parseDateStr(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export interface StretchReading {
  /** The days marked, as the gateway keyed them. */
  days: string[];
  /** Σ of the known days' takings; null when no day of the stretch is known. */
  taken: number | null;
  /** Days of the stretch the server sent with no figure. */
  unknownDays: number;
  /** Σ checks; null unless every day of the stretch carries its count. */
  checks: number | null;
  /** Σ taken ÷ Σ checks; null unless every day's takings and checks are known and some check rang. */
  average: number | null;
  /** The aligned prior days' Σ; null unless compare is on and every aligned prior day is known. */
  prior: number | null;
}

/**
 * The stretch `a..b` (slot indices into `shown`, either order) of the window
 * the till card draws. `w` is the window as drawn: with compare on, the split
 * one (`splitTill`), so its `dailySeries` is the shown window and `prior` the
 * one before it; `priorDays` is every day of that prior window, oldest first
 * (slot i of it is aligned with slot i of `shown`). Undefined when there is
 * nothing to read: a withheld read, no till, no house zone, or no day marked.
 */
export function readStretch(
  w: TillWindow,
  shown: readonly string[],
  a: number,
  b: number,
  priorDays: readonly string[] | null = null,
): StretchReading | undefined {
  if (w.salesWithheld || !w.posConnected || w.zoneUnset) return undefined;
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(shown.length - 1, Math.max(a, b));
  if (hi < lo) return undefined;
  const days = shown.slice(lo, hi + 1);
  const byDate = new Map(w.dailySeries.map((d) => [d.date, d]));
  let taken = 0;
  let knownDays = 0;
  let unknownDays = 0;
  let checks: number | null = 0;
  for (const date of days) {
    const d = byDate.get(date);
    // Absent: the till rang no check that day, which it did state.
    if (!d) {
      knownDays += 1;
      continue;
    }
    if (d.revenue == null) unknownDays += 1;
    else {
      taken += d.revenue;
      knownDays += 1;
    }
    checks = checks == null || d.checks == null ? null : checks + d.checks;
  }
  const average = unknownDays === 0 && checks != null && checks > 0 ? taken / checks : null;
  return {
    days,
    taken: knownDays > 0 ? taken : null,
    unknownDays,
    checks,
    average,
    prior: priorDays ? priorOf(w, priorDays, shown.length, lo, hi) : null,
  };
}

/** The aligned prior days' Σ, only when every one of them is known. */
function priorOf(w: TillWindow, span: readonly string[], length: number, lo: number, hi: number): number | null {
  if (!w.prior || span.length !== length) return null;
  const byDate = new Map(w.prior.dailySeries.map((d) => [d.date, d.revenue]));
  let sum = 0;
  for (const date of span.slice(lo, hi + 1)) {
    if (!byDate.has(date)) continue;
    const v = byDate.get(date);
    if (v == null) return null;
    sum += v;
  }
  return sum;
}

/**
 * The readout, one line: "Tue, Nov 4 – Sun, Nov 9 · 6 days · Taken $4,120 ·
 * 212 checks · average $19.43". Every money figure is the house's.
 */
export function stretchWords(r: StretchReading, money: Money): string {
  const n = r.days.length;
  const first = r.days[0];
  const last = r.days[n - 1];
  const parts = [n === 1 ? dayWords(first) : `${dayWords(first)} – ${dayWords(last)}`, countOf(n, 'day', 'days')];
  if (r.taken == null) parts.push('Taken: the till could not state these days');
  else if (r.unknownDays > 0)
    parts.push(
      `Taken ${money(r.taken)} over ${n - r.unknownDays} of ${countOf(n, 'day', 'days')}; ${countOf(r.unknownDays, 'day', 'days')} the till could not state`,
    );
  else parts.push(`Taken ${money(r.taken)}`);
  parts.push(r.checks == null ? 'checks a day are not read' : countOf(r.checks, 'check', 'checks'));
  if (r.average != null) parts.push(`average ${money(r.average, 'table')}`);
  if (r.prior != null && r.taken != null && r.unknownDays === 0) {
    const change = r.prior > 0 ? ((r.taken - r.prior) / r.prior) * 100 : null;
    parts.push(
      `prior ${money(r.prior)}${change == null ? '' : ` (${change > 0 ? '+' : ''}${change.toFixed(1)}%)`}`,
    );
  }
  return parts.join(' · ');
}

/** The first-day prompt on the single-pointer path. */
export function halfWords(date: string): string {
  return `From ${dayWords(date)}. Tap the last day, or press Escape.`;
}
