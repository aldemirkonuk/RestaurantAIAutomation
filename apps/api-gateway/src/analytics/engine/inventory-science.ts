/**
 * WineOps Analytics Engine — Inventory Science primitives
 * =======================================================
 *
 * Operations-research inventory theory applied to a wine cellar. This is where
 * "how much to hold" and "when to buy" become math instead of gut feel.
 *
 * Covers:
 *   • Turnover & aging      — turnover ratio, DIO/DSI, GMROI
 *   • Order sizing          — EOQ (Wilson), total relevant cost
 *   • Safety & reorder      — safety stock (variable demand & lead time),
 *                             reorder point, fill rate
 *   • Single-period         — newsvendor critical fractile (event ordering)
 *   • Classification        — ABC (Pareto), XYZ (variability)
 *   • Carrying cost         — holding cost per unit-day
 *
 * References: Wilson EOQ; King (2011) safety-stock formula; newsvendor model.
 */

import {
  mean,
  stdev,
  coefficientOfVariation,
  serviceLevelZ,
  normalPdf,
  normalCdf,
  normalInv,
} from "./statistics";

// ---------------------------------------------------------------------------
// Turnover & aging
// ---------------------------------------------------------------------------

/**
 * Inventory turnover ratio = COGS / average inventory value. How many times
 * the cellar "turns" per period. Wine runs low (2–6×/yr) vs food; still the
 * core capital-efficiency signal.
 */
export function inventoryTurnover(
  cogs: number,
  avgInventoryValue: number,
): number | null {
  if (avgInventoryValue <= 0) return null;
  return cogs / avgInventoryValue;
}

/**
 * Days inventory outstanding (a.k.a. DSI) = periodDays / turnover, or
 * equivalently avgInventory/COGS × periodDays. Average days a bottle sits
 * before it sells — directly funds the cash-conversion cycle.
 */
export function daysInventoryOutstanding(
  cogs: number,
  avgInventoryValue: number,
  periodDays = 365,
): number | null {
  const turns = inventoryTurnover(cogs, avgInventoryValue);
  if (turns === null || turns === 0) return null;
  return periodDays / turns;
}

/**
 * GMROI — Gross Margin Return On Inventory Investment = gross margin $ /
 * average inventory cost. "$ of margin per $ of inventory." >1 means the SKU
 * earns its shelf space; the merchandising KPI PE operators live by.
 */
export function gmroi(
  grossMarginDollars: number,
  avgInventoryCost: number,
): number | null {
  if (avgInventoryCost <= 0) return null;
  return grossMarginDollars / avgInventoryCost;
}

/**
 * Sell-through rate = unitsSold / (unitsSold + unitsRemaining) over the period
 * (i.e. of what was available). 0–1.
 */
export function sellThroughRate(
  unitsSold: number,
  unitsReceived: number,
): number | null {
  if (unitsReceived <= 0) return null;
  return Math.min(1, unitsSold / unitsReceived);
}

/**
 * Carrying (holding) cost per unit over a horizon.
 * annualHoldingRate is the fraction of unit value per year (capital cost +
 * storage + insurance + spoilage/obsolescence). Returns cost for `days` held.
 */
export function carryingCost(
  unitValue: number,
  annualHoldingRate: number,
  days: number,
): number {
  return unitValue * annualHoldingRate * (days / 365);
}

// ---------------------------------------------------------------------------
// Order sizing — Economic Order Quantity
// ---------------------------------------------------------------------------

export interface EoqResult {
  /** Economic order quantity (units). */
  eoq: number;
  /** Orders per period at EOQ. */
  ordersPerPeriod: number;
  /** Time between orders (in the period's units). */
  cycleTime: number;
  /** Total relevant cost (ordering + holding) at EOQ. */
  totalCost: number;
}

/**
 * Wilson Economic Order Quantity: Q* = sqrt(2·D·S / H) where D = demand per
 * period, S = fixed cost per order, H = holding cost per unit per period.
 * Minimizes the sum of ordering + carrying cost. The classic
 * order-batching optimizer.
 */
export function eoq(
  annualDemand: number,
  orderingCost: number,
  holdingCostPerUnit: number,
): EoqResult | null {
  if (annualDemand <= 0 || orderingCost <= 0 || holdingCostPerUnit <= 0)
    return null;
  const q = Math.sqrt((2 * annualDemand * orderingCost) / holdingCostPerUnit);
  const ordersPerPeriod = annualDemand / q;
  const totalCost =
    (annualDemand / q) * orderingCost + (q / 2) * holdingCostPerUnit;
  return {
    eoq: q,
    ordersPerPeriod,
    cycleTime: 1 / ordersPerPeriod,
    totalCost,
  };
}

