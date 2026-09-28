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
 */

import { mean, stdev, median, zScore } from "./statistics";

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
