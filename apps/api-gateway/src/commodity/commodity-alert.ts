/**
 * `commodity_exposure_rising` — the arithmetic, and only the arithmetic.
 *
 * Pure: no Nest, no database, no clock, so every rule below is testable as a
 * rule. It is the class-E twin of `notifications/producers/market-signal.ts`,
 * and it deliberately differs from that file in one structural way, for a
 * reason that was measured rather than argued.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THRESHOLD IS NOT A CONSTANT, AND COPYING market-signal.ts WOULD BE WRONG
 * BY A FACTOR OF EIGHT
 * ─────────────────────────────────────────────────────────────────────────────
 * `market-signal.ts` uses one global `DEFAULT_DROP_THRESHOLD = 0.1` and says
 * openly that it is a chosen default. Run over three real series on 2026-09-05
 * with K = 12, the rise threshold that produces "about twice a year" is:
 *
 *     BLS APU0000708111  retail eggs        35.7 %
 *     BLS WPU017107      wholesale eggs     67.8 %
 *     FAO Food Price Index                   8.5 %
 *
 * A factor of eight. A single `COMMODITY_SIGNAL_RISE_PCT` would be a number
 * that means eight different things. And on the founder's own commodity a
 * plausible-looking 15 % threshold fires in **more than a third of all months**.
 *
 * So the operator sets a BUDGET — how often this house wants to hear about this
 * series — and `deriveRiseThreshold` reads the percentage out of the series'
 * own history at the quantile that produces that rate. The number and the
 * window that produced it are stored together, so the sentence on the screen
 * can state its own working.
 *
 * THE STEP GUARD IS PER-SERIES FOR THE SAME REASON, and this one has a
 * measured casualty. A global 35 % "probably a bad parse" ceiling — the shape
 * `IMPLAUSIBLE_DROP_CEILING = 0.6` takes — **refused 25 of 114 evaluated months
 * on the wholesale egg series**, whose real p99 month-on-month move is 82 %.
 * Twenty-two percent of a real market suppressed as implausible. So `J_s` is
 * the series' own p99, and a move above it is refused **and named**, never
 * dropped.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A MEDIAN, NOT A MEAN
 * ─────────────────────────────────────────────────────────────────────────────
 * For the reason `flagOutliers` already uses a median absolute deviation: one
 * revised observation moves a mean and does not move a median. This register
 * writes revisions as new rows on purpose, so revised values are exactly what
 * this arithmetic will meet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * K COUNTS OBSERVATIONS, NOT DAYS
 * ─────────────────────────────────────────────────────────────────────────────
 * A 90-day baseline on a monthly series is three points. This is the mistake
 * the Michigan cadence correction already caught once, in the other direction
 * (`maxAgeDays` 62 on a 91-day cycle).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE REFUSES TO DECIDE, AND SAYS SO
 * ─────────────────────────────────────────────────────────────────────────────
 * The plan's conditions 7 and 8 — "the house carries fewer than N days of this
 * item" and "the item keeps for at least the exposure's lag" — are NOT
 * evaluated here and are NOT quietly treated as satisfied. Measured on this
 * tree, `grep -rn -i "shelf_life\|shelf life\|expiry_date\|best_before"
 * supabase/migrations/` returns **zero shelf-life columns** across every
 * migration. Without one, "stock up" on the founder's own example is advice to
 * buy three months of a perishable.
 *
 * A rule that silently skipped them would be the absence-reported-as-health
 * shape exactly: a condition nobody could evaluate, reported as a condition
 * that passed. So the decision carries `unevaluated`, every caller must render
 * it, and a decision with a non-empty `unevaluated` can never be more than a
 * DARK one. Where shelf life comes from is the plan's Q3 and it is the
 * founder's.
 */

/** The baseline length, in OBSERVATIONS. */
export const DEFAULT_BASELINE_K = 12;

/**
 * Fewer admitted observations than this and the series gets NO threshold at
 * all — `riseThreshold` stays null and the rule cannot fire for it. Stated on
 * the screen, never left as a silence. 36 is three years of a monthly series:
 * enough that a quantile at the 1-in-6-months end is read off real data rather
 * than off its two most extreme points.
 */
