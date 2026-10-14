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
 *  - getRecentActivity / getAlerts reject on failure (F-752), so those two
 *    slices follow the same rule: null is "could not be read", [] is quiet.
 *  - getDashboardStats falls back to a stats object without the spend or the
 *    delivery counts when its own route fails; it marks that (F-751), and
 *    `totalsUnread` reads the mark.
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
import { formatMoney } from "@/lib/utils";
import { getHouseLocale } from "@/lib/houseCurrency";
import { houseMidnight } from "@/lib/houseCalendar";

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
 * real 0 is a measured quiet day. One null is not "unknown": `net_sales` is
 * null with `checks > 0` when not one check carried a subtotal, which reads
 * "not recorded" (netsales F1, "Count and say").
 */
export interface DayLedger {
  date: string; // YYYY-MM-DD, the HOUSE's date
  procurement_spend: number | null;
  /** The code `procurement_spend` is in; null = the house's (F-1052). */
  procurement_spend_currency: string | null;
  /** Each currency's part; what a two-currency day shows (F-1055). */
  procurement_spend_parts: SpendPart[];
  /**
   * Deliveries with no price, left out of `procurement_spend` (F-1442). Null
   * when the gateway did not say; read it through `unpricedOf`.
   */
  procurement_unpriced: number | null;
  bottles_sold: number | null; // bottles DELIVERED by vendors (frozen misnomer)
  events: RawDayEvent[];
  order_count: number | null;
  /** Sum of the subtotals the day's checks carried, voided left out (AW17: net). */
  net_sales: number | null;
  /** Every check on the day. */
  checks: number | null;
  /** The checks that carried a subtotal: "from net_checks of checks". */
  net_checks: number | null;
  /**
   * An owner or manager ruled the day out of the figures (F-1535). With no
   * check on it, `checks` is null: it is not a day of no sales.
   */
  excluded?: boolean;
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
  /** The code `monthlySpend` is in; null = the house's (F-1052). */
  monthlySpendCurrency: string | null;
  /** Each currency's part of the month's spend (F-1055). */
  monthlySpendParts: SpendPart[];
  /** The month's deliveries with no price, left out of `monthlySpend` (F-1442). */
  monthlyUnpriced: number | null;
  monthlyBottles: number | null;
  /** The begun days the register counted, summed (founder 2026-10-05: "Sum, say N of M days"). */
  monthlyNetSales: number | null;
  monthlyChecks: number | null;
  monthlyNetChecks: number | null;
  /** Begun days the register counted, of `monthlyDaysBegun`. */
  monthlyDaysCounted: number | null;
  monthlyDaysBegun: number | null;
  /** F-1591: checks whose net the house's tax settings left unrecorded; null = not said. */
  monthlyNetNotRecordedByTax: number | null;
  /** F-1588: the first day net is before tax, when the month mixes it with checks as sent. */
  taxSwitchDay: string | null;
  monthlyChecksAsSent: number | null;
  /** The zone the days are filed in; null = the house has none; undefined = not said. */
  timezone: string | null | undefined;
  zoneUnset: boolean;
  /** The house's own today, YYYY-MM-DD; null with no zone; undefined = not said. */
  today: string | null | undefined;
  sales: MonthSales;
  /**
   * DASH-W22: 'withheld' when the gateway stripped the money for the caller's
   * role. The spend fields then read null here and must not be drawn as money.
   */
  amounts: "shown" | "withheld";
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/* ── Vendor spend in its own currency (F-1052, F-1055) ─────────────────── */

/** One currency's part of a vendor-spend figure; a null code is the house's. */
export interface SpendPart {
  currency: string | null;
  amount: number;
}

/** A currency code as sent, or null (the house's money). */
const codeOf = (v: unknown): string | null =>
  typeof v === "string" && /^[A-Za-z]{3}$/.test(v.trim())
    ? v.trim().toUpperCase()
    : null;

/** The parts the gateway sent, read safely; [] when none came. */
export function spendPartsFrom(v: unknown): SpendPart[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (p): p is { currency?: unknown; amount: number } =>
        !!p && typeof p === "object" && num((p as { amount?: unknown }).amount) !== null,
    )
    .map((p) => ({ currency: codeOf(p.currency), amount: p.amount }));
}

/**
 * Spend in the currency it was paid in: a single figure from a euro importer
 * in a lira house reads €1.200, never ₺1.200 (F-1052). No code is the house's
 * own money. The em dash for unknown, as every figure on this page.
 */