// ---------------------------------------------------------------------------
// Safety stock & reorder point
// ---------------------------------------------------------------------------

/**
 * Safety stock under uncertain demand AND uncertain lead time (King's
 * formula):
 *   SS = z · sqrt( LT·σ_d²  +  d̄²·σ_LT² )
 * where LT = mean lead time, σ_d = demand stdev per period, d̄ = mean demand
 * per period, σ_LT = lead-time stdev. This is the statistically correct
 * safety stock most POS systems get wrong by ignoring lead-time variance.
 *
 * @param serviceLevel cycle service level, e.g. 0.95
 */
export function safetyStock(params: {
  serviceLevel: number;
  avgDemandPerPeriod: number;
  demandStdev: number;
  avgLeadTime: number;
  leadTimeStdev?: number;
}): number | null {
  const z = serviceLevelZ(params.serviceLevel);
  if (z === null) return null;
  const sigmaLT = params.leadTimeStdev ?? 0;
  const variance =
    params.avgLeadTime * params.demandStdev ** 2 +
    params.avgDemandPerPeriod ** 2 * sigmaLT ** 2;
  if (variance < 0) return null;
  return z * Math.sqrt(variance);
}

/**
 * Reorder point = expected demand over lead time + safety stock.
 * The stock level that should trigger a purchase order.
 */
export function reorderPoint(params: {
  serviceLevel: number;
  avgDemandPerPeriod: number;
  demandStdev: number;
  avgLeadTime: number;
  leadTimeStdev?: number;
}): {
  reorderPoint: number;
  safetyStock: number;
  leadTimeDemand: number;
} | null {
  const ss = safetyStock(params);
  if (ss === null) return null;
  const leadTimeDemand = params.avgDemandPerPeriod * params.avgLeadTime;
  return {
    reorderPoint: leadTimeDemand + ss,
    safetyStock: ss,
    leadTimeDemand,
  };
}

/**
 * Convenience: compute demand statistics (mean, stdev, CV) from a raw series
 * of per-period demand, ready to feed safetyStock/reorderPoint.
 */
export function demandProfile(perPeriodDemand: number[]): {
  mean: number;
  stdev: number;
  cv: number | null;
} | null {
  const m = mean(perPeriodDemand);
  const sd = stdev(perPeriodDemand, true);
  if (m === null || sd === null) return null;
  return {
    mean: m,
    stdev: sd,
    cv: coefficientOfVariation(perPeriodDemand, true),
  };
}

/**
 * Probability of stockout before the next delivery, assuming normally
 * distributed lead-time demand. P(demand > onHand) = 1 - Φ(z).
 */
export function stockoutProbability(params: {
  onHand: number;
  avgDemandPerPeriod: number;
  demandStdev: number;
  leadTime: number;
}): number | null {
  const mu = params.avgDemandPerPeriod * params.leadTime;
  const sigma = params.demandStdev * Math.sqrt(params.leadTime);
  if (sigma <= 0) return params.onHand >= mu ? 0 : 1;
  const z = (params.onHand - mu) / sigma;
  return 1 - normalCdf(z);
}

/**
 * Days of cover = onHand / avgDailyDemand. The simplest runway metric.
 */
export function daysOfCover(
  onHand: number,
  avgDailyDemand: number,
): number | null {
  if (avgDailyDemand <= 0) return null;
  return onHand / avgDailyDemand;
}

// ---------------------------------------------------------------------------
// What a restock reading may say (ADR 0299)
// ---------------------------------------------------------------------------

/**
 * Bottles on hand: the sealed count plus the open bottle, in bottles.
 *
 * A spirit poured by the glass spends most of its life in an OPEN bottle —
 * `inventory_lot_rollup.open_ml`, the sum of `open_bottle_ml` over live lots.
 * Counting sealed bottles alone read Pierre Ferrand at 0 bottles while it held
 * 950 of 1,000 ml, and ranked it the likeliest wine to run out (AW29). The size
 * an open bottle is read back at is the size the writer poured it from:
 * `record_glass_pour` takes `COALESCE(bottle_size_ml, 750)`, so a row with no
 * stated size is read at 750 ml too. A size of 0 or less is one the writer
 * refuses (ADR 0285), so it converts nothing rather than dividing by it.
 */
