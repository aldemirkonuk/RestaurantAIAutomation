/**
 * The two series the expanded row draws, derived from the till lines the row
 * record already carries: velocity by day, and when it sells by hour.
 *
 * WHY THIS IS DERIVED IN THE BROWSER AND NOT ASKED FOR AGAIN. The row record
 * already returns every till line that names the row, with its instant, its
 * quantity and its price. A second endpoint that aggregated the same rows would
 * be a second arithmetic for one claim, and the two would drift.
 *
 * THE ZERO-FILL BUG THIS DELIBERATELY DOES NOT COPY. `/inventory`'s equivalent
 * builds "a dense 14-day series (zero-filled) so the chart has a stable x-axis"
 * (`inventory.service.ts:688-696`). That is the absence-reported-as-health
 * fault drawn as a bar chart: a day BEFORE the house's first till line, or a
 * day the POS was not connected, renders identically to a day nobody bought
 * anything. Migration `20260903091000_days_the_engine_must_not_count.sql`
 * exists in this repo because the recommendation engine made the same mistake.
 *
 * So the window here is clipped to the days the house actually has evidence
 * for: it starts no earlier than the first till line and ends no later than the
 * last, and the caller is told how many days it covers so the axis can say so.
 * A day inside that window with no line IS a zero — the till was reading and
 * rang nothing — and only those are filled.
 */

export interface TillLine {
  at: string | null;
  qty: number | null;
  unitPrice: number | null;
}

export interface DayPoint {
  /** `YYYY-MM-DD`. */
  date: string;
  qty: number;
}

export interface VelocitySeries {
  days: DayPoint[];
  /** The first and last day the house has any evidence for. */
  from: string | null;
  to: string | null;
  /** Mean per day across the covered window. Null when the window is empty. */
  perDay: number | null;
  /** True when the window was clipped by the 14-day cap rather than by evidence. */
  clipped: boolean;
}

const DAY = 86_400_000;

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Quantity sold per day, over at most `window` days, clipped to the days the
 * till actually covers.
 */
export function velocity(lines: TillLine[], window = 14): VelocitySeries {
  const dated = lines
    .map((l) => ({ ms: l.at === null ? NaN : Date.parse(l.at), qty: l.qty ?? 0 }))
    .filter((l) => Number.isFinite(l.ms));

  if (dated.length === 0) {
    return { days: [], from: null, to: null, perDay: null, clipped: false };
  }

  const first = Math.min(...dated.map((l) => l.ms));
  const last = Math.max(...dated.map((l) => l.ms));
  const lastDay = Date.parse(`${dayKey(last)}T00:00:00.000Z`);
  const firstDay = Date.parse(`${dayKey(first)}T00:00:00.000Z`);
  const capped = Math.max(firstDay, lastDay - (window - 1) * DAY);
  const clipped = capped > firstDay;

  const byDay = new Map<string, number>();
  for (const l of dated) {
    if (l.ms < capped) continue;
    const k = dayKey(l.ms);
    byDay.set(k, (byDay.get(k) ?? 0) + l.qty);
  }

  const days: DayPoint[] = [];
  for (let t = capped; t <= lastDay; t += DAY) {
    const k = dayKey(t);
    days.push({ date: k, qty: byDay.get(k) ?? 0 });
  }

  const total = days.reduce((a, d) => a + d.qty, 0);
  return {
    days,
    from: days.length > 0 ? days[0].date : null,
    to: days.length > 0 ? days[days.length - 1].date : null,
    perDay: days.length > 0 ? total / days.length : null,
    clipped,
  };
}

export interface HourBucket {
  /** 0 = Monday. */
  dow: number;
  /** Local hour, 0-23. */
  hour: number;
  qty: number;
}

/**
 * When it sells: every till line placed on its own weekday and hour.
 *
 * NO FIXED SERVICE WINDOW. `/inventory`'s heatmap hard-codes 16:00–23:00
 * (`inventory.service.ts:660-684`), which silently drops every lunch service
 * and every breakfast café — and a café is exactly the house the fourth pass is
 * about. The buckets here are whatever hours the house actually sold in, and
 * the caller renders the span it is given.
 */
export function whenItSells(lines: TillLine[]): {
  buckets: HourBucket[];
  hours: number[];
  peak: HourBucket | null;
} {
  const map = new Map<string, HourBucket>();
  for (const l of lines) {
    if (l.at === null) continue;
    const ms = Date.parse(l.at);
    if (!Number.isFinite(ms)) continue;
    const d = new Date(ms);
    const dow = (d.getDay() + 6) % 7;
    const hour = d.getHours();
    const k = `${dow}:${hour}`;
    const b = map.get(k) ?? { dow, hour, qty: 0 };
    b.qty += l.qty ?? 0;
    map.set(k, b);
  }
  const buckets = [...map.values()].filter((b) => b.qty > 0);
  const hours = [...new Set(buckets.map((b) => b.hour))].sort((a, z) => a - z);
  const peak = buckets.reduce<HourBucket | null>(
    (best, b) => (best === null || b.qty > best.qty ? b : best),
    null,
  );
  return { buckets, hours, peak };
}
