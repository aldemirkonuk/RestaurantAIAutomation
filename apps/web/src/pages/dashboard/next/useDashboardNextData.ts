/**
 * DashboardNext data layer — composes the EXISTING api services
 * (services/api/dashboard|orders|inventory) with one extra property the
 * legacy useDashboardData hook cannot express: per-slice unknowns.
 *
 * The house rule is that an unknown renders as an em dash, never as zero.
 * useDashboardData collapses a failed stats fetch into EMPTY_STATS (all
 * zeros), which is exactly the lie this page must not tell. So each slice
 * here is `T | null | undefined`:
 *
 *   undefined → still loading (skeleton)
 *   null      → the fetch failed (em dash / honest copy)
 *   T         → a real answer, including a real empty list
 *
 * Caveats inherited from the services (documented, not hidden):
 *  - getRecentActivity / getAlerts catch internally and return [] on failure,
 *    so for those two slices an empty list can also mean "unreachable"; the
 *    panels use neutral copy that is true in both cases.
 *  - getCalendarRevenue catches internally and returns { daily: [] }. A
 *    successful month always carries >= 28 day rows (the gateway fills every
 *    day), so `daily.length === 0` is decodable as "unknown".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { dashboardApi, inventoryApi, ordersApi } from "@/services/api";
import type {
  DashboardStats,
  InventoryItem,
  Order,
} from "@/services/api/types";

/* ── Gateway DTO shapes (dashboard.service.ts) ──────────────────────────── */

export interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description?: string;
  timestamp: string;
  entityId?: string;
  entityType?: string;
}

export interface AlertItem {
  id: string;
  type: string;
  severity: "critical" | "warning" | "info" | string;
  title: string;
  message: string;
  actionUrl?: string;
  createdAt: string;
}

/**
 * A calendar_events row as embedded in calendar-revenue daily[].events: the
 * five columns the gateway selects (ADR 0290, AW12), no more.
 */
export interface RawDayEvent {
  id?: string;
  title?: string | null;
  event_type?: string | null;
  event_time?: string | null;
  event_date?: string;
}

/**
 * One house day. Every figure is `number | null`: null is "not known" (no
 * zone set, no register, a day before the register's first check or after
 * its latest, a figure withheld) and renders as the em dash — never as 0. A
 * real 0 is a measured quiet day.
 */
export interface DayLedger {
  date: string; // YYYY-MM-DD, the HOUSE's date
  procurement_spend: number | null;
  bottles_sold: number | null; // bottles DELIVERED by vendors (frozen misnomer)
  events: RawDayEvent[];
  order_count: number | null;
  /** Sum of the day's check subtotals, voided left out (AW17: net). */
  net_sales: number | null;
  checks: number | null;
}

/**
 * Whether the month carries net sales:
 *  - shown       the register is connected and the caller may see sales
 *  - withheld    the caller's role does not see sales (staff)
 *  - no-register the house has never had a check land
 *  - unknown     not said (no zone set, or a gateway older than ADR 0290)
 */
export type MonthSales = "shown" | "withheld" | "no-register" | "unknown";

export interface MonthLedger {
  year: number;
  month: number;
  daily: DayLedger[];
  monthlySpend: number | null;
  monthlyBottles: number | null;
  monthlyNetSales: number | null;
  monthlyChecks: number | null;
  /** The zone the days are filed in; null = the house has none; undefined = not said. */
  timezone: string | null | undefined;
  zoneUnset: boolean;
  /** The house's own today, YYYY-MM-DD; null with no zone; undefined = not said. */
  today: string | null | undefined;
  sales: MonthSales;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * The house-local YYYY-MM-DD of an instant, or null when it cannot be read.
 * The gateway files every calendar day in the house's zone (ADR 0290), so a
 * timestamp is matched to a day the same way — never by the browser's zone
 * and never by the UTC prefix of the ISO string.
 */
export function houseDateOf(
  iso: string | null | undefined,
  zone: string,
): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(t);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    const y = get("year");
    const m = get("month");
    const d = get("day");
    return y && m && d ? `${y}-${m}-${d}` : null;
  } catch {
    return null; // a zone name this browser cannot read
  }
}

/* ── The spine: stats · approvals · low stock · activity · alerts ───────── */