export function bottlesOnHand(
  sealed: number,
  openMl: number | null | undefined,
  bottleSizeMl: number | null | undefined,
): number {
  const size = bottleSizeMl ?? 750;
  const open = Number(openMl) || 0;
  if (!(size > 0) || !(open > 0)) return sealed;
  return sealed + open / size;
}

/** Bottles on hand to the hundredth, for display (250 of 750 ml → 0.33). */
export function bottlesToHundredth(bottles: number): number {
  return Number(bottles.toFixed(2));
}

/**
 * The days with a sale a demand series needs before its swing — standard
 * deviation, CV, safety stock, reorder point and stockout probability — is
 * stated. The same floor as `MIN_TREND_OBSERVED` (insight-generator.service.ts):
 * two weeks of observed days before a pattern is called one.
 *
 * Below it the swing is an artefact of how the sales were RECORDED, not how
 * the wine sells: every Tuzlu series held one import day (F-129), so every
 * series had CV = √90 and every wine with nothing sealed read the same 61%.
 */
export const MIN_DEMAND_DAYS = 14;

export interface RestockReading {
  /** Mean units per day over the window, zero-filled. Always stated. */
  mean: number;
  /** Null until the series is measured. */
  stdev: number | null;
  cv: number | null;
  /** Days in the window with a sale (value > 0). */
  demandDays: number;
  /** `demandDays >= MIN_DEMAND_DAYS`: the swing is the wine's, not the import's. */
  measured: boolean;
  /** onHand / mean; null when nothing sold in the window. */
  daysOfCover: number | null;
  /** mean × lead time — needs only the mean. */
  leadTimeDemand: number;
  reorderPoint: number | null;
  safetyStock: number | null;
  stockoutProbability: number | null;
  /**
   * Measured: on hand at or below the reorder point (unchanged). Unmeasured:
   * on hand at or below the mean lead-time demand, and only where that is
   * PROVABLY below the reorder point — at a service level of 0.5 or more the
   * safety stock is never negative, so ROP ≥ mean × lead time whatever the
   * swing turns out to be. Below 0.5 nothing can be shown, so it is false.
   */
  needsReorder: boolean;
}

/**
 * One reading of a wine's restock position, at every site that states one —
 * the reorder register, Wine-360 and the stockout #1 insight — so the three
 * cannot disagree about what a series supports (ADR 0299).
 */
export function restockReading(params: {
  onHand: number;
  dailyDemand: number[];
  leadTime: number;
  serviceLevel: number;
}): RestockReading {
  const { onHand, dailyDemand, leadTime, serviceLevel } = params;
  const profile = demandProfile(dailyDemand);
  const m = profile?.mean ?? 0;
  const demandDays = dailyDemand.filter((v) => v > 0).length;
  const measured = profile !== null && demandDays >= MIN_DEMAND_DAYS;
  const leadTimeDemand = m * leadTime;
  const cover = daysOfCover(onHand, m);
  if (!measured || profile === null) {
    const z = serviceLevelZ(serviceLevel);
    return {
      mean: m,
      stdev: null,
      cv: null,
      demandDays,
      measured: false,
      daysOfCover: cover,
      leadTimeDemand,
      reorderPoint: null,
      safetyStock: null,
      stockoutProbability: null,
      needsReorder: z !== null && z >= 0 && onHand <= leadTimeDemand,
    };
  }
  const rop = reorderPoint({
    serviceLevel,
    avgDemandPerPeriod: profile.mean,
    demandStdev: profile.stdev,
    avgLeadTime: leadTime,
  });
  return {
    mean: profile.mean,
    stdev: profile.stdev,
    cv: profile.cv,
    demandDays,
    measured: true,
    daysOfCover: cover,
    leadTimeDemand,
    reorderPoint: rop?.reorderPoint ?? null,
    safetyStock: rop?.safetyStock ?? null,
    stockoutProbability: stockoutProbability({
      onHand,
      avgDemandPerPeriod: profile.mean,
      demandStdev: profile.stdev,
      leadTime,
    }),
    needsReorder: rop ? onHand <= rop.reorderPoint : false,
  };
}

