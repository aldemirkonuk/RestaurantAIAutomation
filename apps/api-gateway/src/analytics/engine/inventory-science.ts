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
 * WHY `leadTimeStdev` IS REQUIRED AND NULLABLE
 * --------------------------------------------
 * It used to be `leadTimeStdev?: number`, defaulting to 0. That default is the
 * σ_LT²-term silently vanishing: every caller in the repo omitted it, so the
 * "statistically correct safety stock most POS systems get wrong by ignoring
 * lead-time variance" was, in this repo, computed by ignoring lead-time
 * variance. The measurement existed the whole time — `getVendorScorecard`
 * computes per-vendor lead-time stdev and its own payload note said it "feeds
 * the King safety-stock formula" — it was simply never passed.
 *
 * An optional parameter cannot distinguish "lead time is perfectly reliable"
 * (σ_LT = 0, a real measurement) from "nobody measured it" (σ_LT unknown), and
 * those produce the same number while meaning opposite things. So the parameter
 * is now required and explicitly nullable: `null` means unmeasured, and the
 * result is a demand-only LOWER BOUND that `reorderPoint` labels as such.
 *
 * @param serviceLevel cycle service level in (0,1) — no default; see
 *   `serviceLevelFromCosts` for deriving one from real overage/underage costs.
 * @param leadTimeStdev σ_LT in the same period units as `avgLeadTime`, or
 *   `null` when lead-time variance has not been measured.
 */
export function safetyStock(params: {
  serviceLevel: number;
  avgDemandPerPeriod: number;
  demandStdev: number;
  avgLeadTime: number;
  leadTimeStdev: number | null;
}): number | null {
  const z = serviceLevelZ(params.serviceLevel);
  if (z === null) return null;
  // null → the term drops out, but reorderPoint reports that it did.
  const sigmaLT = params.leadTimeStdev ?? 0;
  // Validation used to be asymmetric: σ_LT rejected negatives while
  // `demandStdev: -1` sailed through and returned a number, because the
  // formula squares it. A negative standard deviation is not a small input
  // error, it is a caller that has lost track of its own units.
  if (
    !Number.isFinite(sigmaLT) ||
    sigmaLT < 0 ||
    !Number.isFinite(params.demandStdev) ||
    params.demandStdev < 0 ||
    !Number.isFinite(params.avgDemandPerPeriod) ||
    params.avgDemandPerPeriod < 0 ||
    !Number.isFinite(params.avgLeadTime) ||
    params.avgLeadTime < 0
  )
    return null;
  const variance =
    params.avgLeadTime * params.demandStdev ** 2 +
    params.avgDemandPerPeriod ** 2 * sigmaLT ** 2;
  if (variance < 0) return null;
  return z * Math.sqrt(variance);
}

export interface ReorderPointResult {
  reorderPoint: number;
  safetyStock: number;
  leadTimeDemand: number;
  /**
   * False when `leadTimeStdev` was null — the σ_LT² term is absent, so
   * `safetyStock` is a lower bound on the correct figure, not the figure.
   * A caller that prints the number without printing this is reporting an
   * unmeasured input as a measured zero.
   */
  leadTimeVarianceIncluded: boolean;
  /** Φ⁻¹(serviceLevel). Negative whenever the service level is below 0.5. */
  z: number;
  /**
   * True when z < 0, i.e. the service level is below 50% and the model is
   * saying **hold less than lead-time demand** — plan to stock out more often
   * than not, because carrying a spare costs more than missing a sale.
   *
   * WHY THIS FLAG EXISTS. It is a real newsvendor answer, not an error, and it
   * is reachable the moment the service level stops being pinned at 0.95:
   * Cu < Co gives CR < 0.5. But it makes `safetyStock` NEGATIVE and can make
   * `reorderPoint` negative too, and `qty <= negativeReorderPoint` is false
   * for every non-negative quantity — so without this flag the SKU drops off
   * the reorder list *silently*, wearing an otherwise healthy-looking result.
   * A caller must either surface it or floor it deliberately; it must not
   * discover it by noticing an empty list.
   */
  understockOptimal: boolean;
}