export interface DashboardSpine {
  stats: DashboardStats | null | undefined;
  pending: Order[] | null | undefined;
  lowStock: InventoryItem[] | null | undefined;
  activity: ActivityItem[] | undefined; // [] may mean unreachable (see header)
  alerts: AlertItem[] | undefined; //      "
  refetch: () => Promise<void>;
}

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export function useDashboardSpine(restaurantId: string | null): DashboardSpine {
  const [stats, setStats] = useState<DashboardStats | null | undefined>(
    undefined,
  );
  const [pending, setPending] = useState<Order[] | null | undefined>(undefined);
  const [lowStock, setLowStock] = useState<InventoryItem[] | null | undefined>(
    undefined,
  );
  const [activity, setActivity] = useState<ActivityItem[] | undefined>(
    undefined,
  );
  const [alerts, setAlerts] = useState<AlertItem[] | undefined>(undefined);
  const alive = useRef(true);

  const refetch = useCallback(async () => {
    if (!restaurantId) {
      // AuthContext resolves activeRestaurantId a beat after login; until it
      // does, "loading" is the honest state — flipping to "unknown" here made
      // the first paint claim the gateway was down when it wasn't.
      return;
    }
    const [s, p, l, act, al] = await Promise.all([
      settle(dashboardApi.getDashboardStats(restaurantId)),
      settle(ordersApi.getOrdersNeedingApproval(restaurantId)),
      settle(inventoryApi.getLowStockItems(restaurantId)),
      settle(dashboardApi.getRecentActivity(12, restaurantId)),
      settle(dashboardApi.getAlerts(restaurantId)),
    ]);
    if (!alive.current) return;
    setStats(s);
    setPending(Array.isArray(p) ? p : null);
    setLowStock(Array.isArray(l) ? l : null);
    setActivity(Array.isArray(act) ? (act as ActivityItem[]) : []);
    setAlerts(Array.isArray(al) ? (al as AlertItem[]) : []);
  }, [restaurantId]);

  useEffect(() => {
    alive.current = true;
    refetch();
    return () => {
      alive.current = false;
    };
  }, [refetch]);

  // Same refresh contract as the legacy hook: 5-minute interval + WS nudge.
  useEffect(() => {
    const interval = setInterval(refetch, 5 * 60 * 1000);
    const onWs = () => refetch();
    window.addEventListener("ws:dashboard-invalidate", onWs);
    return () => {
      clearInterval(interval);
      window.removeEventListener("ws:dashboard-invalidate", onWs);
    };
  }, [refetch]);

  return { stats, pending, lowStock, activity, alerts, refetch };
}

/* ── The month ledger (GET /dashboard/calendar-revenue/:id) ─────────────── */

export type MonthLedgerState =
  | { state: "loading" }
  | { state: "unknown" }
  | { state: "ready"; ledger: MonthLedger };

