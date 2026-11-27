/**
 * Which /reports registers a role may read (ADR 0348, the ruling r108 took
 * for the registers that hand staff supplier, cost and goal money).
 *
 * The rule is the insight feed's (`insights/insight-feed-role.ts`), kept in
 * this file's own table so a register's classes sit next to its name:
 *   - `financial`  Figures of record: the cellar at cost, COGS over 365 days,
 *                  the sell-price valuation and the margin. Money and
 *                  suppliers (the cost is what the house paid a vendor).
 *   - `cashflow`   Spend pacing and the "Against ourselves" spend half: what
 *                  was bought and what is committed. Money and suppliers.
 *   - `menu-engineering`  "Margin against movement": margin per bottle is the
 *                  menu price less what the house paid. Money and suppliers.
 *   - a goal whose metric is purchase spend (money and suppliers), or one
 *     read off the till (sales; money too where it is a currency).
 * A key this table does not know fails closed: only a role that sees every
 * class reads it. The till's own routes keep their `salesGateFor` gate; the
 * compare and plot paths are not here.
 */
import { DATA_CLASSES, DataClass, policyFor } from "../ask-readings/reading-data-classes";

const REGISTER_CLASSES: Readonly<Record<string, readonly DataClass[]>> = {
  financial: ["money", "suppliers"],
  cashflow: ["money", "suppliers"],
  // marginPerBottle is menu price minus lot WAC: against the price staff
  // already know it is the house's cost per bottle (r108 reports review).
  "menu-engineering": ["money", "suppliers"],
};

/**
 * Goal metrics by the classes they carry (the r108 ruling). A goal is the
 * register it reads: `purchase_spend` reads the order book; the five below it
 * read the till's checks and lines, which staff are not sent (#2096), so a
 * goal on them would hand staff the till by another door ("Wine revenue,
 * 4,210 of 9,000"). Days of stock reads the cellar, which staff see.
 */
const GOAL_METRIC_CLASSES: Readonly<Record<string, readonly DataClass[]>> = {
  purchase_spend: ["money", "suppliers"],
  wine_revenue: ["money", "sales"],
  avg_check: ["money", "sales"],
  checks: ["sales"],
  bottles_sold: ["sales"],
  wine_attach_rate: ["sales"],
  days_of_inventory: ["stock"],
};

export function readerSees(user?: { role?: string | null }): readonly DataClass[] {
  return policyFor(user?.role).sees;
}

function allSeen(need: readonly DataClass[], sees: readonly DataClass[]): boolean {
  return need.every((c) => sees.includes(c));
}

export function registerReadable(key: string, sees: readonly DataClass[]): boolean {
  return allSeen(REGISTER_CLASSES[key] ?? DATA_CLASSES, sees);
}

export function goalMetricReadable(metricKey: unknown, sees: readonly DataClass[]): boolean {
  const need = typeof metricKey === "string" ? GOAL_METRIC_CLASSES[metricKey] : undefined;
  return allSeen(need ?? DATA_CLASSES, sees);
}

/** What a withheld register answers: the fact, never a figure and never zero. */
export function withheldRegister(key: string) {
  return { withheldForRole: true, register: key };
}

/** A goal this role may not read: its id and nothing else (a name can carry an amount). */
export function withheldGoal(goal: { id?: unknown }) {
  return { id: goal?.id ?? null, withheldForRole: true };
}

/** The goals this role may read, the others as stubs, and how many were held. */
export function goalsForRole<T extends { id?: unknown; metric_key?: unknown }>(
  goals: readonly T[],
  sees: readonly DataClass[],
): { readable: T[]; withheld: Array<ReturnType<typeof withheldGoal>> } {
  const readable: T[] = [];
  const withheld: Array<ReturnType<typeof withheldGoal>> = [];
  for (const g of goals) {
    if (goalMetricReadable(g?.metric_key, sees)) readable.push(g);
    else withheld.push(withheldGoal(g));
  }
  return { readable, withheld };
}
