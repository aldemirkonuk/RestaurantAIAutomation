/**
 * WineOps Analytics Engine — Comparison & baseline framework
 * ==========================================================
 *
 * The primitives behind every "X was 12% lower than average Tuesdays"
 * sentence. Each comparator returns a structured result the insight
 * verbalizer can render deterministically.
 *
 *   • groupBaseline      — value vs its own group's history ("this Tuesday
 *                          vs average Tuesdays")
 *   • periodOverPeriod   — current window vs the immediately previous one
 *   • peerComparison     — an entity vs its peer group (table 4 vs all
 *                          tables, waiter A vs all waiters)
 *   • contributionToChange — which components drove a total's delta
 *   • dayOfWeekProfile   — per-weekday summary (best/worst days)
 *   • leaderTest         — whether a #1 can be told apart from the rest
 *                          (ADR 0272), before any "ranks #1" is printed
 *   • cutKeepingTies     — a top-N cut that never splits a tie group
 */

import { mean, stdev, median, zScore, normalCdf } from "./statistics";

export interface BaselineComparison {
  value: number;
  baselineMean: number;
  baselineStdev: number | null;
  baselineN: number;
  /** (value - baseline) / baseline. */
  deltaPct: number | null;
  /** z of the value against the baseline distribution. */
  z: number | null;
  direction: "above" | "below" | "in_line";
}

/**
 * Compare a value against the history of its own group (same weekday, same
 * month, same daypart...). `history` should EXCLUDE the value being compared.
 * `inLineBand` = ± fraction inside which we call it "in line" (default 5%).
 */
export function groupBaseline(
  value: number,
  history: number[],
  inLineBand = 0.05,
): BaselineComparison | null {
  const m = mean(history);
  if (m === null) return null;
  const sd = stdev(history, true);
  const deltaPct = m !== 0 ? (value - m) / Math.abs(m) : null;
  const z = zScore(value, history, true);
  let direction: BaselineComparison["direction"] = "in_line";
  if (deltaPct !== null && deltaPct > inLineBand) direction = "above";
  else if (deltaPct !== null && deltaPct < -inLineBand) direction = "below";
  return {
    value,
    baselineMean: m,
    baselineStdev: sd,
    baselineN: history.length,
    deltaPct,
    z,
    direction,
  };
}

export interface PeriodComparison {
  current: number;
  previous: number;
  deltaPct: number | null;
  direction: "up" | "down" | "flat";
}

/**
 * Sum the last `window` points vs the `window` before it.
 * series is chronological (oldest → newest).
 */
export function periodOverPeriod(
  series: number[],
  window: number,
  flatBand = 0.02,
): PeriodComparison | null {
  if (window <= 0 || series.length < 2 * window) return null;
  const current = series.slice(-window).reduce((a, b) => a + b, 0);
  const previous = series
    .slice(-2 * window, -window)
    .reduce((a, b) => a + b, 0);
  const deltaPct =
    previous !== 0 ? (current - previous) / Math.abs(previous) : null;
  let direction: PeriodComparison["direction"] = "flat";
  if (deltaPct !== null && deltaPct > flatBand) direction = "up";
  else if (deltaPct !== null && deltaPct < -flatBand) direction = "down";
  return { current, previous, deltaPct, direction };
}

export interface PeerStanding<T> {
  entity: T;
  value: number;
  rank: number;
  /** 0–1, fraction of peers strictly below. */
  percentile: number;
  pctVsMean: number | null;
  z: number | null;
}

/**
 * Rank entities against their peer group on one measure.
 * Returns standings sorted best→worst (descending value).
 */
export function peerComparison<T>(
  entities: Array<{ entity: T; value: number }>,
): PeerStanding<T>[] {
  const values = entities.map((e) => e.value);
  const m = mean(values);
  const sorted = [...entities].sort((a, b) => b.value - a.value);
  return sorted.map((e, i) => {
    const below = values.filter((v) => v < e.value).length;
    return {
      entity: e.entity,
      value: e.value,
      rank: i + 1,
      percentile: values.length > 1 ? below / (values.length - 1) : 1,
      pctVsMean: m !== null && m !== 0 ? (e.value - m) / Math.abs(m) : null,
      z: zScore(e.value, values, true),
    };
  });
}

export interface ChangeContribution {
  key: string;
  previous: number;
  current: number;
  delta: number;
  /** Share of the total absolute change this component explains. */
  shareOfChange: number | null;
}

/**
 * Decompose the change in a total into per-component contributions:
 * "revenue fell $840 — $612 of that was the Barolo going off-list."
 */
