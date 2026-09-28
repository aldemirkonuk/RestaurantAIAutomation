/**
 * The day strip's calendar arithmetic, and the four sentences it may say.
 *
 * Split out of `DayStrip.tsx` so a page can do month maths without importing a
 * component (and so the component file exports only components — the repo's
 * `react-refresh/only-export-components` rule). Everything here is UTC string
 * arithmetic: no `Intl`, no local-time `Date` construction, nothing that can
 * move a date key by a day depending on where the reader is sitting.
 *
 * `recordWords` lives here rather than in either page because the two pages
 * that draw this strip must not be able to disagree about what a blank day
 * means — see `DayStrip.tsx` for the four states and why `future` is not one a
 * page may assert.
 */

/** What is known about whether a day carries records. */
export type DayRecords = 'yes' | 'none' | 'unknown';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const LONG_DAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];
/** One letter per weekday, Sunday first. The house's own, never `Intl`. */
export const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** `YYYY-MM` of a `YYYY-MM-DD`. */
export function monthOf(date: string): string {
  return date.substring(0, 7);
}

/** The reader's local today as `YYYY-MM-DD` — the default for `today`. */
export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** `YYYY-MM` moved by `n` months. Wraps the year; never produces month 00 or 13. */
export function shiftMonth(month: string, n: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  const y = Math.floor(total / 12);
  const mo = total - y * 12;
  return `${String(y).padStart(4, '0')}-${String(mo + 1).padStart(2, '0')}`;
}

/** "September 2026". */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const i = Number(m[2]) - 1;
  return i >= 0 && i < 12 ? `${MONTHS[i]} ${m[1]}` : month;
}

/** Every date key in a month, in order. 28–31 of them, never a partial week. */
export function monthDays(month: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return [];
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) return [];
  // Day 0 of the NEXT month is the last day of this one — no leap-year table.
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) {
    out.push(`${m[1]}-${m[2]}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

/** "Wednesday 2 September" — written out, never `Intl` (the house's own words). */
export function fmtLongDay(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const t = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(t.getTime())) return date;
  return `${LONG_DAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
}

/**
 * What the strip is allowed to say about a day's records, in words. Never a zero.
 *
 * The future sentence is the whole reason the fourth state exists: a day that
 * has not happened is neither a record nor an absence, and hatching it would
 * say the house wrote nothing on a day it has not reached.
 */
export function recordWords(records: DayRecords, isFuture: boolean): string {
  if (isFuture) return 'this day has not happened yet — that is neither a record nor an absence';
  switch (records) {
    case 'yes':
      return 'a record landed on this day';
    case 'none':
      return 'no record at all on this day — not a zero, nothing was written';
    default:
      return 'whether this day carries records is not known';
  }
}

