/*
 * The week's net sales and the labour share of them (F-1549). /team printed
 * "target 28% of sales" beside a cost with no sales and no share, so the
 * target was never measured. The sales are the dashboard's: the till's
 * non-voided checks, net = subtotal, each filed on the house day it closed
 * (`netSalesByHouseDay`, ADR 0290 / ADR 0296). A day the till was sending
 * and took no check is 0, as on the dashboard; a week the till did not
 * cover from its first day to its last has no sales figure, and says why.
 * A day an owner or manager ruled out of the figures (a till outage, a
 * closure: `analytics_day_exclusions`, ADR 0317) with no check is not a
 * measured 0 either, as on the dashboard (F-1535): the week's sales are not
 * all known (F-1557).
 */

import {
  HOUSE_ZONE_UNSET,
  houseDayBounds,
  houseDayOf,
  houseToday,
} from "../common/house-day";
import { netSalesByHouseDay } from "../dashboard/dashboard.service";
import {
  PERIOD_TAX_NOTE_UNREAD,
  readPeriodTaxNote,
} from "../common/period-tax-note";
import { readAll } from "../providers/vendor-menu-supply";

export interface WeekSales {
  /** The week's net sales; `null` when they are not all known. */
  netSales: number | null;
  /** Why `netSales` is null, in the owner's words; `null` when it is known. */
  unknownWhy: string | null;
  /**
   * F-1588: when the week spans a day the house's net changed tax basis, the
   * sentence naming each stretch (`taxSwitchNote`); null or absent when its
   * net is on one basis, or no sales figure is given.
   */
  taxNote?: string | null;
}

const unknown = (why: string): WeekSales => ({
  netSales: null,
  unknownWhy: why,
});

/** `iso` + `n` days, calendar-safe. */
function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The net sales of the house week `weekStart`..+6, read as the dashboard
 * reads a month. Never throws: a failed read is said, not passed off as no
 * sales.
 */
export async function readWeekSales(
  client: { from: (table: string) => any },
  restaurantId: string,
  weekStart: string,
  zone: string | null,
  now: Date = new Date(),
): Promise<WeekSales> {
  if (!zone) return unknown(HOUSE_ZONE_UNSET);
  const weekEnd = plusDays(weekStart, 6);
  if (weekEnd >= houseToday(zone, now)) {
    return unknown(
      "This week is not over yet, so its sales are not all in. The share of sales is worked out once its last day closes.",
    );
  }
  const bounds = houseDayBounds(weekStart, weekEnd, zone);
  try {
    const [rows, first, latest, ruled] = await Promise.all([
      readAll("The week's checks", (after) => {
        let q = client
          .from("pos_checks")
          .select("id, subtotal, opened_at, closed_at")
          .eq("restaurant_id", restaurantId)
          .eq("voided", false)
          .gte("opened_at", bounds.readFromIso)
          .lt("opened_at", bounds.endIso);
        if (after) q = q.gt("id", after);
        return q;
      }),
      client
        .from("pos_checks")
        .select("opened_at")
        .eq("restaurant_id", restaurantId)
        .order("opened_at", { ascending: true })
        .limit(1),
      client
        .from("pos_checks")
        .select("opened_at, closed_at")
        .eq("restaurant_id", restaurantId)
        .order("opened_at", { ascending: false })
        .limit(1),
      client
        .from("analytics_day_exclusions")
        .select("business_date")
        .eq("restaurant_id", restaurantId)
        .gte("business_date", weekStart)
        .lte("business_date", weekEnd),
    ]);
    if (first.error) throw new Error(first.error.message);
    if (latest.error) throw new Error(latest.error.message);
    // An unread list would count a ruled-out outage as a quiet 0: say it.
    if (ruled.error) throw new Error(ruled.error.message);
    const ruledOut = new Set<string>(
      (ruled.data ?? []).map((r: any) =>
        String(r.business_date ?? "").slice(0, 10),
      ),
    );
    const since = houseDayOf(first.data?.[0]?.opened_at ?? null, zone);
    if (since === null) {
      return unknown(
        "No till is sending sales to this house yet, so the week's sales are not known.",
      );
    }
    if (since > weekStart) {
      return unknown(
        "The till began sending sales partway through this week, so the week's sales are not all known.",
      );
    }
    const days = netSalesByHouseDay(rows as any[], zone);
    let until = houseDayOf(latest.data?.[0] ?? null, zone);
    for (const date of days.keys()) {
      if (until === null || date > until) until = date;
    }
    if (until === null || until < weekEnd) {
      return unknown(
        "The till has sent no sales since before this week's last day, so the week's sales are not all known.",
      );
    }
    let sum = 0;
    let checks = 0;
    let missing = 0;
    for (let i = 0; i < 7; i++) {
      const date = plusDays(weekStart, i);
      const day = days.get(date);
      if (!day && ruledOut.has(date)) {
        return unknown(
          "A day this week was ruled out of the figures and the till took nothing on it, so the week's sales are not all known.",
        );
      }
      if (!day) continue; // the till was sending and took nothing: 0
      checks += day.checks;
      // F-1716: a day whose net covers only some of its checks is not that
      // day's sales. foldNetSales sums the checks that stated a net and is
      // null only when none did, so read the count, never the sum alone.
      missing += day.checks - day.net_checks;
      if (day.net_sales !== null) sum += day.net_sales;
    }
    if (missing > 0) {
      return unknown(
        `${missing} of this week's ${checks} checks ${missing === 1 ? "carries" : "carry"} no amount before tax, so the week's sales are not all known.`,
      );
    }
    // F-1588: the figure stands, and says when its days are on two bases
    // (ADR 0341 F2: no stored check is restamped). An unread answer history
    // is said, not taken as no change, and does not withhold the figure.
    const taxNote = await readPeriodTaxNote(
      client,
      restaurantId,
      zone,
      weekStart,
      weekEnd,
    ).catch(() => PERIOD_TAX_NOTE_UNREAD);
    return {
      netSales: Math.round(sum * 100) / 100,
      unknownWhy: null,
      taxNote,
    };
  } catch {
    return unknown(
      "This week's sales could not be read just now, so the share of sales is not shown.",
    );
  }
}

/**
 * The week's labour cost as a share of its net sales, to one place, or
 * `null` with why. `ownerShiftsLeftOut` > 0 means the cost is a manager's,
 * without the owner's shifts: a share of it would read low.
 */
export function labourShare(
  totalCost: number | null,
  sales: WeekSales,
  ownerShiftsLeftOut: number,
): { laborPct: number | null; laborPctWhy: string | null } {
  if (sales.netSales === null) {
    return { laborPct: null, laborPctWhy: sales.unknownWhy };
  }
  if (totalCost === null) {
    return {
      laborPct: null,
      laborPctWhy:
        "Some shifts have no wage on file, so the week's cost and its share of sales are not known.",
    };
  }
  if (ownerShiftsLeftOut > 0) {
    return {
      laborPct: null,
      laborPctWhy:
        "The cost here leaves out the owner's shifts, so no share of sales is given.",
    };
  }
  if (sales.netSales <= 0) {
    return {
      laborPct: null,
      laborPctWhy:
        "The till recorded no sales this week, so there is no share of sales to give.",
    };
  }
  return {
    laborPct: Math.round((totalCost / sales.netSales) * 1000) / 10,
    laborPctWhy: null,
  };
}
