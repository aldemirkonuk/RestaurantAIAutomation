/**
 * Pricing agility + margin health.
 *
 * Pure and dependency-free, like the rest of the engine: no NestJS, no DB, no
 * clock. Everything here is a function of its arguments, which is what makes a
 * pricing recommendation arguable — you can hand someone the inputs and they
 * can reproduce the number.
 *
 * The maths already lived in ./finance (grossMargin, priceElasticityLogLog,
 * optimalPriceFromElasticity, priceChangeImpact). This module is the judgement
 * layer on top: which estimator is admissible given the data, when to refuse to
 * recommend, and how far a single move is allowed to go.
 *
 * Three decisions worth reading before trusting the output
 * -------------------------------------------------------
 *
 * 1. Model-set prices are excluded from elasticity estimation by default.
 *    Regressing ln(Q) on ln(P) recovers elasticity only while price variation
 *    is exogenous. Once the agent sets prices, its own moves enter the series
 *    and the estimate starts reflecting the model's past decisions rather than
 *    customer behaviour — simultaneity bias, and the specific way a
 *    continuously-running pricing loop goes wrong without anyone noticing.
 *    `admissiblePoints()` drops 'agent_accepted' and 'backfill' points.
 *
 * 2. A missing recommendation is a real answer. With one price point there is
 *    no elasticity to estimate, and inventing one produces a confident number
 *    with nothing behind it. Those cases return recommendedPrice: null and say
 *    why in `notes`. Margin health is still computed — it needs only cost and
 *    price, so the flag works on day one while the recommendation waits for
 *    evidence.
 *
 * 3. Recommendations are clamped, twice. Never below the margin floor (the
 *    point of the exercise), and never more than maxMovePct from the current
 *    price in one step. The unclamped Lerner optimum can be double the current
 *    price on a thin sample; shipping that to a wine list is how a somm loses
 *    trust in the tool permanently.
 */

import {
  grossMargin,
  optimalPriceFromElasticity,
  priceChangeImpact,
  priceElasticityLogLog,
  priceElasticityArc,
} from "./finance";

export const PRICING_ENGINE_VERSION = "pricing-agility/1.0.0";

/** Where an observed price point came from. Mirrors menu_price_versions.change_source. */
export type PriceChangeSource =
  | "manual"
  | "agent_accepted"
  | "import"
  | "backfill";

export interface PricePoint {
  price: number;
  /** Units sold while this price was in effect. */
  quantity: number;
  source?: PriceChangeSource;
}

export type ElasticityMethod = "loglog" | "midpoint" | "category_prior";

export interface PricingInput {
  currentPrice: number;
  unitCost: number;
  /** Observed (price, quantity) pairs, any order. */
  history?: PricePoint[];
  /** Margin below this fraction (0–1) raises a flag. */
  marginFloorPct: number;
  /**
   * Fallback elasticity when the item has no usable price variation. Must be
   * < -1 to imply a finite optimum. Restaurant wine typically sits near -1.3.
   */
  categoryPriorElasticity?: number;
  /** Largest single-step move as a fraction of current price. Default 0.15. */
  maxMovePct?: number;
  /**
   * Include model-set price points in estimation. Default false. Only set this
   * true if you have a reason to believe the agent's past moves were
   * effectively random with respect to demand — which is rarely true.
   */
  includeEndogenousPoints?: boolean;
}

export interface PricingAnalysis {
  currentMarginPct: number | null;
  recommendedPrice: number | null;
  projectedMarginPct: number | null;
  projectedRevenuePct: number | null;
  elasticity: number | null;
  elasticityMethod: ElasticityMethod | null;
  observationCount: number;
  /** 0–1. Combines estimator quality, sample size and price dispersion. */
  confidence: number;
  marginFlagged: boolean;
  flagSeverity: "warning" | "critical" | null;
  /** Human-readable reasons. Always populated; this is what the UI shows. */
  notes: string[];
  engineVersion: string;
}

/** Margin within this many points above the floor still warrants a warning. */
const WARNING_BAND = 0.05;

/** Default single-step move limit. */
const DEFAULT_MAX_MOVE = 0.15;

/** Default fallback elasticity for restaurant wine. */
const DEFAULT_PRIOR_ELASTICITY = -1.3;

/**
 * Points admissible for elasticity estimation.
 *
 * 'backfill' is a synthetic row written when price versioning was introduced —
 * it records a price that was already in effect, not a price movement, so it
 * carries no demand response. 'agent_accepted' is the endogeneity case in (1)
 * above.
 */
