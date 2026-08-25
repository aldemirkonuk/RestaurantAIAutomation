/**
 * Cost basis for margin and pricing.
 *
 * Two different questions, two different numbers, on purpose:
 *
 *   latest_lot        what would it cost to replace this bottle today?
 *   weighted_average  what did the bottles I actually hold cost me?
 *
 * The pricing recommendation uses latest_lot, because a price set against a
 * cheap lot bought eight months ago starts losing money the moment that lot
 * runs out. Reported margin uses weighted_average, because that is what
 * matches COGS and what an accountant will reconcile against.
 *
 * They will disagree, visibly, on the same screen whenever cost has moved.
 * That is the intended behaviour and the disagreement is the signal — a wide
 * gap between the two means cost has drifted and the current price was set
 * against a basis that no longer exists.
 *
 * Relationship to finance.weightedAverageCost
 * -------------------------------------------
 * finance.ts already has weightedAverageCost(lots) — the plain arithmetic over
 * {qty, unitCost} pairs, returning a bare number. It stays; this module does
 * not replace it and calls the same maths.
 *
 * weightedAverageCostBasis() here differs in the three ways that matter
 * against real inventory_lots rows rather than clean inputs: unit_cost is
 * frequently null, lots carry a status so depleted ones must not count toward
 * current cost, and the caller needs to know how much of the stock the answer
 * actually covers. Use finance's when you have complete data and want a
 * number; use this one when reading from the database.
 *
 * Partial cost coverage is reported, never silently averaged away
 * ---------------------------------------------------------------
 * Lots with no unit_cost cannot be included in either number. The naive
 * implementation averages over whichever lots happen to have costs and returns
 * a confident figure computed from half the inventory. Every function here
 * returns coverage alongside the number so the caller can say "based on 3 of 7
 * lots" instead of implying it knows more than it does.
 */

/** A lot as this module needs it — a narrow view of inventory_lots. */
export interface CostLot {
  unitCost: number | null | undefined;
  /** Units remaining in the lot (inventory_lots.qty). */
  qty: number | null | undefined;
  receivedAt?: string | Date | null;
  /** inventory_lots.status — only open/active lots inform current cost. */
  status?: string | null;
}

export type CostBasisMethod = "latest_lot" | "weighted_average";

export interface CostBasisResult {
  cost: number | null;
  method: CostBasisMethod;
  /** Lots that contributed a cost. */
  lotsUsed: number;
  /** Lots considered (after status filtering). */
  lotsTotal: number;
  /** Units represented by the costed lots. */
  qtyCovered: number;
  /** Units across all considered lots. */
  qtyTotal: number;
  /** qtyCovered / qtyTotal, or null when there is nothing to cover. */
  coverage: number | null;
  note: string;
}

/** Statuses that represent stock still on hand. */
const LIVE_STATUSES = new Set(["open", "active", "on_hand", "available"]);

function isLive(lot: CostLot): boolean {
  if (lot.status === null || lot.status === undefined) return true;
  return LIVE_STATUSES.has(String(lot.status).toLowerCase());
}

function hasCost(lot: CostLot): boolean {
  return (
    typeof lot.unitCost === "number" &&
    Number.isFinite(lot.unitCost) &&
    lot.unitCost > 0
  );
}

function qtyOf(lot: CostLot): number {
  const q =
    typeof lot.qty === "number" && Number.isFinite(lot.qty) ? lot.qty : 0;
  return q > 0 ? q : 0;
}

