/**
 * What a delivered order cost, or that its cost is not known.
 *
 * `procurement_orders` carries two money columns: `total_cost` (what the
 * order came to) and `final_price` (the price settled for it). Either can be
 * NULL on an order nobody has costed yet, and `0` is not a cost anyone
 * recorded: no supplier delivers a case for nothing. The readers used to write
 * `o.total_cost || o.final_price || 0`, so an uncosted order joined every
 * purchasing total as $0. A "keep purchases under $25k" goal then read lower
 * than the truth and could read as met (ADR 0020: a smaller number is not a
 * smaller truth, it is a wrong one).
 *
 * The rule, the same one `AnalyticsService.loadDeliveredOrders` already keeps
 * for the financial summary: a recorded figure above 0, `total_cost` first,
 * else `null`. A total that would rest on a `null` is refused, never summed
 * short.
 */
export function orderCostOrNull(o: {
  total_cost?: unknown;
  final_price?: unknown;
}): number | null {
  return positive(o?.total_cost) ?? positive(o?.final_price);
}

function positive(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

const orders = (n: number) => `${n} delivered order${n === 1 ? "" : "s"}`;

/**
 * A purchasing total that would rest on an order with no recorded cost. The
 * goal reads "could not be read" with this sentence
 * (`GoalsService.listGoalsWithProgress`), as a bottles goal does with
 * `UncountedConsumptionError`.
 */
export class UncostedOrdersError extends Error {
  constructor(
    readonly uncosted: number,
    readonly total: number,
  ) {
    super(
      `Purchasing spend could not be summed: ${uncosted} of the ${orders(total)} in this window ${uncosted === 1 ? "carries" : "carry"} no recorded cost, so a total would be short rather than true. Record what ${uncosted === 1 ? "that order" : "those orders"} cost to read it.`,
    );
    this.name = "UncostedOrdersError";
  }
}
