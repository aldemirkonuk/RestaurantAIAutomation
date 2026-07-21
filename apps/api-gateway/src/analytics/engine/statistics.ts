/**
 * WineOps Analytics Engine — Statistics primitives
 * =================================================
 *
 * Pure, dependency-free statistical functions. Every function is total:
 * empty / degenerate inputs return `null` (or a safe neutral) rather than
 * throwing, so callers can compose them over sparse restaurant data without
 * defensive plumbing at every call site.
 *
 * These are the building blocks the higher-level metric services compose:
 * anomaly detection (z-score, MAD, CUSUM), demand variability (CV, stdev),
 * relationships (Pearson / Spearman / OLS), and distribution shape
 * (skewness, kurtosis) that flag when a "normal distribution" assumption in a
 * safety-stock or VaR calc is unsafe.
 *
 * Statistician's note: population vs sample variance matters. We expose both.
 * The default `stdev`/`variance` use the SAMPLE estimator (Bessel's n-1
 * correction) because restaurant series are samples of an underlying process.
 */

/** Clean a numeric array: drop null/undefined/NaN/Infinity. */
export function clean(xs: Array<number | null | undefined>): number[] {
  const out: number[] = [];
  for (const x of xs) {
    if (x === null || x === undefined) continue;
    const n = Number(x);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return sum(xs) / xs.length;
}

/** Weighted mean. Returns null if weights sum to 0. */
export function weightedMean(xs: number[], weights: number[]): number | null {
  if (xs.length === 0 || xs.length !== weights.length) return null;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += xs[i] * weights[i];
    den += weights[i];
  }
  return den === 0 ? null : num / den;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Linear-interpolated percentile (type-7, the Excel/NumPy default).
 * @param p percentile in [0, 100]
 */
export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const s = [...xs].sort((a, b) => a - b);
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return s[lo];
  return s[lo] + (rank - lo) * (s[hi] - s[lo]);
}

export function quantile(xs: number[], q: number): number | null {
  return percentile(xs, q * 100);
}

/** Interquartile range (Q3 - Q1). */
export function iqr(xs: number[]): number | null {
  const q1 = percentile(xs, 25);
  const q3 = percentile(xs, 75);
  if (q1 === null || q3 === null) return null;
  return q3 - q1;
}

/**
 * Variance.
 * @param sample true (default) → Bessel-corrected sample variance (÷ n-1);
 *               false → population variance (÷ n).
 */
export function variance(xs: number[], sample = true): number | null {
  const n = xs.length;
  if (n === 0) return null;
  if (sample && n < 2) return null;
  const m = mean(xs) as number;
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return ss / (sample ? n - 1 : n);
}

export function stdev(xs: number[], sample = true): number | null {
  const v = variance(xs, sample);
  return v === null ? null : Math.sqrt(v);
}

/**
 * Coefficient of variation = stdev / mean. Unit-free relative dispersion —
 * the "XYZ classification" workhorse for demand variability. Returns null when
 * mean is ~0 (CV undefined).
 */
export function coefficientOfVariation(
  xs: number[],
  sample = true,
): number | null {
  const m = mean(xs);
  const sd = stdev(xs, sample);
  if (m === null || sd === null || Math.abs(m) < 1e-12) return null;
  return sd / Math.abs(m);
}

/** Standard error of the mean = stdev / sqrt(n). */
export function standardError(xs: number[]): number | null {
  const sd = stdev(xs, true);
  if (sd === null) return null;
  return sd / Math.sqrt(xs.length);
}

/** Population z-score of a single value against a series. */
export function zScore(
  value: number,
  xs: number[],
  sample = false,
): number | null {
  const m = mean(xs);
  const sd = stdev(xs, sample);
  if (m === null || sd === null || sd === 0) return null;
  return (value - m) / sd;
}

/** Median absolute deviation (robust dispersion). Scaled to be a consistent
 * estimator of stdev under normality via the 1.4826 factor. */
