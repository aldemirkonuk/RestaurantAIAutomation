/**
 * WHAT SEALING A PAPER CHANGED (r108 g17): the stock value its lots were
 * revalued by, and the till's cost of sales its restatements moved.
 *
 * Read from the receipts the cost writes leave behind, never re-derived:
 * `inventory_lot_revaluations` (stock: qty_at_revaluation x (new - prior)),
 * `wine_consumption_cost_restatements` (sales, the order path: new - prior
 * cost_at_sale) and `inventory_lot_draw_settlements` (sales, the delivery path:
 * `difference`), for the order(s) the paper is linked to AND the lots of the
 * deliveries it is linked to. A door delivery with no order books lots with a
 * null source_order_id, so an order-only read reported "no order, no change". Sums are integer micro-units, parsed
 * from the decimal text so 18 significant digits survive. A prior cost that
 * was not known is counted and LEFT OUT of the figure, never read as 0, which
 * would book the whole new cost as a change (ADR 0020).
 *
 * ONE TOTAL, NOT EVENTS. Rows were grouped by `created_at` on the premise that
 * one act shares one transaction stamp. No writer does: finalise_delivery_cost
 * is called once per item and each call is its own transaction, and a receipt
 * adjustment is two RPCs. Grouping by stamp called the first item "the seal" and
 * the rest "corrections". Until the writers carry one act id (a batch uuid
 * passed to each RPC), the figures are one sum with no split.
 */

export const CHANGES_PAGE = 1000;

export interface RevaluationRow {
  id?: string;
  qty_at_revaluation: number | string;
  prior_unit_cost: number | string | null;
  new_unit_cost: number | string;
  created_at: string;
}

export interface RestatementRow {
  id?: string;
  consumption_id: string;
  prior_cost_at_sale: number | string | null;
  new_cost_at_sale: number | string;
  created_at: string;
}

/** `inventory_lot_draw_settlements`: what a sale already made from a revalued lot now costs (the canonical path). */
export interface SettlementRow {
  id?: string;
  txn_id: string;
  prior_total: number | string | null;
  difference: number | string;
}

export interface SealedChanges {
  stockValueDelta: string;
  bottles: number;
  salesCostDelta: string;
  sales: number;
  /** Rows whose prior cost was not known: counted, left out of both figures. */
  notKnown: number;
}

/** Exact decimal text (or a number) to integer micro-units, half away from zero at the 7th place. */
export function toMicro(v: number | string): bigint {
  const t = (typeof v === "number" ? v.toFixed(7) : String(v)).trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m) throw new Error(`not a decimal: ${t}`);
  const frac = (m[3] ?? "").padEnd(7, "0");
  let n = BigInt((m[2] || "0") + frac.slice(0, 6));
  if (Number(frac[6]) >= 5) n += 1n;
  return m[1] ? -n : n;
}