function receivedTime(lot: CostLot): number {
  if (!lot.receivedAt) return 0;
  const t = new Date(lot.receivedAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Lots that count toward current cost: live status, positive quantity. */
export function liveLots(lots: CostLot[]): CostLot[] {
  return lots.filter((l) => isLive(l) && qtyOf(l) > 0);
}

/**
 * Replacement cost: the unit cost of the most recently received lot that has
 * one. Lots without a cost are skipped rather than treated as free, so this
 * falls back through the receipt history until it finds a real number.
 */
export function latestLotCost(lots: CostLot[]): CostBasisResult {
  const considered = liveLots(lots);
  const costed = considered.filter(hasCost);
  const qtyTotal = considered.reduce((a, l) => a + qtyOf(l), 0);
  // Coverage for this method is the newest lot's own quantity, not the sum
  // across all costed lots — this basis is a single lot's price, and claiming
  // the coverage of every costed lot would overstate what it represents.

  if (costed.length === 0) {
    return {
      cost: null,
      method: "latest_lot",
      lotsUsed: 0,
      lotsTotal: considered.length,
      qtyCovered: 0,
      qtyTotal,
      coverage: qtyTotal > 0 ? 0 : null,
      note:
        considered.length === 0
          ? "No live lots on hand, so there is no cost basis."
          : `None of the ${considered.length} live lot(s) has a unit cost recorded.`,
    };
  }

  const newest = costed.reduce((best, l) =>
    receivedTime(l) >= receivedTime(best) ? l : best,
  );

  return {
    cost: newest.unitCost as number,
    method: "latest_lot",
    lotsUsed: 1,
    lotsTotal: considered.length,
    qtyCovered: qtyOf(newest),
    qtyTotal,
    coverage: qtyTotal > 0 ? qtyOf(newest) / qtyTotal : null,
    note: `Replacement cost from the most recent costed lot${
      costed.length < considered.length
        ? ` (${considered.length - costed.length} live lot(s) have no cost recorded)`
        : ""
    }.`,
  };
}

/**
 * Weighted-average cost across live, costed lots. This is the COGS-aligned
 * number and the one reported margin should use.
 */
export function weightedAverageCostBasis(lots: CostLot[]): CostBasisResult {
  const considered = liveLots(lots);
  const costed = considered.filter(hasCost);
  const qtyTotal = considered.reduce((a, l) => a + qtyOf(l), 0);
  const qtyCovered = costed.reduce((a, l) => a + qtyOf(l), 0);

  if (costed.length === 0 || qtyCovered === 0) {
    return {
      cost: null,
      method: "weighted_average",
      lotsUsed: 0,
      lotsTotal: considered.length,
      qtyCovered: 0,
      qtyTotal,
      coverage: qtyTotal > 0 ? 0 : null,
      note:
        considered.length === 0
          ? "No live lots on hand, so there is no cost basis."
          : `None of the ${considered.length} live lot(s) has a unit cost recorded.`,
    };
  }

  const total = costed.reduce(
    (acc, l) => acc + (l.unitCost as number) * qtyOf(l),
    0,
  );
  const coverage = qtyTotal > 0 ? qtyCovered / qtyTotal : null;

  return {
    cost: total / qtyCovered,
    method: "weighted_average",
    lotsUsed: costed.length,
    lotsTotal: considered.length,
    qtyCovered,
    qtyTotal,
    coverage,
    note:
      coverage !== null && coverage < 1
        ? `Weighted average over ${costed.length} of ${considered.length} live lot(s), covering ${(coverage * 100).toFixed(0)}% of units on hand — the uncosted remainder is excluded, not assumed free.`
        : `Weighted average over all ${costed.length} live lot(s).`,
  };
}

export function costBasis(
  lots: CostLot[],
  method: CostBasisMethod,
): CostBasisResult {
  return method === "latest_lot"
    ? latestLotCost(lots)
    : weightedAverageCostBasis(lots);
}

export interface CostDrift {
  latest: number | null;
  weightedAverage: number | null;
  /** latest - weightedAverage. Positive means replacement cost has risen. */
  absolute: number | null;
  /** As a fraction of the weighted average. */
  relative: number | null;
  note: string;
}

/**
 * The gap between the two bases.
 *
 * This is the number that says "the price on this bottle was set against a
 * cost that no longer exists". A large positive drift means every replacement
 * bottle earns less than the reported margin suggests, which is precisely the
 * condition a margin report computed from average cost will not show you.
 */
export function costDrift(lots: CostLot[]): CostDrift {
  const latest = latestLotCost(lots).cost;
  const wavg = weightedAverageCostBasis(lots).cost;

  if (latest === null || wavg === null || wavg === 0) {
    return {
      latest,
      weightedAverage: wavg,
      absolute: null,
      relative: null,
      note: "Not enough cost data on hand to compare replacement cost against the average.",
    };
  }

  const absolute = latest - wavg;
  const relative = absolute / wavg;
  return {
    latest,
    weightedAverage: wavg,
    absolute,
    relative,
    note:
      Math.abs(relative) < 0.01
        ? "Replacement cost matches the average held cost."
        : relative > 0
          ? `Replacement cost is ${(relative * 100).toFixed(1)}% above the average held cost — margin on the next bottle is thinner than the reported figure.`
          : `Replacement cost is ${(Math.abs(relative) * 100).toFixed(1)}% below the average held cost — margin on the next bottle is better than reported.`,
  };
}