export function medianAbsoluteDeviation(
  xs: number[],
  scaled = true,
): number | null {
  const med = median(xs);
  if (med === null) return null;
  const devs = xs.map((x) => Math.abs(x - med));
  const mad = median(devs);
  if (mad === null) return null;
  return scaled ? mad * 1.4826 : mad;
}

/**
 * Robust z-score using median & MAD. Far less sensitive to the single
 * blowout day than the classic z-score — the right tool for restaurant
 * anomaly detection where outliers ARE the signal.
 */
export function robustZScore(value: number, xs: number[]): number | null {
  const med = median(xs);
  const mad = medianAbsoluteDeviation(xs, true);
  if (med === null || mad === null || mad === 0) return null;
  return (value - med) / mad;
}

export function covariance(
  xs: number[],
  ys: number[],
  sample = true,
): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n === 0 || (sample && n < 2)) return null;
  const mx = mean(xs.slice(0, n)) as number;
  const my = mean(ys.slice(0, n)) as number;
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - mx) * (ys[i] - my);
  return s / (sample ? n - 1 : n);
}

/** Pearson product-moment correlation coefficient, r ∈ [-1, 1]. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const cov = covariance(xs.slice(0, n), ys.slice(0, n), true);
  const sx = stdev(xs.slice(0, n), true);
  const sy = stdev(ys.slice(0, n), true);
  if (cov === null || sx === null || sy === null || sx === 0 || sy === 0)
    return null;
  return Math.max(-1, Math.min(1, cov / (sx * sy)));
}

/** Fractional ranks (average ties) — helper for Spearman. */
function rankAverage(xs: number[]): number[] {
  const indexed = xs.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(xs.length).fill(0);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1; // ranks are 1-based
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

/** Spearman rank correlation — monotonic (non-linear-robust) association. */
export function spearman(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  return pearson(rankAverage(xs.slice(0, n)), rankAverage(ys.slice(0, n)));
}

export interface LinearRegressionResult {
  slope: number;
  intercept: number;
  /** Coefficient of determination R². */
  r2: number;
  /** Pearson r. */
  r: number;
  /** Predict y for a given x. */
  predict: (x: number) => number;
  n: number;
}

/**
 * Ordinary least squares simple linear regression y = slope·x + intercept.
 * The backbone of trend estimation, price-elasticity fits, and anchoring
 * (first-quote → final-price) regressions.
 */
export function linearRegression(
  xs: number[],
  ys: number[],
): LinearRegressionResult | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const X = xs.slice(0, n);
  const Y = ys.slice(0, n);
  const mx = mean(X) as number;
  const my = mean(Y) as number;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = X[i] - mx;
    const dy = Y[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  const r = Math.sign(slope) * Math.sqrt(Math.max(0, Math.min(1, r2)));
  return {
    slope,
    intercept,
    r2: Math.max(0, Math.min(1, r2)),
    r,
    n,
    predict: (x: number) => slope * x + intercept,
  };
}

/**
 * Compound annual growth rate implied by a linear fit is wrong; for trend of
 * an evenly-spaced series use the OLS slope as "units per period". This helper
 * returns slope as a % of the mean level — an interpretable "growth per
 * period" figure for dashboards.
 */
export function trendPerPeriodPct(ys: number[]): number | null {
  if (ys.length < 2) return null;
  const xs = ys.map((_, i) => i);
  const reg = linearRegression(xs, ys);
  const m = mean(ys);
  if (!reg || m === null || Math.abs(m) < 1e-12) return null;
  return reg.slope / Math.abs(m);
}

/** Simple (trailing) moving average series. Window w. */
export function movingAverage(xs: number[], w: number): number[] {
  if (w <= 1) return [...xs];
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const start = Math.max(0, i - w + 1);
    const window = xs.slice(start, i + 1);
    out.push((mean(window) as number) ?? xs[i]);
  }
  return out;
}

/**
 * Exponentially-weighted moving average. alpha ∈ (0,1], higher = more
 * responsive. Seeds with the first observation.
 */
export function ewma(xs: number[], alpha: number): number[] {
  if (xs.length === 0) return [];
  const a = Math.max(0, Math.min(1, alpha));
  const out = [xs[0]];
  for (let i = 1; i < xs.length; i++) {
    out.push(a * xs[i] + (1 - a) * out[i - 1]);
  }
  return out;
}

