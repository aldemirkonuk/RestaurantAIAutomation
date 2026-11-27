/**
 * Whether the unit prices on a paper hold tax, read from the paper's OWN
 * stated totals (r108 inventory-1). On this tree a settled delivery cost is
 * the invoice line's unit price as printed, so what the paper printed is what
 * the cost holds:
 * - the lines sum to the total before tax (BT-109), and that plus the tax
 *   gives the total: `net`;
 * - the lines sum to the total with tax (BT-112), and that less the tax gives
 *   the total before it: `gross_cost`;
 * - anything else (a line with no total, no tax stated, a tax too small to
 *   tell the two apart, sums that meet neither): null, "not stated".
 * Never the house's answer, never the country: a paper says it or it is not
 * said.
 */
export type CostTaxBasis = "net" | "gross_cost";

export interface PaperTotals {
  subtotal: number | string | null;
  tax: number | string | null;
  total: number | string | null;
  lineTotals: Array<number | string | null>;
}

const num = (v: number | string | null): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function paperCostTaxBasis(p: PaperTotals): CostTaxBasis | null {
  const subtotal = num(p.subtotal);
  const tax = num(p.tax);
  const total = num(p.total);
  if (subtotal === null || tax === null || total === null || p.lineTotals.length === 0) return null;
  const lines = p.lineTotals.map(num);
  if (lines.some((l) => l === null)) return null;
  const sum = (lines as number[]).reduce((a, b) => a + b, 0);
  // One cent per line of rounding, as the BR-CO-13 tie-out allows.
  const tol = 0.01 * lines.length + 1e-9;
  // The two readings must be told apart: a tax within the rounding is not one.
  if (!(tax > 2 * tol)) return null;
  if (Math.abs(subtotal + tax - total) > 0.01 + 1e-9) return null;
  if (Math.abs(sum - subtotal) <= tol) return "net";
  if (Math.abs(sum - total) <= tol) return "gross_cost";
  return null;
}

/** The one basis every paper states, or null when one is unstated or two differ. */
export function commonCostTaxBasis(bases: Array<CostTaxBasis | null>): CostTaxBasis | null {
  if (bases.length === 0 || bases.some((b) => b === null)) return null;
  return bases.every((b) => b === bases[0]) ? bases[0] : null;
}
