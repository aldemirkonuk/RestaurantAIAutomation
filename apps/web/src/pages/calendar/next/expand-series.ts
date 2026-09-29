/**
 * Repeating entries → the dates they fall on inside the visible window.
 *
 * Sweep 2026-09-28 row 16: a repeating entry showed only on its first date.
 * The gateway now attaches each row's `recurrenceRule` and, when asked with
 * `includeEarlierSeries=true`, returns series that began before the window.
 * This turns them into dates.
 *
 * House time zone. `start_date` and the rule's `endOnDate` are the house's own
 * calendar days, stored as `YYYY-MM-DD`. Every step here is day-number
 * arithmetic on those keys in UTC, so the browser's zone takes no part: a
 * manager reading the book from another zone sees the same Mondays as the
 * house does. The shared `lib/calendar/recurrence.ts` parsed keys with
 * `new Date('YYYY-MM-DD')` (UTC midnight) and then read them back with local
 * getters, which moved every occurrence one day earlier west of Greenwich.
 *
 * Semantics mirror the gateway's own resolver
 * (apps/api-gateway/src/calendar/calendar-occurrences.ts) so the web and the
 * iCal feed agree: daily / weekly / monthly / yearly, `interval`,
 * `daysOfWeek`, `dayOfMonth`, `weekOfMonth`, `monthOfYear`, and the three end
 * types. A series it cannot expand is returned in `unexpanded`, never dropped
 * and never drawn on its first date as if it did not repeat.
 *
 * Not handled (stated, not hidden): per-occurrence exceptions and stored
 * occurrence rows. Those exist only once the gateway's generate-occurrences
 * route has run for a series, which this page never calls, and the list read
 * excludes stored occurrences by default.
 */

export interface SeriesRule {
  frequency?: unknown;
  interval?: unknown;
  daysOfWeek?: unknown;
  dayOfMonth?: unknown;
  weekOfMonth?: unknown;
  monthOfYear?: unknown;
  endType?: unknown;
  endAfterCount?: unknown;
  endOnDate?: unknown;
}

export interface SeriesRow {
  id: string;
  date: string;
  endDate: string | null;
  isRecurring: boolean;
  recurrenceRule?: SeriesRule | Record<string, unknown>;
}

export type Expanded<T> = T & { id: string; date: string; endDate: string | null; seriesId: string; isOccurrence: boolean };

export interface ExpandResult<T> {
  events: Array<Expanded<T>>;
  /** Series whose rule is missing or unreadable — the page must say so. */
  unexpanded: Array<{ id: string; reason: string }>;
}

const DAY = 86_400_000;
/** Work cap per series. A daily rule from 2000 to a 90-day window is ~10k steps. */
const MAX_STEPS = 200_000;

function dayNum(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const head = value.split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return null;
  const t = Date.parse(`${head}T00:00:00.000Z`);
  if (!Number.isFinite(t)) return null;
  if (new Date(t).toISOString().slice(0, 10) !== head) return null;
  return t / DAY;
}

function keyOf(n: number): string {
  return new Date(n * DAY).toISOString().slice(0, 10);
}

