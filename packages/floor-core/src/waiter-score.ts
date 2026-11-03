/**
 * Waiter performance score — flat until the warn minutes, then exponential
 * decay.
 *
 * Ported from the Floor Checker's `lib/waiter-score.ts` (frozen at `5958689`).
 * ADR 0346 is Proposed: each clause cited here is built under OD-242 (OD-255
 * records why), and F2/F3 are the founder's answers recorded in it.
 * The curve is unchanged (ADR 0346 D4). Changed here:
 * - D4 (a): no gaps → null ("—"), not 100.
 * - F2 → D9, the founder's pick "Describe the visits" (ADR 0346 `:96`,
 *   `:197`): the 90/80 cuts stay, the words describe the visits, not the
 *   person.
 * - D4 (d): `onTimePct` uses the score's own boundary, t ≤ T.
 * - F3 → D5, the founder's pick "No, sort only" (ADR 0346 `:75`, `:198`):
 *   `sortByScore` orders rows and prints no "#1", medal or "bottom".
 * `onTimePct` and `overdueGapCount` are lifted from the checker's report
 * (`lib/reports.ts:181-186`, `:353`) so the boundary lives in one place.
 *
 * Open as OD-256, the executor's reading under OD-242, not the founder's pick
 * (non-finite = NaN, Infinity or -Infinity):
 * - a gap that is not finite reads late: one visit, as an unreadable time is
 *   one table on the board (`seatingFreshness`);
 * - a warn/late house minute that is not finite gives no score (null, "—",
 *   ADR 0051), never a 0 for every waiter at once: an unknown setting is less
 *   evidence than no gaps (D4 (a)). The board reads the same setting late.
 * The checker's `!(t > T)` tests (`lib/waiter-score.ts:55`, `:68` at
 * `5958689`) read NaN as on time, so `visitScore` gave 100 for a NaN minute.
 * `latenessLambda` and `visitScoreMu` are the curve's constants and stay
 * unguarded: a non-finite minute gives NaN there, and every scoring function
 * checks before calling them.
 */

/** A gap or a house minute that is not a finite number. */
function unreadable(minutes: number): boolean {
  return !Number.isFinite(minutes);
}

/** λ: severity doubles every T minutes past threshold (NaN for a non-finite minute). */
export function latenessLambda(warnAfterMin: number): number {
  const T = Math.max(1, warnAfterMin);
  return Math.LN2 / T;
}

/**
 * μ for visit-score decay. Set equal to λ so:
 *   visitScore(t) = 100 / (severity(t) + 1)   when t > T
 * (score halves every T minutes past threshold).
 */
export function visitScoreMu(warnAfterMin: number): number {
  return latenessLambda(warnAfterMin);
}

/** Optional severity cap (≈ 2^5 − 1 when overdue by 5·T). */
export const SEVERITY_CAP = 31;

/**
 * F2: the checker's bands were "on_pace" | "watch" | "needs_review", labelled
 * "On pace" / "Watch" / "Needs review" (`waiter-score.ts:25-42`), words about
 * the person. The cuts (≥ 90, ≥ 80) are the checker's.
 */
export type ScoreBand = "on_time" | "some_late" | "many_late";

export function scoreBand(score: number): ScoreBand {
  if (score >= 90) return "on_time";
  if (score >= 80) return "some_late";
  return "many_late";
}

export function scoreBandLabel(band: ScoreBand): string {
  switch (band) {
    case "on_time":
      return "Visits on time";
    case "some_late":
      return "Some late";
    case "many_late":
      return "Many late";
  }
}

/**
 * Lateness severity (impact / penalty). Flat at 0 until T, then exponential.
 * severity(t) = 0                         if t ≤ T
 * severity(t) = min(cap, exp(λ(t−T)) − 1) if t > T
 * severity    = cap                       if t is not finite
 * severity    = null                      if the warn minute is not finite
 * `cap = Infinity` leaves severity uncapped; a NaN or negative cap is
 * `SEVERITY_CAP`, so severity is never NaN.
 */