export function spendMoney(
  v: number | null | undefined,
  currency: string | null | undefined,
  mode: "compact" | "full" = "full",
): string {
  if (v == null || Number.isNaN(v)) return "—";
  return formatMoney(v, mode, currency ?? undefined);
}

/**
 * A spend paid in two currencies, said as its parts — "₺12.000 and €1.200" —
 * where the total would be a bare dash (F-1055). Null when there are not two
 * parts to say.
 */
export function spendPartsSaid(
  parts: SpendPart[] | null | undefined,
  mode: "compact" | "full" = "full",
): string | null {
  if (!parts || parts.length < 2) return null;
  return parts
    .map((p) => formatMoney(p.amount, mode, p.currency ?? undefined))
    .join(" and ");
}

/**
 * What each day's bar or tint is measured against: the month's largest figure
 * IN THE SAME CURRENCY (F-1088). With `currencyOf` the days are scaled per
 * currency, so a €5.000 day never shrinks a ₺100 day to a sliver, nor the
 * reverse: two currencies are never compared without an exchange rate.
 * Without it (sales, order counts) the whole month shares one scale.
 */
export function barScaleOf(
  daily: DayLedger[],
  value: (d: DayLedger) => number | null,
  currencyOf?: (d: DayLedger) => string | null,
): (d: DayLedger) => number {
  const max = new Map<string | null, number>();
  for (const d of daily) {
    const key = currencyOf ? currencyOf(d) : null;
    max.set(key, Math.max(max.get(key) ?? 1, value(d) ?? 0));
  }
  return (d) => max.get(currencyOf ? currencyOf(d) : null) ?? 1;
}

/** Why the parts above are not one figure, in the owner's words. */
export const SPEND_KEPT_APART = "kept apart, no exchange rate on record";

/** One window of the stat cards' spend, as `getStats` sends it (F-1055). */
export interface StatsSpendParts {
  currency: string | null;
  parts: SpendPart[];
  note: string | null;
}

/**
 * The stat cards' code, parts and reason for one window. Read here, as
 * `houseZoneOf` reads the zone, rather than added to the shared
 * `DashboardStats` type. An older gateway sends none: the house's money, no
 * parts.
 */
export function statsSpendOf(
  stats: DashboardStats | null | undefined,
  window: "today" | "week" | "month",
): StatsSpendParts {
  const all = (stats as { procurementSpendParts?: unknown } | null | undefined)
    ?.procurementSpendParts;
  const w =
    all && typeof all === "object"
      ? ((all as Record<string, unknown>)[window] as
          | { currency?: unknown; byCurrency?: unknown; note?: unknown }
          | undefined)
      : undefined;
  return {
    currency: codeOf(w?.currency),
    parts: spendPartsFrom(w?.byCurrency),
    note: typeof w?.note === "string" && w.note ? w.note : null,
  };
}

/** What a delivery with no price reads in place of an amount (F-1442). */
export const PRICE_NOT_KNOWN = "price not known";

/**
 * A day's deliveries with no price, left out of its spend (F-1442, F-701). An
 * older gateway sends no count; a day it says paid 0 for N deliveries was
 * then N unpriced, since a priced order always carries more than 0.
 */
export function unpricedOf(day: DayLedger): number {
  if (day.procurement_unpriced != null) return day.procurement_unpriced;
  return day.procurement_spend === 0 && (day.order_count ?? 0) > 0
    ? (day.order_count as number)
    : 0;
}

/** A count beside house money, grouped the house's way (F-1603). */
const count = (n: number) => n.toLocaleString(getHouseLocale());

/** "N with price not known, not counted", or null when there are none. */
export function unpricedSaid(n: number | null | undefined): string | null {
  return typeof n === "number" && n > 0
    ? `${count(n)} with ${PRICE_NOT_KNOWN}, not counted`
    : null;
}

/** What a net figure reads when checks came and not one carried a subtotal. */
export const NOT_RECORDED = "not recorded";


/**
 * "from N of M checks" when only some of the checks carried a subtotal, so
 * the net figure beside it is short of what the checks came to (netsales F1,
 * "Count and say"). Null when every check carried one, when none did (that
 * reads NOT_RECORDED), and when either count is not known.
 */
export function fromChecks(
  netChecks: number | null | undefined,
  checks: number | null | undefined,
): string | null {
  if (netChecks == null || checks == null) return null;
  if (netChecks <= 0 || netChecks >= checks) return null;
  return `from ${count(netChecks)} of ${count(checks)} checks`;
}

