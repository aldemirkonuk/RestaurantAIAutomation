/**
 * WineOps Analytics Engine — Finance & Economics primitives
 * =========================================================
 *
 * The corporate-finance / trader / PE toolkit, restated for a restaurant
 * wine program. Everything here is deterministic and unit-tested.
 *
 * Grouped as a senior operator would think about the business:
 *   1. Growth & change            — pct change, CAGR, YoY
 *   2. Time value of money        — PV/FV, NPV, IRR/XIRR, payback
 *   3. Margin & unit economics    — markup, GM, contribution, break-even
 *   4. Working capital & credit   — DPO, CCC, early-pay discount APR
 *   5. Pricing / micro-economics  — price elasticity, optimal markup
 *   6. Concentration & structure  — HHI, Gini handled in risk.ts
 *
 * Convention: monetary inputs are plain numbers in one currency; rates are
 * decimals (0.08 = 8%). Functions return null on undefined/degenerate inputs.
 */

import { linearRegression } from "./statistics";

// ---------------------------------------------------------------------------
// 1. Growth & change
// ---------------------------------------------------------------------------

/** Simple percentage change (curr - prev)/prev. Null if prev is 0. */
export function pctChange(prev: number, curr: number): number | null {
  if (prev === 0) return null;
  return (curr - prev) / prev;
}

/**
 * Compound annual growth rate. beginValue → endValue over `years` periods.
 * CAGR = (end/begin)^(1/years) - 1. Requires positive values.
 */
export function cagr(
  beginValue: number,
  endValue: number,
  years: number,
): number | null {
  if (beginValue <= 0 || endValue <= 0 || years <= 0) return null;
  return Math.pow(endValue / beginValue, 1 / years) - 1;
}

/**
 * Compound growth rate for an evenly-spaced series (per period), fit through
 * the geometric mean of period-over-period ratios. More robust than endpoint
 * CAGR when the series is noisy.
 */
export function compoundGrowthRate(series: number[]): number | null {
  if (series.length < 2) return null;
  let logSum = 0;
  let count = 0;
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] <= 0 || series[i] <= 0) return null;
    logSum += Math.log(series[i] / series[i - 1]);
    count++;
  }
  if (count === 0) return null;
  return Math.exp(logSum / count) - 1;
}

// ---------------------------------------------------------------------------
// 2. Time value of money
// ---------------------------------------------------------------------------

/** Present value of a single future cash flow. */
export function presentValue(
  futureValue: number,
  rate: number,
  periods: number,
): number {
  return futureValue / Math.pow(1 + rate, periods);
}

/** Future value of a present amount. */
export function futureValue(pv: number, rate: number, periods: number): number {
  return pv * Math.pow(1 + rate, periods);
}

/**
 * Net present value of a cash-flow stream. cashFlows[0] is t=0 (usually the
 * outlay, negative). `rate` is the per-period discount rate.
 */
export function npv(rate: number, cashFlows: number[]): number {
  let acc = 0;
  for (let t = 0; t < cashFlows.length; t++) {
    acc += cashFlows[t] / Math.pow(1 + rate, t);
  }
  return acc;
}

/**
 * Internal rate of return via bisection on NPV (robust, no derivative).
 * Returns null if no sign change is bracketed in [-0.9999, 10].
 */
