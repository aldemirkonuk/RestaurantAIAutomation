/**
 * The ribbon's day model — the month in one line, and what is NOT known about it.
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
  /** Set only on the first of a month, so the strip can label the turn. */
  monthLabel: string | null;
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
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** The window: 21 days behind, today, and the 7 ahead that can carry a deadline. */
export const DAYS_BEHIND = 21;
export const DAYS_AHEAD = 7;

/** A UTC business date from a timestamp. Null when it will not parse. */
export function businessDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return t.toISOString().substring(0, 10);
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

export interface BuildDaysInput {
  entries: EntryVM[];
  goals: GoalRow[] | null | undefined;
  pos: PosVM;
  exclusions: Array<{ businessDate: string; reason: string | null }> | null;
  /** Defaults to now; injected by the tests so the model is deterministic. */
  now?: Date;
}

/**
 * The strip, left to right. Always the same length, so the ribbon never
 * silently shortens itself when a tenant has fewer records.
 */
export function buildDays(input: BuildDaysInput): DayCell[] {
  const now = input.now ?? new Date();
  const todayKey = now.toISOString().substring(0, 10);
  const start = addDays(now, -DAYS_BEHIND);

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
  for (let i = 0; i <= DAYS_BEHIND + DAYS_AHEAD; i++) {
    const d = addDays(start, i);
    const date = d.toISOString().substring(0, 10);
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
      monthLabel: d.getUTCDate() === 1 ? MONTHS[d.getUTCMonth()] : null,
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

/** "Wednesday 2 September" — written out, for the same reason `fmtDay` is. */
const LONG_DAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];
const LONG_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function fmtLongDay(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const t = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(t.getTime())) return date;
  return `${LONG_DAYS[t.getUTCDay()]} ${t.getUTCDate()} ${LONG_MONTHS[t.getUTCMonth()]}`;
}

/** What the strip says about a day's records, in words. Never a zero. */
export function recordWords(cell: DayCell): string {
  switch (cell.records) {
    case 'yes':
      return 'a record landed on this day';
    case 'none':
      return 'no record at all on this day — not a zero, nothing was written';
    case 'future':
      return 'this day has not happened yet';
    default:
      return 'whether this day carries records is not known';
  }
}
