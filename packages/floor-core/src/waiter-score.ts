/**
 * Waiter performance score — flat until the warn minutes, then exponential
 * decay.
 *
 * Ported from the Floor Checker's `lib/waiter-score.ts` (frozen at `5958689`).
 * The curve is unchanged (ADR 0346 D4). Changed here:
 * - D4 (a): no gaps → null ("—"), not 100.
 * - F2 (founder, 2026-10-31, "Describe the visits"): the 90/80 cuts stay, the
 *   words describe the visits, not the person.
 * - D4 (d): `onTimePct` uses the score's own boundary, t ≤ T.
 * - F3 (founder, 2026-10-31, "No, sort only"): `sortByScore` orders rows and
 *   prints no "#1", medal or "bottom".
 * `onTimePct` and `overdueGapCount` are lifted from the checker's report
 * (`lib/reports.ts:181-186`, `:353`) so the boundary lives in one place.
 *
 * The executor's call under the founder's 2026-10-31T16:57:09Z delegation:
 * a gap or a warn/late minute that is not a finite number (NaN, Infinity or
 * -Infinity) reads late, as an unreadable time does on the board
 * (`seatingFreshness`). The checker's `!(t > T)` tests
 * (`lib/waiter-score.ts:55`, `:68` at `5958689`) read NaN as on time, so
 * `visitScore` gave 100 and `latenessSeverity` 0 for a NaN warn minute.
 * No decision record holds this call yet. It is owed to the ADR 0346 docs PR
 * (the docs-floor-checker worktree), for `visitScore`, `latenessSeverity`,
 * `onTimePct`, `overdueGapCount` and `freshnessOf`.
 */

/** A gap or a house minute that is not a finite number. */
function unreadable(minutes: number): boolean {
  return !Number.isFinite(minutes);
}

/** λ: severity doubles every T minutes past threshold. */
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
 * severity    = cap                       if t or the warn minute is not finite
 */
export function latenessSeverity(
  gapMin: number,
  warnAfterMin: number,
  cap: number = SEVERITY_CAP,
): number {
  if (unreadable(gapMin) || unreadable(warnAfterMin)) return cap;
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
 * visitScore    = 0                       if t or the warn minute is not finite
 */
export function visitScore(gapMin: number, warnAfterMin: number): number {
  if (unreadable(gapMin) || unreadable(warnAfterMin)) return 0;
  const T = Math.max(1, warnAfterMin);
  if (!(gapMin > T)) return 100;
  const μ = visitScoreMu(T);
  return 100 * Math.exp(-μ * (gapMin - T));
}

/**
 * Aggregate waiter score: round(mean(visitScore)) over gap samples.
 *
 * ADR 0346 D4 (a): no samples is no evidence, so null (printed "—", ADR 0051).
 * The checker returned 100 here (`waiter-score.ts:81`).
 */
export function waiterPerformanceScore(
  gapMinutes: number[],
  warnAfterMin: number,
): number | null {
  if (gapMinutes.length === 0) return null;
  const sum = gapMinutes.reduce(
    (acc, t) => acc + visitScore(t, warnAfterMin),
    0,
  );
  return Math.round(sum / gapMinutes.length);
}

/**
 * Share (0-100, rounded) of gaps that were on time; null with no gaps.
 *
 * ADR 0346 D4 (d): on time is t ≤ T, the score's full-marks rule. The
 * checker's report counted t < warn (`lib/reports.ts:182`), so a gap of
 * exactly T scored 100 and was not on time. A gap or warn minute that is not
 * finite is not on time (see the header).
 */
export function onTimePct(gapMinutes: number[], warnAfterMin: number): number | null {
  if (gapMinutes.length === 0) return null;
  if (unreadable(warnAfterMin)) return 0;
  const T = Math.max(1, warnAfterMin);
  const onTime = gapMinutes.filter((t) => !unreadable(t) && t <= T).length;
  return Math.round((onTime / gapMinutes.length) * 100);
}

/**
 * Gaps at or over the house's late minutes (`lib/reports.ts:181`). A gap or
 * late minute that is not finite counts as overdue (see the header).
 */
export function overdueGapCount(gapMinutes: number[], lateAfterMin: number): number {
  if (unreadable(lateAfterMin)) return gapMinutes.length;
  return gapMinutes.filter((t) => unreadable(t) || t >= lateAfterMin).length;
}

export type ScoreOrder = "best_first" | "worst_first";

/**
 * F3 (founder, 2026-10-31, "No, sort only"): order rows by score; the result
 * carries no rank, "#1", medal or "bottom" field, and none may be derived from
 * the position until a load-adjusted fit exists (ADR 0346 D5, ADR 0272). A
 * list's order is not a claim that neighbours differ.
 *
 * Rows with no score (null, D4 a) go last in either order: no evidence is
 * never placed above evidence. Ties break on `id` so the order is stable.
 * Returns a new array; the input is not mutated.
 */
export function sortByScore<T extends { id: string; score: number | null }>(
  rows: readonly T[],
  order: ScoreOrder = "best_first",
): T[] {
  const sign = order === "best_first" ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (a.score === null || b.score === null) {
      if (a.score === b.score) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      return a.score === null ? 1 : -1;
    }
    if (a.score !== b.score) return sign * (a.score - b.score);
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