export const THRESHOLD_HISTORY_FLOOR = 36;

/** How long one (series, item) signal stays said, in days. */
export const DEFAULT_QUIET_WINDOW_DAYS = 14;

/** Observations a year, by grain. The budget is per YEAR; the data is per obs. */
export const OBSERVATIONS_PER_YEAR: Record<string, number> = {
  day: 365,
  week: 52,
  month: 12,
  quarter: 4,
  year: 1,
};

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The `q`-quantile of an ascending sample, linearly interpolated.
 *
 * Interpolated rather than nearest-rank because the whole point is to land on
 * a fire RATE: nearest-rank on a 120-point sample steps in units of 0.83 % of
 * the distribution, which on a "twice a year" budget (a rate of 1/6 of a
 * percent per observation) is a step larger than the target itself.
 */
export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  if (!(q >= 0 && q <= 1)) return null;
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/**
 * The `q`-quantile by NEAREST RANK, rounding UP to a real observed value.
 *
 * Used for the step guard and nowhere else, and the asymmetry with `quantile`
 * above is deliberate rather than an inconsistency. The two numbers err in
 * opposite directions on purpose:
 *
 *   the RISE threshold decides how often a house is interrupted, so it wants
 *   the rate to be right, and interpolation is what lands on it;
 *
 *   the STEP GUARD decides what is thrown away as a probable bad parse, so
 *   erring low SUPPRESSES A REAL MARKET. The plan's own measured casualty is
 *   exactly this: a global 35 % ceiling refused 25 of 114 evaluated months on
 *   the wholesale egg series, whose real p99 is 82 %.
 *
 * Measured on the full 440-row FAO series on 2026-09-05: interpolation puts
 * p99 at **7.49 %**, which sits BETWEEN two real observed steps (6.98 % and
 * 7.80 %) and would have refused a 7.80 % month that actually happened.
 * Nearest rank puts it at **7.80 %** — a value the market really printed, and
 * the same figure the plan's §9b table publishes. So the guard rounds up to a
 * move the series has genuinely made.
 */
export function quantileCeilingRank(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  if (!(q >= 0 && q <= 1)) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(q * s.length));
  return s[Math.min(rank, s.length) - 1];
}

/**
 * `m` — the move against the baseline, at the newest point of `values`.
 *
 *     v_t      the newest value
 *     B        median of the K observations ending one period before t
 *     m        (v_t - B) / B
 *
 * `values` must be ascending by period. Returns null when there is not enough
 * history: at least `K + 2` observations, which is exactly the plan's
 * condition 1.
 */
export function moveAgainstBaseline(
  values: number[],
  k: number = DEFAULT_BASELINE_K,
): { move: number; baseline: number; latest: number } | null {
  const n = values.length;
  if (k < 1 || n < k + 2) return null;
  // v_t is at n-1. The baseline window is v_(t-1-K) … v_(t-2), i.e. indices
  // n-2-k … n-3 inclusive, which is k observations and stops one period short
  // of v_(t-1) on purpose: a baseline that included the point immediately
  // before the move would be partly made of the move.
  const window = values.slice(n - 2 - k, n - 2);
  const baseline = median(window);
  if (baseline === null || baseline <= 0) return null;
  const latest = values[n - 1];
  return { move: (latest - baseline) / baseline, baseline, latest };
}

/** `j` — the single-step jump at the newest point, as a magnitude. */
export function stepAtLatest(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const prev = values[n - 2];
  if (!(prev > 0)) return null;
  return Math.abs(values[n - 1] / prev - 1);
}

/** Every `m` this series' own history would have produced, oldest first. */
export function movesOverHistory(
  values: number[],
  k: number = DEFAULT_BASELINE_K,
): number[] {
  const out: number[] = [];
  for (let end = k + 2; end <= values.length; end += 1) {
    const m = moveAgainstBaseline(values.slice(0, end), k);
    if (m) out.push(m.move);
  }
  return out;
}

