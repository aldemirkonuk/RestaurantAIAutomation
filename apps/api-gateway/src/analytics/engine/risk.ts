/**
 * WineOps Analytics Engine — Risk & Portfolio primitives
 * ======================================================
 *
 * The trader / PE risk desk, repurposed. A wine list IS a portfolio of
 * capital-consuming positions with uncertain "returns" (margin velocity), and
 * a vendor base is a concentration-risk book. These functions quantify that.
 *
 * Covers:
 *   • Dispersion of returns   — volatility, downside deviation
 *   • Tail risk               — historical & parametric VaR, CVaR (expected
 *                               shortfall)
 *   • Risk-adjusted return    — Sharpe, Sortino
 *   • Drawdown                — max drawdown & duration
 *   • Portfolio               — 2-asset & N-asset variance (Markowitz),
 *                               minimum-variance weights (2-asset)
 *   • Inequality              — Gini coefficient (revenue concentration)
 *
 * Return convention: `returns` are per-period simple returns as decimals.
 * VaR/CVaR are reported as POSITIVE loss magnitudes (a 0.05 VaR = "expect to
 * lose ≥5% at that confidence").
 */

import { mean, stdev, percentile, normalInv } from "./statistics";

// ---------------------------------------------------------------------------
// Dispersion
// ---------------------------------------------------------------------------

/** Volatility = stdev of returns, optionally annualized by sqrt(periods). */
export function volatility(
  returns: number[],
  periodsPerYear?: number,
): number | null {
  const sd = stdev(returns, true);
  if (sd === null) return null;
  return periodsPerYear ? sd * Math.sqrt(periodsPerYear) : sd;
}

/**
 * Downside deviation — stdev of returns below a threshold (MAR, default 0).
 * The denominator of the Sortino ratio; penalizes only bad volatility.
 */
export function downsideDeviation(returns: number[], mar = 0): number | null {
  if (returns.length === 0) return null;
  let ss = 0;
  for (const r of returns) {
    const d = Math.min(0, r - mar);
    ss += d * d;
  }
  return Math.sqrt(ss / returns.length);
}

// ---------------------------------------------------------------------------
// Tail risk
// ---------------------------------------------------------------------------

/**
 * Historical Value at Risk at a confidence level (e.g. 0.95). Non-parametric:
 * the (1-conf) empirical quantile of the loss distribution. Returned as a
 * positive loss magnitude.
 */
export function historicalVar(
  returns: number[],
  confidence = 0.95,
): number | null {
  if (returns.length === 0) return null;
  const q = percentile(returns, (1 - confidence) * 100);
  if (q === null) return null;
  return Math.max(0, -q);
}

/**
 * Parametric (variance-covariance / Gaussian) VaR. Assumes returns ~ Normal.
 * VaR = -(μ + z·σ) where z = Φ⁻¹(1-conf). Positive loss magnitude.
 */
export function parametricVar(
  returns: number[],
  confidence = 0.95,
): number | null {
  const mu = mean(returns);
  const sd = stdev(returns, true);
  if (mu === null || sd === null) return null;
  const z = normalInv(1 - confidence);
  if (z === null) return null;
  return Math.max(0, -(mu + z * sd));
}

/**
 * Conditional VaR / Expected Shortfall — average loss GIVEN the loss exceeds
 * the historical VaR threshold. Answers "when it goes bad, how bad?" — the
 * coherent tail-risk measure VaR isn't. Positive loss magnitude.
 */
export function conditionalVar(
  returns: number[],
  confidence = 0.95,
): number | null {
  if (returns.length === 0) return null;
  const threshold = percentile(returns, (1 - confidence) * 100);
  if (threshold === null) return null;
  const tail = returns.filter((r) => r <= threshold);
  if (tail.length === 0) return Math.max(0, -threshold);
  const avg = mean(tail);
  return avg === null ? null : Math.max(0, -avg);
}

// ---------------------------------------------------------------------------
// Risk-adjusted return
// ---------------------------------------------------------------------------

/**
 * Sharpe ratio = (mean excess return) / stdev. `riskFree` is per-period.
 * Optionally annualized by sqrt(periodsPerYear).
 */
