/**
 * What a till line cost when it sold, and what a check's margin reads from it
 * (r57, table side decision D4). Pure, so the arithmetic is tested without a
 * database.
 *
 * The cost of a line is written on its consumption row at the moment of sale.
 * A later invoice, a re-priced lot or a corrected unit price changes what the
 * next sale costs and nothing already sold: every reader of a check's cost and
 * margin reads the row, never the lot.
 */
import { resolveUnitCost } from "../analytics/inventory-cost";
import { glassCostFrom } from "../pricing/margin-to-target";

export type SaleCostBasis =
  | "invoice_lot_wac"
  | "invoice_lot_wac_partial"
  | "last_purchase_price";

/** The unit (one bottle) cost a sale was costed at, and where it came from. */
export interface SaleCostSource {
  unitCost: number;
  basis: SaleCostBasis;
  /** The oldest live costed lot: the one a pour draws from first. */
  lotId: string | null;
  /** The order (invoice) that lot arrived on, when it names one. */
  orderId: string | null;
}

/** The four columns a consumption row keeps for its cost. */
export interface CostSnapshot {
  cost_at_sale: number | null;
  cost_basis: SaleCostBasis | null;
  cost_source_lot_id: string | null;
  cost_source_order_id: string | null;
}

export const NO_COST_SNAPSHOT: CostSnapshot = {
  cost_at_sale: null,
  cost_basis: null,
  cost_source_lot_id: null,
  cost_source_order_id: null,
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

interface LotRow {
  id?: unknown;
  qty?: unknown;
  unit_cost?: unknown;
  cost_provenance?: unknown;
  source_order_id?: unknown;
  received_at?: unknown;
  stock_state?: unknown;
}

/**
 * The cost source for one inventory item: the recorded unit cost by the same
 * rule every other margin reader uses (invoiced lot WAC, else last purchase
 * price), and the oldest live lot that carries a cost as its source. Null when
 * the house has recorded no cost for the item.
 */
export function pickSaleCostSource(
  row: { last_purchase_price?: unknown } | null | undefined,
  rollup: Record<string, unknown> | null | undefined,
  lots: LotRow[] | null | undefined,
): SaleCostSource | null {
  const { unitCost, costBasis } = resolveUnitCost(row, rollup);
  if (unitCost === null || costBasis === "unknown") return null;
  let lotId: string | null = null;
  let orderId: string | null = null;
  if (costBasis !== "last_purchase_price") {
    const live = (lots ?? [])
      .filter(
        (l) =>
          (l.stock_state ?? "live") === "live" &&
          Number(l.qty) > 0 &&
          l.unit_cost != null &&
          l.cost_provenance !== "sample",
      )
      .sort((a, b) =>
        String(a.received_at ?? "").localeCompare(String(b.received_at ?? "")),
      );
    const first = live[0];
    if (first) {
      lotId = first.id ? String(first.id) : null;
      orderId = first.source_order_id ? String(first.source_order_id) : null;
    }
  }
  return { unitCost, basis: costBasis, lotId, orderId };
}

/**
 * The cost snapshot of one line. A whole-bottle line costs one bottle per unit
 * sold. A pour costs its share of the bottle: bottle cost x ml / bottle ml
 * (`glassCostFrom`), so a bottle's worth of pours costs the bottle. A line
 * with no recorded cost, or a pour from a bottle of unknown size, keeps no
 * cost: null, never 0.
 */
export function snapshotLineCost(
  source: SaleCostSource | null,
  mode: "whole_bottle" | "volume",
  volumeMl: number,
  bottleMl: number | null,
  qty: number,
): CostSnapshot {
  if (!source) return NO_COST_SNAPSHOT;
  const cost =
    mode === "whole_bottle"
      ? Number.isFinite(qty) && qty >= 0
        ? source.unitCost * qty
        : null
      : glassCostFrom(source.unitCost, volumeMl, bottleMl);
  if (cost === null || !Number.isFinite(cost)) return NO_COST_SNAPSHOT;
  return {
    cost_at_sale: round4(cost),
    cost_basis: source.basis,
    cost_source_lot_id: source.lotId,
    cost_source_order_id: source.orderId,
  };
}

// ---------------------------------------------------------------------------
// The reader: a check's cost of goods and margin, from the snapshots.
// ---------------------------------------------------------------------------

export interface ConsumptionCostRow {
  wine_name?: string | null;
  quantity?: number | null;
  volume_ml?: number | null;
  total_revenue?: number | string | null;
  cost_at_sale?: number | string | null;
  cost_basis?: string | null;
  notes?: string | null;
}

export interface CheckMarginLine {
  wine: string | null;
  volumeMl: number;
  revenue: number | null;
  cost: number | null;
  costKept: boolean;
  /** Why this line has no cost in the totals, in words; null when it has one. */
  costNote: string | null;
}

export interface CheckMargin {
  lines: CheckMarginLine[];
  /** Lines the till voided: they sold nothing and are not in any total. */
  voidedLines: number;
  /** Revenue and cost over the lines that have both. */
  revenue: number;
  cost: number;
  margin: number | null;
  marginPct: number | null;
  linesWithoutCost: number;
  /** What the owner reads; says outright when part of the check is unknown. */
  sentence: string;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * COGS and margin of a check from what each line cost when it sold. A row
 * with no snapshot (booked before costs were kept, or when no cost was
 * recorded) reads as "cost not kept" and is left out of the totals: it is
 * never costed at today's lot cost, which would let a later invoice move a
 * closed check's margin.
 */
export function checkMarginFromRows(rows: ConsumptionCostRow[]): CheckMargin {
  const lines: CheckMarginLine[] = [];
  let voidedLines = 0;
  let revenue = 0;
  let cost = 0;
  let linesWithoutCost = 0;
  for (const r of rows) {
    if (Number(r.quantity) === 0 && Number(r.volume_ml) === 0) {
      voidedLines++;
      continue;
    }
    const c = num(r.cost_at_sale);
    const rev = num(r.total_revenue);
    const costKept = c !== null;
    let costNote: string | null = null;
    if (!costKept) {
      linesWithoutCost++;
      costNote = "cost not kept";
    } else if (rev === null) {
      costNote = "price not kept";
    }
    if (costKept && rev !== null) {
      revenue += rev;
      cost += c as number;
    }
    lines.push({
      wine: r.wine_name ?? null,
      volumeMl: num(r.volume_ml) ?? 0,
      revenue: rev,
      cost: c,
      costKept,
      costNote,
    });
  }
  const counted = lines.filter((l) => l.costKept && l.revenue !== null).length;
  const margin = counted > 0 ? round4(revenue - cost) : null;
  const marginPct =
    margin !== null && revenue > 0
      ? Math.round((margin / revenue) * 1000) / 10
      : null;
  const unknown = lines.length - counted;
  const sentence =
    lines.length === 0
      ? "No wine lines on this check."
      : unknown === 0
        ? "Every line's cost was kept when it sold."
        : `Cost or price was not kept for ${unknown} of ${lines.length} line${lines.length === 1 ? "" : "s"}; the margin covers only the other ${counted}.`;
  return {
    lines,
    voidedLines,
    revenue: round4(revenue),
    cost: round4(cost),
    margin,
    marginPct,
    linesWithoutCost,
    sentence,
  };
}
