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

/**
 * Does this role see the house's sales? The same /ask row as
 * `seesHouseSales` in dashboard.controller.ts (owner and manager see `sales`);
 * no role sees none. Kept here so the month's second barrier reads the rule
 * without importing the controller.
 */
function seesSales(role: string | null | undefined): boolean {
  if (!role) return false;
  return policyFor(role).sees.includes("sales");
}

/** The register's figures on the month, as the service's withheld path leaves them. */
type MonthSales = {
  monthly_net_sales?: number | null;
  monthly_checks?: number | null;
  monthly_net_checks?: number | null;
  monthly_days_counted?: number | null;
  monthly_days_begun?: number | null;
  pos_connected?: boolean | null;
  sales_withheld?: boolean;
};
type DaySales = {
  net_sales?: number | null;
  checks?: number | null;
  net_checks?: number | null;
};

/**
 * The month ledger: each day keeps its deliveries, bottles and events.
 *
 * Sales are withheld here too, for a role that does not see them (PR #579
 * audit note 5). The service already reads no register unless the
 * controller asks (`withSales`, ADR 0290 §5); this is the second barrier, so
 * a service that one day answered with sales anyway still sends none to
 * staff. Withheld reads exactly as the service's own withheld month: every
 * sales figure null, `pos_connected` null, `sales_withheld` true.
 */
export function calendarForRole<
  T extends {
    daily: Array<{ procurement_spend: number | null } & DaySales>;
    monthly_procurement_spend: number | null;
  } & MonthSales,
>(ledger: T, role: string | null | undefined): T & { amounts: Amounts } {
  const month: T = seesSales(role)
    ? ledger
    : {
        ...ledger,
        daily: ledger.daily.map((d) => ({
          ...d,
          net_sales: null,
          checks: null,
          net_checks: null,
        })),
        monthly_net_sales: null,
        monthly_checks: null,
        monthly_net_checks: null,
        monthly_days_counted: null,
        monthly_days_begun: null,
        pos_connected: null,
        sales_withheld: true,
      };
  if (seesHouseAmounts(role)) return { ...month, amounts: "shown" };
  return {
    ...month,
    daily: month.daily.map((d) => ({ ...d, procurement_spend: null })),
    monthly_procurement_spend: null,
    amounts: "withheld",
  };
}