/**
 * Fill rate (Type-2 service level): expected fraction of demand met from
 * stock. Uses the standard normal loss function
 *   E[shortage] = σ · (φ(z) - z·(1-Φ(z)))
 * fillRate = 1 - E[shortage]/expectedDemand.
 */
export function fillRate(params: {
  reorderPoint: number;
  avgLeadTimeDemand: number;
  leadTimeDemandStdev: number;
  demandPerCycle: number;
}): number | null {
  const {
    reorderPoint,
    avgLeadTimeDemand,
    leadTimeDemandStdev,
    demandPerCycle,
  } = params;
  if (leadTimeDemandStdev <= 0 || demandPerCycle <= 0) return null;
  const z = (reorderPoint - avgLeadTimeDemand) / leadTimeDemandStdev;
  const lossUnit = normalPdf(z) - z * (1 - normalCdf(z));
  const expectedShortage = leadTimeDemandStdev * lossUnit;
  return Math.max(0, Math.min(1, 1 - expectedShortage / demandPerCycle));
}

// ---------------------------------------------------------------------------
// Single-period (newsvendor) — event ordering
// ---------------------------------------------------------------------------

/**
 * Newsvendor critical fractile / optimal order quantity for a one-shot event
 * (NYE, a wine dinner) where leftover stock has salvage value and stockouts
 * cost margin.
 *   critical ratio = Cu / (Cu + Co)
 *     Cu = underage cost (lost margin per unit short) = price - cost
 *     Co = overage cost (per leftover unit) = cost - salvage
 * Optimal Q = μ + z·σ where z = Φ⁻¹(critical ratio), assuming normal demand.
 */
export function newsvendorOrder(params: {
  price: number;
  cost: number;
  salvage: number;
  demandMean: number;
  demandStdev: number;
}): {
  criticalRatio: number;
  optimalQuantity: number;
  z: number;
} | null {
  const cu = params.price - params.cost; // underage
  const co = params.cost - params.salvage; // overage
  if (cu + co <= 0) return null;
  const criticalRatio = cu / (cu + co);
  const z = normalInv(criticalRatio);
  if (z === null) return null;
  return {
    criticalRatio,
    optimalQuantity: params.demandMean + z * params.demandStdev,
    z,
  };
}

// ---------------------------------------------------------------------------
// Classification — ABC & XYZ
// ---------------------------------------------------------------------------

export interface AbcItem<T> {
  item: T;
  value: number;
}
export interface AbcResult<T> {
  item: T;
  value: number;
  cumulativePct: number;
  sharePct: number;
  class: "A" | "B" | "C";
}

/**
 * ABC (Pareto) classification by annual dollar-usage value. Sorts descending,
 * accumulates, and buckets into A/B/C by cumulative-value thresholds
 * (default 80% / 95%). Class A is the vital few to cycle-count weekly.
 */
export function abcClassify<T>(
  items: AbcItem<T>[],
  thresholds: { a?: number; b?: number } = {},
): AbcResult<T>[] {
  const aCut = thresholds.a ?? 0.8;
  const bCut = thresholds.b ?? 0.95;
  const positive = items.filter((i) => i.value > 0);
  const total = positive.reduce((s, i) => s + i.value, 0);
  if (total <= 0) {
    return items.map((i) => ({
      item: i.item,
      value: i.value,
      cumulativePct: 0,
      sharePct: 0,
      class: "C" as const,
    }));
  }
  const sorted = [...positive].sort((a, b) => b.value - a.value);
  let cum = 0;
  return sorted.map((i) => {
    cum += i.value;
    const cumulativePct = cum / total;
    const cls: "A" | "B" | "C" =
      cumulativePct <= aCut ? "A" : cumulativePct <= bCut ? "B" : "C";
    return {
      item: i.item,
      value: i.value,
      sharePct: i.value / total,
      cumulativePct,
      class: cls,
    };
  });
}

/**
 * XYZ classification by demand variability (coefficient of variation).
 * X = steady/predictable (CV ≤ 0.5), Y = variable (≤ 1.0), Z = erratic (>1.0).
 * Combine with ABC → a 9-box that tells you exactly which SKUs to
 * auto-reorder vs hand-manage.
 */
export function xyzClassify(cv: number | null): "X" | "Y" | "Z" | "unknown" {
  if (cv === null || !Number.isFinite(cv)) return "unknown";
  if (cv <= 0.5) return "X";
  if (cv <= 1.0) return "Y";
  return "Z";
}