/**
 * Reorder point = expected demand over lead time + safety stock.
 * The stock level that should trigger a purchase order.
 *
 * `reorderPoint` and `safetyStock` are returned UNFLOORED — a negative value
 * is the model's actual answer and flooring it here would hide the regime
 * change. `understockOptimal` says when you are in it.
 */
export function reorderPoint(params: {
  serviceLevel: number;
  avgDemandPerPeriod: number;
  demandStdev: number;
  avgLeadTime: number;
  leadTimeStdev: number | null;
}): ReorderPointResult | null {
  const ss = safetyStock(params);
  if (ss === null) return null;
  const z = serviceLevelZ(params.serviceLevel);
  if (z === null) return null;
  const leadTimeDemand = params.avgDemandPerPeriod * params.avgLeadTime;
  return {
    reorderPoint: leadTimeDemand + ss,
    safetyStock: ss,
    leadTimeDemand,
    leadTimeVarianceIncluded: params.leadTimeStdev != null,
    z,
    understockOptimal: z < 0,
  };
}

// ---------------------------------------------------------------------------
// Lead-time observation profile
// ---------------------------------------------------------------------------

export interface LeadTimeProfile {
  /** Mean observed order→delivery time, in days. */
  meanDays: number;
  /**
   * Sample standard deviation, or `null` with fewer than two observations.
   * `null` is not 0: one delivery tells you nothing about variability, and
   * reporting 0 there is the exact error this module exists to avoid.
   */
  stdevDays: number | null;
  /** Observations the profile was built from. */
  n: number;
  /**
   * Relative standard error of `stdevDays` — how much of it is sampling noise.
   * For a normal sample, SE(σ̂)/σ ≈ 1/√(2(n−1)): **70.7% at n = 2**, 50% at
   * n = 3, 22% at n = 11. `null` when `stdevDays` is.
   *
   * WHY THIS IS A COMPUTED FACT AND NOT A THRESHOLD. `n ≥ 2` is the only gate
   * here, and it is not a policy — it is the definition of a sample standard
   * deviation. Any gate ABOVE 2 ("trust σ_LT only from 5 deliveries") is a
   * policy number nobody has chosen, so this reports the uncertainty instead
   * of inventing a cutoff. It matters because the King formula SQUARES σ_LT
   * and multiplies it by d̄²: at n = 2 that term carries roughly a 3× spread
   * of its own, with nothing on the surface saying so. When the founder wants
   * a cutoff, this is the number to set it against.
   */
  stdevRelativeStandardError: number | null;
}

/**
 * Build a lead-time profile from observed order→delivery durations in days.
 *
 * Pure, so the same derivation can back both the vendor scorecard and the
 * safety-stock call without the two drifting apart — which is how the
 * scorecard ended up computing a σ_LT that nothing consumed.
 */
export function leadTimeProfile(
  observedDays: number[],
): LeadTimeProfile | null {
  const clean = observedDays.filter((d) => Number.isFinite(d) && d >= 0);
  if (clean.length === 0) return null;
  const m = mean(clean);
  if (m === null) return null;
  const sd = stdev(clean, true);
  return {
    meanDays: m,
    stdevDays: sd,
    n: clean.length,
    stdevRelativeStandardError:
      sd === null ? null : 1 / Math.sqrt(2 * (clean.length - 1)),
  };
}

// ---------------------------------------------------------------------------
// Service level from real costs — the critical ratio
// ---------------------------------------------------------------------------

