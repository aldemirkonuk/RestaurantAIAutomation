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
  /** What one piece of the good weighs, in g, as the house stated it (r28 gap 7). */
  piece_grams?: number | string | null;
  /** What one ml of the good weighs, in g, as the house stated it (r28 gap 7). */
  ml_grams?: number | string | null;
}

/**
 * The statement a line waits for when it is measured one way and the good is
 * kept another, and only the house can say how the two meet (r28 gap 7):
 * - piece_grams: a piece against a weighed good, or a weight against a good
 *   counted in pieces: what one weighs;
 * - ml_grams: a volume against a weighed good, or a weight against a good
 *   kept by volume: what one ml weighs.
 * The cost basis stays `unit_mismatch` beside it, so a reader that does not
 * know this field still says the line is measured another way.
 */
export type BridgeNeeded = "piece_grams" | "ml_grams";

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
   * For display: the six-place cost rounded to the cent on its own, so two
   * lines that cost the same always read the same, and each is within half a
   * cent of what it costs. The lines are not forced to add up to the total,
   * which is the exact sum rounded once: they can differ from it by a cent or
   * so, as any rounded column does. A line under half a cent reads 0 here;
   * `costPerServeExact` says it is not free. Null when unknown or untracked.
   */
  costPerServe: number | null;
  /** The same cost at six places, unrounded by the display; null as above. */
  costPerServeExact: number | null;
  costBasis: LineCostBasis | null;
  /** Set only on a unit_mismatch the house can close by stating a weight. */
  needs?: BridgeNeeded;
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

type Why = "size_not_known" | "pack_size_not_known" | "unit_mismatch";
type BaseCost = { perBase: number } | { why: Why; needs?: BridgeNeeded };

const WEIGHTS = new Set(["mg", "g", "kg"]);

/** A stated weight (g) the bridge may use: a finite number above 0, else none. */
function stated(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  // "" reads as 0, so it is not stated either.
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The cost of one base unit by the good's own unit alone, with no stated weight. */
function directCost(uom: string, item: CostItem, unitCost: number, baseUnit: BaseUnit): BaseCost {
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

/**
 * Cost of one base unit of the line, or why it cannot be had. Never guessed.
 *
 * Where the line and the good are measured differently, the line is priced
 * through a weight the house stated for that very good, and through nothing
 * else: no table of what an egg or a lemon usually weighs (r28 gap 7).
 * - a piece (each_milli) of a weighed good: one piece is `piece_grams` g;
 * - a weight (mg) of a good counted in pieces: the same, the other way;
 * - a volume (ml10) of a weighed good: one ml is `ml_grams` g;
 * - a weight (mg) of a good kept by volume (ml, l, or a bottle or keg of
 *   known size): the same, the other way.
 * Each missing statement is named in `needs`. A piece of a liquid, or a
 * volume of a good counted in pieces, is still a mismatch: what closes it is
 * a pack size, not a weight.
 */
export function baseUnitCost(item: CostItem, unitCost: number, baseUnit: BaseUnit): BaseCost {
  const uom = String(item.uom ?? "").toLowerCase();
  const direct = directCost(uom, item, unitCost, baseUnit);
  // Only a mismatch is bridged; a pack or a bottle of no stated size keeps
  // its own reason, since no branch below takes a pack, and a bottle of no
  // size is answered before any weight is read.
  if ("perBase" in direct) return direct;

  if (baseUnit === "each_milli" && WEIGHTS.has(uom)) {
    const pieceG = stated(item.piece_grams);
    if (pieceG === null) return { why: "unit_mismatch", needs: "piece_grams" };
    // One thousandth of a piece weighs pieceG mg.
    const perMg = directCost(uom, item, unitCost, "mg") as { perBase: number };
    return { perBase: perMg.perBase * pieceG };
  }
  if (baseUnit === "mg" && uom === "each") {
    const pieceG = stated(item.piece_grams);
    if (pieceG === null) return { why: "unit_mismatch", needs: "piece_grams" };
    // One piece is pieceG x 1,000 mg.
    return { perBase: unitCost / (pieceG * 1000) };
  }
  if (baseUnit === "ml10" && WEIGHTS.has(uom)) {
    const mlG = stated(item.ml_grams);
    if (mlG === null) return { why: "unit_mismatch", needs: "ml_grams" };
    // A tenth of a ml weighs mlG x 100 mg.
    const perMg = directCost(uom, item, unitCost, "mg") as { perBase: number };
    return { perBase: perMg.perBase * mlG * 100 };
  }
  if (baseUnit === "mg" && (uom === "ml" || uom === "l" || CONTAINERS.has(uom))) {
    const perMl10 = directCost(uom, item, unitCost, "ml10");
    // A bottle of no stated size says so first: a weight cannot help it.
    if (!("perBase" in perMl10)) return perMl10;
    const mlG = stated(item.ml_grams);
    if (mlG === null) return { why: "unit_mismatch", needs: "ml_grams" };
    // One mg is 1 / (mlG x 100) tenths of a ml.
    return { perBase: perMl10.perBase / (mlG * 100) };
  }
  return direct;
}

/** Cost of one base unit of the line, from the item's cost per inventory unit; null when the sizes do not meet. */
export function costPerBaseUnit(item: CostItem, unitCost: number, baseUnit: BaseUnit): number | null {
  const r = baseUnitCost(item, unitCost, baseUnit);
  return "perBase" in r ? r.perBase : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

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
    if ("why" in base) {
      const out: LineCost = { status: "linked", costPerServe: null, costPerServeExact: null, costBasis: base.why };
      if (base.needs) out.needs = base.needs;
      return out;
    }
    const cost = (Number(line.qtyBase) * base.perBase) / serves;
    if (!Number.isFinite(cost)) return { status: "linked", costPerServe: null, costPerServeExact: null, costBasis: "unknown" };
    exact[exact.length - 1] = cost;
    priced += 1;
    if (costBasis === "invoice_lot_wac_partial") partial += 1;
    // Cents from the six-place figure, so two lines that cost the same to six
    // places never fall on different sides of a half cent.
    return { status: "linked", costPerServe: round2(round6(cost)), costPerServeExact: round6(cost), costBasis };
  });
  const complete = of > 0 && priced === of;
  if (!complete) return { lines: out, perServe: null, perServeExact: null, priced, of, complete, partial };

  const sum = exact.reduce<number>((a, x) => a + (x ?? 0), 0);
  return { lines: out, perServe: round2(round6(sum)), perServeExact: round6(sum), priced, of, complete, partial };
}
