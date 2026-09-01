/**
 * The one place analytics decides what a bottle cost — and, more importantly,
 * the one place it is allowed to answer "we do not know".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Both analytics services used to resolve unit cost inline, identically:
 *
 *     lot?.has_invoice_cost && lot?.wac
 *       ? lot.wac
 *       : Number(i.last_purchase_price) || (unitPrice ? unitPrice * 0.6 : 0);
 *
 * The first branch is a real measurement — `inventory_lot_rollup.wac` is
 * written by receiving, from invoices. The second is a real record, when one
 * exists. The third was invented: `0.6` had no comment, no ADR and no doc
 * anywhere in the repo, and `restaurant_inventory.last_purchase_price` has no
 * write site in this codebase at all (every occurrence is a read), so in
 * production it is NULL on every row. The measured branch covered 2 of 72
 * inventory rows; the invented one covered the other 70 — and its output was
 * then labelled "WAC (lot rollup)" in two endpoints' `basis` strings.
 *
 * ADR 0051 (locked 2026-09-01): a surface shows live data or says it does not
 * know. Unknown is null / an em dash, never a fabricated number and never
 * zero. A `basis` string that names a source the value did not come from is
 * the worst version of the same defect, because it survives review.
 *
 * So: cost is `number | null`, every row carries the provenance of its own
 * number, and callers propagate the null instead of letting arithmetic quietly
 * turn it into 0. `scripts/check_analytics_cost_honesty.py` fails CI if a
 * magic-number cost fallback comes back, or if a `basis` string re-acquires an
 * unconditional source claim.
 *
 * WHAT IS *NOT* DECIDED HERE
 * --------------------------
 * OPEN-DECISIONS OD-100 ("What price values inventory?") is still open and is
 * the founder's call. This file does not answer it — it makes the current
 * answer honest. If OD-100 lands on a different basis, `resolveUnitCost` is
 * the single function to change.
 */

/** Where one row's unit cost came from. `unknown` is a first-class answer. */
export type CostBasis = "invoice_lot_wac" | "last_purchase_price" | "unknown";

export interface ResolvedUnitCost {
  /** Dollars per bottle. `null` means unknown — never substitute a guess. */
  unitCost: number | null;
  costBasis: CostBasis;
}

/** Human-readable source for each basis, for `basis` payload strings. */
export const COST_BASIS_LABEL: Record<CostBasis, string> = {
  invoice_lot_wac: "invoiced lot WAC (inventory_lot_rollup.wac)",
  last_purchase_price: "restaurant_inventory.last_purchase_price",
  unknown: "no recorded cost",
};

/** Minimal shapes, so this module never imports a service. */
export interface InventoryCostRow {
  last_purchase_price?: unknown;
}
export interface LotRollupRow {
  has_invoice_cost?: unknown;
  wac?: unknown;
}

/**
 * Best *recorded* unit cost, or null.
 *
 * Order: invoiced lot WAC → recorded last purchase price → unknown.
 *
 * Two deliberate judgement calls, both narrower than they look:
 *
 *  • A lot WAC of exactly **0 is accepted as measured** when
 *    `has_invoice_cost` is set. Zero is a real invoiced cost here:
 *    `inventory.service.ts` records sample bottles as `unitCost: 0` with
 *    provenance `"sample"`. The old expression treated that 0 as falsy and
 *    fabricated `0.6 × menu price` for a bottle that provably cost nothing.
 *
 *  • A `last_purchase_price` of exactly **0 is treated as unknown**. Unlike
 *    WAC there is no write site in this repo that could have meant "free", so
 *    a 0 there is an unattested value, and reading it as "we paid nothing"
 *    would hand every such wine a 100% margin. This matches the old
 *    expression's behaviour for that case; changing it is an OD-100 question,
 *    not a drive-by.
 */
export function resolveUnitCost(
  row: InventoryCostRow | null | undefined,
  lot: LotRollupRow | null | undefined,
): ResolvedUnitCost {
  const rawWac = lot?.wac;
  if (lot?.has_invoice_cost && rawWac != null) {
    const wac = Number(rawWac);
    if (Number.isFinite(wac) && wac >= 0)
      return { unitCost: wac, costBasis: "invoice_lot_wac" };
  }
  const rawLast = row?.last_purchase_price;
  if (rawLast != null) {
    const last = Number(rawLast);
    if (Number.isFinite(last) && last > 0)
      return { unitCost: last, costBasis: "last_purchase_price" };
  }
  return { unitCost: null, costBasis: "unknown" };
}

export interface CostCoverage {
  /** Rows the caller considered (e.g. on-hand rows, for a valuation). */
  total: number;
  /** Rows with a recorded unit cost. */
  priced: number;
  /** Rows with no recorded unit cost. */
  unpriced: number;
  /** True when every considered row is priced — i.e. a total is computable. */
  complete: boolean;
  byBasis: Record<CostBasis, number>;
}

export function summarizeCostBasis(
  rows: Array<{ unitCost: number | null; costBasis: CostBasis }>,
): CostCoverage {
  const byBasis: Record<CostBasis, number> = {
    invoice_lot_wac: 0,
    last_purchase_price: 0,
    unknown: 0,
  };
  let priced = 0;
  for (const r of rows) {
    byBasis[r.costBasis] = (byBasis[r.costBasis] ?? 0) + 1;
    if (r.unitCost != null) priced += 1;
  }
  return {
    total: rows.length,
    priced,
    unpriced: rows.length - priced,
    complete: rows.length > 0 && priced === rows.length,
    byBasis,
  };
}

/**
 * The per-row truth, as a sentence a `basis` string can carry.
 *
 * This is why the guard exists: the replaced strings said
 * `"on-hand qty × WAC (lot rollup)"` unconditionally, for a number that came
 * from WAC on 2 rows in 72. A basis must describe the rows it actually
 * covered, so it is built from the coverage rather than written by hand.
 */
export function costBasisSentence(coverage: CostCoverage): string {
  if (coverage.total === 0) return "no inventory rows in scope";
  const parts = (Object.keys(coverage.byBasis) as CostBasis[])
    .filter((b) => coverage.byBasis[b] > 0)
    .map((b) => `${COST_BASIS_LABEL[b]} (${coverage.byBasis[b]})`);
  const head = `per row — ${parts.join("; ")}`;
  return coverage.complete
    ? `${head}; every row in scope has a recorded cost`
    : `${head}; ${coverage.unpriced} of ${coverage.total} row(s) have no recorded cost, so any figure needing a complete valuation is null`;
}
