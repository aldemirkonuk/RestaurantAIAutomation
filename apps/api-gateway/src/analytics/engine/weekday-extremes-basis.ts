/**
 * The working line under the week's shape: which of the busiest and quietest
 * weekdays the seasonality lens names, and why it leaves one out (walk r33
 * R-F2).
 *
 * `separableExtremes` withholds only the extreme that is shared and sets
 * `tie` when either is. The line used to read off `tie` alone, so a week with
 * one clear busiest day and two quietest said "bestDay/worstDay are null"
 * beside "Busiest day Saturday", and "Show the working" contradicted the
 * figure it explains. It also said the days were "the single weekdays" when
 * no weekday was observed at all.
 *
 * The two sentences an API reader already knows are kept word for word (the
 * page translates them into the house's words by their opening); the three
 * new ones are written in the house's words to begin with, so they need no
 * translation and carry no field name.
 */

/** Both named: one weekday holds each extreme. */
export const EXTREMES_BOTH_NAMED =
  "bestDay/worstDay are the single weekdays holding the highest and lowest mean";
/** Neither named: more than one weekday shares each extreme. */
export const EXTREMES_BOTH_SHARED =
  "bestDay/worstDay are null: more than one weekday shares the extreme, and naming one of them would be an arbitrary tie-break, not a finding";
/** Too few weekdays observed to rank. */
export const EXTREMES_TOO_FEW =
  "No busiest or quietest day is named: fewer than two weekdays have a reading in this window, so there is nothing to rank.";
export const EXTREMES_BUSIEST_SHARED =
  "No busiest day is named: more than one weekday shares the highest mean, and naming one of them would be an arbitrary tie-break, not a finding. The quietest day is the single weekday holding the lowest mean.";
export const EXTREMES_QUIETEST_SHARED =
  "No quietest day is named: more than one weekday shares the lowest mean, and naming one of them would be an arbitrary tie-break, not a finding. The busiest day is the single weekday holding the highest mean.";

/** No weekday in the window has a counted line: every one is a zero-fill. */
export const EXTREMES_NO_LINE =
  "No busiest or quietest day is named: no weekday has a counted line in this window, so every weekday reads 0 and there is nothing to rank.";

/**
 * r37 walk w3 R-F10. The series is zero-filled, so a weekday on which the log
 * holds no counted line reads a mean of 0. A house that recorded only
 * Saturdays was told six weekdays "share the lowest mean", as if they had
 * been measured equally quiet. The busiest day stays named (Saturday did
 * sell more than the days that recorded nothing), and the line now says
 * which of the quietest, shared or named, have no line at all, so the 0 is
 * read as "nothing recorded", not as a measured quiet night.
 */
export function noLineSentence(days: readonly string[]): string {
  if (days.length === 0) return "";
  const list =
    days.length === 1
      ? days[0]
      : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
  return days.length === 1
    ? `${list} has no counted line in this window, so it reads 0.`
    : `${list} have no counted line in this window, so each reads 0.`;
}

/**
 * @param extremes what `separableExtremes` returned
 * @param ranked how many weekdays the profile holds (`profiles.length`)
 * @param lines which weekdays have no counted line in the window: how many
 *   of the ranked weekdays (`withoutLine`), and the names of those among the
 *   weekdays sharing the lowest mean (`quietWithoutLine`, in weekday order).
 *   Omitted, the line reads as it did before R-F10.
 */
export function extremesBasis(
  extremes: { best: unknown | null; worst: unknown | null },
  ranked: number,
  lines: { withoutLine?: number; quietWithoutLine?: readonly string[] } = {},
): string {
  if (ranked < 2) return EXTREMES_TOO_FEW;
  if (lines.withoutLine !== undefined && lines.withoutLine >= ranked)
    return EXTREMES_NO_LINE;
  const best = extremes.best !== null && extremes.best !== undefined;
  const worst = extremes.worst !== null && extremes.worst !== undefined;
  const head =
    best && worst
      ? EXTREMES_BOTH_NAMED
      : !best && !worst
        ? EXTREMES_BOTH_SHARED
        : best
          ? EXTREMES_QUIETEST_SHARED
          : EXTREMES_BUSIEST_SHARED;
  // Said whether the quietest is named or shared: a named quietest day that
  // recorded nothing is "quietest" only by the zero-fill, too.
  const tail = noLineSentence(lines.quietWithoutLine ?? []);
  return tail ? `${head}${head.endsWith(".") ? "" : "."} ${tail}` : head;
}
