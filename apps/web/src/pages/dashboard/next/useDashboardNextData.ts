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

import { useCallback, useEffect, useRef, useState } from 'react';
import { dashboardApi, inventoryApi, ordersApi } from '@/services/api';
import type { DashboardStats, InventoryItem, Order } from '@/services/api/types';

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
  severity: 'critical' | 'warning' | 'info' | string;
  title: string;
  message: string;
  actionUrl?: string;
  createdAt: string;
}

/** Raw calendar_events row as embedded in calendar-revenue daily[].events. */
export interface RawDayEvent {
  id?: string;
  title?: string;
  event_type?: string;
  event_time?: string | null;
  event_date?: string;
  color?: string | null;
  description?: string | null;
}

export interface DayLedger {
  date: string; // YYYY-MM-DD
  procurement_spend: number;
  bottles_sold: number; // bottles DELIVERED by vendors (frozen misnomer)
  events: RawDayEvent[];
  order_count: number;
}

export interface MonthLedger {
  year: number;
  month: number;
  daily: DayLedger[];
  monthlySpend: number;
  monthlyBottles: number;
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
  const [stats, setStats] = useState<DashboardStats | null | undefined>(undefined);
  const [pending, setPending] = useState<Order[] | null | undefined>(undefined);
  const [lowStock, setLowStock] = useState<InventoryItem[] | null | undefined>(undefined);
  const [activity, setActivity] = useState<ActivityItem[] | undefined>(undefined);
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
    window.addEventListener('ws:dashboard-invalidate', onWs);
    return () => {
      clearInterval(interval);
      window.removeEventListener('ws:dashboard-invalidate', onWs);
    };
  }, [refetch]);

  return { stats, pending, lowStock, activity, alerts, refetch };
}

/* ── The month ledger (GET /dashboard/calendar-revenue/:id) ─────────────── */

export type MonthLedgerState =
  | { state: 'loading' }
  | { state: 'unknown' }
  | { state: 'ready'; ledger: MonthLedger };

export function useMonthLedger(
  restaurantId: string | null,
  year: number,
  month: number,
): { month: MonthLedgerState; refetch: () => void } {
  const [state, setState] = useState<MonthLedgerState>({ state: 'loading' });
  const cache = useRef(new Map<string, MonthLedger>());
  const seq = useRef(0);

  const load = useCallback(
    (force = false) => {
      const key = `${year}-${month}`;
      if (!force) {
        const hit = cache.current.get(key);
        if (hit) {
          setState({ state: 'ready', ledger: hit });
          return;
        }
      }
      if (!restaurantId) {
        // Restaurant context still resolving — stay in loading rather than
        // flashing "couldn't be reached" during the first authenticated paint.
        setState({ state: 'loading' });
        return;
      }
      const mySeq = ++seq.current;
      setState({ state: 'loading' });
      dashboardApi.getCalendarRevenue(year, month, restaurantId).then((res) => {
        if (mySeq !== seq.current) return; // a later month superseded this one
        // The service swallows failures into { daily: [] }; a real month is
        // never shorter than 28 days, so an empty array means "unreachable".
        if (!res.daily || res.daily.length === 0) {
          setState({ state: 'unknown' });
          return;
        }
        // Deployed gateways predating the honest rename still send
        // `daily[].revenue` / `monthly_total` (the same vendor-spend figures
        // under the old misnomer — see services/api/dashboard.ts). Normalize
        // both shapes so the page reads either build truthfully.
        const daily: DayLedger[] = res.daily.map((d) => {
          const raw = d as DayLedger & { revenue?: number };
          return {
            date: raw.date,
            procurement_spend: raw.procurement_spend ?? raw.revenue ?? 0,
            bottles_sold: raw.bottles_sold ?? 0,
            events: raw.events ?? [],
            order_count: raw.order_count ?? 0,
          };
        });
        const legacyTotals = res as unknown as { monthly_total?: number };
        const ledger: MonthLedger = {
          year: res.year,
          month: res.month,
          daily,
          monthlySpend:
            res.monthly_procurement_spend ??
            legacyTotals.monthly_total ??
            daily.reduce((sum, d) => sum + d.procurement_spend, 0),
          monthlyBottles: res.monthly_bottles ?? 0,
        };
        cache.current.set(key, ledger);
        setState({ state: 'ready', ledger });
      });
    },
    [restaurantId, year, month],
  );

  useEffect(() => {
    load();
  }, [load]);

  // A WS nudge means the ledger may have moved — drop the cache, reload.
  useEffect(() => {
    const onWs = () => {
      cache.current.clear();
      load(true);
    };
    window.addEventListener('ws:dashboard-invalidate', onWs);
    return () => window.removeEventListener('ws:dashboard-invalidate', onWs);
  }, [load]);

  return { month: state, refetch: () => load(true) };
}

/* ── One day's delivered orders (GET /procurement/orders/history) ───────── */

export type DayOrdersState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'unknown' }
  | { state: 'ready'; orders: Order[] };

export function useDayOrders(restaurantId: string | null, date: string | null): DayOrdersState {
  const [state, setState] = useState<DayOrdersState>({ state: 'idle' });
  const seq = useRef(0);

  useEffect(() => {
    if (!date || !restaurantId) {
      setState({ state: 'idle' });
      return;
    }
    const mySeq = ++seq.current;
    setState({ state: 'loading' });
    // Ask for a generous window (an order delivered on `date` may have been
    // CREATED weeks earlier, and the server may window on either field) and
    // filter client-side to the exact day on deliveredAt — server range
    // semantics then cannot change what the panel claims happened this date.
    const from = new Date(date);
    from.setDate(from.getDate() - 45);
    const to = new Date(date);
    to.setDate(to.getDate() + 2);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    ordersApi
      // limit is capped at 100 by the gateway's validation (verified: 200 → 400).
      .getOrderHistory({ startDate: fmt(from), endDate: fmt(to), dateFrom: fmt(from), dateTo: fmt(to), limit: 100 })
      .then((res) => {
        if (mySeq !== seq.current) return;
        const orders = (res.data ?? []).filter(
          (o) => o.deliveredAt && o.deliveredAt.startsWith(date),
        );
        setState({ state: 'ready', orders });
      })
      .catch(() => {
        if (mySeq !== seq.current) return;
        setState({ state: 'unknown' });
      });
  }, [restaurantId, date]);

  return state;
}
