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
  | "last_purchase_price"
  /** A pour's share of a bottle costed at the recorded WAC: no ledger row prices a pour (r105). */
  | "pour_lot_wac"
  | "pour_lot_wac_partial";

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
}

/** The four columns a consumption row keeps for its cost. */
export interface CostSnapshot {
  cost_at_sale: number | null;
  cost_basis: SaleCostBasis | null;
  /** One whole bottle's cost the line was costed at; a verified invoice restates from it. */
  cost_unit_at_sale: number | null;
  cost_source_lot_id: string | null;
  cost_source_order_id: string | null;
}

export const NO_COST_SNAPSHOT: CostSnapshot = {
  cost_at_sale: null,
  cost_basis: null,
  cost_unit_at_sale: null,
  cost_source_lot_id: null,
  cost_source_order_id: null,
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

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
  }
  return { unitCost, basis: costBasis, lotId, orderId };
}

/** The depletion row a whole-bottle sale wrote (inventory_transactions), as read back by its key. */
export interface SaleLedgerRow {
  quantity_change?: unknown;
  unit_cost?: unknown;
  cost_total?: unknown;
  unpriced_qty?: unknown;
}

/**
 * What the ledger row of a whole-bottle sale says each bottle cost: the
 * quantity-weighted cost of the lots it drew (cost_total / bottles). Null
 * unless every bottle left priced; with any bottle unpriced the weighted cost
 * of the whole line is unknown, and a lower number from the priced part is
 * never offered (ADR 0067).
 */
export function ledgerUnitCost(
  row: SaleLedgerRow | null | undefined,
  qty: number,
): { unitCost: number; total: number } | null {
  if (!row) return null;
  const total = num(row.cost_total);
  const unpriced = num(row.unpriced_qty);
  const moved = num(row.quantity_change);
  if (total === null || unpriced !== 0 || moved === null || moved >= 0) {
    return null;
  }
  if (-moved !== qty) return null;
  return { unitCost: round4(total / qty), total };
}

const POUR_BASIS: Partial<Record<SaleCostBasis, SaleCostBasis>> = {
  invoice_lot_wac: "pour_lot_wac",
  invoice_lot_wac_partial: "pour_lot_wac_partial",
};

/**
 * The cost snapshot of one line. A whole-bottle line costs one bottle per unit
 * sold, and when its ledger row priced every bottle the line IS that row's
 * cost_total (the lots it really drew, r105), so the two figures cannot
 * disagree. A pour costs its share of the bottle: bottle cost x ml / bottle ml
 * (`glassCostFrom`), so a bottle's worth of pours costs the bottle; no ledger
 * row prices a pour (record_glass_pour writes none), so a pour stays on the
 * recorded WAC under its own basis word. A line with no recorded cost, or a
 * pour from a bottle of unknown size, keeps no cost: null, never 0.
 */
export function snapshotLineCost(
  source: SaleCostSource | null,
  mode: "whole_bottle" | "volume",
  volumeMl: number,
  bottleMl: number | null,
  qty: number,
  ledgerRow?: SaleLedgerRow | null,
): CostSnapshot {
  if (!source) return NO_COST_SNAPSHOT;
  const drawn = mode === "whole_bottle" ? ledgerUnitCost(ledgerRow, qty) : null;
  const cost =
    mode === "whole_bottle"
      ? drawn
        ? drawn.total
        : Number.isFinite(qty) && qty >= 0
          ? source.unitCost * qty
          : null
      : glassCostFrom(source.unitCost, volumeMl, bottleMl);
  if (cost === null || !Number.isFinite(cost)) return NO_COST_SNAPSHOT;
  return {
    cost_at_sale: round4(cost),
    cost_basis: mode === "volume" ? (POUR_BASIS[source.basis] ?? source.basis) : source.basis,
    cost_unit_at_sale: drawn ? drawn.unitCost : source.unitCost,
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
