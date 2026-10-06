/**
 * Net sales — the one fold every owner sales figure reads (ADR 0295).
 *
 * THE RULING
 * ----------
 * AW17, founder, 2026-10-04: "Net sales (Recommended)". Owner sales figures
 * ('Taken', 'Average check', a server's average, the tip rate) read the
 * check's subtotal: after discounts, before tax, surcharge and tip, as /team
 * already does with `server_sales.net_sales` and as a restaurant P&L does. The
 * gross `pos_checks.total` carried 8.63% sales tax and a 4% surcharge on
 * Tuzlu Rüzgar, so every figure read 12.63% over what the house sold, and the
 * tip rate divided by that inflated figure (A-019, A-047).
 *
 * THE PARTIAL RULE (founder F1, "Count and say")
 * ----------------------------------------------
 * A check that carries no subtotal is a check whose net the till did not
 * state. It is never filled from `total`: a gross number under a net label is
 * a fabricated figure (ADR 0020). So a fold:
 *   - sums the subtotals of the checks that carried one (`netSales`);
 *   - counts those checks (`netChecks`) beside every check it was given
 *     (`checks`), so a reader can say "from N of M checks" when N < M;
 *   - is `null` when there were checks and none carried a subtotal — "not
 *     recorded", never 0;
 *   - is 0 when there were no checks at all, which is a measured quiet window.
 * An average divides by `netChecks`, never by `checks`.
 *
 * Voided checks are the caller's filter (`voided = false` in SQL), as they
 * were before this file existed. Nothing here reads `total`.
 */

/** What a fold of checks says about their net sales. */
export interface NetSalesFold {
  /**
   * Sum of the subtotals the checks carried. `null` when `checks > 0` and not
   * one of them carried a subtotal; `0` when there were no checks.
   */
  netSales: number | null;
  /** Checks that carried a subtotal: the denominator of every net average. */
  netChecks: number;
  /** Every check folded, whether or not it carried a subtotal. */
  checks: number;
}

/**
 * One check's net sales, from its subtotal only. A missing, empty or
 * non-numeric subtotal is `null`, never 0 and never the total.
 */
export function netSalesOf(
  check: { subtotal?: unknown } | null | undefined,
): number | null {
  const v = check?.subtotal;
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Fold checks into net sales, under the partial rule above. */
export function foldNetSales(
  checks: Iterable<{ subtotal?: unknown } | null | undefined>,
): NetSalesFold {
  let sum = 0;
  let netChecks = 0;
  let count = 0;
  for (const c of checks) {
    count += 1;
    const net = netSalesOf(c);
    if (net === null) continue;
    sum += net;
    netChecks += 1;
  }
  return {
    netSales: count > 0 && netChecks === 0 ? null : sum,
    netChecks,
    checks: count,
  };
}

/** Net sales per check carrying one; `null` when none did. */
export function netAverage(fold: NetSalesFold): number | null {
  return fold.netSales !== null && fold.netChecks > 0
    ? fold.netSales / fold.netChecks
    : null;
}

/**
 * The basis, in the owner's words, for every surface that prints a net
 * figure. The till's own field name is never shown (F-135).
 */
export const NET_SALES_BASIS =
  "Net sales: what the checks came to after discounts, before tax, surcharge and tips. Voided checks are left out.";
