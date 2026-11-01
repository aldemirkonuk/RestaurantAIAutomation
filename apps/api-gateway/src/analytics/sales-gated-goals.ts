/** Own module so the insight generator can import it without a cycle. */

/**
 * The goal metrics that are a sales holder's figure (ADR 0298 decision 9).
 * The feeds every role reads leave them out, and the goal producers, which
 * carry no sales gate yet, do not read them.
 *
 * Each member is a key of `GoalsService.SUPPORTED_METRICS`, which
 * `createGoal` checks before it stores the key as `metric_key`; a spec and a
 * claim hold that. Decision 9 names only the days-of-stock goal; staff still
 * see the other goal metrics until ADR 0348's post-#617 follow-up.
 */
export const SALES_GATED_GOAL_METRICS: ReadonlySet<string> = new Set([
  "days_of_inventory",
]);

/**
 * Whether a goal's `metric_key` is sales-gated: the one test every reader
 * uses. A row read without its key counts as gated, so a select that drops
 * the column withholds the goal rather than serving it to every role.
 */
export function isSalesGatedGoal(metricKey: unknown): boolean {
  if (metricKey === null || metricKey === undefined || metricKey === "") {
    return true;
  }
  return SALES_GATED_GOAL_METRICS.has(String(metricKey));
}

/** How a goal producer names the sales-gated goals it did not read. */
export function salesGatedBit(n: number): string {
  return `${n} on days of stock, a sales holder's figure this producer does not read yet (ADR 0298 decision 9)`;
}