export function latenessSeverity(
  gapMin: number,
  warnAfterMin: number,
  cap: number = SEVERITY_CAP,
): number | null {
  if (unreadable(warnAfterMin)) return null;
  if (Number.isNaN(cap) || cap < 0) cap = SEVERITY_CAP;
  if (unreadable(gapMin)) return cap;
  const T = Math.max(1, warnAfterMin);
  if (!(gapMin > T)) return 0;
  const λ = latenessLambda(T);
  const raw = Math.exp(λ * (gapMin - T)) - 1;
  return Math.min(cap, raw);
}

/**
 * Per-visit score 0–100 (higher = better).
 * visitScore(t) = 100                     if t ≤ T
 * visitScore(t) = 100 · exp(−μ(t−T))      if t > T
 * visitScore    = 0                       if t is not finite
 * visitScore    = null                    if the warn minute is not finite
 */
export function visitScore(gapMin: number, warnAfterMin: number): number | null {
  if (unreadable(warnAfterMin)) return null;
  if (unreadable(gapMin)) return 0;
  const T = Math.max(1, warnAfterMin);
  if (!(gapMin > T)) return 100;
  const μ = visitScoreMu(T);
  return 100 * Math.exp(-μ * (gapMin - T));
}

/**
 * Aggregate waiter score: round(mean(visitScore)) over gap samples.
 *
 * Proposed ADR 0346 D4 (a): no samples is no evidence, so null (printed "—", ADR 0051).
 * The checker returned 100 here (`waiter-score.ts:81`). An unreadable warn
 * minute is null too (see the header).
 */
export function waiterPerformanceScore(
  gapMinutes: number[],
  warnAfterMin: number,
): number | null {
  if (gapMinutes.length === 0 || unreadable(warnAfterMin)) return null;
  const sum = gapMinutes.reduce(
    (acc, t) => acc + (visitScore(t, warnAfterMin) ?? 0),
    0,
  );
  return Math.round(sum / gapMinutes.length);
}

/**
 * Share (0-100, rounded) of gaps that were on time; null with no gaps.
 *
 * Proposed ADR 0346 D4 (d): on time is t ≤ T, the score's full-marks rule. The
 * checker's report counted t < warn (`lib/reports.ts:182`), so a gap of
 * exactly T scored 100 and was not on time. A gap that is not finite is not
 * on time; an unreadable warn minute gives null (see the header).
 */
export function onTimePct(gapMinutes: number[], warnAfterMin: number): number | null {
  if (gapMinutes.length === 0 || unreadable(warnAfterMin)) return null;
  const T = Math.max(1, warnAfterMin);
  const onTime = gapMinutes.filter((t) => !unreadable(t) && t <= T).length;
  return Math.round((onTime / gapMinutes.length) * 100);
}

/**
 * Gaps at or over the house's late minutes (`lib/reports.ts:181`). A gap that
 * is not finite counts as overdue; an unreadable late minute gives null (see
 * the header).
 */
export function overdueGapCount(gapMinutes: number[], lateAfterMin: number): number | null {
  if (unreadable(lateAfterMin)) return null;
  return gapMinutes.filter((t) => unreadable(t) || t >= lateAfterMin).length;
}

export type ScoreOrder = "best_first" | "worst_first";

/**
 * F3, the founder's "No, sort only" (ADR 0346 `:75`): order rows by score; the result
 * carries no rank, "#1", medal or "bottom" field, and none may be derived from
 * the position until a load-adjusted fit exists (Proposed ADR 0346 D5, ADR 0272). A
 * list's order is not a claim that neighbours differ.
 *
 * Open as OD-258, the executor's reading under OD-242, not the founder's pick:
 * rows with no score (null, or a score that is not finite) go last in either
 * order, so no evidence is never placed above evidence; ties break on `id`,
 * ascending, so the order is stable. Returns a new array; the input is not
 * mutated.
 */
export function sortByScore<T extends { id: string; score: number | null }>(
  rows: readonly T[],
  order: ScoreOrder = "best_first",
): T[] {
  const sign = order === "best_first" ? -1 : 1;
  const byId = (a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return [...rows].sort((a, b) => {
    const sa = a.score !== null && Number.isFinite(a.score) ? a.score : null;
    const sb = b.score !== null && Number.isFinite(b.score) ? b.score : null;
    if (sa === null || sb === null) {
      if (sa === sb) return byId(a, b);
      return sa === null ? 1 : -1;
    }
    if (sa !== sb) return sign * (sa - sb);
    return byId(a, b);
  });
}
