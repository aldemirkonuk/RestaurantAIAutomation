import { WEEKDAY_NAMES } from "./engine/comparisons";

/**
 * The week's shape reads only the weekdays the house recorded a line on (r37
 * walk w3, R-F10).
 *
 * The series is zero-filled, so a weekday with no consumption line in the whole
 * window still had a profile, with a mean of 0 over its 13 days. That broke
 * the page in three ways:
 * - The basis said "a weekday with no observation is absent from
 *   weekdayProfile rather than reported as 0", and the page says it leaves
 *   such a day blank. Neither was true.
 * - A house closed on Mondays was told its quietest day is Monday. A house
 *   closed on Sundays and Mondays was told nothing, because two weekdays
 *   "share the lowest mean".
 * - A house that recorded only Saturdays was told six weekdays share the
 *   lowest mean. The "fewer than two weekdays have a reading" sentence
 *   (#1513) could never show.
 *
 * The rule: a weekday with no line on any of its days in the window is not
 * measured. Its days are left out of the weekday profile. Inside a measured
 * weekday, a day with no line still counts as 0: one quiet Tuesday among busy
 * ones is a quiet Tuesday. The trend and the decomposition still read the
 * whole series, because they are about days in order, not about weekdays.
 */
export function onRecordedWeekdays(
  dates: string[],
  values: number[],
  recorded: (date: string) => boolean,
): { dates: string[]; values: number[]; leftOut: string[] } {
  const seen = new Set<number>();
  for (const d of dates) if (recorded(d)) seen.add(weekdayOf(d));
  // Nothing recorded at all: the register's own empty sentence speaks, not
  // a list of seven weekdays left out.
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
  const names =
    leftOut.length === 1
      ? leftOut[0]
      : `${leftOut.slice(0, -1).join(", ")} and ${leftOut[leftOut.length - 1]}`;
  return `; ${names} ${leftOut.length === 1 ? "has" : "have"} no consumption line in the window, so ${leftOut.length === 1 ? "it is" : "they are"} not measured and left out (a day the house is closed is not its quietest day)`;
}
