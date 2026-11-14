import * as E from "./engine";

/**
 * Spend pacing starts at the house's FIRST purchase order, not at the first
 * day of its 180-day window (r36 reports audit gap 1, the cashflow half).
 *
 * Before a house's first order Mudavym holds no purchasing at all, so those
 * days are unknown, not days without buying. Counting them as zero:
 *
 * - put a 40-day-old house's "30 days before last" at a third of a month
 *   and read the same spend as a +200% pace (the "spend is up" suggestion
 *   fires on that pace too);
 * - fed the Holt projection 20 empty weeks and one or two real ones, so the
 *   four weeks ahead were a climb drawn from the house's opening.
 *
 * The rule, stated once:
 * - the pace compares two FULL 30-day windows of records, so it needs 60 days
 *   from the first order; under that, both the pace and the earlier window are
 *   withheld (null: unknown, never zero);
 * - the projection runs on complete weeks inside the records, newest-aligned
 *   to yesterday, and needs four of them;
 * - a house with no purchase order has nothing to pace or project;
 * - a first order that cannot be read falls back to the whole window, and the
 *   sentence says so.
 */

/** Each side of the pace is one 30-day window. */
export const PACE_WINDOW_DAYS = 30;
/** A projection needs four complete weeks of records. */
export const MIN_PROJECTION_WEEKS = 4;

export type FirstOrder =
  /** `day` is the house day of the first order, or null when there is none. */
  | { read: "read"; day: string | null }
  | { read: "could_not_read"; day: null; error?: string };

export interface PurchasingSpan {
  /** The days of the window, oldest first, ending yesterday. */
  windowDays: number;
  /** The window's days on or after the house's first order. */
  observedDays: number;
  /** The first order's house day, when it falls inside the window. */
  since: string | null;
  firstRecord: "read" | "none" | "could_not_read";
}

/**
 * How many of the window's house days (`dates`, oldest first) the house was
 * recording purchases on.
 */
export function purchasingSpan(
  dates: string[],
  first: FirstOrder,
): PurchasingSpan {
  const windowDays = dates.length;
  if (first.read !== "read")
    return {
      windowDays,
      observedDays: windowDays,
      since: null,
      firstRecord: "could_not_read",
    };
  if (first.day == null)
    return { windowDays, observedDays: 0, since: null, firstRecord: "none" };
  if (windowDays === 0 || first.day <= dates[0])
    return {
      windowDays,
      observedDays: windowDays,
      since: null,
      firstRecord: "read",
    };
  const day = first.day;
  return {
    windowDays,
    observedDays: dates.filter((d) => d >= day).length,
    since: day,
    firstRecord: "read",
  };
}

export interface Pacing {
  spendLast30d: number;
  /** Null when the earlier window is not a full 30 days of records. */
  spendPrev30d: number | null;
  paceDeltaPct: number | null;
  /** Complete weeks of records the projection ran on (or would have). */
  weeks: number;
  projectedNext4Weeks: number[] | null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** The pace and the projection over a dense daily series ending yesterday. */
export function pacingOver(daily: number[], span: PurchasingSpan): Pacing {
  const recorded = Math.min(span.observedDays, daily.length);
  const twoWindows = recorded >= 2 * PACE_WINDOW_DAYS;
  const pace = twoWindows ? E.periodOverPeriod(daily, PACE_WINDOW_DAYS) : null;
  // Complete weeks inside the records, newest-aligned to yesterday. A week
  // that began before the first order would read its empty days as a quiet
  // week, and the newest point is the one Holt leans on most.
  const weeks = Math.floor(recorded / 7);
  const whole = weeks > 0 ? daily.slice(-weeks * 7) : [];
  const weekly: number[] = [];
  for (let i = 0; i < whole.length; i += 7)
    weekly.push(sum(whole.slice(i, i + 7)));
  const holt =
    weekly.length >= MIN_PROJECTION_WEEKS
      ? E.holtLinear(weekly, 0.4, 0.2, 4)
      : null;
  return {
    spendLast30d: sum(daily.slice(-PACE_WINDOW_DAYS)),
    spendPrev30d: twoWindows
      ? sum(daily.slice(-2 * PACE_WINDOW_DAYS, -PACE_WINDOW_DAYS))
      : null,
    paceDeltaPct: pace?.deltaPct ?? null,
    weeks: weekly.length,
    projectedNext4Weeks: holt?.forecast.map((v) => Math.max(0, v)) ?? null,
  };
}

/**
 * The clause after "delivered procurement_orders, filed on the house's day…".
 * Unchanged for a house older than the window.
 */
export function pacingWords(span: PurchasingSpan, p: Pacing): string {
  const projection =
    p.projectedNext4Weeks != null
      ? `the projection runs on ${p.weeks} complete weeks ending yesterday`
      : `no projection: it needs ${MIN_PROJECTION_WEEKS} complete weeks of purchase orders and there ${p.weeks === 1 ? "is 1" : `are ${p.weeks}`}`;
  if (span.firstRecord === "none")
    return "the house has no purchase order yet, so nothing is paced or projected";
  if (span.firstRecord === "could_not_read")
    return `the house's first purchase order could not be read, so all ${span.windowDays} days are counted and the figures run low if the house is younger than that; ${projection}`;
  if (span.since == null) return projection;
  const pace =
    p.spendPrev30d == null
      ? `, so the 30 days before last are not a full window of records and no pace is stated`
      : "";
  return `read over the ${span.observedDays} days since ${span.since}, the house's first purchase order: the days before it are not counted as days without buying${pace}; ${projection}`;
}
