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

/**
 * Where one row's unit cost came from. `unknown` is a first-class answer.
 *
 * `invoice_lot_wac_partial` exists because coverage and completeness are
 * different facts and the rollup only used to expose the first.
 * `has_invoice_cost` is `bool_or(cost_provenance = 'invoice')` over live lots,
 * while `wac` averages only the lots that HAVE a cost — so one invoiced bottle
 * among twenty-one was enough to return the WAC and call the whole row
 * "invoiced lot WAC". The number is real; the scope it was quoted for was not.
 */
export type CostBasis =
  | "invoice_lot_wac"
  | "invoice_lot_wac_partial"
  | "last_purchase_price"
  | "other_currency"
  | "unknown";

export interface ResolvedUnitCost {
  /** Dollars per bottle. `null` means unknown — never substitute a guess. */
  unitCost: number | null;
  costBasis: CostBasis;
}

/** Human-readable source for each basis, for `basis` payload strings. */
export const COST_BASIS_LABEL: Record<CostBasis, string> = {
  invoice_lot_wac: "invoiced lot WAC (inventory_lot_rollup.wac)",
  invoice_lot_wac_partial:
    "invoiced lot WAC covering only part of the on-hand quantity (inventory_lot_rollup.wac)",
  last_purchase_price: "restaurant_inventory.last_purchase_price",
  other_currency:
    "recorded cost is in a different currency from the house's, so it is not compared with a menu price",
  unknown: "no recorded cost",
};

/** Minimal shapes, so this module never imports a service. */
export interface InventoryCostRow {
  last_purchase_price?: unknown;
}
export interface LotRollupRow {
  has_invoice_cost?: unknown;
  wac?: unknown;
  /**
   * Bottles the `wac` actually averages, and bottles on hand. Added to the view
   * on 2026-09-02 (ADR 0079). Both optional: a caller that has not been updated
   * to select them still gets the old behaviour rather than a wrong answer, and
   * completeness is simply not asserted for it.
   */
  wac_qty?: unknown;
  live_qty?: unknown;
  /**
   * The stated currencies among the lots `wac` averages (F-343, 2026-10-09).
   * `cost_currency` is the one code when there is exactly one. Both optional:
   * a lot booked before the column existed states none, and is read as before.
   */
  cost_currency?: unknown;
  cost_currency_count?: unknown;
}

/**
 * Best *recorded* unit cost, or null.
 *
 * Order: invoiced lot WAC → recorded last purchase price → unknown.
 *
 * Two deliberate judgement calls, both narrower than they look:
 *
 *  • A lot WAC of exactly **0 is accepted as measured** when
 *    `has_invoice_cost` is set, because the old expression treated 0 as falsy
 *    and fabricated `0.6 × menu price` from it.
 *
 *    This branch used to justify itself by citing sample bottles —
 *    `inventory.service.ts` records them as `unitCost: 0`, provenance
 *    `"sample"`. That reasoning was wrong about the mechanism, though not
 *    about the conclusion: `inventory_lot_rollup.wac` FILTERs
 *    `cost_provenance <> 'sample'` (baseline migration :3207), so a sample lot
 *    can never contribute to the WAC and the cited case cannot arise. A zero
 *    WAC now means an invoice really did record $0 for a non-sample lot —
 *    rarer, and still a measurement rather than a gap, so the branch stays and
 *    only its explanation changes.
 *
 *  • A WAC that covers only SOME of the on-hand bottles is returned, but as
 *    `invoice_lot_wac_partial`. The average is a real measurement of the
 *    bottles it covers and throwing it away would be its own dishonesty; what
 *    is not true is that it describes the whole row. When the view's `wac_qty`
 *    and `live_qty` are not selected, completeness is unknown and the basis
 *    stays `invoice_lot_wac` — an unasked question is not a failed one.
 *
 *  • A `last_purchase_price` of exactly **0 is treated as unknown**. Unlike
 *    WAC there is no write site in this repo that could have meant "free", so
 *    a 0 there is an unattested value, and reading it as "we paid nothing"
 *    would hand every such wine a 100% margin. This matches the old
 *    expression's behaviour for that case; changing it is an OD-100 question,
 *    not a drive-by.
 *
 *  • A WAC in another money is **not a cost of this house's menu** (F-343).
 *    A lot costs what its order or invoice said, in that paper's currency, and
 *    nothing converts (20260905120000 rule 3). So a WAC that mixes two stated
 *    currencies, or whose one currency is not the house's stated currency,
 *    comes back null as `other_currency` — never compared with a menu price.
 *    A lot that states no currency (booked before the column) and a house that
 *    states none are read as before; see the lot-currency decision note.
 */