export function skewness(xs: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const m = mean(xs) as number;
  const sd = stdev(xs, true);
  if (sd === null || sd === 0) return null;
  let s = 0;
  for (const x of xs) s += ((x - m) / sd) ** 3;
  // Adjusted Fisher-Pearson standardized moment coefficient (Excel SKEW).
  return (n / ((n - 1) * (n - 2))) * s;
}

/** Excess kurtosis (0 for a normal distribution). Excel KURT convention. */
export function kurtosis(xs: number[]): number | null {
  const n = xs.length;
  if (n < 4) return null;
  const m = mean(xs) as number;
  const sd = stdev(xs, true);
  if (sd === null || sd === 0) return null;
  let s = 0;
  for (const x of xs) s += ((x - m) / sd) ** 4;
  const a = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
  const b = (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
  return a * s - b;
}

/**
 * Abramowitz & Stegun 7.1.26 approximation of the standard normal CDF Φ(z).
 * Max abs error ~7.5e-8 — plenty for service-level / VaR use.
 */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const p =
    d *
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

export function normalPdf(z: number): number {
  return 0.3989422804014327 * Math.exp(-(z * z) / 2);
}

/**
 * Inverse standard normal CDF (probit) via Acklam's rational approximation.
 * Given a cumulative probability p ∈ (0,1) returns the z that solves Φ(z)=p.
 * This is how a target service level (e.g. 95%) becomes a safety-stock
 * z-multiplier.
 */
export function normalInv(p: number): number | null {
  if (p <= 0 || p >= 1) return null;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
}

/** z-multiplier for a target service level (cycle service level → z). */
export function serviceLevelZ(serviceLevel: number): number | null {
  return normalInv(serviceLevel);
}

/**
 * Two-sided normal-approximation confidence interval for a mean.
 * Good enough for n ≳ 30; for tiny samples treat as indicative.
 */
export function confidenceIntervalMean(
  xs: number[],
  confidence = 0.95,
): { lower: number; upper: number; mean: number; margin: number } | null {
  const m = mean(xs);
  const se = standardError(xs);
  if (m === null || se === null) return null;
  const z = normalInv(1 - (1 - confidence) / 2);
  if (z === null) return null;
  const margin = z * se;
  return { lower: m - margin, upper: m + margin, mean: m, margin };
}

/**
 * CUSUM (cumulative sum) structural-break / drift detector.
 * Tabular one-sided CUSUM on both directions. Returns per-point high/low
 * accumulators and the first index where either exceeds the decision
 * threshold h (in standard-deviation units). `k` is the slack (allowance),
 * conventionally 0.5σ to detect a 1σ shift.
 */
export function cusum(
  xs: number[],
  opts: { k?: number; h?: number; target?: number } = {},
): {
  high: number[];
  low: number[];
  alarmIndex: number | null;
  target: number;
} {
  const target = opts.target ?? (mean(xs) as number) ?? 0;
  const sd = stdev(xs, true) ?? 1;
  const k = (opts.k ?? 0.5) * sd;
  const h = (opts.h ?? 5) * sd;
  const high: number[] = [];
  const low: number[] = [];
  let sh = 0;
  let sl = 0;
  let alarmIndex: number | null = null;
  for (let i = 0; i < xs.length; i++) {
    sh = Math.max(0, sh + (xs[i] - target) - k);
    sl = Math.min(0, sl + (xs[i] - target) + k);
    high.push(sh);
    low.push(sl);
    if (alarmIndex === null && (sh > h || sl < -h)) alarmIndex = i;
  }
  return { high, low, alarmIndex, target };
}

/** Shannon entropy (in bits) of a discrete distribution given raw weights. */
export function shannonEntropy(weights: number[]): number | null {
  const total = sum(weights.filter((w) => w > 0));
  if (total <= 0) return null;
  let h = 0;
  for (const w of weights) {
    if (w <= 0) continue;
    const p = w / total;
    h -= p * Math.log2(p);
  }
  return h;
}
