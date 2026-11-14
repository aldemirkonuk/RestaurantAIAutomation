/**
 * A rate is taken over the days the house was recording, not over the whole
 * window (r36 reports audit, gap 1). Zero-filling a 90-day window for a
 * 7-day-old house read a 2-a-day good at 0.156 a day: reorder point 3.43
 * instead of 14, 154 days of cover instead of 12.
 *
 * - The window starts at the house's FIRST line ever in the lens's feed (not
 *   the first in the window, so a quiet stretch in an older house stays quiet).
 * - A rate divides by at least one week, so an opening night is not every night.
 * - Under two of each weekday, a projection or a trend is withheld.
 * - An unreadable first line falls back to the whole window, and says so.
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
    firstRecord:
      first.read === "read" && first.day == null ? "none" : first.read,
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
