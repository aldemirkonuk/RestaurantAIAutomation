/*
 * The week's net sales and the labour share of them (F-1549). /team printed
 * "target 28% of sales" beside a cost with no sales and no share, so the
 * target was never measured. The sales are the dashboard's: the till's
 * non-voided checks, net = subtotal, each filed on the house day it closed
 * (`netSalesByHouseDay`, ADR 0290 / ADR 0296). A day the till was sending
 * and took no check is 0, as on the dashboard; a week the till did not
 * cover from its first day to its last has no sales figure, and says why.
 */

import {
  HOUSE_ZONE_UNSET,
  houseDayBounds,
  houseDayOf,
  houseToday,
} from "../common/house-day";
import { netSalesByHouseDay } from "../dashboard/dashboard.service";
import { readAll } from "../providers/vendor-menu-supply";

export interface WeekSales {
  /** The week's net sales; `null` when they are not all known. */
  netSales: number | null;
  /** Why `netSales` is null, in the owner's words; `null` when it is known. */
  unknownWhy: string | null;
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
    const [rows, first, latest] = await Promise.all([
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
    ]);
    if (first.error) throw new Error(first.error.message);
    if (latest.error) throw new Error(latest.error.message);
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
    for (let i = 0; i < 7; i++) {
      const day = days.get(plusDays(weekStart, i));
      if (!day) continue; // the till was sending and took nothing: 0
      if (day.net_sales === null) {
        return unknown(
          "Some of this week's checks carry no amount before tax, so the week's sales are not known.",
        );
      }
      sum += day.net_sales;
    }
    return { netSales: Math.round(sum * 100) / 100, unknownWhy: null };
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