/**
 * "from N of M days" when the month's figure sums only some of its begun days
 * — a day before the register began or after its latest check is not known
 * (the founder, 2026-10-05: "Sum, say N of M days"). Null when every begun day
 * is counted, when none is, and when either count is not known.
 */
export function fromDays(
  counted: number | null | undefined,
  begun: number | null | undefined,
): string | null {
  if (counted == null || begun == null) return null;
  if (counted <= 0 || counted >= begun) return null;
  return `from ${count(counted)} of ${count(begun)} days`;
}

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
  activity: ActivityItem[] | null | undefined;
  alerts: AlertItem[] | null | undefined;
  refetch: () => Promise<void>;
}

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

/**
 * DASH-W20: the zone the gateway bucketed the figures in (`stats.timezone`),
 * or null until the stats answer. Read here rather than added to the shared
 * `DashboardStats` type, which this page branch does not own.
 */
export function houseZoneOf(stats: DashboardStats | null | undefined): string | null {
  const z = (stats as { timezone?: unknown } | null | undefined)?.timezone;
  return typeof z === "string" && z.length > 0 ? z : null;
}

/**
 * F-751: true when the stats came from the client fallback, which has the
 * cellar counts but not the spend, today's deliveries or this month's bottles.
 */
export function totalsUnread(stats: DashboardStats | null | undefined): boolean {
  return (stats as { totalsUnread?: unknown } | null | undefined)?.totalsUnread === true;
}

