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
export type LineCostBasis = CostBasis | "size_not_known";

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
  /** Rounded to 2 decimals for display; null when unknown or untracked. */
  costPerServe: number | null;
  costBasis: LineCostBasis | null;
}

export interface RecipeCost {
  lines: LineCost[];
  perServe: number | null;
  priced: number;
  of: number;
  complete: boolean;
}

// One bottle or keg is the container `bottle_size_ml` measures. A case or a
// pack holds an unrecorded number of them, so its cost per ml is not known.
const CONTAINERS = new Set(["bottle", "keg"]);

/** Cost of one base unit of the line, from the item's cost per inventory unit; null when the sizes do not meet. */
export function costPerBaseUnit(item: CostItem, unitCost: number, baseUnit: BaseUnit): number | null {
  const uom = String(item.uom ?? "").toLowerCase();
  if (baseUnit === "ml10") {
    const size = Number(item.bottle_size_ml);
    if (CONTAINERS.has(uom)) return Number.isFinite(size) && size > 0 ? unitCost / (size * 10) : null;
    if (uom === "ml") return unitCost / 10;
    if (uom === "l") return unitCost / 10000;
    return null;
  }
  if (baseUnit === "mg") {
    if (uom === "mg") return unitCost;
    if (uom === "g") return unitCost / 1000;
    if (uom === "kg") return unitCost / 1000000;
    return null;
  }
  if (baseUnit === "each_milli" && uom === "each") return unitCost / 1000;
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function recipeCost(lines: CostLineInput[], yieldServes: number): RecipeCost {
  const serves = Number.isInteger(yieldServes) && yieldServes > 0 ? yieldServes : NaN;
  let sum = 0;
  let priced = 0;
  let of = 0;
  const out: LineCost[] = lines.map((line) => {
    if (line.role === "untracked") return { status: "untracked", costPerServe: null, costBasis: null };
    of += 1;
    if (!line.inventoryId || !line.item) return { status: "not_linked", costPerServe: null, costBasis: null };
    const { unitCost, costBasis } = resolveUnitCost(line.item, line.lot);
    if (unitCost == null) return { status: "linked", costPerServe: null, costBasis };
    const perBase = costPerBaseUnit(line.item, unitCost, line.baseUnit);
    if (perBase == null) return { status: "linked", costPerServe: null, costBasis: "size_not_known" };
    const cost = (Number(line.qtyBase) * perBase) / serves;
    if (!Number.isFinite(cost)) return { status: "linked", costPerServe: null, costBasis: "unknown" };
    sum += cost;
    priced += 1;
    return { status: "linked", costPerServe: round2(cost), costBasis };
  });
  const complete = of > 0 && priced === of;
  return { lines: out, perServe: complete ? round2(sum) : null, priced, of, complete };
}
