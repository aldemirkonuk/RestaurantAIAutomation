/**
 * Cost per serve of a recipe at today's prices (ADR 0360, F7). Pure: no
 * service imports, no I/O. Unknown stays null, never 0 (ADR 0051), and the
 * total exists only when every stocked line is linked and priced.
 */
import {
  CostBasis,
  InventoryCostRow,
  LotRollupRow,
  resolveUnitCost,
} from "../analytics/inventory-cost";

export type BaseUnit = "ml10" | "mg" | "each_milli";
export type LineStatus = "linked" | "not_linked" | "untracked";
/**
 * Why a linked line has no price, beside the cost bases (round 17, D6):
 * - size_not_known: a bottle or keg whose size the shelf does not say;
 * - pack_size_not_known: a case, pack, glass or shot measured in ml or g: the
 *   shelf does not say what one holds;
 * - unit_mismatch: the line is measured one way (volume, weight, pieces) and
 *   the shelf counts the item another way.
 */
export type LineCostBasis = CostBasis | "size_not_known" | "pack_size_not_known" | "unit_mismatch";

export interface CostItem extends InventoryCostRow {
  uom: string;
  bottle_size_ml?: number | string | null;
}

export interface CostLineInput {
  role: "stocked" | "untracked";
  inventoryId: string | null;
  qtyBase: number;
  baseUnit: BaseUnit;
  /** The linked house item, or null when it is not linked or not read. */
  item: CostItem | null;
  lot: LotRollupRow | null;
}

export interface LineCost {
  status: LineStatus;
  /**
   * For display, in cents. When the total is known the lines' cents add up to
   * it exactly (largest remainder), so a sheet never shows lines that disagree
   * with their total. Null when unknown or untracked.
   */
  costPerServe: number | null;
  /** The same cost at six places, unrounded by the display; null as above. */
  costPerServeExact: number | null;
  costBasis: LineCostBasis | null;
}

export interface RecipeCost {
  lines: LineCost[];
  /** Two places, the sum of the six-place line costs rounded once. */
  perServe: number | null;
  perServeExact: number | null;
  priced: number;
  of: number;
  complete: boolean;
  /** Priced lines whose average covers only part of the stock on hand. */
  partial: number;
}

// One bottle or keg is the container `bottle_size_ml` measures.
const CONTAINERS = new Set(["bottle", "keg"]);
// A case or pack holds an unrecorded number of bottles; a glass or shot an
// unrecorded volume. They are counted in pieces, so their size is not known.
const PACKS = new Set(["case", "pack", "glass", "shot"]);

/** Cost of one base unit of the line, or why it cannot be had. Never guessed. */
export function baseUnitCost(
  item: CostItem,
  unitCost: number,
  baseUnit: BaseUnit,
): { perBase: number } | { why: "size_not_known" | "pack_size_not_known" | "unit_mismatch" } {
  const uom = String(item.uom ?? "").toLowerCase();
  if (baseUnit === "ml10") {
    if (CONTAINERS.has(uom)) {
      const size = Number(item.bottle_size_ml);
      return Number.isFinite(size) && size > 0 ? { perBase: unitCost / (size * 10) } : { why: "size_not_known" };
    }
    if (uom === "ml") return { perBase: unitCost / 10 };
    if (uom === "l") return { perBase: unitCost / 10000 };
    if (PACKS.has(uom)) return { why: "pack_size_not_known" };
    return { why: "unit_mismatch" };
  }
  if (baseUnit === "mg") {
    if (uom === "mg") return { perBase: unitCost };
    if (uom === "g") return { perBase: unitCost / 1000 };
    if (uom === "kg") return { perBase: unitCost / 1000000 };
    if (PACKS.has(uom)) return { why: "pack_size_not_known" };
    return { why: "unit_mismatch" };
  }
  // A piece meets only a thing the shelf counts in pieces: one bottle of a
  // bottle item is never assumed, since "1 lime" linked to a case of limes
  // would cost the case.
  if (uom === "each") return { perBase: unitCost / 1000 };
  return { why: "unit_mismatch" };
}

/** Cost of one base unit of the line, from the item's cost per inventory unit; null when the sizes do not meet. */
export function costPerBaseUnit(item: CostItem, unitCost: number, baseUnit: BaseUnit): number | null {
  const r = baseUnitCost(item, unitCost, baseUnit);
  return "perBase" in r ? r.perBase : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Cents for each exact cost so they add up to the rounded total: floor every
 * line, then hand the cents left over to the largest remainders (ties to the
 * earlier line). Each line stays within a cent of its exact cost.
 */
function centsThatAddUp(exact: number[], totalCents: number): number[] {
  const raw = exact.map((x) => x * 100);
  const floors = raw.map((x) => Math.floor(x + 1e-9));
  let left = totalCents - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => ({ i, rem: x - floors[i] })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

export function recipeCost(lines: CostLineInput[], yieldServes: number): RecipeCost {
  const serves = Number.isInteger(yieldServes) && yieldServes > 0 ? yieldServes : NaN;
  let priced = 0;
  let of = 0;
  let partial = 0;
  const exact: Array<number | null> = [];
  const out: LineCost[] = lines.map((line) => {
    exact.push(null);
    if (line.role === "untracked") return { status: "untracked", costPerServe: null, costPerServeExact: null, costBasis: null };
    of += 1;
    if (!line.inventoryId || !line.item) {
      return { status: "not_linked", costPerServe: null, costPerServeExact: null, costBasis: null };
    }
    const { unitCost, costBasis } = resolveUnitCost(line.item, line.lot);
    if (unitCost == null) return { status: "linked", costPerServe: null, costPerServeExact: null, costBasis };
    const base = baseUnitCost(line.item, unitCost, line.baseUnit);
    if ("why" in base) return { status: "linked", costPerServe: null, costPerServeExact: null, costBasis: base.why };
    const cost = (Number(line.qtyBase) * base.perBase) / serves;
    if (!Number.isFinite(cost)) return { status: "linked", costPerServe: null, costPerServeExact: null, costBasis: "unknown" };
    exact[exact.length - 1] = cost;
    priced += 1;
    if (costBasis === "invoice_lot_wac_partial") partial += 1;
    return { status: "linked", costPerServe: round2(cost), costPerServeExact: round6(cost), costBasis };
  });
  const complete = of > 0 && priced === of;
  if (!complete) return { lines: out, perServe: null, perServeExact: null, priced, of, complete, partial };

  const sum = exact.reduce<number>((a, x) => a + (x ?? 0), 0);
  const perServe = round2(sum);
  const pricedAt = exact.map((x, i) => (x == null ? -1 : i)).filter((i) => i >= 0);
  const cents = centsThatAddUp(pricedAt.map((i) => exact[i] as number), Math.round(perServe * 100));
  pricedAt.forEach((i, k) => {
    out[i] = { ...out[i], costPerServe: cents[k] / 100 };
  });
  return { lines: out, perServe, perServeExact: round6(sum), priced, of, complete, partial };
}
