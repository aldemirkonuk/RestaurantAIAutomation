import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { readWholeWindow } from "../common/read-whole-window";
import {
  DashboardSummaryDto,
  DashboardStatsDto,
  ActivityItemDto,
  AlertDto,
  SalesChartPointDto,
  InventoryBreakdownDto,
  InventorySummaryDto,
  OrderSummaryDto,
  NotificationSummaryDto,
  ReportSummaryDto,
  CalendarSummaryDto,
  ProcurementSpendSummaryDto,
  ServiceErrorDto,
} from "./dto/dashboard-summary.dto";
import {
  ORDER_AWAITING_APPROVAL_STATUSES,
  ORDER_OPEN_WITH_VENDOR_STATUSES,
  ORDER_OUTSTANDING_STATUSES,
  ORDER_SPEND_STATUSES,
  hasStatus,
} from "../procurement/order-status";
import { houseFrame } from "../common/house-frame";
import {
  localDateIn,
  localMidnight,
  shiftLocalDate,
} from "../notifications/producers/service-day";
import { readAll } from "../providers/vendor-menu-supply";

/**
 * The rows of a settled read, or a throw. Supabase reports most failures in
 * `error` rather than by rejecting, so a check on `status` alone let a refused
 * query through as `data: null` → `[]` — and an empty list renders as an empty
 * cellar (DASH-W3, DASH-W6).
 */
function rowsOrThrow(result: PromiseSettledResult<any>, table: string): any[] {
  if (result.status === "rejected") throw result.reason;
  if (result.value.error) {
    throw new Error(`${table} read failed: ${result.value.error.message}`);
  }
  return result.value.data || [];
}

/** The value of a settled call that is not a Supabase read, or its throw. */
function valueOrThrow<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

/** An embedded PostgREST relation arrives as an object or a one-row array. */
function one<T>(rel: T | T[] | null | undefined): T | undefined {
  return Array.isArray(rel) ? rel[0] : (rel ?? undefined);
}

/** "1 bottle", "6 bottles"; nothing when the count is unknown. */
function bottles(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  return `${n} ${n === 1 ? "bottle" : "bottles"}`;
}

/** The wine as the house names it, with its vintage when the library has one. */
function wineLabel(row: any): string {
  if (!row) return "";
  const lib = one(row.master_wine_library) as any;
  const name = row.display_name || row.wine_name || lib?.name || "";
  const vintage = lib?.vintage ? String(lib.vintage) : "";
  return vintage && name && !name.endsWith(vintage)
    ? `${name} ${vintage}`
    : name;
}

/** What an alert says when a cellar row has no name: an item, never a wine (DASH-W37, DASH-G7). */
const UNNAMED_ITEM = "An item with no name";

/** Where an order stands, in the words Lately uses. */
const ORDER_VERB: Record<string, string> = {
  PENDING: "waiting on you",
  APPROVAL_NEEDED: "waiting on you",
  NEGOTIATING: "in talks with the vendor",
  APPROVED: "approved",
  CONFIRMED: "confirmed by the vendor",
  IN_TRANSIT: "on its way",
  DELIVERED: "delivered",
  PARTIALLY_RECEIVED: "partly received",
  COMPLETED: "closed",
  CANCELLED: "cancelled",
  REJECTED: "turned down",
  FAILED: "failed",
};

/**
 * One line per `events` row, from the payload shapes production actually holds
 * (queried 2026-10-01: order_change, provider_change, inventory_change,
 * calendar_event, report_event). Null means "leave it out": a kind with no
 * sentence is never shown as its code.
 */
export function eventSentence(
  eventType: string,
  p: Record<string, any>,
): { title: string; description: string } | null {
  switch (eventType) {
    case "order_change": {
      const verb = {
        created: "placed",
        approved: "approved",
        cancelled: "cancelled",
        delivered: "delivered",
      }[p.type as string];
      if (!verb) return null;
      const title = p.orderNumber
        ? `Order ${p.orderNumber} ${verb}`
        : `Order ${verb}`;
      return { title, description: bottles(p.quantity) };
    }
    case "provider_change": {
      const title = {
        added: "Vendor added",
        updated: "Vendor details changed",
        removed: "Vendor removed",
      }[p.type as string];
      if (!title) return null;
      return { title, description: p.providerName || "" };
    }
    case "inventory_change": {
      if (!p.wineName) return null;
      if (p.type === "add") {
        return {
          title: p.wineName,
          // An add with no count reads "added", never "added, ".
          description: ["added", bottles(p.quantity)].filter(Boolean).join(", "),
        };
      }
      if (typeof p.quantity !== "number") return null;
      return {
        title: p.wineName,
        description:
          typeof p.previousQuantity === "number"
            ? `${p.previousQuantity} → ${bottles(p.quantity)}`
            : `now ${bottles(p.quantity)}`,
      };
    }
    case "calendar_event":
      return p.title
        ? { title: p.title, description: p.description || "" }
        : null;
    case "report_event":
      return p.type === "generated"
        ? { title: "Report ready", description: "" }
        : null;
    default:
      return null;
  }
}

/* ── The month calendar (GET /dashboard/calendar-revenue/:id, ADR 0290) ──── */

/** One calendar entry on a day, in the columns the page draws (AW12). */
export interface CalendarDayEvent {
  id: string;
  title: string | null;
  event_type: string | null;
  event_date: string;
  event_time: string | null;
}

/** One house day. Null is "not known", never zero (ADR 0016, DASH-G2). */
export interface CalendarDay {
  date: string;
  /** Delivered orders' value: money paid to vendors, not sales. */
  procurement_spend: number | null;
  /** Bottles DELIVERED by vendors (the frozen key is a misnomer). */
  bottles_sold: number | null;
  order_count: number | null;
  /**
   * Sum of the subtotals the day's checks carried, voided left out. Null when
   * the day is not known, and when it had checks and not one carried a
   * subtotal ("not recorded"); 0 is a measured quiet day.
   */
  net_sales: number | null;
  /** Every check filed on the day (voided left out). Null: the day is not known. */
  checks: number | null;
  /** The day's checks that carried a subtotal: "from net_checks of checks". */
  net_checks: number | null;
  events: CalendarDayEvent[];
}

export interface CalendarMonth {
  year: number;
  month: number;
  restaurant_id: string;
  /** The zone every day figure is filed in; null when the house has none. */
  timezone: string | null;
  zone_unset: boolean;
  /** The house's own today, `YYYY-MM-DD`; null when it has no zone. */
  today: string | null;
  daily: CalendarDay[];
  monthly_procurement_spend: number | null;
  monthly_bottles: number | null;
  /**
   * The month so far: the sum over the begun days the register counted, said
   * with `monthly_days_counted` of `monthly_days_begun` (founder, 2026-10-05,
   * "Sum, say N of M days"). Null when no begun day is counted, and when
   * those days had checks and not one carried a subtotal ("not recorded").
   */
  monthly_net_sales: number | null;
  monthly_checks: number | null;
  monthly_net_checks: number | null;
  /** Begun days the register counted (a day with a known check count). */
  monthly_days_counted: number | null;
  /** Days of the month begun on the house's clock (all of them, for a past month). */
  monthly_days_begun: number | null;
  /** Has this house's register ever sent a check? Null when not asked. */
  pos_connected: boolean | null;
  /** True when the caller's role does not see sales; the register was not read. */
  sales_withheld: boolean;
}

