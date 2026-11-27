import { WEEKDAY_NAMES } from "./engine/comparisons";

/**
 * The week's shape reads only the weekdays the house recorded a counted line
 * on (r109 reports-r109-7, re-deriving #1631 on the reports chain).
 *
 * The series is zero-filled, so a weekday with no line in the whole window
 * still had a profile, with a mean of 0 over its 13 days. A house closed on
 * Mondays was told Monday is its quietest day; a house closed on Sundays and
 * Mondays was told nothing, because two weekdays "share the lowest mean"; and
 * the basis said a weekday with no observation is absent, which was not true.
 *
 * The rule:
 * - A weekday with no counted line on any of its days is not measured. Its
 *   days are left out of the weekday profile: never a mean of 0.
 * - A counted line is one with a bottle figure, 0 included. A line with no
 *   bottle figure (ADR 0297) does not make its day recorded: a weekday known
 *   only through such lines has no known figure, and zero-fill would read it
 *   as 0.
 * - Inside a measured weekday, a day with no line still counts as 0. The log
 *   has no "open, sold nothing" marker, so dropping such a day would read one
 *   busy Tuesday among twelve empty ones as a busy weekday.
 * - The trend and the decomposition still read every day in order.
 */
export function onRecordedWeekdays(
  dates: string[],
  values: number[],
  recorded: (date: string) => boolean,
): { dates: string[]; values: number[]; leftOut: string[] } {
  const seen = new Set<number>();
  for (const d of dates) if (recorded(d)) seen.add(weekdayOf(d));
  // Nothing recorded at all: the register's own empty sentence speaks, not a
  // list of seven weekdays left out.
  if (seen.size === 0) return { dates: [], values: [], leftOut: [] };
  const keep = dates.map((d) => seen.has(weekdayOf(d)));
  const leftOut = Array.from(new Set(dates.map(weekdayOf)))
    .filter((w) => !seen.has(w))
    .sort((a, b) => a - b)
    .map((w) => WEEKDAY_NAMES[w]);
  return {
    dates: dates.filter((_, i) => keep[i]),
    values: values.filter((_, i) => keep[i]),
    leftOut,
  };
}

/** The weekday of a house day string, as `dayOfWeekProfile` reads it. */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The clause the weekday basis adds when a weekday is left out. */
export function leftOutWords(leftOut: string[]): string {
  if (leftOut.length === 0) return "";
  const one = leftOut.length === 1;
  const names = one
    ? leftOut[0]
    : `${leftOut.slice(0, -1).join(", ")} and ${leftOut[leftOut.length - 1]}`;
  return `; ${names} ${one ? "has" : "have"} no counted consumption line in the window, so ${one ? "it is" : "they are"} not measured and left out (a day the house is closed is not its quietest day)`;
}

/** The extremes basis when fewer than two weekdays are measured. */
export const EXTREMES_TOO_FEW =
  "bestDay/worstDay are null: fewer than two weekdays have a counted consumption line in the window, so there is nothing to rank";
