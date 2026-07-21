/**
 * WineOps Analytics Engine — Multiple regression & attribution
 * ============================================================
 *
 * The "ML that adjusts the weights", done honestly: closed-form ridge/OLS
 * regression with standardized coefficients. This is what powers:
 *
 *   • Venue-feature weighting — how much does distance-to-kitchen, seat
 *     count, outdoor, pool proximity actually move a table's sales?
 *     (hedonic regression: sales ~ attributes)
 *   • Waiter adjusted ratings — a server's effect on check size AFTER
 *     controlling for which tables/shifts they worked (the sports-analytics
 *     "adjusted plus-minus" idea, via dummy-encoded ridge).
 *   • Partial correlation — the correlation between X and sales once
 *     confounders are held constant.
 *
 * Ridge (λ>0) keeps coefficients finite under collinearity (e.g. dummy
 * variables that sum to 1) and doubles as L2-regularized "learning" of
 * feature weights — explainable ML that runs in-process.
 */

import { transpose, matMul, matVec, solve, identity } from "./linalg";
import { mean, stdev, pearson } from "./statistics";

export interface MultipleRegressionResult {
  /** Coefficient per input feature (original scale). */
  coefficients: number[];
  intercept: number;
  /** Beta weights on standardized (z-scored) features — comparable across
   *  features with different units; the "importance weights". */
  standardizedBetas: number[];
  r2: number;
  adjustedR2: number;
  residuals: number[];
  fitted: number[];
  n: number;
  k: number;
  predict: (x: number[]) => number;
}

/**
 * Multiple linear regression y = b0 + Σ bj·xj via ridge-regularized normal
 * equations: (XᵀX + λI)b = Xᵀy. λ=0 gives plain OLS. Intercept is added
 * internally (and never regularized when λ>0, per standard practice — we
 * center variables instead).
 */
export function multipleRegression(
  X: number[][],
  y: number[],
  opts: { ridgeLambda?: number } = {},
): MultipleRegressionResult | null {
  const n = Math.min(X.length, y.length);
  if (n < 2) return null;
  const k = X[0]?.length ?? 0;
  if (k === 0 || X.some((r) => r.length !== k)) return null;
  const lambda = opts.ridgeLambda ?? 0;

  // Center X and y so the intercept drops out of the regularized system.
  const xMeans = new Array(k).fill(0);
  for (let j = 0; j < k; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][j];
    xMeans[j] = s / n;
  }
  const yMean = mean(y.slice(0, n)) as number;
  const Xc = Array.from({ length: n }, (_, i) =>
    Array.from({ length: k }, (_, j) => X[i][j] - xMeans[j]),
  );
  const yc = y.slice(0, n).map((v) => v - yMean);

  // (XcᵀXc + λI) b = Xcᵀ yc
  const Xt = transpose(Xc);
  const XtX = matMul(Xt, Xc);
  if (lambda > 0) {
    const I = identity(k);
    for (let i = 0; i < k; i++) XtX[i][i] += lambda * I[i][i];
  }
  const Xty = matVec(Xt, yc);
  const b = solve(XtX, Xty);
  if (!b) return null;

  const intercept = yMean - b.reduce((s, bj, j) => s + bj * xMeans[j], 0);
  const predict = (x: number[]) =>
    intercept + b.reduce((s, bj, j) => s + bj * (x[j] ?? 0), 0);

  const fitted = X.slice(0, n).map((row) => predict(row));
  const residuals = fitted.map((f, i) => y[i] - f);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += residuals[i] * residuals[i];
    ssTot += (y[i] - yMean) * (y[i] - yMean);
  }
  const r2 = ssTot === 0 ? 1 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));
  const adjustedR2 =
    n - k - 1 > 0 ? 1 - ((1 - r2) * (n - 1)) / (n - k - 1) : r2;

  // Standardized betas: bj · sd(xj)/sd(y).
  const sy = stdev(y.slice(0, n), true) ?? 0;
  const standardizedBetas = b.map((bj, j) => {
    const sx = stdev(
      X.slice(0, n).map((r) => r[j]),
      true,
    );
    return sy && sx ? (bj * sx) / sy : 0;
  });

  return {
    coefficients: b,
    intercept,
    standardizedBetas,
    r2,
    adjustedR2,
    residuals,
    fitted,
    n,
    k,
    predict,
  };
}

