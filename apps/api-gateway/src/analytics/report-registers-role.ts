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
 *   - a goal whose metric is purchase spend (money and suppliers).
 * A key this table does not know fails closed: only a role that sees every
 * class reads it. The till's own routes keep their `salesGateFor` gate; the
 * compare and plot paths are not here.
 */
import { DATA_CLASSES, DataClass, policyFor } from "../ask-readings/reading-data-classes";

const REGISTER_CLASSES: Readonly<Record<string, readonly DataClass[]>> = {
  financial: ["money", "suppliers"],
  cashflow: ["money", "suppliers"],
};

/**
 * Goal metrics by the classes they carry. The five that read the till or a
 * day count carry none here: their withholding is the till's own ruling and
 * is not changed by this file. `purchase_spend` is the purchasing goal.
 */
const GOAL_METRIC_CLASSES: Readonly<Record<string, readonly DataClass[]>> = {
  purchase_spend: ["money", "suppliers"],
  wine_revenue: [],
  bottles_sold: [],
  checks: [],
  avg_check: [],
  wine_attach_rate: [],
  days_of_inventory: [],
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
