/**
 * A rate is taken over the days the house was recording, not over the days of
 * the lens's window (r36 reports audit, gap 1).
 *
 * Restock, menu speed, the week's shape and the forecast each read a fixed
 * window (90 or 120 days) and filled every day without a line with a zero. For
 * a house that started recording last week, that counted ~83 days before its
 * first line as days it sold nothing. Measured with the engine: a good selling
 * 2 bottles a day in a 7-day-old house read a reorder point of 3.43 instead of
 * 14, 154 days of cover instead of 12, and a trend of +16.1% a day for flat
 * sales.
 *
 * The rule here:
 *
 * - The window starts at the house's FIRST RECORD of the feed the lens reads
 *   (the first `wine_consumption_log` line ever, not the first in the window,
 *   so a quiet stretch inside an older house still counts as quiet).
 * - A rate divides by at least `MIN_RATE_DAYS` (one week), so a busy opening
 *   night is not read as every night. Under a week the rate runs low by at
 *   most observed/7, and `young` says so.
 * - Under `MIN_PLAN_DAYS` (two of each weekday) a lens that projects or
 *   draws a trend withholds it: the history is too young to plan from.
 * - When the first record cannot be read, the whole window is used (the old
 *   reading, right for any house older than the window) and the basis says
 *   the rate may run low.
 *
 * Days are compared as `YYYY-MM-DD` strings in the same clock the caller's
 * series uses.
 */

/** A rate never divides by fewer days than one week. */
export const MIN_RATE_DAYS = 7;
/** A projection or a trend needs two of each weekday. */
export const MIN_PLAN_DAYS = 14;

export type FirstRecord =
  /** `day` is null when the house has no line at all. */
  | { read: "read"; day: string | null }
  | { read: "could_not_read"; day: null; error?: string };

export interface ObservedWindow {
  /** The lens's own window, in days. */
  windowDays: number;
  /** Days from the house's first record (or the window's start) to its end. */
  observedDays: number;
  /** The divisor for a rate: observedDays, floored at one week. */
  rateDays: number;
  /** The first counted day when the house is younger than the window, else null. */
  since: string | null;
  /** Fewer than `MIN_PLAN_DAYS` observed: too young to project or trend. */
  young: boolean;
  firstRecord: "read" | "none" | "could_not_read";
}

const DAY_MS = 86400000;

function dayOf(d: Date): string {
  return d.toISOString().substring(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

/**
 * The window of `windowDays` days ending on `lastDay` (inclusive), cut at the
 * house's first record.
 */
export function observedWindow(
  windowDays: number,
  lastDay: string,
  first: FirstRecord,
): ObservedWindow {
  const whole: ObservedWindow = {
    windowDays,
    observedDays: windowDays,
    rateDays: windowDays,
    since: null,
    young: false,
    firstRecord: first.read === "read" && first.day == null ? "none" : first.read,
  };
  // No line at all, or unreadable: nothing to cut at. A house with no line
  // reads zero over any window; the lenses already refuse an all-zero series.
  if (first.read !== "read" || first.day == null) return whole;
  const firstWindowDay = dayOf(
    new Date(Date.parse(`${lastDay}T00:00:00Z`) - (windowDays - 1) * DAY_MS),
  );
  if (first.day <= firstWindowDay) return whole;
  const observedDays = Math.max(
    0,
    Math.min(windowDays, daysBetween(first.day, lastDay) + 1),
  );
  return {
    windowDays,
    observedDays,
    rateDays: Math.min(windowDays, Math.max(observedDays, MIN_RATE_DAYS)),
    since: first.day,
    young: observedDays < MIN_PLAN_DAYS,
    firstRecord: "read",
  };
}

/** The last `rateDays` days of a dense series that is oldest first. */
export function trimToObserved<T>(
  series: { dates: string[]; values: T[] },
  w: ObservedWindow,
): { dates: string[]; values: T[] } {
  if (w.rateDays >= series.values.length) return series;
  return {
    dates: series.dates.slice(-w.rateDays),
    values: series.values.slice(-w.rateDays),
  };
}

/**
 * The window clause of a basis sentence. Unchanged ("over 90d") for a house
 * older than the window, so a reader of the old sentence still matches it.
 */
export function windowWords(w: ObservedWindow, what: string): string {
  if (w.firstRecord === "could_not_read")
    return `over ${w.windowDays}d (the house's first ${what} could not be read, so the whole window is counted; the rate runs low if the house is younger than ${w.windowDays} days)`;
  if (w.since == null) return `over ${w.windowDays}d`;
  const floor =
    w.rateDays > w.observedDays
      ? `, counted as ${w.rateDays} days because a rate is never taken over less than a week`
      : "";
  const young = w.young
    ? `; ${w.observedDays} days of records is too young to plan from`
    : "";
  return `over ${w.observedDays} days since ${w.since} (the house's first ${what}; the days of the ${w.windowDays}-day window before it are not counted as days without sales${floor})${young}`;
}

/**
 * The house's first line in `table`, read once (`order … limit 1`). A failed
 * read is reported, never thrown: the lens falls back to its whole window and
 * says so.
 */
export async function readFirstRecord(
  client: any,
  table: string,
  restaurantId: string,
  column = "created_at",
): Promise<FirstRecord> {
  try {
    const { data, error } = await client
      .from(table)
      .select(column)
      .eq("restaurant_id", restaurantId)
      .order(column, { ascending: true })
      .limit(1);
    if (error)
      return {
        read: "could_not_read",
        day: null,
        error: error.message ?? String(error),
      };
    const v = Array.isArray(data) ? data[0]?.[column] : null;
    return { read: "read", day: v ? String(v).substring(0, 10) : null };
  } catch (err: any) {
    return {
      read: "could_not_read",
      day: null,
      error: err?.message ?? String(err),
    };
  }
}
