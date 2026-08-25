/**
 * WineOps Analytics Engine — Forecasting & Time-Series primitives
 * ===============================================================
 *
 * Lightweight, dependency-free forecasters. These are intentionally the
 * classical, explainable models (exponential smoothing family) — not a black
 * box. A manager can trust "this is a trend + weekly-seasonality projection"
 * far more than an opaque ML score, and these run in-process with no Python.
 *
 * Covers:
 *   • Simple exponential smoothing (SES)      — level only
 *   • Holt's linear method                    — level + trend
 *   • Holt-Winters (additive)                 — level + trend + seasonality
 *   • Classical additive decomposition        — trend / seasonal / residual
 *   • Seasonal-naive baseline                 — the honest benchmark
 *   • Forecast error metrics                  — MAE, RMSE, MAPE, MASE
 *
 * For heavier ARIMA/Prophet/LightGBM ensembles the orchestrator bridges to
 * Python; these cover the tier-2 "good enough and instant" cases.
 */

import { mean } from "./statistics";

// ---------------------------------------------------------------------------
// Simple exponential smoothing (level only)
// ---------------------------------------------------------------------------

/**
 * SES: forecast = α·actual + (1-α)·prevForecast. Good for level series with
 * no trend/seasonality. Returns the fitted series and an h-step-ahead flat
 * forecast (SES has no trend, so all future points equal the last level).
 */
export function simpleExponentialSmoothing(
  series: number[],
  alpha: number,
  horizon = 1,
): { fitted: number[]; forecast: number[] } | null {
  if (series.length === 0 || alpha <= 0 || alpha > 1) return null;
  const fitted: number[] = [series[0]];
  for (let i = 1; i < series.length; i++) {
    fitted.push(alpha * series[i - 1] + (1 - alpha) * fitted[i - 1]);
  }
  const level =
    alpha * series[series.length - 1] + (1 - alpha) * fitted[fitted.length - 1];
  return { fitted, forecast: new Array(horizon).fill(level) };
}

// ---------------------------------------------------------------------------
// Holt's linear (level + trend)
// ---------------------------------------------------------------------------

/**
 * Holt's linear trend method.
 *   level_t = α·y_t + (1-α)·(level_{t-1} + trend_{t-1})
 *   trend_t = β·(level_t - level_{t-1}) + (1-β)·trend_{t-1}
 *   forecast_{t+h} = level_t + h·trend_t
 */