function int(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

type Plan =
  | { ok: true; qualifies: (n: number) => boolean; lastDay: number | null; maxCount: number | null }
  | { ok: false; reason: string };

function plan(anchor: number, rule: SeriesRule): Plan {
  const freq = rule.frequency;
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly' && freq !== 'yearly') {
    return { ok: false, reason: `the ${String(freq)} repeat cannot be drawn` };
  }
  const interval = rule.interval ?? 1;
  if (!int(interval, 1, 365)) return { ok: false, reason: 'the repeat interval is unreadable' };
  const dows = rule.daysOfWeek;
  if (dows != null && (!Array.isArray(dows) || dows.some((d) => !int(d, 0, 6)))) {
    return { ok: false, reason: 'a repeat weekday is unreadable' };
  }
  if (rule.dayOfMonth != null && !int(rule.dayOfMonth, 1, 31)) return { ok: false, reason: 'the repeat day of month is unreadable' };
  if (rule.weekOfMonth != null && (!int(rule.weekOfMonth, 1, 5) || !(dows as number[] | null)?.length)) {
    return { ok: false, reason: 'a repeat week of month needs a weekday' };
  }
  if (rule.monthOfYear != null && !int(rule.monthOfYear, 1, 12)) return { ok: false, reason: 'the repeat month is unreadable' };

  const endType = rule.endType ?? 'never';
  let lastDay: number | null = null;
  let maxCount: number | null = null;
  if (endType === 'on_date') {
    lastDay = dayNum(rule.endOnDate);
    if (lastDay === null) return { ok: false, reason: 'the series end date is unreadable' };
  } else if (endType === 'after_count') {
    if (!int(rule.endAfterCount, 1, Number.MAX_SAFE_INTEGER)) return { ok: false, reason: 'the occurrence count is unreadable' };
    maxCount = rule.endAfterCount;
  } else if (endType !== 'never') {
    return { ok: false, reason: 'the series end is unreadable' };
  }

  const a = new Date(anchor * DAY);
  const weekdays = (dows as number[] | null)?.length ? (dows as number[]) : [a.getUTCDay()];
  const anchorWeek = anchor - a.getUTCDay();
  const dom = (rule.dayOfMonth as number | undefined) ?? a.getUTCDate();
  const wom = rule.weekOfMonth as number | undefined;
  const moy = (rule.monthOfYear as number | undefined) ?? a.getUTCMonth() + 1;

  const monthDay = (d: Date) =>
    wom != null
      ? Math.floor((d.getUTCDate() - 1) / 7) + 1 === wom &&
        weekdays.includes(d.getUTCDay()) &&
        (rule.dayOfMonth == null || d.getUTCDate() === rule.dayOfMonth)
      : d.getUTCDate() === dom;

  const qualifies = (n: number) => {
    const d = new Date(n * DAY);
    if (freq === 'daily') return (n - anchor) % interval === 0;
    if (freq === 'weekly') return Math.floor((n - anchorWeek) / 7) % interval === 0 && weekdays.includes(d.getUTCDay());
    const months = (d.getUTCFullYear() - a.getUTCFullYear()) * 12 + d.getUTCMonth() - a.getUTCMonth();
    if (freq === 'monthly') return months % interval === 0 && monthDay(d);
    return (d.getUTCFullYear() - a.getUTCFullYear()) % interval === 0 && d.getUTCMonth() + 1 === moy && monthDay(d);
  };
  return { ok: true, qualifies, lastDay, maxCount };
}

/**
 * Expand every repeating row into its dates inside [from, to] (inclusive day
 * keys). Rows that do not repeat pass through untouched, except that
 * `seriesId`/`isOccurrence` are set.
 */
export function expandSeries<T extends SeriesRow>(rows: T[], from: string, to: string): ExpandResult<T> {
  const lo = dayNum(from);
  const hi = dayNum(to);
  const events: Array<Expanded<T>> = [];
  const unexpanded: Array<{ id: string; reason: string }> = [];
  if (lo === null || hi === null || lo > hi) {
    return { events, unexpanded: rows.filter((r) => r.isRecurring).map((r) => ({ id: r.id, reason: 'the window is unreadable' })) };
  }

  // A series we cannot expand is drawn on its own stored date only when that
  // date is in view; the `unexpanded` entry says the rest is missing.
  const inWindow = (row: T) => {
    const a = dayNum(row.date);
    const b = row.endDate ? dayNum(row.endDate) : a;
    return a !== null && a <= hi && (b ?? a) >= lo;
  };

  for (const row of rows) {
    const repeats = row.isRecurring || !!row.recurrenceRule;
    if (!repeats) {
      events.push({ ...row, seriesId: row.id, isOccurrence: false });
      continue;
    }
    const anchor = dayNum(row.date);
    if (!row.recurrenceRule || anchor === null) {
      unexpanded.push({ id: row.id, reason: row.recurrenceRule ? 'its first date is unreadable' : 'its repeat rule was not returned' });
      // Still drawn on its own date, flagged — never silently dropped.
      if (inWindow(row)) events.push({ ...row, seriesId: row.id, isOccurrence: false });
      continue;
    }
    const p = plan(anchor, row.recurrenceRule as SeriesRule);
    if (!p.ok) {
      unexpanded.push({ id: row.id, reason: p.reason });
      if (inWindow(row)) events.push({ ...row, seriesId: row.id, isOccurrence: false });
      continue;
    }
    const endNum = row.endDate ? dayNum(row.endDate) : null;
    const span = endNum !== null && endNum >= anchor ? endNum - anchor : 0;
    const stop = Math.min(hi, p.lastDay ?? hi);
    let count = 0;
    let steps = 0;
    let capped = false;
    for (let n = anchor; n <= stop; n++) {
      if (++steps > MAX_STEPS) {
        capped = true;
        break;
      }
      if (!p.qualifies(n)) continue;
      count++;
      if (p.maxCount !== null && count > p.maxCount) break;
      if (n + span < lo) continue;
      const key = keyOf(n);
      events.push({
        ...row,
        id: `${row.id}__occ_${key}`,
        date: key,
        endDate: row.endDate ? keyOf(n + span) : null,
        seriesId: row.id,
        isOccurrence: true,
      });
    }
    if (capped) unexpanded.push({ id: row.id, reason: 'the series is too long to draw in one pass' });
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { events, unexpanded };
}
