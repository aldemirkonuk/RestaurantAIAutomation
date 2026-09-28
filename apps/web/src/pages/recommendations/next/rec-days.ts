/**
 * The ribbon's day model — one calendar month in a line, and what is NOT known
 * about it.
 *
 * ── The window is a MONTH, since 2026-09-04 ────────────────────────────────
 * It was 21 days behind and 7 ahead. The founder replaced it with a full
 * calendar month — the one containing today by default, with previous/next
 * controls — and the reason is that a rolling window has no name: nobody says
 * "the last twenty-one days" to a colleague, and every other record in the
 * house is kept by month. The future half of the current month is drawn as
 * EMPTY days, never hatched: a day that has not happened is neither a record
 * nor an absence, and the cell's own title says so.
 *
 * The drawing of all this now lives in `components/mudavym/DayStrip.tsx` — the
 * house strip, shared with `/notifications`. This module is what is left: the
 * page's own answer to *what does each day of this month carry*.
 *
 * The founder, fourth pass (2026-09-03): *"a calendar strip that we can select
 * and see that is highly advanced and elegant looking"*. Sketch 094a drew it;
 * the decision was to keep it as a SELECTOR above the docket rather than as the
 * page's axis, so this module answers exactly three questions per day and
 * refuses the rest:
 *
 *   what FIRED that day        `firstSeenAt` on a standing entry
 *   what FALLS DUE that day    a goal's deadline · a snoozed entry's wake date
 *   what RECORDS exist         the POS window's sparse daily series
 *
 * ── "No records" is the whole point ────────────────────────────────────────
 * `GET /analytics/pos-revenue/:rid` returns `dailySeries` that is SPARSE — only
 * days that actually carried a non-voided check appear (`goals.service.ts`
 * `computeMetricWithSeries` builds the map from rows, then `getPosRevenueWindow`
 * maps it). A day inside the window that is absent from that series carried no
 * record at all, and it is drawn HATCHED, never as a bar of zero. That
 * distinction is the reason the second pass of this page exists: "Wednesday
 * sales came in 100% lower" was a closure being read as a measurement.
 *
 * Four states, not two, because the reasons a day is blank are different facts:
 *
 *   'yes'      a record landed — the day is measured
 *   'none'     the window was read and this day held nothing
 *   'unknown'  the window could not be read, or no POS is wired at all —
 *              nothing may be claimed about any day, including this one
 *   'future'   the day has not happened; an absence of records is not a fact
 *              about it, so it is neither hatched nor counted
 *
 * ── What the ribbon deliberately cannot draw ───────────────────────────────
 *  - `firstSeenAt` is attached by the gateway from `recommendation_impressions`
 *    and is capped at forty keys, and null for any rule with no impression row.
 *    An entry with no first-fired date draws NO mark: it must never draw one
 *    starting today, because today is exactly the wrong answer.
 *  - vendor cutoffs do not exist anywhere in the gateway, so no "falls due"
 *    mark can come from one.
 *  - money per day is the money that went THROUGH THE TILL, from the POS
 *    window. It is not "money at stake" — the feed carries no such figure —
 *    and the two are never shown as the same quantity.
 */

import { monthDays, recordWords as houseRecordWords } from '@/components/mudavym/dayStripDates';
import type { EntryVM, GoalRow } from './useRecommendationsNextData';

/** The POS window, as the ribbon needs it. */
export interface PosWindowVM {
  /** False = this restaurant has never had a POS check land. */
  connected: boolean;
  from: string;
  to: string;
  /** date → revenue booked. ONLY days that carried a record appear. */
  byDay: Record<string, number>;
}

/** undefined = not asked yet · null = the read failed · a window = read. */
export type PosVM = PosWindowVM | null | undefined;

export type RecordState = 'yes' | 'none' | 'unknown' | 'future';

export interface DueMark {
  kind: 'goal' | 'snooze';
  /** What falls due, in words. */
  label: string;
  /** The rule this due mark belongs to, when one is recorded. */
  ruleKey: string | null;
}

export interface DayCell {
  /** YYYY-MM-DD, UTC — the same business-date key the gateway stores. */
  date: string;
  /** One letter, the house's own abbreviation (never Intl — see `fmtDay`). */
  weekday: string;
  dayNum: number;
  isToday: boolean;
  isFuture: boolean;
  /** Rule keys whose first impression landed on this day. */
  fired: string[];
  due: DueMark[];
  records: RecordState;
  /** Money through the till that day. Null unless a record exists. */
  revenue: number | null;
  excluded: boolean;
  excludedReason: string | null;
}

const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/**
 * How far back the till window must be asked for, to cover a whole month.
 *
 * `GET /analytics/pos-revenue/:rid?days=N` counts back from today and the
 * gateway clamps N to 1–365 — `analytics.controller.ts:792-795`, the clamp
 * itself on `:794`, inside `getPosRevenue` (`:788`, routed at `:773`).
 * Re-measured 2026-09-04; the `:757-760` this line used to cite is the
 * Wine-360 `@ApiOperation`, not the clamp. Reading a
 * month that ended in March therefore needs a longer window than one that ends
 * today — and a month more than 365 days back cannot be covered at all, which
 * is why every day of it comes back `unknown` rather than `none`. Nothing here
 * pretends otherwise.
 */
