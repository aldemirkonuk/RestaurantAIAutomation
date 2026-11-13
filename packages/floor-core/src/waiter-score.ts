/**
 * Waiter performance score — flat until the warn minutes, then exponential
 * decay.
 *
 * Ported from the Floor Checker's `lib/waiter-score.ts` (frozen at `5958689`).
 * ADR 0346 is Proposed: each clause cited here is built under OD-242 (OD-255
 * records why), and F2 is the founder's answer recorded in it.
 * The curve is unchanged (ADR 0346 D4). Changed here:
 * - D4 (a): no gaps → null ("—"), not 100.
 * - F2 → D9, the founder's pick "Describe the visits" (ADR 0346 `:96`,
 *   `:197`): the 90/80 cuts stay, the words describe the visits, not the
 *   person.
 * - D4 (d): `onTimePct` uses the score's own boundary, t ≤ T.
 * - `latenessSeverity` is the checker's (`lib/waiter-score.ts:49`) with
 *   OD-256's readings, and a NaN or negative cap read as `SEVERITY_CAP` (the
 *   checker returned NaN or that cap past T); `sortByScore` is new, for the
 *   manager's waiter view that will replace the checker's own sort
 *   (`WaiterPerformanceView.tsx:34`) under OD-258. See each below.
 * `onTimePct` and `overdueGapCount` are lifted from the checker's report
 * (`lib/reports.ts:181-186`, `:353`) so the boundary lives in one place.
 *
 * Open as OD-256, the executor's reading under OD-242, not the founder's pick
 * (non-finite = NaN, Infinity or -Infinity):
 * - a gap that is not finite reads late: one visit, as an unreadable time is
 *   one table on the board (`seatingFreshness`);
 * - a warn/late house minute that is not finite gives no score (null, "—",
 *   ADR 0051), never a 0 for every waiter at once.
 * Gaps come from `exactMinutesSince`, which never returns a negative; a
 * negative gap passed in anyway is read as on time, as the checker read it.
 * The checker's `!(t > T)` tests (`lib/waiter-score.ts:55`, `:68` at
 * `5958689`) read NaN as on time, so `visitScore` gave 100 for a NaN minute.
 */

/** A gap or a house minute that is not a finite number. */
function unreadable(minutes: number): boolean {
  return !Number.isFinite(minutes);
}

/** λ: severity doubles every T minutes past threshold; NaN for a minute that is not finite. */
export function latenessLambda(warnAfterMin: number): number {
  if (unreadable(warnAfterMin)) return NaN;
  const T = Math.max(1, warnAfterMin);
  return Math.LN2 / T;
}

/**
 * F2: the checker's bands were "on_pace" | "watch" | "needs_review", labelled
 * "On pace" / "Watch" / "Needs review" (`waiter-score.ts:25-42`), words about
 * the person. The cuts (≥ 90, ≥ 80) are the checker's.
 */
export type ScoreBand = "on_time" | "some_late" | "many_late";

/** No score (null, or not finite) has no band: D4 (a). */
export function scoreBand(score: number | null): ScoreBand | null {
  if (score === null || !Number.isFinite(score)) return null;
  if (score >= 90) return "on_time";
  if (score >= 80) return "some_late";
  return "many_late";
}

/** No band prints "—" (ADR 0051). */
export function scoreBandLabel(band: ScoreBand | null): string {
  if (band === null) return "—";
  switch (band) {
    case "on_time":
      return "Visits on time";
    case "some_late":
      return "Some late";
    case "many_late":
      return "Many late";
    default:
      return "—";
  }
}

/** One gap's score against a readable warn minute; 0 for an unreadable gap. */
function scoreAt(gapMin: number, warnAfterMin: number): number {
  if (unreadable(gapMin)) return 0;
  const T = Math.max(1, warnAfterMin);
  if (!(gapMin > T)) return 100;
  return 100 * Math.exp(-latenessLambda(T) * (gapMin - T));
}

/**
 * Per-visit score 0–100 (higher = better). μ = λ, so the score halves every
 * T minutes past the threshold.
 * visitScore(t) = 100                     if t ≤ T
 * visitScore(t) = 100 · exp(−λ(t−T))      if t > T
 * visitScore    = 0                       if t is not finite
 * visitScore    = null                    if the warn minute is not finite
 */
export function visitScore(gapMin: number, warnAfterMin: number): number | null {
  return unreadable(warnAfterMin) ? null : scoreAt(gapMin, warnAfterMin);
}

