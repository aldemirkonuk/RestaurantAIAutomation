import { houseDayBounds, houseDayOf, houseToday } from "../common/house-day";

/**
 * Which month a stock-take's counts are filed in (F-1544 lane 5).
 *
 * The founder's pick, 2026-10-12 (sim-ledger S224), F1 (b): a count session
 * states its period, and the month close files the session's counts by it --
 * but only a count made within 6 hours after that period ends. The moment
 * each count was made stays the moment it was made (`stock_counts.counted_at`
 * is never moved); only the month it is FILED in changes.
 *
 * So a month-end count walked from 22:00 on the 31st to 01:30 on the 1st is
 * one count of the month that ended, and a count of the same session made at
 * 07:00 on the 1st is the new month's, as the house's day says (ADR 0296).
 *
 * A count with no session (a spot count), or whose session states no period
 * (every session opened before 20270113300000), is filed by its own moment
 * exactly as before.
 */

/** How long after its period ends a session's count is still filed in it. */
export const COUNT_PERIOD_GRACE_MS = 6 * 3_600_000;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(v: unknown): v is string {
  return typeof v === "string" && MONTH_RE.test(v);
}

/** "2026-10" -> "2026-09"; January goes back a year. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** The instants that open and end a month on the house's clock. */
export function monthInstants(
  month: string,
  zone: string,
): { start: number; end: number } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const b = houseDayBounds(
    `${month}-01`,
    `${month}-${String(last).padStart(2, "0")}`,
    zone,
  );
  return { start: Date.parse(b.startIso), end: Date.parse(b.endIso) };
}

/**
 * The months a count opened now may state: this month, and the month that
 * just ended while it is within its 6 hours (`ended`, else null).
 */
export function periodChoiceAt(
  now: Date,
  zone: string,
): { current: string; ended: string | null } {
  const current = houseToday(zone, now).slice(0, 7);
  const prev = previousMonth(current);
  const ended =
    now.getTime() < monthInstants(prev, zone).end + COUNT_PERIOD_GRACE_MS
      ? prev
      : null;
  return { current, ended };
}

export class CountPeriodRefused extends Error {}

/**
 * The period a count being opened states. An opening count starts the books
 * and is never a month's variance (ADR 0335 §2), so it states none. A house
 * with no time zone cannot be cut into months, so its count states none
 * unless one was asked for, which is refused. Not asked: this month.
 */
export function sessionPeriodFor(
  requested: unknown,
  kind: string,
  now: Date,
  zone: string | null,
): string | null {
  if (kind === "opening") return null;
  const asked =
    requested === undefined || requested === null ? null : requested;
  if (!zone) {
    if (asked !== null)
      throw new CountPeriodRefused(
        "This house's time zone isn't set, so a count cannot say its month. An owner or manager can set it in Settings, under Time zone.",
      );
    return null;
  }
  const choice = periodChoiceAt(now, zone);
  if (asked === null) return choice.current;
  if (asked === choice.current || (isMonth(asked) && asked === choice.ended))
    return asked;
  throw new CountPeriodRefused(
    "A count is for this month. It can be for last month only in the first 6 hours after last month ends.",
  );
}

/**
 * The month a count is filed in. A session's count made from the start of
 * its period until 6 hours after the period ends is filed in the period;
 * every other count is filed by its own moment on the house's clock.
 * Null when the moment cannot be read.
 */
export function filedMonth(
  countedAt: string | null | undefined,
  period: string | null | undefined,
  zone: string,
): string | null {
  if (!countedAt) return null;
  const t = Date.parse(countedAt);
  if (Number.isNaN(t)) return null;
  if (isMonth(period)) {
    const { start, end } = monthInstants(period, zone);
    if (t >= start && t < end + COUNT_PERIOD_GRACE_MS) return period;
  }
  return houseDayOf(countedAt, zone)?.slice(0, 7) ?? null;
}