export function holtLinear(
  series: number[],
  alpha: number,
  beta: number,
  horizon = 1,
): {
  fitted: number[];
  forecast: number[];
  level: number;
  trend: number;
} | null {
  if (series.length < 2 || alpha <= 0 || alpha > 1 || beta < 0 || beta > 1)
    return null;
  let level = series[0];
  let trend = series[1] - series[0];
  const fitted: number[] = [series[0]];
  for (let i = 1; i < series.length; i++) {
    const prevLevel = level;
    level = alpha * series[i] + (1 - alpha) * (prevLevel + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    fitted.push(prevLevel + trend);
  }
  const forecast: number[] = [];
  for (let h = 1; h <= horizon; h++) forecast.push(level + h * trend);
  return { fitted, forecast, level, trend };
}

// ---------------------------------------------------------------------------
// Holt-Winters additive (level + trend + seasonality)
// ---------------------------------------------------------------------------

/**
 * Additive Holt-Winters with a fixed seasonal period (e.g. 7 for weekly
 * seasonality on daily data). Seeds seasonal factors from the first full
 * cycle. Additive is the right choice when seasonal swings are roughly
 * constant in magnitude (a Friday adds ~N covers regardless of level).
 */
export function holtWintersAdditive(
  series: number[],
  period: number,
  params: { alpha: number; beta: number; gamma: number },
  horizon = period,
): {
  fitted: number[];
  forecast: number[];
  level: number;
  trend: number;
  seasonals: number[];
} | null {
  const { alpha, beta, gamma } = params;
  if (
    period < 2 ||
    series.length < 2 * period ||
    [alpha, beta, gamma].some((p) => p < 0 || p > 1)
  )
    return null;

  // Seed level = mean of first season; trend = avg diff between first two
  // seasons; seasonals = deviation of first season from its mean.
  const firstSeason = series.slice(0, period);
  const secondSeason = series.slice(period, 2 * period);
  let level = mean(firstSeason) as number;
  const meanSecond = mean(secondSeason) as number;
  let trend = (meanSecond - level) / period;
  const seasonals = firstSeason.map((v) => v - level);

  const fitted: number[] = [];
  for (let i = 0; i < series.length; i++) {
    const s = seasonals[i % period];
    if (i === 0) {
      fitted.push(level + trend + s);
      continue;
    }
    const prevLevel = level;
    const seasonalIdx = i % period;
    level =
      alpha * (series[i] - seasonals[seasonalIdx]) +
      (1 - alpha) * (prevLevel + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    seasonals[seasonalIdx] =
      gamma * (series[i] - level) + (1 - gamma) * seasonals[seasonalIdx];
    fitted.push(level + trend + seasonals[seasonalIdx]);
  }

  const forecast: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const s = seasonals[(series.length + h - 1) % period];
    forecast.push(level + h * trend + s);
  }
  return { fitted, forecast, level, trend, seasonals };
}

// ---------------------------------------------------------------------------
// Seasonal-naive baseline
// ---------------------------------------------------------------------------

/**
 * Seasonal-naive forecast: ŷ_{t+h} = y_{t+h-period}. The honest benchmark any
 * fancier model must beat (used as the denominator of MASE).
 */
export function seasonalNaive(
  series: number[],
  period: number,
  horizon = period,
): number[] | null {
  if (series.length < period) return null;
  const out: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    out.push(series[series.length - period + ((h - 1) % period)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Classical additive decomposition (trend via centered MA)
// ---------------------------------------------------------------------------

/**
 * Classical additive decomposition: Y = Trend + Seasonal + Residual.
 * Trend by a centered moving average of length `period`; seasonal by averaging
 * detrended values per seasonal index (re-centered to sum ~0); residual is the
 * remainder. Trend/residual are null at the un-computable edges.
 */
export function seasonalDecompose(
  series: number[],
  period: number,
): {
  trend: Array<number | null>;
  seasonal: number[];
  residual: Array<number | null>;
} | null {
  if (period < 2 || series.length < 2 * period) return null;
  const n = series.length;
  const half = Math.floor(period / 2);

  // Centered moving average (handle even periods with the 2×MA trick).
  const trend: Array<number | null> = new Array(n).fill(null);
  for (let i = half; i < n - half; i++) {
    let acc = 0;
    if (period % 2 === 0) {
      for (let k = -half; k <= half; k++) {
        const weight = k === -half || k === half ? 0.5 : 1;
        acc += weight * series[i + k];
      }
      trend[i] = acc / period;
    } else {
      for (let k = -half; k <= half; k++) acc += series[i + k];
      trend[i] = acc / period;
    }
  }

  // Seasonal component: average detrended value per seasonal index.
  const buckets: number[][] = Array.from({ length: period }, () => []);
  for (let i = 0; i < n; i++) {
    if (trend[i] !== null)
      buckets[i % period].push(series[i] - (trend[i] as number));
  }
  const rawSeasonal = buckets.map((b) => (b.length ? (mean(b) as number) : 0));
  const seasonalMean = mean(rawSeasonal) as number;
  const seasonalFactors = rawSeasonal.map((s) => s - seasonalMean); // sum ~0
  const seasonal = series.map((_, i) => seasonalFactors[i % period]);

  const residual: Array<number | null> = series.map((y, i) =>
    trend[i] === null ? null : y - (trend[i] as number) - seasonal[i],
  );

  return { trend, seasonal, residual };
}

// ---------------------------------------------------------------------------
// Forecast error metrics
// ---------------------------------------------------------------------------

export function mae(actual: number[], predicted: number[]): number | null {
  const n = Math.min(actual.length, predicted.length);
  if (n === 0) return null;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(actual[i] - predicted[i]);
  return s / n;
}

export function rmse(actual: number[], predicted: number[]): number | null {
  const n = Math.min(actual.length, predicted.length);
  if (n === 0) return null;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const e = actual[i] - predicted[i];
    s += e * e;
  }
  return Math.sqrt(s / n);
}

/** Mean absolute percentage error (%). Skips points where actual is 0. */
export function mape(actual: number[], predicted: number[]): number | null {
  const n = Math.min(actual.length, predicted.length);
  let s = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (actual[i] === 0) continue;
    s += Math.abs((actual[i] - predicted[i]) / actual[i]);
    count++;
  }
  return count === 0 ? null : (s / count) * 100;
}

/**
 * Mean Absolute Scaled Error — MAE of the forecast scaled by the MAE of the
 * in-sample seasonal-naive forecast. MASE < 1 means you beat the naive
 * benchmark; the scale-free metric to compare across SKUs.
 */
export function mase(
  actual: number[],
  predicted: number[],
  trainingSeries: number[],
  period = 1,
): number | null {
  const forecastMae = mae(actual, predicted);
  if (forecastMae === null) return null;
  let naiveErr = 0;
  let count = 0;
  for (let i = period; i < trainingSeries.length; i++) {
    naiveErr += Math.abs(trainingSeries[i] - trainingSeries[i - period]);
    count++;
  }
  if (count === 0 || naiveErr === 0) return null;
  return forecastMae / (naiveErr / count);
}
