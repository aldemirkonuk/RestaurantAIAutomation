import { zonedWallTimeToInstant } from "../../calendar/reminder-window";
import {
  serviceWindows,
  type OperatingHours,
} from "../../common/operating-hours/operating-hours";

/**
 * When is a day's trading finished enough to summarise?
 *
 * THE QUESTION IS NOT RHETORICAL. A "sale record" written at 21:00 while the
 * dining room is still full is a wrong number stated as a fact, and a permanent
 * row cannot be corrected. So the producer needs a rule, and the rule needs a
 * source rather than a taste.
 *
 * TWO RULES, AND THE ROW SAYS WHICH ONE DECIDED
 * ---------------------------------------------
 * 1. **The venue's own hours.** `restaurants.operating_hours`
 *    (20260902210000_restaurant_operating_hours.sql) plus
 *    `serviceWindows(hours, zone, localDate)` gives the UTC `[start, end)` of
 *    every window that OPENS on that local date, midnight-crossing included. The
 *    day is finished `SETTLE_MINUTES` after the last window ends — a margin for
 *    the POS import to land, not for the kitchen.
 *
 * 2. **A settle margin past local midnight**, when the hours are unknown. And
 *    they are unknown: that migration's own header records that the column was
 *    added nullable, "every existing row keeps NULL", and that NULL means "we do
 *    not know this venue's hours" with no reader permitted to coerce it. So rule
 *    2 is the live path today, not the fallback nobody hits.
 *
 * The fallback is a SCHEDULING decision, not a claim about the restaurant, and
 * that distinction is what makes it honest: it says when this process will look,
 * never when the venue closed. The producer carries `dayClosedRule` into the
 * notification's metadata so a reader can see which rule produced the timing.
 *
 * `serviceWindows` throws — `OperatingHoursError` on a shape it cannot parse,
 * `RangeError` on an unknown zone — and both are caught here and reported as
 * rule 2 with a reason, because a malformed hours object must not make a
 * restaurant's daily record permanently unwritable.
 */

/** How long after the last service window the day is treated as settled. */
export const SETTLE_MINUTES_AFTER_HOURS = 60;

/**
 * How long after local midnight the day is treated as settled when the venue's
 * hours are unknown. Six hours: past any plausible close, before the next
 * service. Stated rather than derived — there is nothing in the schema to derive
 * it from while `operating_hours` is NULL, and pretending otherwise would be
 * worse than naming it.
 */
export const SETTLE_HOURS_AFTER_MIDNIGHT = 6;

export type DayClosedRule =
  | "operating_hours"
  | "settle_after_midnight"
  | "closed_day";

export interface ServiceDayVerdict {
  /** True when the day may be summarised now. */
  settled: boolean;
  rule: DayClosedRule;
  /** The instant this day became summarisable. */
  settledAt: Date;
  /** Why rule 2 was used, when it was used despite hours being present. */
  note: string | null;
}

/** `YYYY-MM-DD` for an instant on a named zone's wall clock. */
export function localDateIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** `YYYY-MM-DD` shifted by whole days, calendar-safe. */
export function shiftLocalDate(localDate: string, days: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return [
    String(shifted.getUTCFullYear()).padStart(4, "0"),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/** Local midnight that OPENS `localDate`, as an instant. */
export function localMidnight(localDate: string, timeZone: string): Date {
  const [y, m, d] = localDate.split("-").map(Number);
  return zonedWallTimeToInstant(y, m, d, 0, 0, timeZone);
}

/**
 * Is `localDate`'s trading finished as of `now`?
 *
 * `closed_day` is a real verdict and not the same as "not settled yet": the
 * venue's hours name no window opening on that date, so there was no service to
 * summarise and the producer must not write a zero-revenue record for it.
 */
export function serviceDaySettled(
  hours: OperatingHours | unknown | null,
  timeZone: string,
  localDate: string,
  now: Date,
): ServiceDayVerdict {
  const midnightAfter = localMidnight(
    shiftLocalDate(localDate, 1),
    timeZone,
  );
  const fallbackAt = new Date(
    midnightAfter.getTime() + SETTLE_HOURS_AFTER_MIDNIGHT * 3_600_000,
  );

  if (hours === null || hours === undefined) {
    return {
      settled: now.getTime() >= fallbackAt.getTime(),
      rule: "settle_after_midnight",
      settledAt: fallbackAt,
      note: "This venue's operating hours are not recorded, so the day is treated as settled a fixed margin after local midnight.",
    };
  }

  let windows: Array<{ start: Date; end: Date }>;
  try {
    windows = serviceWindows(hours, timeZone, localDate);
  } catch (e: any) {
    return {
      settled: now.getTime() >= fallbackAt.getTime(),
      rule: "settle_after_midnight",
      settledAt: fallbackAt,
      note: `This venue's operating hours could not be read (${e?.message ?? "unknown"}), so the day is treated as settled a fixed margin after local midnight.`,
    };
  }

  if (windows.length === 0) {
    return {
      settled: false,
      rule: "closed_day",
      settledAt: fallbackAt,
      note: "The venue's hours name no service window opening on this date.",
    };
  }

  const lastEnd = windows.reduce(
    (latest, w) => (w.end.getTime() > latest.getTime() ? w.end : latest),
    windows[0].end,
  );
  const settledAt = new Date(
    lastEnd.getTime() + SETTLE_MINUTES_AFTER_HOURS * 60_000,
  );
  return {
    settled: now.getTime() >= settledAt.getTime(),
    rule: "operating_hours",
    settledAt,
    note: null,
  };
}