export function irr(cashFlows: number[], tol = 1e-7): number | null {
  if (cashFlows.length < 2) return null;
  const f = (r: number) => npv(r, cashFlows);
  let lo = -0.9999;
  let hi = 10;
  let flo = f(lo);
  let fhi = f(hi);
  if (Number.isNaN(flo) || Number.isNaN(fhi)) return null;
  if (flo * fhi > 0) return null; // no bracketed root
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fmid = f(mid);
    if (Math.abs(fmid) < tol) return mid;
    if (flo * fmid < 0) {
      hi = mid;
      fhi = fmid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * XIRR — IRR for irregularly-dated cash flows (the real-world case for vendor
 * payments). `flows` are { amount, date } pairs; rate is annualized using
 * actual/365 day counts.
 */
export function xirr(
  flows: Array<{ amount: number; date: Date }>,
  tol = 1e-7,
): number | null {
  if (flows.length < 2) return null;
  const sorted = [...flows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const t0 = sorted[0].date.getTime();
  const yearFrac = (d: Date) => (d.getTime() - t0) / (365 * 24 * 3600 * 1000);
  const f = (r: number) => {
    let acc = 0;
    for (const cf of sorted)
      acc += cf.amount / Math.pow(1 + r, yearFrac(cf.date));
    return acc;
  };
  let lo = -0.9999;
  let hi = 100;
  let flo = f(lo);
  const fhi = f(hi);
  if (Number.isNaN(flo) || Number.isNaN(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fmid = f(mid);
    if (Math.abs(fmid) < tol) return mid;
    if (flo * fmid < 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Payback period (in periods) for an initial outlay recovered by a stream of
 * (positive) inflows, with linear interpolation within the crossover period.
 * Returns null if never recovered.
 */
export function paybackPeriod(
  initialOutlay: number,
  inflows: number[],
): number | null {
  let cumulative = 0;
  const outlay = Math.abs(initialOutlay);
  for (let i = 0; i < inflows.length; i++) {
    const before = cumulative;
    cumulative += inflows[i];
    if (cumulative >= outlay) {
      const needed = outlay - before;
      return i + (inflows[i] === 0 ? 0 : needed / inflows[i]);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. Margin & unit economics
// ---------------------------------------------------------------------------

/** Markup on cost = (price - cost)/cost. */
export function markup(cost: number, price: number): number | null {
  if (cost === 0) return null;
  return (price - cost) / cost;
}

/** Gross margin = (price - cost)/price. */
export function grossMargin(cost: number, price: number): number | null {
  if (price === 0) return null;
  return (price - cost) / price;
}

/** Convert a markup multiple to gross margin. markup 2.0 (200%) → 0.667. */
export function markupToMargin(markupPct: number): number | null {
  const denom = 1 + markupPct;
  if (denom === 0) return null;
  return markupPct / denom;
}

/** Convert gross margin to markup. margin 0.667 → 2.0. */
export function marginToMarkup(marginPct: number): number | null {
  const denom = 1 - marginPct;
  if (denom === 0) return null;
  return marginPct / denom;
}

/** COGS ratio = cost of goods sold / revenue (the classic beverage-cost %). */
export function cogsRatio(cogs: number, revenue: number): number | null {
  if (revenue === 0) return null;
  return cogs / revenue;
}

/**
 * Prime cost ratio = (COGS + labor) / revenue. The single most-watched
 * restaurant health metric; industry rule-of-thumb target ≤ 0.60–0.65.
 */
export function primeCostRatio(
  cogs: number,
  labor: number,
  revenue: number,
): number | null {
  if (revenue === 0) return null;
  return (cogs + labor) / revenue;
}

/** Contribution margin per unit = price - variable cost. */
export function contributionMargin(
  price: number,
  variableCost: number,
): number {
  return price - variableCost;
}

/** Contribution margin ratio = CM / price. */
export function contributionMarginRatio(
  price: number,
  variableCost: number,
): number | null {
  if (price === 0) return null;
  return (price - variableCost) / price;
}

/**
 * Break-even volume (units) = fixedCosts / contributionMargin.
 * Returns null if CM ≤ 0 (never breaks even).
 */
export function breakEvenUnits(
  fixedCosts: number,
  price: number,
  variableCost: number,
): number | null {
  const cm = price - variableCost;
  if (cm <= 0) return null;
  return fixedCosts / cm;
}

/** Break-even revenue = fixedCosts / contributionMarginRatio. */
export function breakEvenRevenue(
  fixedCosts: number,
  price: number,
  variableCost: number,
): number | null {
  const cmr = contributionMarginRatio(price, variableCost);
  if (cmr === null || cmr <= 0) return null;
  return fixedCosts / cmr;
}

/**
 * Landed (true) unit cost = invoice + freight + duty + storage + breakage
 * reserve, all per unit. The number the P&L should actually use, not the
 * invoice price.
 */
export function landedCost(parts: {
  invoice: number;
  freight?: number;
  duty?: number;
  storage?: number;
  breakageReserve?: number;
  other?: number;
}): number {
  return (
    parts.invoice +
    (parts.freight ?? 0) +
    (parts.duty ?? 0) +
    (parts.storage ?? 0) +
    (parts.breakageReserve ?? 0) +
    (parts.other ?? 0)
  );
}

// ---------------------------------------------------------------------------
// 4. Working capital & vendor credit
// ---------------------------------------------------------------------------

/** Days payable outstanding = (accountsPayable / cogs) * periodDays. */
export function daysPayableOutstanding(
  accountsPayable: number,
  cogs: number,
  periodDays = 365,
): number | null {
  if (cogs === 0) return null;
  return (accountsPayable / cogs) * periodDays;
}

/**
 * Cash conversion cycle = DIO + DSO - DPO (days). For a restaurant DSO≈0
 * (guests pay immediately), so CCC ≈ DIO - DPO — negative is great (vendors
 * finance your inventory).
 */
export function cashConversionCycle(
  dio: number,
  dso: number,
  dpo: number,
): number {
  return dio + dso - dpo;
}

/**
 * Annualized (APR) cost of NOT taking an early-payment discount, e.g. "2/10
 * net 30". The implied return on paying early — often 30%+ APR, a top-tier
 * "risk-free" use of cash. discount as decimal (0.02), days = net - discount
 * window (30 - 10 = 20).
 */
export function earlyPaymentDiscountApr(
  discount: number,
  daysSaved: number,
): number | null {
  if (discount <= 0 || discount >= 1 || daysSaved <= 0) return null;
  return (discount / (1 - discount)) * (365 / daysSaved);
}

// ---------------------------------------------------------------------------
// 5. Pricing / micro-economics
// ---------------------------------------------------------------------------

/**
 * Point price elasticity of demand between two (price, quantity) observations
 * using the midpoint (arc) formula — symmetric and bounded, the correct
 * elementary estimator. Negative for normal goods; |E|>1 elastic.
 */
export function priceElasticityArc(
  p0: number,
  q0: number,
  p1: number,
  q1: number,
): number | null {
  const dP = p1 - p0;
  const dQ = q1 - q0;
  const avgP = (p0 + p1) / 2;
  const avgQ = (q0 + q1) / 2;
  if (avgP === 0 || avgQ === 0 || dP === 0) return null;
  return dQ / avgQ / (dP / avgP);
}

/**
 * Log-log elasticity: regress ln(Q) on ln(P); the slope IS the constant
 * elasticity. The right tool when you have several price points. Requires all
 * positive.
 */
export function priceElasticityLogLog(
  prices: number[],
  quantities: number[],
): number | null {
  const n = Math.min(prices.length, quantities.length);
  if (n < 2) return null;
  const lnP: number[] = [];
  const lnQ: number[] = [];
  for (let i = 0; i < n; i++) {
    if (prices[i] <= 0 || quantities[i] <= 0) return null;
    lnP.push(Math.log(prices[i]));
    lnQ.push(Math.log(quantities[i]));
  }
  const reg = linearRegression(lnP, lnQ);
  return reg ? reg.slope : null;
}

/**
 * Profit-maximizing markup implied by the Lerner index: (P-MC)/P = -1/E.
 * Given constant elasticity E (<-1 for a solution) and marginal cost, returns
 * the optimal price. This is the monopolistic-competition pricing rule a
 * somm's list actually lives in.
 */
export function optimalPriceFromElasticity(
  marginalCost: number,
  elasticity: number,
): number | null {
  if (elasticity >= -1) return null; // inelastic → raise price without bound
  const markupMultiple = elasticity / (elasticity + 1); // > 1
  return marginalCost * markupMultiple;
}

/**
 * Expected revenue impact of a price change under an assumed elasticity.
 * Returns projected quantity, revenue, and % revenue change. Uses constant
 * elasticity: Q1 = Q0 · (P1/P0)^E.
 */
export function priceChangeImpact(
  p0: number,
  q0: number,
  p1: number,
  elasticity: number,
): {
  q1: number;
  revenue0: number;
  revenue1: number;
  revenuePct: number;
} | null {
  if (p0 <= 0 || q0 < 0) return null;
  const q1 = q0 * Math.pow(p1 / p0, elasticity);
  const revenue0 = p0 * q0;
  const revenue1 = p1 * q1;
  return {
    q1,
    revenue0,
    revenue1,
    revenuePct: revenue0 === 0 ? 0 : (revenue1 - revenue0) / revenue0,
  };
}

// ---------------------------------------------------------------------------
// 6. Concentration / market structure
// ---------------------------------------------------------------------------

/**
 * Herfindahl-Hirschman Index of concentration. Input raw shares (e.g. spend
 * per vendor); they're normalized internally. Returns index on the 0–1 scale
 * (1 = single supplier monopoly). Multiply by 10,000 for the DOJ points
 * convention. The canonical "single point of failure" / vendor-dependency
 * measure.
 */
export function herfindahlIndex(weights: number[]): number | null {
  const positive = weights.filter((w) => w > 0);
  const total = positive.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let hhi = 0;
  for (const w of positive) {
    const s = w / total;
    hhi += s * s;
  }
  return hhi;
}

/**
 * Effective number of suppliers = 1 / HHI (the "numbers-equivalent").
 * A intuitive read: HHI 0.25 → effectively 4 equal vendors.
 */
export function effectiveCount(weights: number[]): number | null {
  const hhi = herfindahlIndex(weights);
  return hhi && hhi > 0 ? 1 / hhi : null;
}

/**
 * n-firm concentration ratio: share of the top-n largest weights.
 * CR4 (top 4) is the classic. Returns share in [0,1].
 */
export function concentrationRatio(
  weights: number[],
  n: number,
): number | null {
  const positive = weights.filter((w) => w > 0).sort((a, b) => b - a);
  const total = positive.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const top = positive.slice(0, n).reduce((a, b) => a + b, 0);
  return top / total;
}

/**
 * Weighted-average unit cost (moving-average inventory costing). Given lots of
 * (qty, unitCost), returns the blended cost per unit. The valuation basis
 * `inventory_lot_rollup.wac` represents.
 */
export function weightedAverageCost(
  lots: Array<{ qty: number; unitCost: number }>,
): number | null {
  let totalQty = 0;
  let totalCost = 0;
  for (const l of lots) {
    if (l.qty <= 0) continue;
    totalQty += l.qty;
    totalCost += l.qty * l.unitCost;
  }
  return totalQty === 0 ? null : totalCost / totalQty;
}

/**
 * FIFO valuation of the remaining on-hand quantity given the receiving lots
 * (oldest first) and total units consumed. Returns the dollar value of what's
 * left, valued at the newest surviving lot costs.
 */
export function fifoValuation(
  lots: Array<{ qty: number; unitCost: number }>,
  consumed: number,
): { remainingQty: number; value: number } {
  let toConsume = consumed;
  let value = 0;
  let remainingQty = 0;
  for (const lot of lots) {
    let q = lot.qty;
    if (toConsume > 0) {
      const taken = Math.min(toConsume, q);
      q -= taken;
      toConsume -= taken;
    }
    remainingQty += q;
    value += q * lot.unitCost;
  }
  return { remainingQty, value };
}