export function useMonthLedger(
  restaurantId: string | null,
  year: number,
  month: number,
): { month: MonthLedgerState; refetch: () => void } {
  const [state, setState] = useState<MonthLedgerState>({ state: "loading" });
  const cache = useRef(new Map<string, MonthLedger>());
  const seq = useRef(0);

  const load = useCallback(
    (force = false) => {
      const mySeq = ++seq.current;
      const key = `${restaurantId}:${year}-${month}`;
      if (!force) {
        const hit = cache.current.get(key);
        if (hit) {
          setState({ state: "ready", ledger: hit });
          return;
        }
      }
      if (!restaurantId) {
        // Restaurant context still resolving — stay in loading rather than
        // flashing "couldn't be reached" during the first authenticated paint.
        setState({ state: "loading" });
        return;
      }
      setState({ state: "loading" });
      dashboardApi.getCalendarRevenue(year, month, restaurantId).then((res) => {
        if (mySeq !== seq.current) return; // a later month superseded this one
        // The service swallows a thrown failure into { daily: [] } — but a 200
        // with a null/empty body resolves the promise with `res` itself null,
        // which `!res.daily` cannot see (reading `.daily` off null throws
        // before the `!` ever runs). `res?.daily` covers both: no response
        // object, and a response object with no days. A real month is never
        // shorter than 28 days, so either case means "unreachable", not zero.
        if (!res?.daily || res.daily.length === 0) {
          setState({ state: "unknown" });
          return;
        }
        // Deployed gateways predating the honest rename still send
        // `daily[].revenue` / `monthly_total` (the same vendor-spend figures
        // under the old misnomer — see services/api/dashboard.ts). Normalize
        // both shapes so the page reads either build truthfully. A null
        // stays null: it is "not known" (no zone, no register, withheld), and
        // `?? 0` here once turned every one of those into a drawn zero.
        const daily: DayLedger[] = res.daily.map((d) => {
          const raw = d as typeof d & { revenue?: number };
          return {
            date: raw.date,
            procurement_spend:
              raw.procurement_spend !== undefined
                ? num(raw.procurement_spend)
                : num(raw.revenue),
            bottles_sold: num(raw.bottles_sold),
            events: raw.events ?? [],
            order_count: num(raw.order_count),
            net_sales: num(raw.net_sales),
            checks: num(raw.checks),
          };
        });
        const legacyTotals = res as unknown as { monthly_total?: number };
        const summedSpend = daily.every((d) => d.procurement_spend !== null)
          ? daily.reduce((sum, d) => sum + (d.procurement_spend ?? 0), 0)
          : null;
        const ledger: MonthLedger = {
          year: res.year,
          month: res.month,
          daily,
          monthlySpend:
            res.monthly_procurement_spend !== undefined
              ? num(res.monthly_procurement_spend)
              : legacyTotals.monthly_total !== undefined
                ? num(legacyTotals.monthly_total)
                : summedSpend,
          monthlyBottles: num(res.monthly_bottles),
          monthlyNetSales: num(res.monthly_net_sales),
          monthlyChecks: num(res.monthly_checks),
          timezone: res.timezone,
          zoneUnset: res.zone_unset === true,
          today: res.today,
          sales:
            res.sales_withheld === true
              ? "withheld"
              : res.pos_connected === true
                ? "shown"
                : res.pos_connected === false
                  ? "no-register"
                  : "unknown",
        };
        cache.current.set(key, ledger);
        setState({ state: "ready", ledger });
      }).catch(() => {
        // `getCalendarRevenue` already catches a thrown request into a fallback
        // object, so reaching here means something else broke (a bug in that
        // catch, a rejection from `.then` itself) — an unhandled rejection is
        // strictly worse than the honest 'unknown' the two branches above show,
        // so this must land the same place they do, not stay in 'loading'
        // forever (defect 6, live-review.md 2026-09-17).
        if (mySeq !== seq.current) return;
        setState({ state: "unknown" });
      });
    },
    [restaurantId, year, month],
  );

  useEffect(() => {
    load();
    return () => {
      seq.current += 1;
    };
  }, [load]);

  // A WS nudge means the ledger may have moved — drop the cache, reload.
  useEffect(() => {
    const onWs = () => {
      cache.current.clear();
      load(true);
    };
    window.addEventListener("ws:dashboard-invalidate", onWs);
    return () => window.removeEventListener("ws:dashboard-invalidate", onWs);
  }, [load]);

  return { month: state, refetch: () => load(true) };
}

/* ── One day's delivered orders (GET /procurement/orders/history) ───────── */

export type DayOrdersState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "unknown" }
  /** The house has no time zone, so no delivery can be filed on a day. */
  | { state: "no-zone" }
  | { state: "ready"; orders: Order[] };

/**
 * `zone` is the house's zone from the month ledger: a string files each
 * delivery on its house date (the gateway's rule, ADR 0290); null means the
 * house has none, so nothing is listed; undefined means an older gateway did
 * not say, and the UTC prefix of `deliveredAt` is kept as before.
 */
export function useDayOrders(
  restaurantId: string | null,
  date: string | null,
  zone?: string | null,
): DayOrdersState {
  const [state, setState] = useState<DayOrdersState>({ state: "idle" });
  const seq = useRef(0);

  useEffect(() => {
    if (!date || !restaurantId) {
      setState({ state: "idle" });
      return;
    }
    if (zone === null) {
      seq.current += 1;
      setState({ state: "no-zone" });
      return;
    }
    const mySeq = ++seq.current;
    setState({ state: "loading" });
    // Ask for a generous window (an order delivered on `date` may have been
    // CREATED weeks earlier, and the server may window on either field) and
    // filter client-side to the exact day on deliveredAt — server range
    // semantics then cannot change what the panel claims happened this date.
    const from = new Date(date);
    from.setDate(from.getDate() - 45);
    const to = new Date(date);
    to.setDate(to.getDate() + 2);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    ordersApi
      // limit is capped at 100 by the gateway's validation (verified: 200 → 400).
      .getOrderHistory({
        startDate: fmt(from),
        endDate: fmt(to),
        dateFrom: fmt(from),
        dateTo: fmt(to),
        limit: 100,
      })
      .then((res) => {
        if (mySeq !== seq.current) return;
        const orders = (res.data ?? []).filter((o) =>
          zone
            ? houseDateOf(o.deliveredAt, zone) === date
            : Boolean(o.deliveredAt && o.deliveredAt.startsWith(date)),
        );
        setState({ state: "ready", orders });
      })
      .catch(() => {
        if (mySeq !== seq.current) return;
        setState({ state: "unknown" });
      });
  }, [restaurantId, date, zone]);

  return state;
}
