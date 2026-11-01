/** Own module so the insight generator can import it without a cycle. */

/**
 * Why a days-of-stock goal is not scored for a caller without the sales class
 * (ADR 0298 decision 9): it is cost of goods over the cellar, and that
 * record decides to read cost of goods from the till.
 */
export const DAYS_OF_STOCK_WITHHELD =
  "Days of stock is an owner's or a manager's figure to see, so it is not scored here.";

/**
 * The goal metrics scored only with the sales gate open (ADR 0298 decision
 * 9).
 */
export const SALES_GATED_GOAL_METRICS: ReadonlySet<string> = new Set([
  "days_of_inventory",
]);
