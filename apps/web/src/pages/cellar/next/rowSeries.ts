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

import { getHouseZone } from '@/lib/houseZone';

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

/*
 * THE HOUSE'S CLOCK (F-1222, rehit of F-327). Both series place a line on the
 * day, weekday and hour it fell on in the HOUSE's zone (`getHouseZone`;
 * CellarNext calls `useHouseZone` so the page re-renders when it lands), the
 * same day `countedDay` and `shortDate` name. F-327 made the bars and the grid
 * agree, but on the reader's device: an Istanbul bar opened from London put a
 * 01:30 sale on the night before. With no zone known yet, the device's clock
 * stands in, as everywhere else on these pages.
 */
const clocks = new Map<string, Intl.DateTimeFormat>();

/** One formatter per named zone; the device's is built afresh, as its zone can move. */
function clock(zone: string | null): Intl.DateTimeFormat {
  let f = zone ? clocks.get(zone) : undefined;
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      hourCycle: 'h23',
    };
    try {
      f = new Intl.DateTimeFormat('en-US', zone ? { ...opts, timeZone: zone } : opts);
    } catch {
      // A zone this engine does not know: the device's clock stands in.
      return new Intl.DateTimeFormat('en-US', opts);
    }
    if (zone) clocks.set(zone, f);
  }
  return f;
}

const WEEKDAY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** The `YYYY-MM-DD` day, Monday-first weekday and 0-23 hour of an instant on `zone`'s clock. */
function placed(ms: number, zone: string | null): { day: string; dow: number; hour: number } {
  const p = clock(zone).formatToParts(new Date(ms));
  const get = (type: string) => p.find((x) => x.type === type)?.value ?? '';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    dow: WEEKDAY[get('weekday')] ?? 0,
    hour: Number(get('hour')) % 24,
  };
}

/**
 * The calendar day `shift` days on from a `YYYY-MM-DD` day. Pure calendar
 * arithmetic, not 24 h steps, so a daylight-saving night neither skips nor
 * repeats a bar.
 */
function shiftDay(day: string, shift: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + shift)).toISOString().slice(0, 10);
}

/**
 * Quantity sold per day, over at most `window` days, clipped to the days the
 * till actually covers.
 */
export function velocity(
  lines: TillLine[],
  window = 14,
  zone: string | null = getHouseZone(),
): VelocitySeries {
  const dated = lines
    .map((l) => ({ ms: l.at === null ? NaN : Date.parse(l.at), qty: l.qty ?? 0 }))
    .filter((l) => Number.isFinite(l.ms))
    .map((l) => ({ day: placed(l.ms, zone).day, qty: l.qty }));

  if (dated.length === 0) {
    return { days: [], from: null, to: null, perDay: null, clipped: false };
  }

  // `YYYY-MM-DD` sorts as the calendar does.
  const keys = dated.map((l) => l.day).sort();
  const firstDay = keys[0];
  const lastDay = keys[keys.length - 1];
  const earliest = shiftDay(lastDay, -(window - 1));
  const capped = earliest > firstDay ? earliest : firstDay;
  const clipped = capped > firstDay;

  const byDay = new Map<string, number>();
  for (const l of dated) {
    if (l.day < capped) continue;
    byDay.set(l.day, (byDay.get(l.day) ?? 0) + l.qty);
  }

  const days: DayPoint[] = [];
  for (let k = capped; k <= lastDay; k = shiftDay(k, 1)) {
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
  /** The house's hour, 0-23. */
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
export function whenItSells(
  lines: TillLine[],
  zone: string | null = getHouseZone(),
): {
  buckets: HourBucket[];
  hours: number[];
  peak: HourBucket | null;
} {
  const map = new Map<string, HourBucket>();
  for (const l of lines) {
    if (l.at === null) continue;
    const ms = Date.parse(l.at);
    if (!Number.isFinite(ms)) continue;
    const { dow, hour } = placed(ms, zone);
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
