/**
 * Day / Week / Month grain for the till (r109 g3). Pure, so the sums that make
 * a weekly bar honest are tested without a canvas.
 *
 * Why: a 365-day bar chart draws at most MAX_DRAWN (150) of its days, the
 * highest of each stretch (`thinCats`, rp-plot.tsx), so the low days vanish.
 * A week or a month bar holds every day it covers.
 *
 *  - Buckets are built from the house-day keys the gateway filed (ADR 0296),
 *    never re-bucketed from instants. A week is the heat map's own week
 *    (`weekStart`, Monday), and a month is the key's YYYY-MM.
 *  - Takings = Σ known revenue of the days in the bucket. A bucket with a day
 *    present but unstated (revenue null) draws no bar: it says so instead.
 *    A bucket in which no day rang up a check is a gap, never a 0.
 *  - Checks are summed only when every trading day of the bucket carries them.
 *    Average check = Σ revenue ÷ Σ checks, never a mean of daily averages.
 *  - An edge bucket that does not hold its whole week or month is flagged
 *    `whole: false` and named ("part week: 3 days"), so a short week never
 *    reads as a slow one. It is drawn, not dropped (the window's takings must
 *    still add up) and not scaled (that would be an invented figure).
 *  - Compare: the prior window is bucketed by the SAME slots (slot j of the
 *    prior is the day `days` before slot j of the window), so bucket i of each
 *    covers the same number of days and they align by index (DD-r105-1).
 */

import { shortDay, weekStart } from './rp-format';

export type Grain = 'day' | 'week' | 'month';

/** The page link's name for the till grain: `/reports?grain=week`. */
export const GRAIN_PARAM = 'grain';

/** The grains a window offers: none at 7 days (no pill), Week from 30, Month from 90. */
export function grainsOffered(days: number): Grain[] {
  if (days >= 90) return ['day', 'week', 'month'];
  if (days >= 30) return ['day', 'week'];
  return [];
}

/** The grain a link names, or Day when it names one this window does not offer. */
export function grainOf(raw: string | null | undefined, days: number): Grain {
  const offered = grainsOffered(days);
  return offered.includes(raw as Grain) ? (raw as Grain) : 'day';
}

export interface DayRow {
  date: string;
  revenue: number | null;
  checks?: number | null;
}

export interface Bucket {
  key: string;
  /** The axis label: "Nov 3" for a week, "Nov 2026" for a month. */
  label: string;
  /** The tooltip's words, with a part bucket or an unstated day named. */
  full: string;
  /** Slot indices into the window's span. */
  slots: number[];
  /** False for an edge bucket that does not hold its whole week or month. */
  whole: boolean;
  /** Days of the bucket that rang up a check. */
  traded: number;
  /** Days present with no figure: the till could not state them. */
  unstated: number;
  revenue: number | null;
  checks: number | null;
  /** Σ revenue ÷ Σ checks, or null. */
  avg: number | null;
}

const daysInMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The window's days (`span`, every house day, in order) grouped by `grain`.
 * `series` is sparse: a day with no check is absent.
 */
export function bucketTill(span: readonly string[], series: readonly DayRow[], grain: Exclude<Grain, 'day'>): Bucket[] {
  const byDate = new Map(series.map((d) => [d.date, d]));
  const order: string[] = [];
  const groups = new Map<string, number[]>();
  span.forEach((date, i) => {
    const key = grain === 'week' ? weekStart(date) : date.slice(0, 7);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(i);
  });
  return order.map((key) => {
    const slots = groups.get(key)!;
    const size = grain === 'week' ? 7 : daysInMonth(key);
    const whole = slots.length === size;
    let sum = 0;
    let traded = 0;
    let unstated = 0;
    let checks = 0;
    let counted = true;
    for (const i of slots) {
      const row = byDate.get(span[i]);
      if (!row) continue;
      if (row.revenue == null) unstated += 1;
      else {
        sum += row.revenue;
        traded += 1;
      }
      if (row.checks == null) counted = false;
      else checks += row.checks;
    }
    const present = traded + unstated;
    const revenue = unstated > 0 || traded === 0 ? null : sum;
    const checkSum = counted && present > 0 ? checks : null;
    const label = grain === 'week' ? shortDay(key) : monthLabel(key);
    const head = grain === 'week' ? `week of ${label}` : label;
    const words = [head];
    if (!whole) words.push(`part ${grain}: ${plural(slots.length, 'day', 'days')}`);
    if (unstated > 0) words.push(`the till could not state ${plural(unstated, 'day', 'days')}`);
    else if (present === 0) words.push('no check');
    return {
      key,
      label,
      full: words.join(' · '),
      slots,
      whole,
      traded,
      unstated,
      revenue,
      checks: checkSum,
      avg: revenue != null && checkSum != null && checkSum > 0 ? revenue / checkSum : null,
    };
  });
}

/**
 * The prior window's takings in the same buckets: bucket i sums the prior days
 * at bucket i's slots. Null for a bucket when any aligned prior day is
 * unstated or none of them rang up a check; all null when the prior span does
 * not line up with the window slot for slot.
 */
export function bucketPrior(
  buckets: readonly Bucket[],
  span: readonly string[],
  priorSpan: readonly string[],
  priorSeries: ReadonlyArray<{ date: string; revenue: number | null }>,
): Array<number | null> {
  if (priorSpan.length !== span.length) return buckets.map(() => null);
  const byDate = new Map(priorSeries.map((d) => [d.date, d.revenue]));
  return buckets.map((b) => {
    let sum = 0;
    let traded = 0;
    for (const i of b.slots) {
      const date = priorSpan[i];
      if (!byDate.has(date)) continue;
      const v = byDate.get(date);
      if (v == null) return null;
      sum += v;
      traded += 1;
    }
    return traded === 0 ? null : sum;
  });
}