export function useDashboardSpine(restaurantId: string | null): DashboardSpine {
  const [stats, setStats] = useState<DashboardStats | null | undefined>(
    undefined,
  );
  const [pending, setPending] = useState<Order[] | null | undefined>(undefined);
  const [lowStock, setLowStock] = useState<InventoryItem[] | null | undefined>(
    undefined,
  );
  const [activity, setActivity] = useState<ActivityItem[] | null | undefined>(
    undefined,
  );
  const [alerts, setAlerts] = useState<AlertItem[] | null | undefined>(undefined);
  // Each read takes a number; only the latest one may land. One shared
  // `alive` flag was set true again by the next house's effect before the
  // last house's reads came back, so they landed (F-220).
  const seq = useRef(0);

  // Another house: nothing of the last one stays on screen while its own
  // figures are read.
  const [spineHouse, setSpineHouse] = useState(restaurantId);
  if (spineHouse !== restaurantId) {
    setSpineHouse(restaurantId);
    setStats(undefined);
    setPending(undefined);
    setLowStock(undefined);
    setActivity(undefined);
    setAlerts(undefined);
  }

  const refetch = useCallback(async () => {
    const mine = ++seq.current;
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
    if (mine !== seq.current) return;
    setStats(s);
    setPending(Array.isArray(p) ? p : null);
    setLowStock(Array.isArray(l) ? l : null);
    setActivity(Array.isArray(act) ? (act as ActivityItem[]) : null);
    setAlerts(Array.isArray(al) ? (al as AlertItem[]) : null);
  }, [restaurantId]);

  useEffect(() => {
    refetch();
    return () => {
      // Unmounted or another house: whatever is still on its way is dropped.
      seq.current++;
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
          const raw = d as typeof d & {
            revenue?: number;
            procurement_spend_currency?: unknown;
            procurement_spend_by_currency?: unknown;
            procurement_unpriced?: unknown;
          };
          return {
            date: raw.date,
            procurement_spend:
              raw.procurement_spend !== undefined
                ? num(raw.procurement_spend)
                : num(raw.revenue),
            procurement_spend_currency: codeOf(raw.procurement_spend_currency),
            procurement_spend_parts: spendPartsFrom(raw.procurement_spend_by_currency),
            procurement_unpriced: num(raw.procurement_unpriced),
            bottles_sold: num(raw.bottles_sold),
            events: raw.events ?? [],
            order_count: num(raw.order_count),
            net_sales: num(raw.net_sales),
            checks: num(raw.checks),
            net_checks: num(raw.net_checks),
            excluded: raw.excluded === true,
          };
        });
        const legacyTotals = res as unknown as {
          monthly_total?: number;
          amounts?: string;
          monthly_procurement_spend_currency?: unknown;
          monthly_procurement_spend_by_currency?: unknown;
          monthly_procurement_unpriced?: unknown;
          monthly_net_not_recorded_by_tax?: unknown;
          tax_switch_day?: unknown;
          monthly_checks_as_sent?: unknown;
        };
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
          monthlySpendCurrency: codeOf(legacyTotals.monthly_procurement_spend_currency),
          monthlySpendParts: spendPartsFrom(legacyTotals.monthly_procurement_spend_by_currency),
          monthlyUnpriced: num(legacyTotals.monthly_procurement_unpriced),
          monthlyBottles: num(res.monthly_bottles),
          monthlyNetSales: num(res.monthly_net_sales),
          monthlyChecks: num(res.monthly_checks),
          monthlyNetChecks: num(res.monthly_net_checks),
          monthlyDaysCounted: num(res.monthly_days_counted),
          monthlyDaysBegun: num(res.monthly_days_begun),
          monthlyNetNotRecordedByTax: num(legacyTotals.monthly_net_not_recorded_by_tax),
          taxSwitchDay: typeof legacyTotals.tax_switch_day === 'string' ? legacyTotals.tax_switch_day : null,
          monthlyChecksAsSent: num(legacyTotals.monthly_checks_as_sent),
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
          amounts: legacyTotals.amounts === "withheld" ? "withheld" : "shown",
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

/** Pages a busy day may take before the list is called unknown, not short. */
const DAY_DELIVERY_PAGES = 50;

/** Every order delivered in [from, to), page by page (limit is capped at 100). */
async function readDayDeliveries(from: string, to: string): Promise<Order[]> {
  const out: Order[] = [];
  for (let page = 1; page <= DAY_DELIVERY_PAGES; page++) {
    const res = await ordersApi.getOrderHistory({
      deliveredFrom: from,
      deliveredTo: to,
      limit: 100,
      page,
    });
    out.push(...(res.data ?? []));
    if (!res.hasMore || (res.data ?? []).length === 0) return out;
  }
  throw new Error("The day holds more deliveries than one read lists.");
}

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
    // The house day's own instants, read by delivery and paged to the end
    // (F-1202). It used to ask for the 100 newest orders CREATED in the 45
    // days around the day, so a busy house's older days could not be listed,
    // and the bounds came from the browser's clock, so a US house lost its
    // evening deliveries. An older gateway that did not say its zone (zone
    // undefined) keeps UTC days, as the filter below does.
    const [y, m, d] = date.split("-").map(Number);
    const at = (day: number) =>
      new Date(
        zone ? houseMidnight(zone, y, m, day) : Date.UTC(y, m - 1, day),
      ).toISOString();
    readDayDeliveries(at(d), at(d + 1))
      .then((rows) => {
        if (mySeq !== seq.current) return;
        const orders = rows.filter((o) =>
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

/* ── One day's activity (GET /dashboard/activity/:id?date=) ─────────────── */

/** The most lines one day's sheet asks for; more are said, not dropped. */
export const DAY_ACTIVITY_LIMIT = 100;

export type DayActivityState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "unknown" }
  /** The house has no time zone, so no line can be filed on a day. */
  | { state: "no-zone" }
  /** `cut` = the day holds at least DAY_ACTIVITY_LIMIT lines; older ones were not read. */
  | { state: "ready"; items: ActivityItem[]; cut: boolean };

/**
 * The day sheet's own activity read (F-431). It used to filter the twelve
 * newest lines of the whole house by date, so every day older than those
 * twelve said "No recorded activity" however busy it was. Now the gateway
 * bounds the read to the house's day. `zone` follows `useDayOrders`: null =
 * the house has none (nothing is read); undefined = an older gateway did not
 * say, and the read is still asked for.
 */
export function useDayActivity(
  restaurantId: string | null,
  date: string | null,
  zone?: string | null,
): DayActivityState {
  const [state, setState] = useState<DayActivityState>({ state: "idle" });
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
    dashboardApi
      .getDayActivity(date, DAY_ACTIVITY_LIMIT, restaurantId)
      .then((rows) => {
        if (mySeq !== seq.current) return;
        const items = rows as ActivityItem[];
        // The gateway reads up to the limit per source and returns at most
        // the limit, so a full page may have left older lines unread.
        setState({ state: "ready", items, cut: items.length >= DAY_ACTIVITY_LIMIT });
      })
      .catch(() => {
        if (mySeq !== seq.current) return;
        setState({ state: "unknown" });
      });
  }, [restaurantId, date, zone]);

  return state;
}
