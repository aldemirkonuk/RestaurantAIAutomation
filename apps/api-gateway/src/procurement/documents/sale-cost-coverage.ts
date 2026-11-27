/**
 * HOW MUCH OF THE TILL'S COST IS EXACT (r109 g2). Every sale keeps what it
 * cost and the basis it was read on (20271201100000). This sums the house's
 * drinks cost of sales for a window, by how far that basis can be trusted:
 *
 *   checked   invoice_lot_wac, invoice_restated, pour_lot_wac
 *   partly    invoice_lot_wac_partial, pour_lot_wac_partial (its own figure, never split)
 *   estimate  last_purchase_price, with the deliveries it came from
 *   not kept  cost_at_sale is null: counted, never read as 0 (ADR 0020)
 *
 * Voided lines (quantity 0 and volume 0) sold nothing and are left out.
 * Figures are integer micro-units from the decimal text, spoken back exactly.
 */
import { microText, toMicro } from "./sealed-changes";

export const CHECKED_BASES = ["invoice_lot_wac", "invoice_restated", "pour_lot_wac"] as const;
export const PARTIAL_BASES = ["invoice_lot_wac_partial", "pour_lot_wac_partial"] as const;
export const ESTIMATE_BASES = ["last_purchase_price"] as const;

export interface CoverageRow {
  cost_at_sale: number | string | null;
  cost_basis: string | null;
  cost_source_order_id: string | null;
  quantity: number | string | null;
  volume_ml: number | string | null;
}

export interface EstimateDelivery {
  orderId: string | null;
  vendor: string | null;
  deliveredAt: string | null;
  cost: string;
  sales: number;
  /** The paper for this delivery: in review (with its id), checked, or none yet. */
  paper: { state: "in_review" | "checked" | "none"; documentId: string | null };
}

export interface Coverage {
  total: string;
  checked: string;
  partial: string;
  estimate: string;
  /** A basis this read does not name (a newer word): in the total, said apart. */
  other: string;
  sales: number;
  notKept: number;
  voided: number;
  estimateDeliveries: EstimateDelivery[];
}

const isVoid = (r: CoverageRow) => Number(r.quantity ?? 0) === 0 && Number(r.volume_ml ?? 0) === 0;

export function summariseCoverage(
  rows: CoverageRow[],
  describe: (orderId: string | null) => Omit<EstimateDelivery, "orderId" | "cost" | "sales">,
): Coverage {
  let checked = 0n;
  let partial = 0n;
  let estimate = 0n;
  let other = 0n;
  let sales = 0;
  let notKept = 0;
  let voided = 0;
  const byOrder = new Map<string | null, { cost: bigint; sales: number }>();
  for (const r of rows) {
    if (isVoid(r)) {
      voided++;
      continue;
    }
    if (r.cost_at_sale == null || r.cost_at_sale === "") {
      notKept++;
      continue;
    }
    const m = toMicro(r.cost_at_sale);
    const b = String(r.cost_basis ?? "");
    sales++;
    if ((CHECKED_BASES as readonly string[]).includes(b)) checked += m;
    else if ((PARTIAL_BASES as readonly string[]).includes(b)) partial += m;
    else if ((ESTIMATE_BASES as readonly string[]).includes(b)) {
      estimate += m;
      const k = r.cost_source_order_id ?? null;
      const e = byOrder.get(k) ?? { cost: 0n, sales: 0 };
      e.cost += m;
      e.sales++;
      byOrder.set(k, e);
    } else other += m;
  }
  const estimateDeliveries = [...byOrder.entries()]
    .map(([orderId, e]) => ({ orderId, cost: microText(e.cost), sales: e.sales, ...describe(orderId), _c: e.cost }))
    .sort((a, b) => (a._c < b._c ? 1 : a._c > b._c ? -1 : String(a.orderId).localeCompare(String(b.orderId))))
    .map(({ _c, ...d }) => d);
  return {
    total: microText(checked + partial + estimate + other),
    checked: microText(checked),
    partial: microText(partial),
    estimate: microText(estimate),
    other: microText(other),
    sales,
    notKept,
    voided,
    estimateDeliveries,
  };
}
