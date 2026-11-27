/**
 * Whether the unit prices on a paper hold tax, read from the paper's OWN
 * stated totals (r108 inventory-1). On this tree a settled delivery cost is
 * the invoice line's unit price as printed, so what the paper printed is what
 * the cost holds:
 * - the lines sum to the total before tax (BT-109), and that plus the tax
 *   gives the total: `net`;
 * - the lines sum to the total with tax (BT-112), and that less the tax gives
 *   the total before it: `gross_cost`;
 * - every costed line must also tie out (quantity x unit price = line total,
 *   `lineTiesOut`), else the cost is not the figure the totals describe;
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

export interface PaperLine {
  unitPrice: number | string | null;
  lineTotal: number | string | null;
  qty?: number | string | null;
  qtyBottles?: number | string | null;
  freeGoodsQty?: number | string | null;
}

/**
 * Whether a costed line's own arithmetic holds: quantity x the unit price
 * that becomes the cost equals the line's total, to the cent (the free goods
 * a vendor adds come off the charged quantity). The basis is read from line
 * TOTALS but the cost stamped is the UNIT PRICE; a paper that prints net unit
 * prices beside a gross line column (KDV dahil tutar) sums to its total with
 * tax and would otherwise stamp a net price as gross. A line with no unit
 * price is not a costed line and does not count.
 */
export function lineTiesOut(l: PaperLine): boolean {
  const up = num(l.unitPrice);
  if (up === null || !(up > 0)) return true;
  const lt = num(l.lineTotal);
  if (lt === null) return false;
  const free = num(l.freeGoodsQty ?? null) ?? 0;
  const asked = [num(l.qty ?? null), num(l.qtyBottles ?? null)].filter((q): q is number => q !== null && q > 0);
  const candidates = asked.flatMap((q) => (free > 0 && q - free > 0 ? [q, q - free] : [q]));
  return candidates.some((q) => Math.abs(q * up - lt) <= 0.01 + q * 0.00005 + 1e-9);
}

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