export function posDaysFor(month: string, todayKey: string): number {
  const first = `${month}-01`;
  const a = Date.parse(`${first}T00:00:00Z`);
  const b = Date.parse(`${todayKey}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 31;
  const span = Math.ceil((b - a) / 86_400_000) + 1;
  return Math.min(365, Math.max(1, span));
}

/** A UTC business date from a timestamp. Null when it will not parse. */
export function businessDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return t.toISOString().substring(0, 10);
}

export interface BuildDaysInput {
  /** The calendar month on screen, `YYYY-MM`. */
  month: string;
  entries: EntryVM[];
  goals: GoalRow[] | null | undefined;
  pos: PosVM;
  exclusions: Array<{ businessDate: string; reason: string | null }> | null;
  /** Defaults to now; injected by the tests so the model is deterministic. */
  now?: Date;
}

/**
 * One calendar month of cells, the 1st to the last, in order.
 *
 * The length is the month's own length — 28, 29, 30 or 31 — and never a
 * rolling count, so the strip's left edge is always the 1st and a reader can
 * point at "the 14th" and be understood.
 */
export function buildDays(input: BuildDaysInput): DayCell[] {
  const now = input.now ?? new Date();
  const todayKey = now.toISOString().substring(0, 10);

  const firedByDay = new Map<string, string[]>();
  const dueByDay = new Map<string, DueMark[]>();

  for (const e of input.entries) {
    const first = businessDate(e.firstSeenAt);
    if (first) {
      const list = firedByDay.get(first);
      if (list) list.push(e.ruleKey);
      else firedByDay.set(first, [e.ruleKey]);
    }
    const wake = businessDate(e.snoozeUntil);
    if (wake) {
      const mark: DueMark = { kind: 'snooze', label: 'a snoozed entry wakes', ruleKey: e.ruleKey };
      const list = dueByDay.get(wake);
      if (list) list.push(mark);
      else dueByDay.set(wake, [mark]);
    }
  }

  if (Array.isArray(input.goals)) {
    for (const g of input.goals) {
      // `deadline` is a DATE column, so it is already a business date; parsing
      // it through Date() would shift it a day in half the world's timezones.
      const day = typeof g.deadline === 'string' ? g.deadline.substring(0, 10) : null;
      if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const mark: DueMark = {
        kind: 'goal',
        label: `goal “${g.name}” falls due`,
        ruleKey: g.sourceRuleKey,
      };
      const list = dueByDay.get(day);
      if (list) list.push(mark);
      else dueByDay.set(day, [mark]);
    }
  }

  const excluded = new Map<string, string | null>();
  for (const x of input.exclusions ?? []) excluded.set(x.businessDate, x.reason);

  const cells: DayCell[] = [];
  for (const date of monthDays(input.month)) {
    const d = new Date(`${date}T12:00:00Z`);
    const isFuture = date > todayKey;
    let records: RecordState;
    let revenue: number | null = null;
    if (isFuture) records = 'future';
    else if (!input.pos || !input.pos.connected) records = 'unknown';
    else if (date < input.pos.from || date > input.pos.to) records = 'unknown';
    else if (Object.prototype.hasOwnProperty.call(input.pos.byDay, date)) {
      records = 'yes';
      revenue = input.pos.byDay[date];
    } else records = 'none';

    cells.push({
      date,
      weekday: DAY_LETTER[d.getUTCDay()],
      dayNum: d.getUTCDate(),
      isToday: date === todayKey,
      isFuture,
      fired: firedByDay.get(date) ?? [],
      due: dueByDay.get(date) ?? [],
      records,
      revenue,
      excluded: excluded.has(date),
      excludedReason: excluded.get(date) ?? null,
    });
  }
  return cells;
}

/**
 * Does this entry touch the selected day?
 *
 * Three ways, and only three: it first fired that day, it wakes that day, or a
 * goal that names it as its source falls due that day. An entry with no
 * first-fired date touches NO day — it is withheld from every selection rather
 * than shown on all of them, and the page says how many are in that state.
 */
export function touchesDay(entry: EntryVM, date: string, goals: GoalRow[] | null | undefined): boolean {
  if (businessDate(entry.firstSeenAt) === date) return true;
  if (businessDate(entry.snoozeUntil) === date) return true;
  if (Array.isArray(goals))
    return goals.some(
      (g) =>
        g.sourceRuleKey === entry.ruleKey &&
        typeof g.deadline === 'string' &&
        g.deadline.substring(0, 10) === date,
    );
  return false;
}

/** The bar heights the strip draws, in px. Counts, never money. */
export const BAR_UNIT = 4;
export const BAR_MAX = 18;

export function barHeight(count: number): number {
  if (count <= 0) return 0;
  return Math.min(BAR_MAX, 5 + (count - 1) * BAR_UNIT);
}

/**
 * The house strip's own words, re-exported so nothing on this page can drift
 * from what the strip's cell titles say. `fmtLongDay` and the four record
 * sentences live in `components/mudavym/DayStrip.tsx`.
 */
export { fmtLongDay } from '@/components/mudavym/dayStripDates';

/** What this page says about a day's records, in words. Never a zero. */
export function recordWords(cell: DayCell): string {
  return houseRecordWords(
    cell.records === 'future' ? 'unknown' : cell.records,
    cell.isFuture,
  );
}
