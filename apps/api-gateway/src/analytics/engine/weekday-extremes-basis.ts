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

/**
 * @param extremes what `separableExtremes` returned
 * @param ranked how many weekdays had an observation (`profiles.length`)
 */
export function extremesBasis(
  extremes: { best: unknown | null; worst: unknown | null },
  ranked: number,
): string {
  if (ranked < 2) return EXTREMES_TOO_FEW;
  const best = extremes.best !== null && extremes.best !== undefined;
  const worst = extremes.worst !== null && extremes.worst !== undefined;
  if (best && worst) return EXTREMES_BOTH_NAMED;
  if (!best && !worst) return EXTREMES_BOTH_SHARED;
  return best ? EXTREMES_QUIETEST_SHARED : EXTREMES_BUSIEST_SHARED;
}