/** The day's takings, as `netSalesByHouseDay` folds them (count and say). */
export interface HouseDaySales {
  /** Every check filed on the day. */
  checks: number;
  /** The checks that carried a subtotal. */
  net_checks: number;
  /** Their subtotals' sum; null when the day had checks and none carried one. */
  net_sales: number | null;
}

/**
 * How far before the month's first midnight the check read starts. A check
 * opened late on the last night of the previous month and closed after
 * midnight belongs to the 1st (it closed then), so the read has to reach back
 * for it. A check open longer than this is not found; stated, not hidden.
 */
export const CHECK_LOOKBACK_MS = 24 * 3_600_000;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Money to whole cents, so a sum of cents does not drift in the last digit. */
const cents = (n: number): number => Math.round(n * 100) / 100;

/**
 * One check's net sales, from its subtotal only: a missing, empty or
 * non-numeric subtotal is null, never 0 and never the total.
 *
 * The same rule as lane netsales' `netSalesOf` (`analytics/net-sales.ts`,
 * ADR 0295, PR #615, unmerged). Whichever of #615 and this branch lands
 * second deletes this copy and imports that one.
 */
function netSalesOf(
  check: { subtotal?: unknown } | null | undefined,
): number | null {
  const v = check?.subtotal;
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fold checks into net sales under the founder's netsales F1 ruling, "Count
 * and say (Recommended)", which supersedes ADR 0290's first rule 2: sum the
 * subtotals the checks carried (`netSales`), count those checks (`netChecks`)
 * beside every check (`checks`) so a reader can say "from N of M checks";
 * `netSales` is null when there were checks and none carried a subtotal ("not
 * recorded"), and 0 only when there were no checks.
 *
 * The same shape and rule as lane netsales' `foldNetSales`
 * (`analytics/net-sales.ts`, ADR 0295, PR #615, unmerged). Whichever of #615
 * and this branch lands second deletes this copy and imports that one.
 */
function foldNetSales(
  checks: Iterable<{ subtotal?: unknown } | null | undefined>,
): { netSales: number | null; netChecks: number; checks: number } {
  let sum = 0;
  let netChecks = 0;
  let count = 0;
  for (const c of checks) {
    count += 1;
    const net = netSalesOf(c);
    if (net === null) continue;
    sum += net;
    netChecks += 1;
  }
  return {
    netSales: count > 0 && netChecks === 0 ? null : sum,
    netChecks,
    checks: count,
  };
}

/** The two times a POS check carries. */
interface CheckTimes {
  closed_at?: string | null;
  opened_at?: string | null;
}

/**
 * The house date (`YYYY-MM-DD`) a sale falls on. Given a check, it is filed
 * by when it CLOSED, else when it opened; given an instant, by that instant.
 * The day ends at midnight on the house's clock. Null when there is no usable
 * time.
 *
 * The same rule and signature as lane tz's `houseDayOf`
 * (`common/house-day.ts`, ADR 0296, PR #616, unmerged; the founder's
 * "Midnight, by close (Recommended)"). Whichever of #616 and this branch lands
 * second deletes this copy and imports that one.
 */
function houseDayOf(
  subject: string | Date | CheckTimes | null | undefined,
  zone: string,
): string | null {
  const instant =
    subject !== null &&
    typeof subject === "object" &&
    !(subject instanceof Date)
      ? subject.closed_at || subject.opened_at || null
      : subject;
  if (instant === null || instant === undefined || instant === "") return null;
  const t = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(t.getTime())) return null;
  return localDateIn(t, zone);
}

/**
 * Net sales per house day (ADR 0290 §2-§3). Exported for its spec.
 *
 * - A check belongs to the house day it CLOSED on, else the day it opened
 *   (`houseDayOf`), read on the house's wall clock in `zone`.
 * - Net is `subtotal`. `total` and `tip` are never read: the founder's AW17
 *   ruling. `subtotal` is before tax and surcharge only where the POS adapter
 *   writes it so: generic/CSV pass it through, Square maps
 *   `net_amounts.total_money`, Toast `amount`, Clover null (pos-adapters.ts).
 *   Lane netsales owns the adapters' basis.
 * - Each day is folded by `foldNetSales`: the subtotals that were stated are
 *   summed, and the day says how many of its checks stated one.
 * - The rows are expected to be non-voided already; the read filters them.
 */
export function netSalesByHouseDay(
  rows: ReadonlyArray<Record<string, unknown>>,
  zone: string,
): Map<string, HouseDaySales> {
  const byDay = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const date = houseDayOf(row as CheckTimes, zone);
    if (!date) continue;
    const list = byDay.get(date) ?? [];
    list.push(row);
    byDay.set(date, list);
  }
  const out = new Map<string, HouseDaySales>();
  for (const [date, list] of byDay) {
    const fold = foldNetSales(list);
    out.set(date, {
      checks: fold.checks,
      net_checks: fold.netChecks,
      net_sales: fold.netSales === null ? null : cents(fold.netSales),
    });
  }
  return out;
}

/**
 * The month's calendar entries, filed on `event_date` (already a house date).
 * Every row, keyset-paged; only the columns the page draws (AW12). Every
 * status is kept, as before: which statuses the grid should show is not
 * decided here.
 */
async function readMonthEvents(
  client: any,
  restaurantId: string,
  first: string,
  nextFirst: string,
): Promise<Map<string, CalendarDayEvent[]>> {
  const rows = await readAll("The month's calendar events", (after) => {
    let q = client
      .from("calendar_events")
      .select("id, title, event_type, event_date, event_time")
      .eq("restaurant_id", restaurantId)
      .gte("event_date", first)
      .lt("event_date", nextFirst);
    if (after) q = q.gt("id", after);
    return q;
  });
  const byDay = new Map<string, CalendarDayEvent[]>();
  for (const r of rows) {
    const date = String(r.event_date ?? "").slice(0, 10);
    const list = byDay.get(date) ?? [];
    list.push({
      id: String(r.id),
      title: typeof r.title === "string" ? r.title : null,
      event_type: typeof r.event_type === "string" ? r.event_type : null,
      event_date: date,
      event_time: typeof r.event_time === "string" ? r.event_time : null,
    });
    byDay.set(date, list);
  }
  // All-day entries first, then by time, so a day reads in order.
  for (const list of byDay.values()) {
    list.sort(
      (a, b) =>
        (a.event_time ?? "").localeCompare(b.event_time ?? "") ||
        a.id.localeCompare(b.id),
    );
  }
  return byDay;
}

/**
 * The register's takings for the month, by house day, or a throw.
 *
 * The register counted the days from `since` to `until`, and only those:
 *
 * - `since` is the house day the register sent its FIRST check (voided or
 *   not), or null when it never has. A day before it is not a quiet day — the
 *   register was not there to count it — so it is unknown, not zero.
 * - `until` is the house day of the LATEST check it sent (voided or not; the
 *   day the check closed, else opened, as the fold files it), or a later day
 *   the month's own checks are filed on. A day after it is unknown too: no
 *   check came, and nothing records that the register was still sending (no
 *   table stamps a check feed's heartbeat), so a register gone dark and a
 *   house that was closed read alike. Tuzlu Rüzgar's feed ends 2026-08-30;
 *   with only `since`, its September and October drew "$0 · 0 checks".
 * - A day from `since` to `until` with no check is a measured zero.
 *
 * `connected` is `since !== null`.
 */
async function readMonthTakings(
  client: any,
  restaurantId: string,
  start: Date,
  end: Date,
  zone: string,
): Promise<{
  connected: boolean;
  since: string | null;
  until: string | null;
  days: Map<string, HouseDaySales>;
}> {
  const from = new Date(start.getTime() - CHECK_LOOKBACK_MS);
  const [rows, first, latest] = await Promise.all([
    readAll("The month's checks", (after) => {
      let q = client
        .from("pos_checks")
        .select("id, subtotal, opened_at, closed_at")
        .eq("restaurant_id", restaurantId)
        .eq("voided", false)
        .gte("opened_at", from.toISOString())
        .lt("opened_at", end.toISOString());
      if (after) q = q.gt("id", after);
      return q;
    }),
    // One row, on the (restaurant_id, opened_at) index: when did this house's
    // register first send anything? Asked every time, because a month can
    // hold checks and still begin before the register did.
    client
      .from("pos_checks")
      .select("opened_at")
      .eq("restaurant_id", restaurantId)
      .order("opened_at", { ascending: true })
      .limit(1),
    // The same index read backwards: when did it LAST send anything? Asked
    // every time, because a month can hold checks and still run past the
    // register's last one.
    client
      .from("pos_checks")
      .select("opened_at, closed_at")
      .eq("restaurant_id", restaurantId)
      .order("opened_at", { ascending: false })
      .limit(1),
  ]);
  if (first.error) {
    throw new Error(`pos_checks read failed: ${first.error.message}`);
  }
  if (latest.error) {
    throw new Error(`pos_checks read failed: ${latest.error.message}`);
  }
  const firstAt = first.data?.[0]?.opened_at;
  const since = houseDayOf(typeof firstAt === "string" ? firstAt : null, zone);
  const days = netSalesByHouseDay(rows, zone);
  const last = latest.data?.[0];
  let until =
    since === null ? null : houseDayOf((last ?? null) as CheckTimes, zone);
  // A check opened before the latest one can close after it; the month's own
  // checks are filed already, so a day one of them is filed on is counted.
  if (since !== null) {
    for (const date of days.keys()) {
      if (until === null || date > until) until = date;
    }
  }
  return {
    connected: since !== null,
    since,
    until,
    days,
  };
}

/**
 * The columns the summary's `recent` notices carry: what a bell row draws
 * (kind, title, text, urgency, link, read state, time). Never `metadata`,
 * where a producer may file figures, and never the addressee or delivery
 * columns. Every one of them is in what the bell itself returns to the same
 * person (`NotificationsService.mapNotificationRow`), so this is never more.
 */
export const RECENT_NOTICE_COLUMNS =
  "id, type, title, message, priority, status, action_url, action_label, read_at, created_at";

/**
 * Dashboard Service - Aggregates data from multiple services in parallel
 *
 * This implements the API Bus/Aggregator pattern to:
 * - Reduce frontend API calls from 4+ to 1
 * - Execute backend calls in parallel (Promise.allSettled)
 * - Provide graceful degradation when services fail
 * - Optimize payload for dashboard needs
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly dbService: DatabaseService) {}

  /**
   * The house's IANA zone. A house with none recorded falls back to UTC, the
   * clock these figures always used; a failed read throws.
   */
  private async houseZone(client: any, restaurantId: string): Promise<string> {
    const { data, error } = await client
      .from("restaurants")
      .select("timezone")
      .eq("id", restaurantId)
      .limit(1);
    if (error) throw new Error(`restaurants read failed: ${error.message}`);
    return (data && data[0]?.timezone) || "UTC";
  }

  /**
   * Get aggregated dashboard summary with parallel service calls
   * Uses Promise.allSettled for graceful degradation
   *
   * `userId` is the caller's (`public.users.user_id`, from the token): the
   * notices leg reads only that person's rows. Without it the leg reads none.
   */
  async getDashboardSummary(
    restaurantId: string,
    userId?: string | null,
  ): Promise<DashboardSummaryDto> {
    this.logger.log(
      `Fetching dashboard summary for restaurant: ${restaurantId}`,
    );
    const startTime = Date.now();

    // Execute all service calls in parallel
    const results = await Promise.allSettled([
      this.getInventorySummary(restaurantId),
      this.getOrdersSummary(restaurantId),
      this.getNotificationsSummary(restaurantId, userId),
      this.getReportsSummary(restaurantId),
      this.getCalendarSummary(restaurantId),
      this.getProcurementSpendSummary(restaurantId),
    ]);

    // Process results with graceful degradation
    const inventory = this.handleResult<InventorySummaryDto>(
      results[0],
      "inventory",
    );
    const orders = this.handleResult<OrderSummaryDto>(results[1], "orders");
    const notifications = this.handleResult<NotificationSummaryDto>(
      results[2],
      "notifications",
    );
    const reports = this.handleResult<ReportSummaryDto>(results[3], "reports");
    const calendar = this.handleResult<CalendarSummaryDto>(
      results[4],
      "calendar",
    );
    const procurementSpend = this.handleResult<ProcurementSpendSummaryDto>(
      results[5],
      "procurementSpend",
    );

    // Collect any errors
    const errors = this.collectErrors(results, [
      "inventory",
      "orders",
      "notifications",
      "reports",
      "calendar",
      "procurementSpend",
    ]);

    const duration = Date.now() - startTime;
    this.logger.log(
      `Dashboard summary fetched in ${duration}ms (${errors.length} errors)`,
    );

    return {
      inventory,
      orders,
      notifications,
      reports,
      calendar,
      procurementSpend,
      errors,
      timestamp: new Date().toISOString(),
      allServicesHealthy: errors.length === 0,
    };
  }

  /**
   * Get inventory summary optimized for dashboard
   */
  private async getInventorySummary(
    restaurantId: string,
  ): Promise<InventorySummaryDto> {
    const [inventory, lowStock] = await Promise.all([
      this.dbService.getRestaurantInventory(restaurantId),
      this.dbService.getLowStockItems(restaurantId),
    ]);

    const totalItems = inventory?.length || 0;
    const totalBottles =
      inventory?.reduce((sum, item) => sum + (item.stock_live || 0), 0) || 0;
    const lowStockCount = lowStock?.length || 0;
    const criticalCount =
      inventory?.filter((item) => (item.stock_live || 0) === 0).length || 0;

    return {
      totalItems,
      totalBottles,
      lowStockCount,
      criticalCount,
      healthyCount: totalItems - lowStockCount,
    };
  }

  /**
   * Get orders summary optimized for dashboard
   */
  private async getOrdersSummary(
    restaurantId: string,
  ): Promise<OrderSummaryDto> {
    const orders = await this.dbService.getProcurementOrders(restaurantId);

    const pending =
      orders?.filter((o) =>
        hasStatus(o.status, ORDER_AWAITING_APPROVAL_STATUSES),
      ) || [];
    const inTransit =
      orders?.filter((o) =>
        hasStatus(o.status, ORDER_OPEN_WITH_VENDOR_STATUSES),
      ) || [];

    return {
      pending: pending.slice(0, 5), // Only return top 5 for dashboard
      inTransit: inTransit.slice(0, 5),
      pendingCount: pending.length,
      inTransitCount: inTransit.length,
    };
  }

  /**
   * The caller's own five newest notices, scoped exactly as the bell scopes
   * its list (`NotificationsService.getNotifications`): `user_id` is the
   * token's user, `restaurant_id` the house, newest `created_at` first.
   *
   * It read every row in the house (`select("*")` by restaurant_id alone), so
   * any member read notices addressed to someone else: the owners' own-wage
   * notice with its figures (ADR 0215, round 5 item 32), a notice the area
   * routing kept to one area or held for someone Away (ADR 0218), and rows a
   * producer filed with no addressee. A row with no `user_id` is in nobody's
   * bell (`eq` never matches null), so it is in nobody's summary either.
   *
   * Ordered as the bell orders: no gateway writer sets `sent_at`, and under
   * DESC its NULLs sort first, so ordering by it picked an arbitrary five.
   */
  private async getNotificationsSummary(
    restaurantId: string,
    userId: string | null | undefined,
  ): Promise<NotificationSummaryDto> {
    const own = typeof userId === "string" ? userId.trim() : "";
    if (own === "") {
      // Never the house's notices in place of the person's.
      this.logger.warn("Notifications summary: no user on the call; none read");
      return { recent: [], unreadCount: 0 };
    }
    const client = this.dbService.getClient();

    try {
      const { data: notifications, error } = await client
        .from("notifications")
        .select(RECENT_NOTICE_COLUMNS)
        .eq("user_id", own)
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) {
        // If notifications table doesn't exist or error, return empty
        this.logger.warn(`Notifications query error: ${error.message}`);
        return {
          recent: [],
          unreadCount: 0,
        };
      }

      const unreadCount = notifications?.filter((n) => !n.read_at).length || 0;

      return {
        recent: notifications || [],
        unreadCount,
      };
    } catch (error) {
      this.logger.warn(`Notifications fetch failed: ${error.message}`);
      return {
        recent: [],
        unreadCount: 0,
      };
    }
  }

  /**
   * Get reports summary optimized for dashboard
   */
  private async getReportsSummary(
    restaurantId: string,
  ): Promise<ReportSummaryDto> {
    const client = this.dbService.getClient();

    try {
      const { data: reports, error } = await client
        .from("generated_reports")
        .select(
          "id, restaurant_id, report_type, title, summary, status, " +
            "report_period_start, report_period_end, created_at",
        )
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) {
        // ADR 0020: a read that did not answer is NOT emptiness. Say so, and
        // carry the PostgREST code — `PGRST205` is precisely the "this table
        // does not exist" signal that went unnoticed here for months.
        this.logger.warn(`Reports query error: ${error.message}`);
        const code = error.code ? ` [${error.code}]` : "";
        return {
          latest: null,
          lastGeneratedAt: null,
          unavailable: `The report archive could not be read${code}: ${error.message}`,
        };
      }

      // supabase-js cannot infer a row type from a column list built by
      // concatenation, so name the two fields this block actually reads.
      const latest =
        (reports?.[0] as { created_at?: string } | undefined) ?? null;

      return {
        latest,
        lastGeneratedAt: latest?.created_at || null,
        unavailable: null,
      };
    } catch (error) {
      this.logger.warn(`Reports fetch failed: ${error.message}`);
      return {
        latest: null,
        lastGeneratedAt: null,
        unavailable: `The report archive could not be read: ${error.message}`,
      };
    }
  }

  /**
   * Get calendar summary optimized for dashboard
   */
  private async getCalendarSummary(
    restaurantId: string,
  ): Promise<CalendarSummaryDto> {
    const client = this.dbService.getClient();

    try {
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      const nextWeekStr = nextWeek.toISOString().split("T")[0];

      // Get upcoming events (next 7 days)
      const { data: upcoming, error } = await client
        .from("calendar_events")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .gte("event_date", todayStr)
        .lte("event_date", nextWeekStr)
        .order("event_date", { ascending: true })
        .limit(20);

      if (error) {
        this.logger.warn(`Calendar query error: ${error.message}`);
        return { upcoming: [], todayCount: 0, deliveriesThisWeek: 0 };
      }

      const events = upcoming || [];
      const todayCount = events.filter((e) => e.event_date === todayStr).length;
      const deliveriesThisWeek = events.filter(
        (e) => e.event_type === "delivery" || e.event_type === "DELIVERY",
      ).length;

      return {
        upcoming: events,
        todayCount,
        deliveriesThisWeek,
      };
    } catch (error) {
      this.logger.warn(`Calendar fetch failed: ${error.message}`);
      return { upcoming: [], todayCount: 0, deliveriesThisWeek: 0 };
    }
  }

  /**
   * Total the restaurant paid its vendors for orders that were delivered.
   *
   * `procurement_orders.total_cost` is a vendor invoice line: money OUT. This
   * method previously published the same sums as `totalRevenue` /
   * `monthlyRevenue` / `revenueByMonth`, so the dashboard's headline number
   * reported cost as income and every "revenue up" reading actually meant the
   * restaurant had spent more. The query is unchanged; only the claim is.
   *
   * Sales revenue is not derivable here — it lives in `pos_checks`, which this
   * service does not query.
   */
  private async getProcurementSpendSummary(
    restaurantId: string,
  ): Promise<ProcurementSpendSummaryDto> {
    const client = this.dbService.getClient();

    try {
      // Get all delivered orders for this restaurant
      const { data: delivered, error } = await client
        .from("procurement_orders")
        .select(
          "final_price, total_cost, bottles_total, quantity, delivered_at, created_at, status",
        )
        .eq("restaurant_id", restaurantId)
        .in("status", ORDER_SPEND_STATUSES);

      if (error) {
        this.logger.warn(`Procurement spend query error: ${error.message}`);
        return {
          totalProcurementSpend: 0,
          monthlyProcurementSpend: 0,
          totalBottlesDelivered: 0,
          spendByMonth: [],
        };
      }

      const orders = delivered || [];

      // Total paid to vendors
      const totalProcurementSpend = orders.reduce(
        (sum, o) => sum + (o.total_cost || o.final_price || 0),
        0,
      );
      const totalBottlesDelivered = orders.reduce(
        (sum, o) => sum + (o.bottles_total || o.quantity || 0),
        0,
      );

      // Paid to vendors this calendar month
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const monthlyProcurementSpend = orders
        .filter((o) => {
          const orderDate = o.delivered_at || o.created_at;
          return orderDate && orderDate.startsWith(currentMonth);
        })
        .reduce((sum, o) => sum + (o.total_cost || o.final_price || 0), 0);

      // Spend by month (last 12 months)
      const spendByMonth: {
        month: string;
        spend: number;
        bottles: number;
      }[] = [];
      const monthMap = new Map<string, { spend: number; bottles: number }>();

      for (const o of orders) {
        const orderDate = o.delivered_at || o.created_at;
        if (!orderDate) continue;
        const month = orderDate.substring(0, 7); // YYYY-MM
        const existing = monthMap.get(month) || { spend: 0, bottles: 0 };
        existing.spend += o.total_cost || o.final_price || 0;
        existing.bottles += o.bottles_total || o.quantity || 0;
        monthMap.set(month, existing);
      }

      // Sort by month and take last 12
      for (const [month, data] of Array.from(monthMap.entries()).sort()) {
        spendByMonth.push({
          month,
          spend: data.spend,
          bottles: data.bottles,
        });
      }

      return {
        totalProcurementSpend,
        monthlyProcurementSpend,
        totalBottlesDelivered,
        spendByMonth: spendByMonth.slice(-12),
      };
    } catch (error) {
      this.logger.warn(`Procurement spend fetch failed: ${error.message}`);
      return {
        totalProcurementSpend: 0,
        monthlyProcurementSpend: 0,
        totalBottlesDelivered: 0,
        spendByMonth: [],
      };
    }
  }

  /**
   * The month behind `GET /dashboard/calendar-revenue/:id` (ADR 0290). The
   * route name is frozen; what it carries is stated per field:
   *
   * - `procurement_spend`, `bottles_sold`, `order_count`: delivered
   *   `procurement_orders` (ORDER_SPEND_STATUSES) — money paid to vendors and
   *   bottles they brought, never money earned.
   * - `net_sales`, `checks`, `net_checks`: the register's takings, the
   *   subtotals carried by checks that are not voided (AW17 "Net sales
   *   (Recommended)"), counted and said (netsales F1 "Count and say
   *   (Recommended)"): `net_checks` of `checks` carried one. Read only for a
   *   caller whose role sees `sales`; for anyone else the register is not
   *   read at all and `sales_withheld` is true.
   * - Every figure is filed on the HOUSE's day, in its zone (`houseFrame`: its
   *   own, else its country's only one). A house with no zone gets every day
   *   figure as null (DASH-G2): no figure is bucketed on a clock the house
   *   never stated. Events keep their days, because `event_date` is already a
   *   house date.
   *
   * Every read is keyset-paged to the end and throws on failure, so a month
   * past PostgREST's 1,000-row ceiling is complete and an unreadable table is
   * a 500, never a month of zeros (ADR 0020).
   */
  async getCalendarRevenue(
    restaurantId: string,
    year: number | null,
    month: number | null,
    opts: { withSales?: boolean } = {},
  ): Promise<CalendarMonth> {
    const client = this.dbService.getClient();
    const withSales = opts.withSales === true;

    try {
      const zone = await this.houseZoneOrNull(client, restaurantId);
      const now = new Date();
      const today = zone ? localDateIn(now, zone) : null;
      // With no zone there is no house "today". The server's UTC date only
      // picks WHICH month to show when the caller names none; it files no
      // figure (every figure below is null in that case).
      const pickFrom = today ?? now.toISOString().slice(0, 10);
      const y = year ?? Number(pickFrom.slice(0, 4));
      const m = month ?? Number(pickFrom.slice(5, 7));

      const first = `${y}-${pad2(m)}-01`;
      const nextFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${pad2(m + 1)}-01`;
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const dates = Array.from(
        { length: daysInMonth },
        (_, i) => `${y}-${pad2(m)}-${pad2(i + 1)}`,
      );

      const eventsRead = readMonthEvents(
        client,
        restaurantId,
        first,
        nextFirst,
      );

      if (!zone) {
        const eventsByDay = await eventsRead;
        return {
          year: y,
          month: m,
          restaurant_id: restaurantId,
          timezone: null,
          zone_unset: true,
          today: null,
          daily: dates.map((date) => ({
            date,
            procurement_spend: null,
            bottles_sold: null,
            order_count: null,
            net_sales: null,
            checks: null,
            net_checks: null,
            events: eventsByDay.get(date) ?? [],
          })),
          monthly_procurement_spend: null,
          monthly_bottles: null,
          monthly_net_sales: null,
          monthly_checks: null,
          monthly_net_checks: null,
          monthly_days_counted: null,
          monthly_days_begun: null,
          pos_connected: null,
          sales_withheld: !withSales,
        };
      }

      // The month on the house's wall clock, as instants.
      const start = localMidnight(first, zone);
      const end = localMidnight(nextFirst, zone);

      const [eventsByDay, orders, takings] = await Promise.all([
        eventsRead,
        readAll("The month's deliveries", (after) => {
          // `wine_name` was in this select; `procurement_orders` has never had
          // it, PostgREST refused the whole read, and the error was not read —
          // so every day showed $0 paid (C18, F-156).
          let q = client
            .from("procurement_orders")
            .select(
              "id, final_price, total_cost, bottles_total, quantity, delivered_at",
            )
            .eq("restaurant_id", restaurantId)
            .in("status", ORDER_SPEND_STATUSES)
            .gte("delivered_at", start.toISOString())
            .lt("delivered_at", end.toISOString());
          if (after) q = q.gt("id", after);
          return q;
        }),
        withSales
          ? readMonthTakings(client, restaurantId, start, end, zone)
          : Promise.resolve(null),
      ]);

      const spend = new Map<
        string,
        { spend: number; bottles: number; count: number }
      >();
      for (const o of orders) {
        const date = houseDayOf(
          typeof o.delivered_at === "string" ? o.delivered_at : null,
          zone,
        );
        if (!date) continue;
        const day = spend.get(date) ?? { spend: 0, bottles: 0, count: 0 };
        // The method is unchanged: the order's total, else its final price;
        // its bottle total, else its quantity.
        day.spend += Number(o.total_cost) || Number(o.final_price) || 0;
        day.bottles += Number(o.bottles_total) || Number(o.quantity) || 0;
        day.count += 1;
        spend.set(date, day);
      }

      const connected = takings?.connected ?? null;
      const since = takings?.since ?? null;
      const until = takings?.until ?? null;
      const daily: CalendarDay[] = dates.map((date) => {
        const s = spend.get(date);
        const sold = takings?.days.get(date);
        // A day the register was there for: from its first check's house day
        // to its latest check's. A quiet day between them is a measured zero.
        // A register that never sent a check, a day before it began, or a day
        // after the last check it sent says nothing (unknown) — a day after
        // includes today until its first check lands, and every day ahead.
        const counted =
          since !== null && until !== null && date >= since && date <= until;
        return {
          date,
          procurement_spend: cents(s?.spend ?? 0),
          bottles_sold: s?.bottles ?? 0,
          order_count: s?.count ?? 0,
          net_sales: counted ? (sold ? sold.net_sales : 0) : null,
          checks: counted ? (sold ? sold.checks : 0) : null,
          net_checks: counted ? (sold ? sold.net_checks : 0) : null,
          events: eventsByDay.get(date) ?? [],
        };
      });

      // The month so far: the days of it that have begun on the house's
      // clock (all of them, for a past month). The founder, 2026-10-05, "Sum,
      // say N of M days (Recommended)": the figure sums the begun days the
      // register counted and says how many of the begun days those are, so a
      // day before the register began or after its last check no longer
      // blanks the month. Inside the counted days the checks are folded as
      // each day is (count and say): the stated subtotals summed, the checks
      // that stated one counted beside every check. No counted day, or
      // counted days whose checks all lack a subtotal, states no figure; a
      // month not yet begun states none.
      const begun = daily.filter((d) => today !== null && d.date <= today);
      const known = begun.filter((d) => d.checks !== null);
      const monthlyChecks = known.reduce((sum, d) => sum + (d.checks ?? 0), 0);
      const monthlyNetChecks = known.reduce(
        (sum, d) => sum + (d.net_checks ?? 0),
        0,
      );
      const monthStated = connected === true && known.length > 0;
      const monthlyNet =
        monthStated && !(monthlyChecks > 0 && monthlyNetChecks === 0)
          ? cents(known.reduce((sum, d) => sum + (d.net_sales ?? 0), 0))
          : null;

      return {
        year: y,
        month: m,
        restaurant_id: restaurantId,
        timezone: zone,
        zone_unset: false,
        today,
        daily,
        monthly_procurement_spend: cents(
          daily.reduce((sum, d) => sum + (d.procurement_spend ?? 0), 0),
        ),
        monthly_bottles: daily.reduce(
          (sum, d) => sum + (d.bottles_sold ?? 0),
          0,
        ),
        monthly_net_sales: monthlyNet,
        monthly_checks: monthStated ? monthlyChecks : null,
        monthly_net_checks: monthStated ? monthlyNetChecks : null,
        monthly_days_counted: connected === true ? known.length : null,
        monthly_days_begun: connected === true ? begun.length : null,
        pos_connected: connected,
        sales_withheld: !withSales,
      };
    } catch (error) {
      this.logger.error(`Calendar month fetch failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * The house's IANA zone: its own (`restaurants.timezone`, when this server
   * can read the name), else its country's only zone, else null —
   * `houseFrame` (`common/house-frame.ts`, ADR 0207 question 6), the rule lane
   * tz's `readHouseZone` reads too (ADR 0296, PR #616, unmerged). Never a
   * default and never UTC: the founder's 2026-09-03 rule
   * (`a_default_is_not_an_answer`) cleared the old one, and DASH-G2 rules
   * that an unset zone reads as unknown. A failed read throws.
   */
  private async houseZoneOrNull(
    client: any,
    restaurantId: string,
  ): Promise<string | null> {
    const { data, error } = await client
      .from("restaurants")
      .select("timezone, country")
      .eq("id", restaurantId)
      .limit(1);
    if (error) throw new Error(`restaurants read failed: ${error.message}`);
    return houseFrame(data?.[0] ?? null).zone;
  }

  // ==========================================================================
  // STATS
  // ==========================================================================

  async getStats(restaurantId: string): Promise<DashboardStatsDto> {
    const client = this.dbService.getClient();

    try {
      const [inventoryResult, lowStockResult, ordersResult, zoneResult] =
        await Promise.allSettled([
          // All three reads are whole or refused (ADR 0292). Unranged, each
          // stopped at PostgREST's 1,000 rows (`supabase/config.toml:18`), so
          // past that the cellar, low-stock and vendor-spend tiles printed a
          // slice as the total (DASH-G2's size half; PR #579 audit note 2).
          readWholeWindow<any>("The cellar for the stat cards", () =>
            client
              .from("restaurant_inventory")
              .select("id, stock_live, bottle_size_ml", { count: "exact" })
              .eq("restaurant_id", restaurantId)
              .is("deleted_at", null)
              .eq("is_active", true),
          ),
          readWholeWindow<any>("The low-stock wines for the stat cards", () =>
            client
              .from("v_low_stock_items")
              .select("id", { count: "exact" })
              .eq("restaurant_id", restaurantId),
          ),
          readWholeWindow<any>("The vendor orders for the stat cards", () =>
            client
              .from("procurement_orders")
              .select(
                "id, status, total_cost, final_price, bottles_total, quantity, delivered_at",
                { count: "exact" },
              )
              .eq("restaurant_id", restaurantId),
          ),
          this.houseZone(client, restaurantId),
        ]);

      // A failed read used to become an empty list, so a cellar that could
      // not be read rendered "0 · across 0 wines" — absence reported as
      // health (DASH-W3). The cellar, low-stock and order reads now fail the
      // call, and the page shows its em dash for "unknown". A
      // `wine_consumption_log` read used to ride along here and feed nothing;
      // it is gone (DASH-W8).
      const inventory = valueOrThrow(inventoryResult);
      const lowStock = valueOrThrow(lowStockResult);
      const orders = valueOrThrow(ordersResult);
      const zone = valueOrThrow(zoneResult);
      const totalWines = inventory.length;
      const totalBottles = inventory.reduce(
        (sum, i) => sum + (i.stock_live || 0),
        0,
      );
      const totalVolumeMl = inventory.reduce(
        (sum, i) => sum + (i.stock_live || 0) * (i.bottle_size_ml || 750),
        0,
      );
      const totalVolumeOz = Math.round(totalVolumeMl * 0.033814 * 100) / 100;
      const lowStockItems = lowStock.length;
      const pendingOrders = orders.filter((o) =>
        hasStatus(o.status, ORDER_AWAITING_APPROVAL_STATUSES),
      ).length;

      // Same rule as the calendar (DASH-W2): money counts on the day it was
      // DELIVERED, on the house's wall clock, and "month" is this calendar
      // month. These cards counted by `created_at` on the UTC date over a
      // rolling 30 days, so an order placed last week and delivered today was
      // in neither card while the calendar put it on today.
      const todayLocal = localDateIn(new Date(), zone);
      const weekStartLocal = shiftLocalDate(todayLocal, -6);
      const monthLocal = todayLocal.slice(0, 7);

      // Sums vendor invoices on delivered procurement orders. This was named
      // `salesFrom` and published as todaySales/weekSales/monthSales, which the
      // web dashboard rendered as "Total Revenue" — the exact opposite of what
      // the number is. Nothing here is a sale.
      const spendWhere = (items: any[], onDay: (day: string) => boolean) =>
        items
          .filter(
            (o) =>
              o.delivered_at &&
              onDay(localDateIn(new Date(o.delivered_at), zone)),
          )
          .reduce((sum, o) => sum + (o.total_cost || o.final_price || 0), 0);

      const deliveredOrders = orders.filter((o) =>
        hasStatus(o.status, ORDER_SPEND_STATUSES),
      );
      // DASH-W22: the counts staff read in place of the two money cards, on
      // the same days and the same orders as the spend.
      const deliveredOn = (onDay: (day: string) => boolean) =>
        deliveredOrders.filter(
          (o) =>
            o.delivered_at &&
            onDay(localDateIn(new Date(o.delivered_at), zone)),
        );

      return {
        totalWines,
        totalBottles,
        totalVolumeMl,
        totalVolumeOz,
        lowStockItems,
        pendingOrders,
        todayProcurementSpend: spendWhere(
          deliveredOrders,
          (day) => day === todayLocal,
        ),
        weekProcurementSpend: spendWhere(
          deliveredOrders,
          (day) => day >= weekStartLocal && day <= todayLocal,
        ),
        monthProcurementSpend: spendWhere(
          deliveredOrders,
          (day) => day.slice(0, 7) === monthLocal,
        ),
        todayDeliveries: deliveredOn((day) => day === todayLocal).length,
        monthBottlesIn: deliveredOn((day) => day.slice(0, 7) === monthLocal).reduce(
          (sum, o) => sum + (o.bottles_total || o.quantity || 0),
          0,
        ),
        timezone: zone,
      };
    } catch (error) {
      this.logger.error(`Stats fetch failed: ${error.message}`);
      throw error;
    }
  }

  // ==========================================================================
  // ACTIVITY
  // ==========================================================================

  async getActivity(
    restaurantId: string,
    limit: number = 20,
  ): Promise<ActivityItemDto[]> {
    const client = this.dbService.getClient();

    try {
      const [ordersResult, eventsResult, inventoryResult] =
        await Promise.allSettled([
          client
            .from("procurement_orders")
            .select(
              `id, order_number, status, bottles_total, quantity, created_at, updated_at,
               restaurant_inventory(display_name, wine_name, master_wine_library(name, vintage)),
               providers(name)`,
            )
            .eq("restaurant_id", restaurantId)
            .order("updated_at", { ascending: false })
            .limit(limit),
          client
            .from("events")
            .select("id, event_type, payload, created_at")
            .eq("restaurant_id", restaurantId)
            .order("created_at", { ascending: false })
            .limit(limit),
          client
            .from("restaurant_inventory")
            .select(
              "id, display_name, wine_name, stock_live, updated_at, master_wine_library(name, vintage)",
            )
            .eq("restaurant_id", restaurantId)
            .is("deleted_at", null)
            .eq("is_active", true)
            .order("updated_at", { ascending: false })
            .limit(limit),
        ]);

      // Lately printed internal codes (DASH-W4): it read `payload.title`, which
      // only calendar events carry, so every other event came out as
      // "provider_change — provider_change". Each kind now gets one sentence in
      // the house's words, naming the wine or vendor; an unknown kind is left
      // out rather than shown as its code. A failed read fails the call
      // (DASH-W3) instead of quietly thinning the list.
      const activities: ActivityItemDto[] = [];

      const orders = rowsOrThrow(ordersResult, "procurement_orders");
      const orderIds = new Set<string>();
      for (const o of orders) {
        orderIds.add(o.id);
        const verb = ORDER_VERB[o.status as string];
        if (!verb) continue;
        const inv = one(o.restaurant_inventory);
        const what = [
          wineLabel(inv),
          bottles(o.bottles_total ?? o.quantity),
        ].filter(Boolean);
        const vendor = one(o.providers)?.name;
        activities.push({
          id: `order-${o.id}`,
          type: "order",
          title: `Order ${o.order_number} ${verb}`,
          description: what.join(", ") + (vendor ? ` from ${vendor}` : ""),
          timestamp: o.updated_at || o.created_at,
          entityId: o.id,
          entityType: "procurement_order",
        });
      }

      const events = rowsOrThrow(eventsResult, "events");
      for (const e of events) {
        const payload =
          typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload;
        // Each order once: its own row above already says where it stands.
        if (
          e.event_type === "order_change" &&
          payload?.orderId &&
          orderIds.has(payload.orderId)
        ) {
          continue;
        }
        const line = eventSentence(e.event_type, payload ?? {});
        if (!line) continue;
        activities.push({
          id: `event-${e.id}`,
          type: e.event_type || "event",
          title: line.title,
          description: line.description,
          timestamp: e.created_at,
          entityId: e.id,
          entityType: "event",
        });
      }

      // A wine row's last edit. It is not an event — the row says only when
      // it last changed and what it holds now — so the line says exactly that.
      const inventory = rowsOrThrow(inventoryResult, "restaurant_inventory");
      for (const i of inventory) {
        const name = wineLabel(i);
        if (!name || i.stock_live == null) continue;
        activities.push({
          id: `inv-${i.id}`,
          type: "inventory_change",
          title: name,
          description: `${bottles(i.stock_live)} on hand`,
          timestamp: i.updated_at,
          entityId: i.id,
          entityType: "inventory",
        });
      }

      activities.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      return activities.slice(0, limit);
    } catch (error) {
      this.logger.error(`Activity fetch failed: ${error.message}`);
      throw error;
    }
  }

  // ==========================================================================
  // ALERTS
  // ==========================================================================

  async getAlerts(restaurantId: string): Promise<AlertDto[]> {
    const client = this.dbService.getClient();
    const alerts: AlertDto[] = [];

    try {
      const [lowStockResult, overdueResult, inventoryResult] =
        await Promise.allSettled([
          client
            .from("v_low_stock_items")
            .select("id, stock_live, threshold_min, wine_name, vintage")
            .eq("restaurant_id", restaurantId),
          client
            .from("procurement_orders")
            .select("id, status, expected_delivery_date, created_at")
            .eq("restaurant_id", restaurantId)
            .in("status", ORDER_OUTSTANDING_STATUSES),
          client
            .from("restaurant_inventory")
            .select(
              "id, display_name, wine_name, stock_live, updated_at, master_wine_library(name, vintage)",
            )
            .eq("restaurant_id", restaurantId)
            .is("deleted_at", null)
            .eq("is_active", true)
            .eq("stock_live", 0),
        ]);

      // The cellar is the active, undeleted wines — the rule
      // `v_low_stock_items` already applies (DASH-W10). A failed read fails
      // the call: an empty alert list would read as "nothing is wrong"
      // (DASH-W11, as DASH-W3 for stats and Lately).
      const lowStock = rowsOrThrow(lowStockResult, "v_low_stock_items");
      // Alerts name the wine as Lately does and never fall back to its id
      // (DASH-W7). The view carries the library's name and vintage, not the
      // house's display name; no house renames a wine today (production,
      // 2026-10-01: 0 of 183 rows differ).
      for (const item of lowStock) {
        const label =
          wineLabel({
            wine_name: item.wine_name,
            master_wine_library: { vintage: item.vintage },
          }) || UNNAMED_ITEM;
        alerts.push({
          id: `low-stock-${item.id}`,
          type: "low_stock",
          severity: item.stock_live === 0 ? "critical" : "warning",
          title: "Low Stock",
          message: `${label} — ${bottles(item.stock_live)} left, you keep at least ${item.threshold_min}`,
          actionUrl: `/inventory?highlight=${item.id}`,
          createdAt: new Date().toISOString(),
        });
      }

      const overdue = rowsOrThrow(overdueResult, "procurement_orders");
      const now = new Date();
      for (const order of overdue) {
        if (
          order.expected_delivery_date &&
          new Date(order.expected_delivery_date) < now
        ) {
          alerts.push({
            id: `overdue-${order.id}`,
            type: "overdue_order",
            severity: "warning",
            title: "Overdue Order",
            message: `Order expected by ${order.expected_delivery_date}`,
            actionUrl: `/orders?highlight=${order.id}`,
            createdAt: order.created_at,
          });
        }
      }

      const outOfStock = rowsOrThrow(inventoryResult, "restaurant_inventory");
      for (const item of outOfStock) {
        if (!lowStock.find((ls) => ls.id === item.id)) {
          alerts.push({
            id: `out-of-stock-${item.id}`,
            type: "out_of_stock",
            severity: "critical",
            title: "Out of Stock",
            message: `${wineLabel(item) || UNNAMED_ITEM} — out of stock`,
            actionUrl: `/inventory?highlight=${item.id}`,
            createdAt: item.updated_at || new Date().toISOString(),
          });
        }
      }

      alerts.sort((a, b) => {
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        return (
          (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2)
        );
      });

      return alerts;
    } catch (error) {
      this.logger.error(`Alerts fetch failed: ${error.message}`);
      throw error;
    }
  }

  // ==========================================================================
  // SALES CHART
  // ==========================================================================

  /**
   * Time series behind `GET /dashboard/sales-chart/:id`. The route name is
   * frozen; the payload is not sales. Each point's `procurementSpend` is summed
   * from delivered `procurement_orders.total_cost` — vendor invoices, money
   * out. `glasses` is a `wine_consumption_log` count. Sales revenue lives in
   * `pos_checks`, which this method does not read.
   */
  async getSalesChart(
    restaurantId: string,
    period: "day" | "week" | "month" | "year" = "month",
  ): Promise<SalesChartPointDto[]> {
    const client = this.dbService.getClient();

    try {
      const now = new Date();
      let sinceDate: Date;
      let groupFn: (dateStr: string) => string;

      switch (period) {
        case "day":
          sinceDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          groupFn = (d) => d.substring(0, 13); // YYYY-MM-DDTHH
          break;
        case "week":
          sinceDate = new Date(now.getTime() - 7 * 86400000);
          groupFn = (d) => d.substring(0, 10); // YYYY-MM-DD
          break;
        case "month":
          sinceDate = new Date(now.getTime() - 30 * 86400000);
          groupFn = (d) => d.substring(0, 10);
          break;
        case "year":
          sinceDate = new Date(now.getTime() - 365 * 86400000);
          groupFn = (d) => d.substring(0, 7); // YYYY-MM
          break;
      }

      const sinceStr = sinceDate.toISOString();

      const [ordersResult, consumptionResult] = await Promise.allSettled([
        client
          .from("procurement_orders")
          .select(
            "id, total_cost, final_price, bottles_total, quantity, delivered_at, created_at, status",
          )
          .eq("restaurant_id", restaurantId)
          .in("status", ORDER_SPEND_STATUSES)
          .gte("delivered_at", sinceStr),
        // Read whole or refused (ADR 0292). Unranged, this stopped at
        // PostgREST's 1,000 rows, so a year's chart drew a slice of its
        // glasses (A-033).
        readWholeWindow<any>("The consumption lines for the chart", () =>
          client
            .from("wine_consumption_log")
            .select("id, volume_ml, quantity, created_at", { count: "exact" })
            .eq("restaurant_id", restaurantId)
            .gte("created_at", sinceStr),
        ),
      ]);

      const orders =
        ordersResult.status === "fulfilled"
          ? ordersResult.value.data || []
          : [];
      // A refused consumption read is not "no glasses poured": it is thrown,
      // and the catch below rethrows it, instead of drawing glasses = 0.
      // Asked as "not fulfilled": a "rejected" literal next to a
      // procurement_orders chain reads to check_order_status_literals.py as
      // an order status typed in the wrong case.
      if (consumptionResult.status !== "fulfilled")
        throw consumptionResult.reason;
      const consumption = consumptionResult.value;

      const buckets = new Map<
        string,
        { procurementSpend: number; bottles: number; glasses: number }
      >();

      for (const o of orders) {
        const dateKey = groupFn(o.delivered_at || o.created_at);
        const existing = buckets.get(dateKey) || {
          procurementSpend: 0,
          bottles: 0,
          glasses: 0,
        };
        existing.procurementSpend += o.total_cost || o.final_price || 0;
        existing.bottles += o.bottles_total || o.quantity || 0;
        buckets.set(dateKey, existing);
      }

      for (const c of consumption) {
        const dateKey = groupFn(c.created_at);
        const existing = buckets.get(dateKey) || {
          procurementSpend: 0,
          bottles: 0,
          glasses: 0,
        };
        existing.glasses += c.quantity || 0;
        buckets.set(dateKey, existing);
      }

      return Array.from(buckets.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({
          date,
          procurementSpend: data.procurementSpend,
          bottles: data.bottles,
          glasses: data.glasses,
        }));
    } catch (error) {
      this.logger.error(`Sales chart fetch failed: ${error.message}`);
      throw error;
    }
  }

  // ==========================================================================
  // INVENTORY BREAKDOWN
  // ==========================================================================

  async getInventoryBreakdown(
    restaurantId: string,
  ): Promise<InventoryBreakdownDto> {
    const client = this.dbService.getClient();

    try {
      const { data: inventory, error } = await client
        .from("restaurant_inventory")
        // wine_type/stock_status/unit_price do not exist on this table; a
        // single unknown column 42703s the whole request. Type comes from the
        // wine library, status from inventory_state, price from
        // menu_price_current.
        .select(
          "id, stock_live, inventory_state, storage_location_id, menu_price_current, master_wine_library(primary_type)",
        )
        .eq("restaurant_id", restaurantId);

      if (error) {
        this.logger.warn(`Inventory breakdown query error: ${error.message}`);
        return { byType: [], byStatus: [], byLocation: [] };
      }

      const items = inventory || [];

      const typeMap = new Map<string, { count: number; value: number }>();
      const statusMap = new Map<string, number>();
      const locationMap = new Map<string, number>();

      for (const item of items) {
        // supabase-js types a FK embed as an array; at runtime a to-one
        // relation comes back as an object. Accept either.
        const lib: any = (item as any).master_wine_library;
        const type =
          (Array.isArray(lib) ? lib[0]?.primary_type : lib?.primary_type) ||
          "unknown";
        const typeEntry = typeMap.get(type) || { count: 0, value: 0 };
        typeEntry.count += item.stock_live || 0;
        typeEntry.value +=
          (item.stock_live || 0) * (Number(item.menu_price_current) || 0);
        typeMap.set(type, typeEntry);

        const status = item.inventory_state || "unknown";
        statusMap.set(status, (statusMap.get(status) || 0) + 1);

        // storage_location_id is a UUID FK; use 'unassigned' when null
        const location = item.storage_location_id ? "assigned" : "unassigned";
        locationMap.set(
          location,
          (locationMap.get(location) || 0) + (item.stock_live || 0),
        );
      }

      return {
        byType: Array.from(typeMap.entries()).map(([type, data]) => ({
          type,
          count: data.count,
          value: Math.round(data.value * 100) / 100,
        })),
        byStatus: Array.from(statusMap.entries()).map(([status, count]) => ({
          status,
          count,
        })),
        byLocation: Array.from(locationMap.entries()).map(
          ([location, count]) => ({ location, count }),
        ),
      };
    } catch (error) {
      this.logger.error(`Inventory breakdown fetch failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle Promise.allSettled result with type safety
   */
  private handleResult<T>(
    result: PromiseSettledResult<T>,
    serviceName: string,
  ): T | null {
    if (result.status === "fulfilled") {
      return result.value;
    }

    this.logger.error(`Service ${serviceName} failed: ${result.reason}`);
    return null;
  }

  /**
   * Collect errors from Promise.allSettled results
   */
  private collectErrors(
    results: PromiseSettledResult<any>[],
    serviceNames: string[],
  ): ServiceErrorDto[] {
    const errors: ServiceErrorDto[] = [];

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        errors.push({
          service: serviceNames[index],
          message: result.reason?.message || "Unknown error",
        });
      }
    });

    return errors;
  }
}