/** Micro-units spoken to their stored places, never fewer than 2, with a sign. */
export function microText(n: bigint): string {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const i = a / 1_000_000n;
  const f = (a % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${neg ? "-" : ""}${i}.${f}`;
}

/** Reads every page of 1000 until a short one, so no figure stops at a cap. */
export async function readEveryPage<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += CHANGES_PAGE) {
    const { data, error } = await page(from, from + CHANGES_PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < CHANGES_PAGE) return out;
  }
}

export function summariseChanges(
  revaluations: RevaluationRow[],
  restatements: RestatementRow[],
  settlements: SettlementRow[] = [],
): SealedChanges {
  let stock = 0n;
  let sales = 0n;
  let bottles = 0;
  let notKnown = 0;
  const saleIds = new Set<string>();
  for (const r of revaluations) {
    if (r.prior_unit_cost == null || r.prior_unit_cost === "") {
      notKnown++;
      continue;
    }
    const qty = BigInt(Math.trunc(Number(r.qty_at_revaluation)));
    stock += qty * (toMicro(r.new_unit_cost) - toMicro(r.prior_unit_cost));
    bottles += Number(qty);
  }
  for (const r of restatements) {
    if (r.prior_cost_at_sale == null || r.prior_cost_at_sale === "") {
      notKnown++;
      continue;
    }
    sales += toMicro(r.new_cost_at_sale) - toMicro(r.prior_cost_at_sale);
    saleIds.add(r.consumption_id);
  }
  for (const r of settlements) {
    // A draw that left with no price has no prior to move from: counted, left out.
    if (r.prior_total == null || r.prior_total === "") {
      notKnown++;
      continue;
    }
    sales += toMicro(r.difference);
    saleIds.add(r.txn_id);
  }
  return {
    stockValueDelta: microText(stock),
    bottles,
    salesCostDelta: microText(sales),
    sales: saleIds.size,
    notKnown,
  };
}

// ---------------------------------------------------------------------------
// r109 g3: the table sales a sealed paper re-costed, by name.
// restatement.consumption_id -> wine_consumption_log (notes
// `pos:<source>:<check>:...`) -> pos_checks -> restaurant_tables.
// ---------------------------------------------------------------------------

export interface SaleRow {
  id: string;
  wine_name: string | null;
  quantity: number | string | null;
  volume_ml: number | string | null;
  consumption_type: string | null;
  recorded_at: string | null;
  notes: string | null;
}
export interface CheckRow {
  source: string;
  external_check_id: string;
  table_id: string | null;
  table_ref: string | null;
}
export interface TableRow {
  id: string;
  label: string | null;
}
export interface SettledSale {
  id: string;
  at: string | null;
  wine: string | null;
  quantity: number;
  unit: string | null;
  volumeMl: number;
  /** The till voided the line after it was restated. */
  voided: boolean;
  /** "Table 4", the till's own word, or "no table". */
  table: string;
  /** The latest restatement's before and after, exact; before is null when not known. */
  before: string | null;
  after: string;
}

/** `pos:<source>:<check id>:...` to its source and check; null for any other note. */
export function checkOfNotes(notes: string | null | undefined): { source: string; check: string } | null {
  const m = /^pos:([^:]+):([^:]+):/.exec(String(notes ?? ""));
  return m ? { source: m[1], check: m[2] } : null;
}

/** One event per sale: a sale restated twice shows its latest. */
export function latestPerSale(rows: RestatementRow[]): RestatementRow[] {
  const by = new Map<string, RestatementRow>();
  for (const r of rows) {
    const had = by.get(r.consumption_id);
    if (!had || r.created_at > had.created_at || (r.created_at === had.created_at && String(r.id ?? "") > String(had.id ?? "")))
      by.set(r.consumption_id, r);
  }
  return [...by.values()];
}

const tableWord = (label: string | null | undefined) => {
  const t = String(label ?? "").trim();
  return !t ? null : /^\d+$/.test(t) ? `Table ${t}` : t;
};

/** The sales, newest first. A restatement whose sale is not this house's row is not named. */
export function settledSales(
  restatements: RestatementRow[],
  sales: SaleRow[],
  checks: CheckRow[],
  tables: TableRow[],
): SettledSale[] {
  const saleBy = new Map(sales.map((s) => [s.id, s]));
  const checkBy = new Map(checks.map((c) => [`${c.source}\u0000${c.external_check_id}`, c]));
  const tableBy = new Map(tables.map((t) => [t.id, t]));
  const out: SettledSale[] = [];
  for (const r of latestPerSale(restatements)) {
    const s = saleBy.get(r.consumption_id);
    if (!s) continue;
    const k = checkOfNotes(s.notes);
    const c = k ? checkBy.get(`${k.source}\u0000${k.check}`) : undefined;
    const table =
      tableWord(c?.table_id ? tableBy.get(c.table_id)?.label : null) ??
      (String(c?.table_ref ?? "").trim() ? `Table ${String(c?.table_ref).trim()}` : "no table");
    const quantity = Number(s.quantity ?? 0) || 0;
    const volumeMl = Number(s.volume_ml ?? 0) || 0;
    out.push({
      id: s.id,
      at: s.recorded_at,
      wine: s.wine_name,
      quantity,
      unit: s.consumption_type,
      volumeMl,
      voided: quantity === 0 && volumeMl === 0,
      table,
      before: r.prior_cost_at_sale == null || r.prior_cost_at_sale === "" ? null : microText(toMicro(r.prior_cost_at_sale)),
      after: microText(toMicro(r.new_cost_at_sale)),
    });
  }
  return out.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")) || a.id.localeCompare(b.id));
}