export type ServiceLevelUnavailableReason =
  /** No usable menu price, so the margin lost per unit short is unknown. */
  | "unit_price_unknown"
  /** No recorded cost (ADR 0051) — both Cu and Co need it. */
  | "unit_cost_unknown"
  /** Price ≤ cost: the item loses money per unit sold, so Cu ≤ 0. */
  | "underage_not_positive"
  /** Co ≤ 0 (e.g. an invoiced cost of exactly 0 — a sample bottle). */
  | "overage_not_positive"
  /** No replenishment cycle length, so holding cost per cycle is unknown. */
  | "cycle_length_unknown";

export interface ServiceLevelFromCosts {
  ok: true;
  /**
   * Cu / (Cu + Co) — the newsvendor critical ratio, used as the cycle service
   * level. Strictly inside (0,1), so `serviceLevelZ` is always finite.
   */
  serviceLevel: number;
  /** Cu — contribution margin forgone on one unit of unmet demand. */
  underageCost: number;
  /** Co — cost of carrying one excess unit for one replenishment cycle. */
  overageCost: number;
  /** The cycle Co was accrued over. */
  cycleDays: number;
}

export interface ServiceLevelUnavailable {
  ok: false;
  reason: ServiceLevelUnavailableReason;
}

export type ServiceLevelResult =
  | ServiceLevelFromCosts
  | ServiceLevelUnavailable;

/**
 * Derive a cycle service level from what over- and under-stocking actually
 * cost, instead of asserting one.
 *
 *   Cu = unitPrice − unitCost      margin lost on a unit of unmet demand
 *   Co = unitCost × h × cycle/365  cost of holding one excess unit a cycle
 *   CR = Cu / (Cu + Co)
 *
 * A hardcoded 0.95 is not a policy, it is a claim: it asserts Cu/Co = 19 for
 * every SKU simultaneously. On a bottle costing $20, held at 26%/yr on a
 * 30-day cycle, Co ≈ $0.43, so 0.95 asserts a lost margin of $8.12 on every
 * item — true for some of the list and false for the rest, and never checked.
 *
 * Returns a REASON rather than a number when an input is missing. There is no
 * fallback constant here on purpose (ADR 0051): a service level invented to
 * keep a column populated is exactly the fabrication the null exists to
 * prevent, and it propagates into an order quantity someone will pay for.
 */
export function serviceLevelFromCosts(params: {
  unitPrice: number | null;
  unitCost: number | null;
  /** Fraction of unit value per year: capital + storage + spoilage. */
  annualHoldingRate: number;
  /** Length of one replenishment cycle in days (e.g. EOQ cycle time × 365). */
  cycleDays: number | null;
}): ServiceLevelResult {
  const { unitPrice, unitCost, annualHoldingRate, cycleDays } = params;
  if (unitCost == null || !Number.isFinite(unitCost))
    return { ok: false, reason: "unit_cost_unknown" };
  // `menu_price_current` is coerced with `|| 0` upstream, so 0 here means
  // "no price recorded", not "given away free".
  if (unitPrice == null || !Number.isFinite(unitPrice) || unitPrice <= 0)
    return { ok: false, reason: "unit_price_unknown" };
  if (cycleDays == null || !Number.isFinite(cycleDays) || cycleDays <= 0)
    return { ok: false, reason: "cycle_length_unknown" };

  const underageCost = unitPrice - unitCost;
  if (underageCost <= 0) return { ok: false, reason: "underage_not_positive" };

  const overageCost = carryingCost(unitCost, annualHoldingRate, cycleDays);
  // Co = 0 sends the critical ratio to exactly 1 and z to infinity. It happens
  // for real: receiving records sample bottles at an invoiced cost of 0.
  if (!(overageCost > 0)) return { ok: false, reason: "overage_not_positive" };

  return {
    ok: true,
    serviceLevel: underageCost / (underageCost + overageCost),
    underageCost,
    overageCost,
    cycleDays,
  };
}

// ---------------------------------------------------------------------------
// Order-shaping constraints — case packs and shelf life
// ---------------------------------------------------------------------------

