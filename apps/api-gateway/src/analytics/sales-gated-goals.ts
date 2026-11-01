/** Own module so the insight generator can import it without a cycle. */

/**
 * The goal metrics that are a sales holder's figure (ADR 0298 decision 9).
 * The goal producers, which carry no sales gate yet, do not read them; the
 * insight feed and recommendations keep them for a viewer who sees sales.
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

/**
 * How a goal producer names the goals it did not read. It names both causes
 * `isSalesGatedGoal` counts, so a row read without its key is never reported
 * as a days-of-stock goal alone.
 */
export function salesGatedBit(n: number): string {
  return `${n} on days of stock or without a metric key, a sales holder's figure this producer does not read yet (ADR 0298 decision 9)`;
}

/** The insight type a goal's pace is filed under (`computeGoalsFamily`). */
export const GOAL_PACE_INSIGHT = "overall.revenue.goal_pace";

/**
 * The insight feed for one viewer (ADR 0298 decision 9): a sales-gated goal's
 * pace stays for a viewer who sees sales and is left out, and counted, for
 * any other. The stored feed holds every pace; this runs on each read. A live
 * record (`candidateKey`) and a stored row (`candidate_key`) both carry the
 * goal's key as `evidence.measureLabel`; a pace row without it counts as
 * gated.
 */
export function goalPaceForViewer<T>(
  rows: T[],
  withSales: boolean,
): { kept: T[]; salesGated: number } {
  if (withSales) return { kept: rows, salesGated: 0 };
  const kept: T[] = [];
  let salesGated = 0;
  for (const row of rows) {
    const r = row as {
      candidateKey?: unknown;
      candidate_key?: unknown;
      evidence?: { measureLabel?: unknown } | null;
    };
    const key = r?.candidateKey ?? r?.candidate_key;
    if (
      key === GOAL_PACE_INSIGHT &&
      isSalesGatedGoal(r?.evidence?.measureLabel)
    ) {
      salesGated += 1;
      continue;
    }
    kept.push(row);
  }
  return { kept, salesGated };
}
