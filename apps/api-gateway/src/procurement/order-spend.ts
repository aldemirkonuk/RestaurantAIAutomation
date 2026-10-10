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

/**
 * A spend total refused because deliveries in its window carry no price
 * (F-701). Thrown where a short figure would be read as the whole one — a
 * goal's progress — the way `UncountedConsumptionError` refuses bottles sold.
 */
export class UnpricedSpendError extends Error {
  constructor(readonly unpricedCount: number) {
    super(
      `Purchase spend could not be totalled: ${unpricedCount} ${unpricedCount === 1 ? "delivery" : "deliveries"} in this window ${unpricedCount === 1 ? "carries" : "carry"} no price, so a total would be short rather than true.`,
    );
    this.name = "UnpricedSpendError";
  }
}

/**
 * The currency an order names, upper-cased; null when it names none (F-339).
 * An order with no code is read as the house's money, as every order was
 * before the column existed.
 */
export function orderCurrency(o: { currency?: unknown }): string | null {
  return typeof o.currency === "string" && o.currency.trim()
    ? o.currency.trim().toUpperCase()
    : null;
}

/**
 * The distinct currencies a set of orders names, sorted (F-1015). Given the
 * house's currency, an order naming none counts as the house's (F-1052), so
 * old no-code orders beside a euro one are two currencies, not one.
 */
export function namedCurrencies(
  orders: ReadonlyArray<{ currency?: unknown }>,
  houseCurrency: string | null = null,
): string[] {
  const house = orderCurrency({ currency: houseCurrency });
  const codes = new Set<string>();
  for (const o of orders) {
    const c = orderCurrency(o) ?? house;
    if (c) codes.add(c);
  }
  return Array.from(codes).sort();
}

/**
 * A spend total refused because its orders were placed in more than one
 * currency (F-1015): with no exchange rate on record, a lira order and a euro
 * order have no single total, as COGS already says (F-339).
 */
export class MixedCurrencySpendError extends Error {
  constructor(readonly currencies: string[]) {
    super(
      `Purchase spend could not be totalled: the deliveries in this window were paid in ${currencies.join(" and ")}, and with no exchange rate on record they cannot be added into one figure.`,
    );
    this.name = "MixedCurrencySpendError";
  }
}

/**
 * A spend total refused because every delivery in its window was paid in one
 * currency that is not the house's (F-1052). A goal's target is in the house's
 * money, so a euro sum is not progress towards a lira target, and nothing
 * converts one into the other. A `MixedCurrencySpendError`, so every reader
 * that already refuses a two-currency total refuses this one too.
 */
export class ForeignCurrencySpendError extends MixedCurrencySpendError {
  constructor(
    readonly currency: string,
    readonly houseCurrency: string,
  ) {
    super([currency]);
    this.message = `Purchase spend could not be totalled: the deliveries in this window were paid in ${currency}, not the house's ${houseCurrency}, and with no exchange rate on record they cannot be set against a target in ${houseCurrency}.`;
    this.name = "ForeignCurrencySpendError";
  }
}
