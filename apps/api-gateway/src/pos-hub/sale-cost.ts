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

/** Written only by restate_sale_cost, when a verified invoice moves a sale's cost. */
export const RESTATED_BASIS = "invoice_restated";

/** The unit (one bottle) cost a sale was costed at, and where it came from. */
export interface SaleCostSource {
  unitCost: number;
  basis: SaleCostBasis;
  /** The oldest live costed lot: the one a pour draws from first. */
  lotId: string | null;
  /** The order (invoice) that lot arrived on, when it names one. */
  orderId: string | null;
  /**
   * r109 g1: every live lot the unit cost was read over, so each delivery's
   * paper restates its own share of the WAC. Null when there were none, or
   * when there were more than COST_PARTS_CAP (then `partsCapped`).
   */
  parts: CostPart[] | null;
  /** More live lots than COST_PARTS_CAP: the row keeps no parts and is never restated. */
  partsCapped: boolean;
}

/** One live lot on the shelf at sale: what a paper restates, part by part. */
export interface CostPart {
  order_id: string | null;
  /** The delivery that booked the lot: one order can arrive as two, each with its own paper. */
  delivery_id: string | null;
  lot_id: string | null;
  qty: number;
  unit_cost: number;
  /** The lot's cost came from a checked paper (cost_provenance = invoice). */
  invoiced: boolean;
}

/** A sale keeps at most this many parts; past it, it says it cannot be restated. */
export const COST_PARTS_CAP = 20;

/** The four columns a consumption row keeps for its cost. */
export interface CostSnapshot {
  cost_at_sale: number | null;
  cost_basis: SaleCostBasis | null;
  /** One whole bottle's cost the line was costed at; a verified invoice restates from it. */
  cost_unit_at_sale: number | null;
  cost_source_lot_id: string | null;
  cost_source_order_id: string | null;
  /** r109 g1: the shelf the unit cost was read over (restate_sale_cost v2). */
  cost_parts: CostPart[] | null;
  cost_parts_capped: boolean;
}

export const NO_COST_SNAPSHOT: CostSnapshot = {
  cost_at_sale: null,
  cost_basis: null,
  cost_unit_at_sale: null,
  cost_source_lot_id: null,
  cost_source_order_id: null,
  cost_parts: null,
  cost_parts_capped: false,
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

interface LotRow {
  id?: unknown;
  qty?: unknown;
  unit_cost?: unknown;
  cost_provenance?: unknown;
  source_order_id?: unknown;
  delivery_id?: unknown;
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
  let parts: CostPart[] | null = null;
  let partsCapped = false;
  {
    // The oldest live costed lot is named whatever the basis: a line costed at
    // the last price paid still came off a delivery, and the invoice that
    // verifies that delivery restates the line (r102).
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
    // r109 g1: the same live lots the rollup's WAC is read over (live, priced,
    // not a sample), each with its own qty and cost. A paper replaces its own
    // order's part, so a lot spent before its paper is checked still restates.
    if (live.length > COST_PARTS_CAP) partsCapped = true;
    else if (live.length > 0)
      parts = live.map((l) => ({
        order_id: l.source_order_id ? String(l.source_order_id) : null,
        delivery_id: l.delivery_id ? String(l.delivery_id) : null,
        lot_id: l.id ? String(l.id) : null,
        qty: Number(l.qty),
        unit_cost: Number(l.unit_cost),
        invoiced: l.cost_provenance === "invoice",
      }));
  }
  return {
    unitCost,
    basis: costBasis,
    lotId,
    orderId,
    parts,
    partsCapped,
  };
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
    cost_unit_at_sale: source.unitCost,
    cost_source_lot_id: source.lotId,
    cost_source_order_id: source.orderId,
    cost_parts: source.parts ?? null,
    cost_parts_capped: source.partsCapped ?? false,
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
  /** A verified invoice moved this line's cost off the delivery's estimate. */
  restated: boolean;
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
  /** Lines whose cost a verified invoice restated. */
  restatedLines: number;
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
  let restatedLines = 0;
  for (const r of rows) {
    if (Number(r.quantity) === 0 && Number(r.volume_ml) === 0) {
      voidedLines++;
      continue;
    }
    const c = num(r.cost_at_sale);
    const rev = num(r.total_revenue);
    const costKept = c !== null;
    let costNote: string | null = null;
    const restated = costKept && r.cost_basis === RESTATED_BASIS;
    if (restated) restatedLines++;
    if (!costKept) {
      linesWithoutCost++;
      costNote = "cost not kept";
    } else if (rev === null) {
      costNote = "price not kept";
    } else if (restated) {
      costNote = "cost restated to the invoice";
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
      restated,
    });
  }
  const counted = lines.filter((l) => l.costKept && l.revenue !== null).length;
  const margin = counted > 0 ? round4(revenue - cost) : null;
  const marginPct =
    margin !== null && revenue > 0
      ? Math.round((margin / revenue) * 1000) / 10
      : null;
  const unknown = lines.length - counted;
  const base =
    lines.length === 0
      ? "No wine lines on this check."
      : unknown === 0
        ? "Every line's cost was kept when it sold."
        : `Cost or price was not kept for ${unknown} of ${lines.length} line${lines.length === 1 ? "" : "s"}; the margin covers only the other ${counted}.`;
  const sentence =
    restatedLines > 0
      ? `${base} ${restatedLines} line${restatedLines === 1 ? "" : "s"} ${restatedLines === 1 ? "was" : "were"} restated to the invoice cost once the invoice was checked.`
      : base;
  return {
    lines,
    voidedLines,
    revenue: round4(revenue),
    cost: round4(cost),
    margin,
    marginPct,
    linesWithoutCost,
    restatedLines,
    sentence,
  };
}