export type PackRoundingResult =
  | {
      ok: true;
      /** Whole packs to order. */
      packs: number;
      /** packs × unitsPerPack — what will actually arrive. */
      units: number;
      unitsPerPack: number;
      /** units − requested; always ≥ 0. */
      overshoot: number;
    }
  | { ok: false; reason: "pack_size_unknown" | "bad_quantity" };

/**
 * Round an order quantity up to whole purchase units. You cannot order 1.4
 * cases.
 *
 * Refuses when the pack size is unknown, matching
 * `procurement/order-units.ts:173-183`: guessing 12 orders twelve times the
 * intent, guessing 1 orders a twelfth of it, and neither is knowledge.
 *
 * All three tables that store one — `vendor_price_observations`,
 * `vendor_portal_listings` and `procurement_document_lines` — declare it
 * `pack_size integer DEFAULT 1 NOT NULL`, so an unrecorded pack arrives from
 * the database looking exactly like a genuine single. The caller, not this
 * function, has to know whether its 1 was recorded or defaulted; passing the
 * column through unchecked is how an absence becomes a measurement.
 */
export function roundUpToPack(
  requestedUnits: number,
  unitsPerPack: number | null,
): PackRoundingResult {
  if (!Number.isFinite(requestedUnits) || requestedUnits < 0)
    return { ok: false, reason: "bad_quantity" };
  if (
    unitsPerPack == null ||
    !Number.isFinite(unitsPerPack) ||
    !Number.isInteger(unitsPerPack) ||
    unitsPerPack < 1
  )
    return { ok: false, reason: "pack_size_unknown" };
  const packs = Math.ceil(requestedUnits / unitsPerPack);
  const units = packs * unitsPerPack;
  return {
    ok: true,
    packs,
    units,
    unitsPerPack,
    overshoot: units - requestedUnits,
  };
}

export type ShelfLifeCapResult =
  | {
      ok: true;
      /** min(proposed, what will sell before it spoils). */
      cappedUnits: number;
      /** True when shelf life, not demand, set the quantity. */
      capped: boolean;
      /** avgDailyDemand × shelfLifeDays. */
      unitsSoldWithinShelfLife: number;
    }
  | { ok: false; reason: "shelf_life_unknown" | "demand_unknown" };

/**
 * Cap an order at what will sell before it spoils.
 *
 * TYPED SEAM, NOT A LIVE CONSTRAINT. Nothing in this repo records shelf life:
 * `restaurant_inventory` has no shelf-life, expiry or best-before column, and
 * the only `valid_until` in the schema is a vendor-promotion end date
 * (`supabase/migrations/20260807001252_distributor_geo_foundation.sql:123`).
 * So every caller today passes `null` and gets `shelf_life_unknown`. The
 * function exists so that the day a shelf-life column lands there is one
 * place to wire it, and so the absence is visible in the payload rather than
 * silently equivalent to "nothing ever spoils".
 */
export function shelfLifeCap(params: {
  proposedUnits: number;
  avgDailyDemand: number;
  shelfLifeDays: number | null;
}): ShelfLifeCapResult {
  const { proposedUnits, avgDailyDemand, shelfLifeDays } = params;
  if (
    shelfLifeDays == null ||
    !Number.isFinite(shelfLifeDays) ||
    shelfLifeDays <= 0
  )
    return { ok: false, reason: "shelf_life_unknown" };
  if (!Number.isFinite(avgDailyDemand) || avgDailyDemand <= 0)
    return { ok: false, reason: "demand_unknown" };
  const unitsSoldWithinShelfLife = avgDailyDemand * shelfLifeDays;
  const cappedUnits = Math.min(proposedUnits, unitsSoldWithinShelfLife);
  return {
    ok: true,
    cappedUnits,
    capped: cappedUnits < proposedUnits,
    unitsSoldWithinShelfLife,
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