export function admissiblePoints(
  history: PricePoint[],
  includeEndogenous = false,
): PricePoint[] {
  return history.filter((p) => {
    if (p.price <= 0 || p.quantity <= 0) return false;
    if (includeEndogenous) return true;
    return p.source !== "agent_accepted" && p.source !== "backfill";
  });
}

/** Distinct price levels — two observations at the same price carry no signal. */
function distinctPrices(points: PricePoint[]): number[] {
  return [...new Set(points.map((p) => p.price))];
}

/**
 * Coefficient of variation of price. Low dispersion means the regression is
 * extrapolating from a narrow window and the slope is fragile.
 */
function priceDispersion(points: PricePoint[]): number {
  const prices = points.map((p) => p.price);
  if (prices.length < 2) return 0;
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  if (mean === 0) return 0;
  const variance =
    prices.reduce((acc, p) => acc + (p - mean) ** 2, 0) / prices.length;
  return Math.sqrt(variance) / mean;
}

export interface ElasticityEstimate {
  elasticity: number | null;
  method: ElasticityMethod | null;
  observationCount: number;
  confidence: number;
  note: string;
}

/**
 * Pick the strongest admissible estimator for the data available.
 *
 * loglog (>=3 distinct prices) > midpoint (2) > category prior (fewer).
 * The prior is returned with low confidence rather than withheld, so margin
 * health and a floor-based recommendation still work on a brand-new item.
 */
