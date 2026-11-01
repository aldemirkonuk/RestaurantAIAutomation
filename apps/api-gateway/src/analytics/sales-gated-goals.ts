/** Own module so the insight generator can import it without a cycle. */

/**
 * The goal metrics that are a sales holder's figure (ADR 0298 decision 9).
 * The feeds every role reads leave them out, and the goal producers, which
 * carry no sales gate yet, do not read them.
 */
export const SALES_GATED_GOAL_METRICS: ReadonlySet<string> = new Set([
  "days_of_inventory",
]);

/** How a goal producer names the sales-gated goals it did not read. */
export function salesGatedBit(n: number): string {
  return `${n} on days of stock, a sales holder's figure this producer does not read yet (ADR 0298 decision 9)`;
}