/** Every single-step move, as a magnitude, over the whole history. */
export function stepsOverHistory(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i - 1] > 0) out.push(Math.abs(values[i] / values[i - 1] - 1));
  }
  return out;
}

export interface DerivedThreshold {
  /** The rise, as a fraction of the baseline, that produces the budget. */
  riseThreshold: number;
  /** The series' own p99 single-step move. A move above it is refused, named. */
  stepGuard: number;
  /** How many `m` values the quantile was read off. */
  nObs: number;
  /** The budget this was derived for, restated so the sentence can quote it. */
  firesPerYear: number;
}

/**
 * Read the threshold out of the series' own history at the budget's quantile.
 *
 * Returns null — meaning THE RULE CANNOT FIRE FOR THIS SERIES — when the
 * history is shorter than `THRESHOLD_HISTORY_FLOOR`. That is a real answer and
 * the screen states it; it is never a zero and never a default.
 */
export function deriveThreshold(
  values: number[],
  opts: {
    firesPerYear: number;
    observationsPerYear: number;
    k?: number;
    historyFloor?: number;
  },
): DerivedThreshold | null {
  const k = opts.k ?? DEFAULT_BASELINE_K;
  const floor = opts.historyFloor ?? THRESHOLD_HISTORY_FLOOR;
  if (values.length < floor) return null;
  if (!(opts.firesPerYear > 0) || !(opts.observationsPerYear > 0)) return null;

  const moves = movesOverHistory(values, k);
  if (moves.length === 0) return null;

  // The share of observations that should fire. A budget looser than "every
  // observation" is clamped rather than producing a negative quantile.
  const rate = Math.min(opts.firesPerYear / opts.observationsPerYear, 1);
  const rise = quantile(moves, 1 - rate);
  const steps = stepsOverHistory(values);
  // Nearest rank, not interpolation. See `quantileCeilingRank`: a guard that
  // lands between two real observations refuses a move the market made.
  const guard = quantileCeilingRank(steps, 0.99);
  if (rise === null || guard === null) return null;
  // A series so flat that its budget quantile is at or below zero would fire on
  // every observation that is not a fall. That is not a threshold.
  if (!(rise > 0) || !(guard > 0)) return null;

  return {
    riseThreshold: rise,
    stepGuard: guard,
    nObs: moves.length,
    firesPerYear: opts.firesPerYear,
  };
}

export type CommodityVerdict =
  | "would_notify"
  | "no_threshold"
  | "too_short_a_history"
  | "implausible_step"
  | "below_floor"
  | "may_not_be_published"
  | "stale"
  | "no_exposure_mapped"
  | "already_said";

export interface CommoditySignalInput {
  /** Ascending by period. The series' admitted observations. */
  values: number[];
  /** The stored, derived threshold. null means the rule cannot fire. */
  riseThreshold: number | null;
  stepGuard: number | null;
  /** From the series row. `prohibited` may never reach a screen. */
  redistribution: string;
  /** Whether the staleness gate admitted the newest observation. */
  fresh: boolean;
  /** The reason it did not, when it did not. Never invented here. */
  staleReason?: string | null;
  /** How many LIVE exposures join this house's items to this series. */
  liveExposures: number;
  /** Days since this (series, item) was last said, or null if never. */
  daysSinceLastSaid: number | null;
  quietWindowDays?: number;
  k?: number;
}

export interface CommoditySignalDecision {
  verdict: CommodityVerdict;
  /** Plain words. Every "no" carries one. */
  reason: string;
  /** The move against the baseline, when it could be computed. */
  move: number | null;
  baseline: number | null;
  latest: number | null;
  step: number | null;
  /**
   * The plan's conditions this evaluation COULD NOT reach, named. A decision
   * with a non-empty list may never become a person's notification: it is a
   * dark run and nothing more. Today it always contains the two storability
   * conditions, because this repository has no shelf-life column at all.
   */
  unevaluated: string[];
}

/**
 * The conditions that CANNOT be evaluated on this tree today, named once so
 * every caller reports the same list.
 *
 *   coverage      the house's days of inventory for the mapped item. The
 *                 ledger holds stock, but "days of it" needs a consumption
 *                 rate per item that this rule has no read for yet.
 *   storability   how long the item keeps. Measured: zero shelf-life columns
 *                 across every migration in this repository.
 */