export function sharpeRatio(
  returns: number[],
  riskFree = 0,
  periodsPerYear?: number,
): number | null {
  const mu = mean(returns);
  const sd = stdev(returns, true);
  if (mu === null || sd === null || sd === 0) return null;
  const sharpe = (mu - riskFree) / sd;
  return periodsPerYear ? sharpe * Math.sqrt(periodsPerYear) : sharpe;
}

/** Sortino ratio = (mean excess return) / downside deviation. */
export function sortinoRatio(
  returns: number[],
  mar = 0,
  periodsPerYear?: number,
): number | null {
  const mu = mean(returns);
  const dd = downsideDeviation(returns, mar);
  if (mu === null || dd === null || dd === 0) return null;
  const sortino = (mu - mar) / dd;
  return periodsPerYear ? sortino * Math.sqrt(periodsPerYear) : sortino;
}

// ---------------------------------------------------------------------------
// Drawdown
// ---------------------------------------------------------------------------

/**
 * Maximum drawdown of an equity/level series (not returns): the largest
 * peak-to-trough decline as a fraction. Also returns the trough index and the
 * peak it fell from. For a restaurant: worst cumulative-revenue slump.
 */
export function maxDrawdown(levels: number[]): {
  maxDrawdown: number;
  peakIndex: number;
  troughIndex: number;
} | null {
  if (levels.length === 0) return null;
  let peak = levels[0];
  let peakIdx = 0;
  let maxDd = 0;
  let mddPeakIdx = 0;
  let mddTroughIdx = 0;
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] > peak) {
      peak = levels[i];
      peakIdx = i;
    }
    const dd = peak === 0 ? 0 : (peak - levels[i]) / peak;
    if (dd > maxDd) {
      maxDd = dd;
      mddPeakIdx = peakIdx;
      mddTroughIdx = i;
    }
  }
  return {
    maxDrawdown: maxDd,
    peakIndex: mddPeakIdx,
    troughIndex: mddTroughIdx,
  };
}

// ---------------------------------------------------------------------------
// Portfolio (Markowitz)
// ---------------------------------------------------------------------------

/**
 * Two-asset portfolio variance:
 *   σ_p² = w₁²σ₁² + w₂²σ₂² + 2·w₁·w₂·ρ·σ₁·σ₂
 */
export function twoAssetPortfolioVariance(
  w1: number,
  sigma1: number,
  w2: number,
  sigma2: number,
  correlation: number,
): number {
  return (
    w1 * w1 * sigma1 * sigma1 +
    w2 * w2 * sigma2 * sigma2 +
    2 * w1 * w2 * correlation * sigma1 * sigma2
  );
}

/**
 * Minimum-variance weights for two assets (closed form). Returns weight on
 * asset 1 (w2 = 1 - w1). The intuition behind "diversify the wine list so one
 * category's collapse doesn't sink the program."
 */
export function minVarianceWeights2(
  sigma1: number,
  sigma2: number,
  correlation: number,
): { w1: number; w2: number } | null {
  const cov = correlation * sigma1 * sigma2;
  const denom = sigma1 * sigma1 + sigma2 * sigma2 - 2 * cov;
  if (denom === 0) return null;
  const w1 = (sigma2 * sigma2 - cov) / denom;
  return { w1, w2: 1 - w1 };
}

/**
 * N-asset portfolio variance from weights and a covariance matrix:
 *   σ_p² = wᵀ Σ w
 */
export function portfolioVariance(
  weights: number[],
  covMatrix: number[][],
): number | null {
  const n = weights.length;
  if (covMatrix.length !== n) return null;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (covMatrix[i].length !== n) return null;
    for (let j = 0; j < n; j++) {
      acc += weights[i] * weights[j] * covMatrix[i][j];
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Inequality / concentration
// ---------------------------------------------------------------------------

/**
 * Gini coefficient of a set of values (e.g. revenue per SKU). 0 = perfectly
 * even, →1 = one item captures everything. A revenue-concentration lens
 * complementary to HHI. Uses the mean-absolute-difference definition.
 */
export function giniCoefficient(values: number[]): number | null {
  const xs = values.filter((v) => v >= 0);
  const n = xs.length;
  if (n === 0) return null;
  const total = xs.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  let cumWeighted = 0;
  for (let i = 0; i < n; i++) {
    cumWeighted += (i + 1) * sorted[i];
  }
  // G = (2·Σ i·x_i)/(n·Σ x_i) - (n+1)/n
  return (2 * cumWeighted) / (n * total) - (n + 1) / n;
}
