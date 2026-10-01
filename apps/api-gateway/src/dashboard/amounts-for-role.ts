/**
 * Who sees the house's money on the dashboard (DASH-W22).
 *
 * The founder, 2026-10-01, page walk-through: "A: hide amounts for staff
 * (Recommended)" — staff see counts, not money, and the gateway stops sending
 * the amounts to staff too, because hiding them only on the page would not
 * keep them private. It carries his earlier /ask rule onto this page: "do not
 * give money or sensitive incentives like sales etc to the staff" (ADR 0145).
 *
 * One test, read from the /ask role table, so "which role sees money" is
 * decided in one place: a role whose row sees the `money` class sees amounts
 * here. No role (a session in no house) sees none.
 */

import { ForbiddenException } from "@nestjs/common";
import { ROLE_POLICY } from "../ask-readings/reading-data-classes";

export function seesHouseAmounts(role: string | null | undefined): boolean {
  if (!role) return false;
  const policy = (ROLE_POLICY as Record<string, { sees: readonly string[] } | undefined>)[role];
  return policy?.sees.includes("money") === true;
}

/** The one line a refused role reads (the /ask refusals are one line too). */
export const AMOUNTS_REFUSAL =
  "Amounts are for the house's owners and managers.";

/** For the routes that are nothing but money: refuse, in words. */
export function assertSeesHouseAmounts(role: string | null | undefined): void {
  if (!seesHouseAmounts(role)) throw new ForbiddenException(AMOUNTS_REFUSAL);
}

type Amounts = "shown" | "withheld";

/** The stat cards: counts stay, the three spend figures become null. */
export function statsForRole<
  T extends {
    todayProcurementSpend: number | null;
    weekProcurementSpend: number | null;
    monthProcurementSpend: number | null;
  },
>(stats: T, role: string | null | undefined): T & { amounts: Amounts } {
  if (seesHouseAmounts(role)) return { ...stats, amounts: "shown" };
  return {
    ...stats,
    todayProcurementSpend: null,
    weekProcurementSpend: null,
    monthProcurementSpend: null,
    amounts: "withheld",
  };
}

/** The month ledger: each day keeps its deliveries, bottles and events. */
export function calendarForRole<
  T extends {
    daily: Array<{ procurement_spend: number | null }>;
    monthly_procurement_spend: number | null;
  },
>(ledger: T, role: string | null | undefined): T & { amounts: Amounts } {
  if (seesHouseAmounts(role)) return { ...ledger, amounts: "shown" };
  return {
    ...ledger,
    daily: ledger.daily.map((d) => ({ ...d, procurement_spend: null })),
    monthly_procurement_spend: null,
    amounts: "withheld",
  };
}
