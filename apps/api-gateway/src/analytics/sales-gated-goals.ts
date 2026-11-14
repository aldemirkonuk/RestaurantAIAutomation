/** Own module so the insight generator can import it without a cycle. */

/**
 * The goal metrics that are a sales holder's figure (ADR 0298 decision 9).
 * The goal producers, which carry no sales gate yet, do not read them.
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

/**
 * The data classes (ADR 0145 ROLE_POLICY) a goal's READING belongs to: its
 * current value, its baseline and everything scored from them (ADR 0348
 * item 3, "POST goals ... a baseline revenue, spend or average check"; walk
 * r31 F7 and r33 R-F4: staff read "Wine revenue to 60k $50.1K of $60K").
 *
 * - Revenue and the average check are money read off the till.
 * - Purchasing spend is money paid to suppliers.
 * - Checks served and the wine attach rate are the till's counts.
 * - Days of stock divides stock at cost by the cost of what the till sold.
 * - Bottles sold is a volume. Volumes stay open to staff, as they do on the
 *   lenses (r30 call 3), until a ruling names them.
 *
 * Every key of `GoalsService.SUPPORTED_METRICS` has an entry here; a spec
 * holds that, so a new metric is classified when it is added.
 */
export const GOAL_READING_CLASSES: Readonly<Record<string, readonly string[]>> = {
  wine_revenue: ["money", "sales"],
  bottles_sold: [],
  purchase_spend: ["money", "suppliers"],
  checks: ["sales"],
  avg_check: ["money", "sales"],
  wine_attach_rate: ["sales"],
  days_of_inventory: ["money", "sales"],
};

/** What a goal whose metric is not known is read as: closed. */
const UNKNOWN_GOAL_READING: readonly string[] = ["money", "sales"];

/**
 * The classes of a goal's reading this caller is not sent, or `[]` when the
 * reading is theirs to read. The gate is the sales gate: owner and manager
 * see money, sales and suppliers, and staff (or an unknown role) see none of
 * them (ADR 0145 ROLE_POLICY), so one boolean answers all three. A gate that
 * is absent is closed. A goal read without its key, or with a key this list
 * does not know, is withheld rather than served to every role.
 */
export function goalReadingWithheldFor(
  metricKey: unknown,
  gate: { withSales?: boolean } = {},
): string[] {
  if (gate.withSales === true) return [];
  const key =
    metricKey === null || metricKey === undefined ? "" : String(metricKey);
  const classes = Object.prototype.hasOwnProperty.call(GOAL_READING_CLASSES, key)
    ? GOAL_READING_CLASSES[key]
    : UNKNOWN_GOAL_READING;
  return [...classes];
}
