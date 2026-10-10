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
 * here. The row is found through `policyFor`, as /ask finds it — case-blind,
 * `admin` reads the owner row, anything unknown reads the staff row. No role
 * (a session in no house) sees none.
 */

import { ForbiddenException } from "@nestjs/common";
import { policyFor } from "../ask-readings/reading-data-classes";

export function seesHouseAmounts(role: string | null | undefined): boolean {
  if (!role) return false;
  return policyFor(role).sees.includes("money");
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
    procurementSpendParts?: unknown;
  },
>(stats: T, role: string | null | undefined): T & { amounts: Amounts } {
  if (seesHouseAmounts(role)) return { ...stats, amounts: "shown" };
  // Each currency's part is money too (F-1055): it leaves with the totals.
  const { procurementSpendParts: _parts, ...rest } = stats;
  return {
    ...(rest as T),
    todayProcurementSpend: null,
    weekProcurementSpend: null,
    monthProcurementSpend: null,
    amounts: "withheld",
  };
}

/**
 * The month ledger: each day keeps its deliveries, bottles and events. The
 * per-currency spend lines are amounts too, so a withheld role is sent none.
 */
export function calendarForRole<
  T extends {
    daily: Array<{
      procurement_spend: number | null;
      procurement_spend_by_currency?: unknown;
    }>;
    monthly_procurement_spend: number | null;
    monthly_procurement_spend_by_currency?: unknown;
  },
>(ledger: T, role: string | null | undefined): T & { amounts: Amounts } {
  if (seesHouseAmounts(role)) return { ...ledger, amounts: "shown" };
  const { monthly_procurement_spend_by_currency: _month, ...rest } = ledger;
  return {
    ...(rest as T),
    daily: ledger.daily.map((d) => {
      const { procurement_spend_by_currency: _day, ...day } = d;
      return { ...day, procurement_spend: null };
    }),
    monthly_procurement_spend: null,
    amounts: "withheld",
  };
}