/**
 * Aggregate waiter score: round(mean(visitScore)) over gap samples.
 *
 * Proposed ADR 0346 D4 (a): no samples is no evidence, so null (printed "—").
 * The checker returned 100 here (`waiter-score.ts:81`). An unreadable warn
 * minute is null too (see the header).
 */
export function waiterPerformanceScore(
  gapMinutes: number[],
  warnAfterMin: number,
): number | null {
  if (gapMinutes.length === 0 || unreadable(warnAfterMin)) return null;
  const sum = gapMinutes.reduce((acc, t) => acc + scoreAt(t, warnAfterMin), 0);
  return Math.round(sum / gapMinutes.length);
}

/**
 * Share (0-100, rounded) of gaps that were on time; null with no gaps.
 *
 * Proposed ADR 0346 D4 (d): on time is t ≤ T, the score's full-marks rule. The
 * checker's report counted t < warn (`lib/reports.ts:182`), so a gap of
 * exactly T scored 100 and was not on time.
 */
export function onTimePct(gapMinutes: number[], warnAfterMin: number): number | null {
  if (gapMinutes.length === 0 || unreadable(warnAfterMin)) return null;
  const T = Math.max(1, warnAfterMin);
  const onTime = gapMinutes.filter((t) => !unreadable(t) && t <= T).length;
  return Math.round((onTime / gapMinutes.length) * 100);
}

/**
 * Gaps at or over the house's late minutes (`lib/reports.ts:181`), the same
 * `>=` as `freshnessOf`'s late boundary; a spec pins the two together. A gap
 * that is not finite counts as overdue. The late minute is used as set, so a
 * late setting ≤ 0 counts every gap overdue while `onTimePct` may read 100
 * (OD-256 registers it).
 */
export function overdueGapCount(gapMinutes: number[], lateAfterMin: number): number | null {
  if (gapMinutes.length === 0 || unreadable(lateAfterMin)) return null;
  return gapMinutes.filter((t) => unreadable(t) || t >= lateAfterMin).length;
}

/** Optional severity cap (≈ 2^5 − 1 when overdue by 5·T). */
export const SEVERITY_CAP = 31;

/**
 * Lateness severity (impact / penalty). Flat at 0 until T, then exponential.
 * severity(t) = 0                         if t ≤ T
 * severity(t) = min(cap, exp(λ(t−T)) − 1) if t > T
 * severity    = cap                       if t is not finite (OD-256)
 * severity    = null                      if the warn minute is not finite
 * `cap = Infinity` leaves severity uncapped; a NaN or negative cap is
 * `SEVERITY_CAP`, so severity is never NaN. A cap of 0 flattens severity to
 * 0: the cap is a caller's argument, not a house setting.
 */
export function latenessSeverity(
  gapMin: number,
  warnAfterMin: number,
  cap: number = SEVERITY_CAP,
): number | null {
  if (unreadable(warnAfterMin)) return null;
  const limit = Number.isNaN(cap) || cap < 0 ? SEVERITY_CAP : cap;
  if (unreadable(gapMin)) return limit;
  const T = Math.max(1, warnAfterMin);
  if (!(gapMin > T)) return 0;
  return Math.min(limit, Math.exp(latenessLambda(T) * (gapMin - T)) - 1);
}

export type ScoreOrder = "best_first" | "worst_first";

/**
 * F3, the founder's "No, sort only" (ADR 0346 `:75`, `:198`): order rows by
 * score; the result carries no rank, "#1", medal or "bottom" field, and none
 * may be derived from the position until a load-adjusted fit exists
 * (Proposed ADR 0346 D5, ADR 0272).
 *
 * Open as OD-258, the executor's reading under OD-242, not the founder's pick:
 * rows with no score (null, or a score that is not finite) go last in either
 * order; ties break on `id`, ascending. Returns a new array.
 */
export function sortByScore<T extends { id: string; score: number | null }>(
  rows: readonly T[],
  order: ScoreOrder = "best_first",
): T[] {
  const sign = order === "best_first" ? -1 : 1;
  const byId = (a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const finite = (s: number | null) => (s !== null && Number.isFinite(s) ? s : null);
  return [...rows].sort((a, b) => {
    const sa = finite(a.score);
    const sb = finite(b.score);
    if (sa === null || sb === null) {
      if (sa === sb) return byId(a, b);
      return sa === null ? 1 : -1;
    }
    return sa !== sb ? sign * (sa - sb) : byId(a, b);
  });
}
