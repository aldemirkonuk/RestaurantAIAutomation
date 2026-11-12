/**
 * One scorer for a goal's standing (reports lane r2, 2026-11-11).
 *
 * Three readers judged goals with three pieces of arithmetic: the goals desk
 * (`GoalsService.getGoalProgress`), the insight feed (`computeGoalsFamily`)
 * and the recommendations goal rule. Only the desk read the goal's direction,
 * so a "keep at most" goal under its ceiling was "behind" on the other two,
 * and the feed said "You're 0% of the way" off a stored value nobody had read.
 * And none of them knew that a level (an average check, days of stock) is not
 * a running total: a linear schedule from 0 to the target called a level that
 * already met its target "behind" on day one, and called almost any level "on
 * pace" in the first weeks.
 *
 * The invariants this holds, for every reader:
 * - An unknown current or target is no score: every field null, never 0.
 * - `met` follows the direction: at least means current >= target, at most
 *   means current <= target.
 * - A running total climbs from 0, so its schedule runs from 0 to the target.
 *   At least: reached is on pace. At most: over the ceiling is never on pace,
 *   since a running total does not come back down.
 * - A level is read at an instant. Met is on pace. Otherwise its schedule runs
 *   from the baseline (where it stood when the goal was set) to the target;
 *   with no baseline on the far side of the target there is no schedule, so
 *   the pace is unknown (null), not "behind" — unless it once met the target
 *   and has since slipped past it, which is behind.
 * - No deadline, no schedule: pace null.
 *
 * Pure: no I/O, and no clock but the `at` it is given.
 */

export type GoalDirection = "at_least" | "at_most";
export type GoalShape = "cumulative" | "level";

/** A pace within this share of the schedule is on pace (the desk's old 10%). */
export const PACE_SLACK = 0.1;

const DAY_MS = 86400000;

/**
 * The metrics read at an instant rather than summed over the goal's window
 * (`GoalsService.computeMetricWithSeries`: they return no daily series).
 */
const LEVEL_METRICS: ReadonlySet<string> = new Set([
  "avg_check",
  "wine_attach_rate",
  "days_of_inventory",
]);

export function goalShape(metricKey: unknown): GoalShape {
  return LEVEL_METRICS.has(String(metricKey ?? "")) ? "level" : "cumulative";
}

export function goalDirection(direction: unknown): GoalDirection {
  return direction === "at_most" ? "at_most" : "at_least";
}

export interface GoalScoreInput {
  direction: unknown;
  shape: GoalShape;
  current: number | null;
  target: number | null;
  /** Where a level stood when the goal was set; ignored for a running total. */
  baseline?: number | null;
  /** Epoch ms the schedule opens and closes; null end = no deadline. */
  start: number | null;
  end: number | null;
  /** Epoch ms the reading is judged at. */
  at: number;
}

export interface GoalScore {
  direction: GoalDirection;
  /** current / target: share of the target reached, or of the ceiling used. */
  progressPct: number | null;
  met: boolean | null;
  expectedByNow: number | null;
  onTrack: boolean | null;
  daysLeft: number | null;
}

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** A stored or wire figure as a number, or null; never `Number(null) || 0`. */
export function figureOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  return finite(n) ? n : null;
}

export function scoreGoal(input: GoalScoreInput): GoalScore {
  const direction = goalDirection(input.direction);
  const { current, target, shape, start, end, at } = input;
  const none: GoalScore = {
    direction,
    progressPct: null,
    met: null,
    expectedByNow: null,
    onTrack: null,
    daysLeft: null,
  };
  if (!finite(current) || !finite(target) || target <= 0) return none;

  const metAt = (v: number) => (direction === "at_most" ? v <= target : v >= target);
  const met = metAt(current);
  const score: GoalScore = { ...none, progressPct: current / target, met };

  if (!finite(end) || !finite(start)) return score;
  const totalDays = Math.max(1, (end - start) / DAY_MS);
  const elapsed = Math.min(totalDays, Math.max(0, (at - start) / DAY_MS));
  const frac = elapsed / totalDays;
  score.daysLeft = Math.max(0, Math.ceil((end - at) / DAY_MS));

  if (shape === "cumulative") {
    const expected = target * frac;
    score.expectedByNow = expected;
    score.onTrack =
      direction === "at_most"
        ? current <= target && current <= expected * (1 + PACE_SLACK)
        : met || current >= expected * (1 - PACE_SLACK);
    return score;
  }

  // A level.
  if (met) {
    score.expectedByNow = target;
    score.onTrack = true;
    return score;
  }
  const baseline = input.baseline;
  if (finite(baseline) && !metAt(baseline)) {
    const gap = target - baseline;
    const expected = baseline + gap * frac;
    score.expectedByNow = expected;
    const slack = Math.abs(gap) * PACE_SLACK;
    score.onTrack =
      direction === "at_most" ? current <= expected + slack : current >= expected - slack;
    return score;
  }
  if (finite(baseline)) {
    // It met the target when it was set and has slipped past it since.
    score.expectedByNow = target;
    score.onTrack = false;
  }
  return score;
}

/**
 * A stored goal row as a reader may show it (reports lane r2).
 *
 * `current_value` is the last live reading, kept by `getGoalProgress`. When
 * the latest reading was refused (`current_unread`, when in
 * `current_read_at`), the number left in the column is an older one: shown
 * beside the refusal it posed as where the goal stands now (an owner saw the
 * bench's "Now" beside the desk's "could not be scored"). So it goes out as
 * null with the refusal's reason, and every reader prints a null as unknown.
 */
export function presentStoredReading<T extends Record<string, any> | null>(row: T): T {
  if (!row) return row;
  const unread = row.current_unread;
  if (typeof unread !== "string" || unread === "") return row;
  return { ...row, current_value: null };
}

/**
 * The stored reading a pace claim may be made from: its value and when it was
 * read, or null when the row has no dated, unrefused reading. A row written
 * before the read stamp existed has no date, so its age is unknown and no
 * pace is claimed from it until it is next read.
 */
export function datedReading(
  row: Record<string, any> | null | undefined,
): { current: number; at: number } | null {
  const shown = presentStoredReading(row ?? null);
  if (!shown) return null;
  const current = figureOrNull(shown.current_value);
  const at = Date.parse(String(shown.current_read_at ?? ""));
  if (current === null || !Number.isFinite(at)) return null;
  return { current, at };
}