export const UNEVALUATED_CONDITIONS = [
  "coverage: the house's days of inventory for this item is not read here",
  "storability: this repository records no shelf life for any item, so whether the house could hold what it bought is unknown",
];

/**
 * The nine conditions, in the plan's order, with every "no" carrying a reason.
 *
 * A producer that emitted nothing and said nothing is indistinguishable from
 * one that never ran — `market-signal.ts`'s own rule, and the fault this
 * repository has fifteen measured instances of.
 */
export function decideCommoditySignal(
  input: CommoditySignalInput,
): CommoditySignalDecision {
  const k = input.k ?? DEFAULT_BASELINE_K;
  const quiet = input.quietWindowDays ?? DEFAULT_QUIET_WINDOW_DAYS;
  const m = moveAgainstBaseline(input.values, k);
  const step = stepAtLatest(input.values);
  const shape = {
    move: m?.move ?? null,
    baseline: m?.baseline ?? null,
    latest: m?.latest ?? null,
    step,
    unevaluated: [...UNEVALUATED_CONDITIONS],
  };

  if (input.riseThreshold === null) {
    return {
      ...shape,
      verdict: "no_threshold",
      reason: `This series has no threshold derived from its own history, so the rule cannot fire for it at all. That is stated rather than left as a silence: fewer than ${THRESHOLD_HISTORY_FLOOR} admitted observations is not enough to read a rate off.`,
    };
  }
  if (m === null) {
    return {
      ...shape,
      verdict: "too_short_a_history",
      reason: `Fewer than ${k + 2} admitted observations, so there is no baseline to measure a rise against. The baseline is ${k} OBSERVATIONS, never a number of days.`,
    };
  }
  if (input.stepGuard !== null && step !== null && step > input.stepGuard) {
    return {
      ...shape,
      verdict: "implausible_step",
      reason: `The newest observation moved ${(step * 100).toFixed(1)}% in one period, past this series' own 99th-percentile step of ${(input.stepGuard * 100).toFixed(1)}%. Refused and named rather than dropped — a rebasing and a bad parse both look like this, and so does a real shock, which is why the number is the series' own and not a global ceiling.`,
    };
  }
  if (m.move < input.riseThreshold) {
    return {
      ...shape,
      verdict: "below_floor",
      reason: `The newest observation is ${(m.move * 100).toFixed(1)}% above its ${k}-observation median, short of the ${(input.riseThreshold * 100).toFixed(1)}% this house's chosen frequency produces for this series.`,
    };
  }
  if (input.redistribution === "prohibited") {
    return {
      ...shape,
      verdict: "may_not_be_published",
      reason:
        "This series' publisher forbids third-party publication, and an alert is publication. It may be held and read; it may not be said.",
    };
  }
  if (!input.fresh) {
    return {
      ...shape,
      verdict: "stale",
      reason:
        input.staleReason ??
        "The newest observation is past this series' cadence bound, so the move is history rather than news.",
    };
  }
  if (input.liveExposures < 1) {
    return {
      ...shape,
      verdict: "no_exposure_mapped",
      reason:
        "No live exposure joins this house's items to this series. Nothing infers one: a mapping is a person's assertion, and the category leader's own product infers item-level exposures and publishes no accuracy figure of any kind.",
    };
  }
  if (input.daysSinceLastSaid !== null && input.daysSinceLastSaid < quiet) {
    return {
      ...shape,
      verdict: "already_said",
      reason: `This series was already raised about this house ${input.daysSinceLastSaid} days ago, inside the ${quiet}-day quiet window. A price sitting above its median all month is one signal, not thirty.`,
    };
  }

  return {
    ...shape,
    verdict: "would_notify",
    reason: `${(m.move * 100).toFixed(1)}% above the ${k}-observation median of ${m.baseline.toFixed(2)}, at ${m.latest.toFixed(2)}, past the ${(input.riseThreshold * 100).toFixed(1)}% this house's chosen frequency produces for this series.`,
  };
}