/**
 * Partial correlation between x and y controlling for `controls`:
 * residualize both on the controls, then Pearson-correlate the residuals.
 * "Is table distance still correlated with sales once seats & outdoor are
 * held constant?"
 */
export function partialCorrelation(
  x: number[],
  y: number[],
  controls: number[][],
): number | null {
  const n = Math.min(x.length, y.length, ...controls.map((c) => c.length));
  if (n < 3) return null;
  if (controls.length === 0) {
    return pearson(x.slice(0, n), y.slice(0, n));
  }
  const Z = Array.from({ length: n }, (_, i) => controls.map((c) => c[i]));
  const rx = multipleRegression(Z, x.slice(0, n));
  const ry = multipleRegression(Z, y.slice(0, n));
  if (!rx || !ry) return null;
  return pearson(rx.residuals, ry.residuals);
}

export interface GroupEffect {
  group: string;
  /** Adjusted effect: deviation from overall mean after controls. */
  effect: number;
  /** Raw (unadjusted) mean for the group. */
  rawMean: number;
  n: number;
}

/**
 * Adjusted group effects via dummy-encoded ridge regression — the "waiter
 * rating adjusted for which tables they worked" estimator.
 *
 * y is the outcome per observation (e.g. check total). `target` is the group
 * label per observation (waiter). Each entry of `controls` is another factor
 * (table id, weekday, daypart). All factors are one-hot encoded; a small
 * ridge λ resolves the dummy-variable collinearity, so effects come out as
 * deviations from the grand mean.
 *
 * Reading: effect > 0 ⇒ this waiter lifts the outcome vs average even after
 * accounting for the tables/shifts they were dealt.
 */
export function adjustedGroupEffects(params: {
  y: number[];
  target: string[];
  controls?: string[][];
  ridgeLambda?: number;
}): { effects: GroupEffect[]; r2: number } | null {
  const { y, target } = params;
  const controls = params.controls ?? [];
  const n = Math.min(y.length, target.length, ...controls.map((c) => c.length));
  if (n < 3) return null;

  // Build level maps.
  const factorLevels: string[][] = [];
  const factors: string[][] = [target, ...controls];
  for (const f of factors) {
    const levels = Array.from(new Set(f.slice(0, n))).sort();
    factorLevels.push(levels);
  }
  const k = factorLevels.reduce((s, ls) => s + ls.length, 0);
  if (k === 0) return null;

  // One-hot design matrix.
  const X: number[][] = Array.from({ length: n }, () => new Array(k).fill(0));
  for (let i = 0; i < n; i++) {
    let offset = 0;
    for (let f = 0; f < factors.length; f++) {
      const idx = factorLevels[f].indexOf(factors[f][i]);
      if (idx >= 0) X[i][offset + idx] = 1;
      offset += factorLevels[f].length;
    }
  }

  const lambda = params.ridgeLambda ?? Math.max(1e-6, n * 1e-4);
  const reg = multipleRegression(X, y.slice(0, n), { ridgeLambda: lambda });
  if (!reg) return null;

  // Raw means per target level.
  const rawSum = new Map<string, { s: number; c: number }>();
  for (let i = 0; i < n; i++) {
    const g = target[i];
    const e = rawSum.get(g) || { s: 0, c: 0 };
    e.s += y[i];
    e.c += 1;
    rawSum.set(g, e);
  }

  const targetLevels = factorLevels[0];
  const effects: GroupEffect[] = targetLevels.map((g, idx) => ({
    group: g,
    effect: reg.coefficients[idx],
    rawMean: (rawSum.get(g)!.s ?? 0) / (rawSum.get(g)!.c || 1),
    n: rawSum.get(g)?.c ?? 0,
  }));
  effects.sort((a, b) => b.effect - a.effect);
  return { effects, r2: reg.r2 };
}
