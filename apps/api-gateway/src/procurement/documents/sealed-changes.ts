/**
 * WHAT SEALING A PAPER CHANGED (r108 g17): the stock value its lots were
 * revalued by, and the till's cost of sales its restatements moved.
 *
 * Read from the receipts the cost writes leave behind, never re-derived:
 * `inventory_lot_revaluations` (stock: qty_at_revaluation x (new - prior)) and
 * `wine_consumption_cost_restatements` (sales: new - prior cost_at_sale), for
 * the order(s) the paper is linked to. Sums are integer micro-units, parsed
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
  qty_at_revaluation: number | string;
  prior_unit_cost: number | string | null;
  new_unit_cost: number | string;
  created_at: string;
}

export interface RestatementRow {
  consumption_id: string;
  prior_cost_at_sale: number | string | null;
  new_cost_at_sale: number | string;
  created_at: string;
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

export function summariseChanges(revaluations: RevaluationRow[], restatements: RestatementRow[]): SealedChanges {
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
  return {
    stockValueDelta: microText(stock),
    bottles,
    salesCostDelta: microText(sales),
    sales: saleIds.size,
    notKnown,
  };
}