export function resolveUnitCost(
  row: InventoryCostRow | null | undefined,
  lot: LotRollupRow | null | undefined,
  houseCurrency?: string | null,
): ResolvedUnitCost {
  const rawWac = lot?.wac;
  if (lot?.has_invoice_cost && rawWac != null) {
    if (!wacIsInHouseMoney(lot, houseCurrency))
      return { unitCost: null, costBasis: "other_currency" };
    const wac = Number(rawWac);
    if (Number.isFinite(wac) && wac >= 0) {
      const covered = Number(lot?.wac_qty);
      const onHand = Number(lot?.live_qty);
      const measurable =
        lot?.wac_qty != null &&
        lot?.live_qty != null &&
        Number.isFinite(covered) &&
        Number.isFinite(onHand) &&
        onHand > 0;
      return {
        unitCost: wac,
        costBasis:
          measurable && covered < onHand
            ? "invoice_lot_wac_partial"
            : "invoice_lot_wac",
      };
    }
  }
  const rawLast = row?.last_purchase_price;
  if (rawLast != null) {
    const last = Number(rawLast);
    if (Number.isFinite(last) && last > 0)
      return { unitCost: last, costBasis: "last_purchase_price" };
  }
  return { unitCost: null, costBasis: "unknown" };
}

/** True unless the lots behind `wac` state a currency other than the house's. */
function wacIsInHouseMoney(
  lot: LotRollupRow,
  houseCurrency: string | null | undefined,
): boolean {
  const count = Number(lot.cost_currency_count ?? 0);
  if (Number.isFinite(count) && count > 1) return false;
  const code =
    typeof lot.cost_currency === "string"
      ? lot.cost_currency.trim().toUpperCase()
      : "";
  const house =
    typeof houseCurrency === "string" ? houseCurrency.trim().toUpperCase() : "";
  return !code || !house || code === house;
}

export interface CostCoverage {
  /** Rows the caller considered (e.g. on-hand rows, for a valuation). */
  total: number;
  /** Rows with a recorded unit cost. */
  priced: number;
  /** Rows with no recorded unit cost. */
  unpriced: number;
  /**
   * Priced rows whose cost covers only some of their bottles
   * (`invoice_lot_wac_partial`, F-1652). Each is in `priced`, because its
   * costed bottles have a value; none of them is whole, so `complete` is false.
   */
  partial: number;
  /** The bottles of those partial rows that carry no cost of their own. */
  uncostedBottles: number;
  /**
   * True when every considered row is priced for every bottle it holds —
   * i.e. a total is computable.
   */
  complete: boolean;
  byBasis: Record<CostBasis, number>;
}

export function summarizeCostBasis(
  rows: Array<{
    unitCost: number | null;
    costBasis: CostBasis;
    /** A partial row's bottles with no cost; absent reads as 0. */
    uncostedBottles?: number | null;
  }>,
): CostCoverage {
  const byBasis: Record<CostBasis, number> = {
    invoice_lot_wac: 0,
    invoice_lot_wac_partial: 0,
    last_purchase_price: 0,
    other_currency: 0,
    unknown: 0,
  };
  let priced = 0;
  let partial = 0;
  let uncostedBottles = 0;
  for (const r of rows) {
    byBasis[r.costBasis] = (byBasis[r.costBasis] ?? 0) + 1;
    if (r.unitCost != null) priced += 1;
    if (r.unitCost != null && r.costBasis === "invoice_lot_wac_partial") {
      partial += 1;
      const u = Number(r.uncostedBottles ?? 0);
      if (Number.isFinite(u) && u > 0) uncostedBottles += u;
    }
  }
  return {
    total: rows.length,
    priced,
    unpriced: rows.length - priced,
    partial,
    uncostedBottles,
    // F-1652: a row costed for 12 bottles of 36 is not a costed row; a total
    // that took it whole would hold 24 bottles nobody recorded a cost for.
    complete: rows.length > 0 && priced === rows.length && partial === 0,
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
  if (coverage.complete)
    return `${head}; every row in scope has a recorded cost`;
  const gaps = [
    coverage.unpriced > 0
      ? `${coverage.unpriced} of ${coverage.total} row(s) have no recorded cost`
      : null,
    // F-1652: a partly costed row is a gap too, and it is named as one.
    coverage.partial > 0
      ? `${coverage.partial} of ${coverage.total} row(s) have a recorded cost for only part of their bottles (${coverage.uncostedBottles} bottle(s) with none)`
      : null,
  ].filter((g): g is string => g !== null);
  return `${head}; ${gaps.join("; ")}, so any figure needing a complete valuation is null`;
}