export function contributionToChange(
  previous: Map<string, number>,
  current: Map<string, number>,
): { totalDelta: number; contributions: ChangeContribution[] } {
  const keys = new Set([...previous.keys(), ...current.keys()]);
  const contributions: ChangeContribution[] = [];
  let totalDelta = 0;
  for (const key of keys) {
    const prev = previous.get(key) || 0;
    const curr = current.get(key) || 0;
    const delta = curr - prev;
    totalDelta += delta;
    contributions.push({
      key,
      previous: prev,
      current: curr,
      delta,
      shareOfChange: null,
    });
  }
  const absTotal = contributions.reduce((s, c) => s + Math.abs(c.delta), 0);
  for (const c of contributions) {
    c.shareOfChange = absTotal > 0 ? Math.abs(c.delta) / absTotal : null;
  }
  contributions.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { totalDelta, contributions };
}

export interface WeekdayProfile {
  weekday: number; // 0=Sun … 6=Sat
  mean: number;
  median: number | null;
  stdev: number | null;
  n: number;
}

/**
 * Per-weekday summary of a dated series. `dates` are YYYY-MM-DD strings
 * (parsed as UTC). Returns profiles plus best/worst weekday by mean.
 */
export function dayOfWeekProfile(
  dates: string[],
  values: number[],
): {
  profiles: WeekdayProfile[];
  best: WeekdayProfile | null;
  worst: WeekdayProfile | null;
} {
  const buckets: number[][] = Array.from({ length: 7 }, () => []);
  const n = Math.min(dates.length, values.length);
  for (let i = 0; i < n; i++) {
    const d = new Date(`${dates[i]}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;
    buckets[d.getUTCDay()].push(values[i]);
  }
  const profiles: WeekdayProfile[] = buckets
    .map((b, weekday) => ({
      weekday,
      mean: (mean(b) as number) ?? 0,
      median: median(b),
      stdev: stdev(b, true),
      n: b.length,
    }))
    .filter((p) => p.n > 0);
  if (profiles.length === 0) return { profiles: [], best: null, worst: null };
  const best = profiles.reduce((a, b) => (b.mean > a.mean ? b : a));
  const worst = profiles.reduce((a, b) => (b.mean < a.mean ? b : a));
  return { profiles, best, worst };
}

/**
 * The separable extremes of a weekday profile.
 *
 * `dayOfWeekProfile` picks best/worst with `reduce((a, b) => b.mean > a.mean)`,
 * which resolves an exact tie to whichever weekday came first — Sunday. On a
 * restaurant with no movement all seven means are 0, so the endpoint reported
 * Sunday as both the busiest AND the quietest night: an arbitrary tie-break
 * dressed as a finding, and a manager could staff against it.
 *
 * A ranking that shares its extreme is not a ranking. This returns the extreme
 * only when exactly one weekday holds it — exact equality is the right test
 * because exact equality is precisely when the `reduce` above was choosing
 * arbitrarily — and reports `tie` so a caller can say why it printed nothing.
 * A profile with fewer than two observed weekdays cannot rank either: its one
 * day is both the best and the worst, which is a tautology, not a finding.
 */
export function separableExtremes(profiles: WeekdayProfile[]): {
  best: WeekdayProfile | null;
  worst: WeekdayProfile | null;
  tie: boolean;
} {
  if (profiles.length < 2)
    return { best: null, worst: null, tie: profiles.length === 1 };
  const means = profiles.map((p) => p.mean);
  const max = Math.max(...means);
  const min = Math.min(...means);
  const atMax = profiles.filter((p) => p.mean === max);
  const atMin = profiles.filter((p) => p.mean === min);
  const best = atMax.length === 1 ? atMax[0] : null;
  const worst = atMin.length === 1 ? atMin[0] : null;
  return { best, worst, tie: best === null || worst === null };
}

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// ---------------------------------------------------------------------------
// Rankings that can be told apart (ADR 0272)
// ---------------------------------------------------------------------------

/**
 * Two computed values are the same value — a tie.
 *
 * A tie is equality of the COMPUTED value, never of its printed rounding:
 * 26.8% and 26.9% both print "27%", and they are not tied. But "computed" has
 * to mean the arithmetic, not its last bit. On Tuzlu every SKU's demand was
 * dated to one import day, so five wines at 22.5 days of cover share one
 * stockout probability in exact arithmetic — and in floating point they came
 * back as 0.26844096449466426, …370 and …437, depending only on how many
 * bottles each sold. Strict equality would have called that group five
 * different risks and ranked them by rounding error. So: equal to within one
 * part in a billion of the larger magnitude (absolute below 1): six or more
 * orders finer than a risk printed to 0.1%, about seven above double rounding.
 */
export const TIE_TOLERANCE = 1e-9;

export function sameValue(
  a: number | null | undefined,
  b: number | null | undefined,
): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return (
    Math.abs(a - b) <= TIE_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b))
  );
}

/**
 * The first `n` rows of an already-sorted list, extended through every row
 * whose `key` ties row `n`'s. A cut that kept two of five rows tied at 27% —
 * chosen by the order the database happened to return them in — under "the
 * 25 at the highest risk are listed" printed a ranking the data did not make
 * (A-070). Trimming the tie group off instead would return nothing at all when
 * the top group is larger than the cut, so the cut grows instead.
 *
 * `extendOnlyAbove` bounds that growth. A tie at or below it is not a ranking
 * the cut could split — the restock cut passes 0, because a 0% stockout risk
 * is no risk at all: every wine with no demand in the window and nothing on
 * hand sits "below" a reorder point of 0 at exactly 0%, and extending through
 * that group listed the whole of it (5 wines with demand and 40 without gave
 * 45 rows; 11 and 400 gave 411). Above the floor the group is bounded by the
 * wines that share the edge's risk, each of which sold in the window.
 */
export function cutKeepingTies<R>(
  rows: R[],
  n: number,
  key: (row: R) => number | null | undefined,
  opts: { extendOnlyAbove?: number } = {},
): R[] {
  if (n <= 0) return [];
  if (rows.length <= n) return rows.slice();
  const edge = key(rows[n - 1]);
  const floor = opts.extendOnlyAbove;
  if (
    floor != null &&
    !(edge != null && edge > floor && !sameValue(edge, floor))
  )
    return rows.slice(0, n);
  let end = n;
  while (end < rows.length && sameValue(key(rows[end]), edge)) end++;
  return rows.slice(0, end);
}

const byCodeUnits = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * The one order of "at risk of running out" rows: highest stockout
 * probability first; within a tie, the fewest days of cover (unmeasured last),
 * then the fewest bottles, then the name and the id. The database's row order
 * never decides — it decided which two of Tuzlu's five tied wines were listed.
 */
export function byStockoutRisk(
  a: {
    stockoutProbability: number | null;
    daysOfCover: number | null;
    onHand: number;
    name: string;
    id: string;
  },
  b: {
    stockoutProbability: number | null;
    daysOfCover: number | null;
    onHand: number;
    name: string;
    id: string;
  },
): number {
  const pa = a.stockoutProbability;
  const pb = b.stockoutProbability;
  if (!sameValue(pa, pb)) return pa == null ? 1 : pb == null ? -1 : pb - pa;
  const ca = a.daysOfCover;
  const cb = b.daysOfCover;
  if (!sameValue(ca, cb)) return ca == null ? 1 : cb == null ? -1 : ca - cb;
  if (!sameValue(a.onHand, b.onHand)) return a.onHand - b.onHand;
  return byCodeUnits(a.name, b.name) || byCodeUnits(a.id, b.id);
}

/** One group's observations, summarised: count, mean, sample variance. */
export interface GroupMoments<T> {
  entity: T;
  n: number;
  mean: number;
  /** Sample (n − 1) variance of the group's observations. */
  variance: number;
}

/** Count, mean and sample variance from a running sum and sum of squares. */
export function momentsFromSums<T>(
  entity: T,
  n: number,
  sum: number,
  sumSq: number,
): GroupMoments<T> {
  const m = n > 0 ? sum / n : 0;
  const variance = n > 1 ? Math.max(0, (sumSq - n * m * m) / (n - 1)) : 0;
  return { entity, n, mean: m, variance };
}

export interface LeaderTestResult<T> {
  /** True only when the leader is apart from BOTH the runner-up and the rest. */
  separable: boolean;
  reason:
    | "separable"
    | "too_few_groups"
    | "tied_with_runner_up"
    | "not_apart_from_the_rest";
  /** Eligible groups (n ≥ minN), highest mean first, ties by entity. */
  ranked: GroupMoments<T>[];
  leader: T | null;
  runnerUp: T | null;
  /** One-sided Welch z and p of the leader against the runner-up. */
  zVsRunnerUp: number | null;
  pVsRunnerUp: number | null;
  /** One-sided Welch z and p of the leader against everyone else pooled. */
  zVsRest: number | null;
  pVsRest: number | null;
  /** `pVsRest` × the number of eligible groups (Bonferroni), capped at 1. */
  pVsRestAdjusted: number | null;
}

/** Upper-tail p of a z: P(Z ≥ z). Written so it never subtracts from 1. */
const upperTail = (z: number): number => normalCdf(-z);

function welchZ(
  m1: number,
  v1: number,
  n1: number,
  m2: number,
  v2: number,
  n2: number,
): number {
  const d = m1 - m2;
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  if (!(se > 0)) return d > 0 ? Number.POSITIVE_INFINITY : 0;
  return d / se;
}

/**
 * May the top group be printed as "#1"?
 *
 * `peerComparison` ranks k means and calls the largest #1 whatever the gap.
 * On Tuzlu, where servers were dealt uniformly, it named Lucas #1 of 5 on a
 * 1.0% lead (A-003) — and the largest of k noisy means is always ahead of
 * something. The leader is printable only when both hold, at `alpha`:
 *
 *  (i)  a one-sided Welch test of the leader against the RUNNER-UP rejects —
 *       the tie check: a #1 indistinguishable from #2 is not a #1;
 *  (ii) a one-sided Welch test of the leader against the POOLED REST rejects
 *       after multiplying its p by k (Bonferroni) — because the leader was
 *       chosen as the maximum of k, and under "nobody differs" the chance
 *       that SOME group clears an uncorrected test is near k × alpha.
 *
 * Groups under `minN` observations are not ranked at all (normal theory needs
 * the numbers, and a mean over a dozen checks is a coincidence). The pooled
 * rest is rebuilt from each group's n, mean and variance, so one group's
 * outliers — two $3,400 booth checks — inflate that group's variance and
 * shrink its z instead of crowning it.
 */
export function leaderTest<T>(
  groups: GroupMoments<T>[],
  opts: { alpha?: number; minN?: number; minGroups?: number } = {},
): LeaderTestResult<T> {
  const alpha = opts.alpha ?? 0.05;
  const minN = opts.minN ?? 30;
  const minGroups = Math.max(2, opts.minGroups ?? 2);
  const ranked = groups
    .filter((g) => g.n >= minN && Number.isFinite(g.mean))
    .sort(
      (a, b) =>
        b.mean - a.mean || byCodeUnits(String(a.entity), String(b.entity)),
    );
  const empty: LeaderTestResult<T> = {
    separable: false,
    reason: "too_few_groups",
    ranked,
    leader: ranked[0]?.entity ?? null,
    runnerUp: ranked[1]?.entity ?? null,
    zVsRunnerUp: null,
    pVsRunnerUp: null,
    zVsRest: null,
    pVsRest: null,
    pVsRestAdjusted: null,
  };
  if (ranked.length < minGroups) return empty;

  const [lead, second] = ranked;
  const zVsRunnerUp = welchZ(
    lead.mean,
    lead.variance,
    lead.n,
    second.mean,
    second.variance,
    second.n,
  );
  const pVsRunnerUp = upperTail(zVsRunnerUp);

  let restN = 0;
  let restSum = 0;
  let restSumSq = 0;
  for (const g of ranked.slice(1)) {
    restN += g.n;
    restSum += g.n * g.mean;
    restSumSq += (g.n - 1) * g.variance + g.n * g.mean * g.mean;
  }
  const rest = momentsFromSums(null, restN, restSum, restSumSq);
  const zVsRest = welchZ(
    lead.mean,
    lead.variance,
    lead.n,
    rest.mean,
    rest.variance,
    rest.n,
  );
  const pVsRest = upperTail(zVsRest);
  const pVsRestAdjusted = Math.min(1, ranked.length * pVsRest);

  const tied = !(pVsRunnerUp <= alpha);
  const apart = pVsRestAdjusted <= alpha;
  return {
    ...empty,
    separable: !tied && apart,
    reason: tied
      ? "tied_with_runner_up"
      : apart
        ? "separable"
        : "not_apart_from_the_rest",
    zVsRunnerUp,
    pVsRunnerUp,
    zVsRest,
    pVsRest,
    pVsRestAdjusted,
  };
}

/**
 * Is a Pearson r over n points distinguishable from no correlation?
 * Fisher's z = atanh(r)·√(n − 3), two-sided. `tests` is how many correlations
 * the caller looked at before picking this one (Bonferroni). Returns the z
 * the score uses and the adjusted p.
 */
export function correlationSignificance(
  r: number,
  n: number,
  tests = 1,
): { z: number; p: number; pAdjusted: number } | null {
  if (!Number.isFinite(r) || n < 4) return null;
  const rc = Math.max(-1 + 1e-12, Math.min(1 - 1e-12, r));
  const z = Math.atanh(rc) * Math.sqrt(n - 3);
  const p = Math.min(1, 2 * upperTail(Math.abs(z)));
  return { z, p, pAdjusted: Math.min(1, Math.max(1, tests) * p) };
}