export function estimateElasticity(
  history: PricePoint[],
  opts: {
    categoryPriorElasticity?: number;
    includeEndogenousPoints?: boolean;
  } = {},
): ElasticityEstimate {
  const prior = opts.categoryPriorElasticity ?? DEFAULT_PRIOR_ELASTICITY;
  const points = admissiblePoints(history, opts.includeEndogenousPoints);
  const levels = distinctPrices(points);

  if (levels.length >= 3) {
    const e = priceElasticityLogLog(
      points.map((p) => p.price),
      points.map((p) => p.quantity),
    );
    if (e !== null && Number.isFinite(e)) {
      // Dispersion caps confidence: three prices within 1% of each other is
      // arithmetically a regression and practically a single price.
      const dispersion = priceDispersion(points);
      const sampleTerm = Math.min(1, points.length / 8);
      const dispersionTerm = Math.min(1, dispersion / 0.1);
      const confidence = Math.max(
        0.2,
        Math.min(0.95, 0.5 * sampleTerm + 0.5 * dispersionTerm),
      );
      return {
        elasticity: e,
        method: "loglog",
        observationCount: points.length,
        confidence,
        note: `Elasticity ${e.toFixed(2)} from log-log regression over ${points.length} observations at ${levels.length} distinct prices.`,
      };
    }
  }

  if (levels.length === 2) {
    // Two levels: collapse to mean quantity per level, then arc elasticity.
    const [pa, pb] = levels;
    const qa = mean(
      points.filter((p) => p.price === pa).map((p) => p.quantity),
    );
    const qb = mean(
      points.filter((p) => p.price === pb).map((p) => p.quantity),
    );
    const e = priceElasticityArc(pa, qa, pb, qb);
    if (e !== null && Number.isFinite(e)) {
      return {
        elasticity: e,
        method: "midpoint",
        observationCount: points.length,
        confidence: 0.35,
        note: `Elasticity ${e.toFixed(2)} from a midpoint (arc) estimate across two price points — directional only.`,
      };
    }
  }

  return {
    elasticity: prior,
    method: "category_prior",
    observationCount: points.length,
    confidence: 0.1,
    note:
      points.length === 0
        ? `No usable price history; assuming a category prior of ${prior}. Recommendation is margin-driven, not demand-driven.`
        : `Only ${levels.length} distinct price level(s) observed; assuming a category prior of ${prior}.`,
  };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Price that exactly achieves a target gross margin at a given cost. */
export function priceForMargin(
  unitCost: number,
  targetMarginPct: number,
): number | null {
  if (unitCost <= 0) return null;
  if (targetMarginPct >= 1 || targetMarginPct < 0) return null;
  return unitCost / (1 - targetMarginPct);
}

/**
 * Full analysis for one item.
 *
 * Margin health is computed whenever cost and price are known — it does not
 * depend on any estimate and is therefore the part that is always trustworthy.
 * The recommendation is layered on top and degrades explicitly.
 */
export function analyzePricing(input: PricingInput): PricingAnalysis {
  const {
    currentPrice,
    unitCost,
    history = [],
    marginFloorPct,
    maxMovePct = DEFAULT_MAX_MOVE,
  } = input;

  const notes: string[] = [];
  const base: PricingAnalysis = {
    currentMarginPct: null,
    recommendedPrice: null,
    projectedMarginPct: null,
    projectedRevenuePct: null,
    elasticity: null,
    elasticityMethod: null,
    observationCount: 0,
    confidence: 0,
    marginFlagged: false,
    flagSeverity: null,
    notes,
    engineVersion: PRICING_ENGINE_VERSION,
  };

  if (!(currentPrice > 0) || !(unitCost > 0)) {
    notes.push(
      "Cannot analyse: a positive menu price and unit cost are both required. Margin is undefined without them, so nothing here is flagged rather than being flagged as healthy.",
    );
    return base;
  }

  // ---- Margin health (no estimation involved) ----------------------------
  const currentMarginPct = grossMargin(unitCost, currentPrice);
  base.currentMarginPct = currentMarginPct;

  if (currentMarginPct !== null) {
    if (currentMarginPct < marginFloorPct) {
      base.marginFlagged = true;
      base.flagSeverity = "critical";
      notes.push(
        `Margin ${(currentMarginPct * 100).toFixed(1)}% is below the ${(marginFloorPct * 100).toFixed(0)}% floor.`,
      );
    } else if (currentMarginPct < marginFloorPct + WARNING_BAND) {
      base.marginFlagged = true;
      base.flagSeverity = "warning";
      notes.push(
        `Margin ${(currentMarginPct * 100).toFixed(1)}% is within ${(WARNING_BAND * 100).toFixed(0)} points of the ${(marginFloorPct * 100).toFixed(0)}% floor.`,
      );
    }
  }

  // ---- Elasticity --------------------------------------------------------
  const est = estimateElasticity(history, {
    categoryPriorElasticity: input.categoryPriorElasticity,
    includeEndogenousPoints: input.includeEndogenousPoints,
  });
  base.elasticity = est.elasticity;
  base.elasticityMethod = est.method;
  base.observationCount = est.observationCount;
  base.confidence = est.confidence;
  notes.push(est.note);

  const excluded =
    history.length -
    admissiblePoints(history, input.includeEndogenousPoints).length;
  if (excluded > 0 && !input.includeEndogenousPoints) {
    notes.push(
      `${excluded} price point(s) excluded from estimation because they were set by this engine or seeded at backfill — including them would let the model learn from its own decisions.`,
    );
  }

  // ---- Recommendation ----------------------------------------------------
  const floorPrice = priceForMargin(unitCost, marginFloorPct);

  let target: number | null = null;
  if (est.elasticity !== null && est.elasticity < -1) {
    target = optimalPriceFromElasticity(unitCost, est.elasticity);
  }

  if (target === null) {
    // Inelastic (or unusable) estimate: the Lerner optimum is unbounded, so
    // there is no demand-based answer. Fall back to the margin floor, and say
    // so — this is a floor-satisfying price, not a profit-maximising one.
    if (floorPrice !== null && currentPrice < floorPrice) {
      target = floorPrice;
      notes.push(
        "Demand appears inelastic (or too thin to estimate), so no profit-maximising price exists from the data. Falling back to the price that just meets the margin floor.",
      );
    } else {
      notes.push(
        "No price change recommended: demand is inelastic or unestimable, and the current price already clears the margin floor.",
      );
      return base;
    }
  }

  // Never recommend below the floor — the whole point of the exercise.
  if (floorPrice !== null && target < floorPrice) {
    notes.push(
      `Profit-maximising price ${target.toFixed(2)} sits below the margin floor; raised to ${floorPrice.toFixed(2)}.`,
    );
    target = floorPrice;
  }

  // Clamp the step size.
  const upper = currentPrice * (1 + maxMovePct);
  const lower = currentPrice * (1 - maxMovePct);
  const unclamped = target;
  if (target > upper) target = upper;
  if (target < lower) target = lower;
  if (target !== unclamped) {
    notes.push(
      `Move limited to ${(maxMovePct * 100).toFixed(0)}% per step (uncapped suggestion was ${unclamped.toFixed(2)}).`,
    );
  }

  const rounded = Math.round(target * 100) / 100;
  if (Math.abs(rounded - currentPrice) < 0.01) {
    notes.push("Current price is already at the recommended level.");
    return base;
  }

  base.recommendedPrice = rounded;
  base.projectedMarginPct = grossMargin(unitCost, rounded);

  if (est.elasticity !== null) {
    const q0 = mean(
      admissiblePoints(history, input.includeEndogenousPoints).map(
        (p) => p.quantity,
      ),
    );
    const impact = priceChangeImpact(
      currentPrice,
      q0 || 1,
      rounded,
      est.elasticity,
    );
    base.projectedRevenuePct = impact ? impact.revenuePct : null;
  }

  return base;
}
