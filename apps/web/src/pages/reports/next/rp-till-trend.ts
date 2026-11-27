/**
 * The till's 7-day average: "Average a trading day, last 7" (r109 g2). Pure,
 * so the one invariant that makes the line honest is tested without a canvas:
 *
 *   point(d) = Σ revenue over the days in [d-6, d] that rang up a check
 *              ÷ the count of those days
 *
 *  - The window is TRAILING (d and the 6 house days before it), never centred:
 *    the last days of the window keep a point, and "the week so far" reads.
 *  - A day absent from the series rang nothing up. It is in neither the sum nor
 *    the count, so a house closed on Mondays averages over its 6 open days and
 *    shows no dip (Σ/7 would treat that closed day as a 0 the till never said).
 *  - A day present with revenue `null` is a day the till could not state. The
 *    point is `null`, never computed around it.
 *  - Fewer than 3 trading days in the 7 give `null`, so a "7-day average" is
 *    never one or two days' takings.
 *  - A day whose 7 reach back past the first day the read holds has no trail
 *    to average: `null`. With compare on, the read is the doubled one, so the
 *    first shown days take their trail from the read's earlier days.
 *
 * Keys are the house days the gateway filed (ADR 0296); nothing is re-bucketed
 * from instants here.
 */

export const TRAIL_DAYS = 7;
/** The fewest trading days in a trail that still make an average. */
export const TRAIL_MIN = 3;

export interface TrendPoint {
  /** The average, or null when it cannot be stated (see `why`). */
  value: number | null;
  /** Trading days counted in this point's 7. */
  days: number;
  why: 'ok' | 'unstated' | 'few' | 'no-trail';
}

const KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The house day `n` days after `key` (negative: before). Calendar maths in UTC, so no DST hour moves a day. */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${`${t.getUTCMonth() + 1}`.padStart(2, '0')}-${`${t.getUTCDate()}`.padStart(2, '0')}`;
}

/**
 * One point per `shown` day. `series` is every day the read holds (sparse: a
 * day with no check is absent), and `readFrom` is the first house day that read
 * covers, so a day before it is unknown rather than absent.
 */
export function trailingAverage(
  series: ReadonlyArray<{ date: string; revenue: number | null }>,
  shown: readonly string[],
  readFrom: string,
): TrendPoint[] {
  const byDate = new Map(series.map((d) => [d.date, d.revenue]));
  return shown.map((day) => {
    if (!KEY.test(day) || !KEY.test(readFrom)) return { value: null, days: 0, why: 'no-trail' };
    const start = addDays(day, -(TRAIL_DAYS - 1));
    if (start < readFrom) return { value: null, days: 0, why: 'no-trail' };
    let sum = 0;
    let n = 0;
    let unstated = false;
    for (let i = 0; i < TRAIL_DAYS; i++) {
      const key = addDays(start, i);
      if (!byDate.has(key)) continue;
      const v = byDate.get(key);
      if (v == null) unstated = true;
      else {
        sum += v;
        n += 1;
      }
    }
    if (unstated) return { value: null, days: n, why: 'unstated' };
    if (n < TRAIL_MIN) return { value: null, days: n, why: 'few' };
    return { value: sum / n, days: n, why: 'ok' };
  });
}

/** The words a tooltip puts after a point. */
export function trendTip(p: TrendPoint): string {
  if (p.why === 'ok') return `over ${p.days} trading ${p.days === 1 ? 'day' : 'days'}`;
  if (p.why === 'unstated') return 'the till could not state a day in these 7';
  if (p.why === 'few')
    return `only ${p.days} trading ${p.days === 1 ? 'day' : 'days'} in these 7, fewer than ${TRAIL_MIN}`;
  return 'no 7 days behind it in this read';
}

/** True when some shown day has no trail in the read, so the caption says where the line starts. */
export function startsLate(points: readonly TrendPoint[]): boolean {
  return points.some((p) => p.why === 'no-trail');
}
