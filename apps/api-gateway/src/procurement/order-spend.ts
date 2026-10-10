/**
 * What one delivered order cost the house, and what a set of them cost (F-701).
 *
 * `total_cost` is NOT NULL and an order placed with no price is written 0
 * (`createOrder`: `finalPrice ?? quotedPrice ?? 0`), so a 0 there is "nobody
 * priced this", not a free delivery. Every spend reader used to sum
 * `total_cost || final_price || 0`, which counted that delivery as $0 and said
 * nothing — or, when `final_price` was set, added ONE bottle's price as the
 * whole order, because `final_price` is per bottle. Purchases then understated
 * silently while the stock value, under ADR 0051, withholds itself for the same
 * missing cost.
 *
 * So an order with no positive `total_cost` is unpriced: left out of the total
 * and counted, so the page can say how many deliveries the figure is missing,
 * the way `costCoverage` does for the cellar.
 */

/** The order's money, or null when it carries none we can trust. */
export function orderSpend(o: { total_cost?: unknown }): number | null {
  const n = Number(o.total_cost);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface SpendTotal {
  /** The sum over the orders that carry a price. */
  total: number;
  /** Orders left out of `total` because they carry no price. */
  unpricedCount: number;
}

export function sumOrderSpend(
  orders: ReadonlyArray<{ total_cost?: unknown }>,
): SpendTotal {
  let total = 0;
  let unpricedCount = 0;
  for (const o of orders) {
    const spend = orderSpend(o);
    if (spend == null) unpricedCount += 1;
    else total += spend;
  }
  return { total, unpricedCount };
}
