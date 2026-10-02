import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
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
import {
  localDateIn,
  localMidnight,
  shiftLocalDate,
} from "../notifications/producers/service-day";

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

/** What an alert says when the cellar row carries no name at all. */
const UNNAMED_WINE = "A wine with no name";

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
   */
  async getDashboardSummary(
    restaurantId: string,
  ): Promise<DashboardSummaryDto> {
    this.logger.log(
      `Fetching dashboard summary for restaurant: ${restaurantId}`,
    );
    const startTime = Date.now();

    // Execute all service calls in parallel
    const results = await Promise.allSettled([
      this.getInventorySummary(restaurantId),
      this.getOrdersSummary(restaurantId),
      this.getNotificationsSummary(restaurantId),
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
   * Get notifications summary optimized for dashboard
   */
  private async getNotificationsSummary(
    restaurantId: string,
  ): Promise<NotificationSummaryDto> {
    // For now, get notifications from the database
    // In production, this would be scoped to the restaurant's managers
    const client = this.dbService.getClient();

    try {
      const { data: notifications, error } = await client
        .from("notifications")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("sent_at", { ascending: false })
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
   * Per-day figures behind `GET /dashboard/calendar-revenue/:id`. The route
   * name is frozen; the payload is not revenue. `daily[].procurement_spend` and
   * `monthly_procurement_spend` are summed from delivered `procurement_orders`
   * — money paid to vendors, not money earned. `bottles_sold` counts bottles
   * DELIVERED by vendors, for the same reason. Joins `calendar_events` for the
   * day overlays. Sales revenue lives in `pos_checks` and is not read here.
   */
  async getCalendarRevenue(
    restaurantId: string,
    year: number,
    month: number,
  ): Promise<any> {
    const client = this.dbService.getClient();

    try {
      // Build date range for the month
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const endMonth = month === 12 ? 1 : month + 1;
      const endYear = month === 12 ? year + 1 : year;
      const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

      // A delivery belongs to the day on the HOUSE's wall clock (DASH-W2):
      // 8pm in Chicago is already tomorrow in UTC, and bucketing on the UTC
      // date moved an evening delivery into the next day's cell.
      const zone = await this.houseZone(client, restaurantId);

      // Fetch calendar events for the month
      const { data: events, error: eventsError } = await client
        .from("calendar_events")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .gte("event_date", startDate)
        .lt("event_date", endDate)
        .order("event_date", { ascending: true });
      if (eventsError) {
        throw new Error(`calendar_events read failed: ${eventsError.message}`);
      }

      // Fetch delivered orders for the month. This select named `wine_name`,
      // which `procurement_orders` has never had (DASH-W6): PostgREST refused
      // the whole query, only `data` was read, and the calendar showed $0 paid
      // on every day for every house. A failed read now fails the call, so the
      // page shows "unknown" instead of a month of zeros.
      const { data: orders, error: ordersError } = await client
        .from("procurement_orders")
        .select(
          "id, final_price, total_cost, bottles_total, quantity, delivered_at, status",
        )
        .eq("restaurant_id", restaurantId)
        .in("status", ORDER_SPEND_STATUSES)
        .gte("delivered_at", localMidnight(startDate, zone).toISOString())
        .lt("delivered_at", localMidnight(endDate, zone).toISOString());
      if (ordersError) {
        throw new Error(
          `procurement_orders read failed: ${ordersError.message}`,
        );
      }

      // Build per-day data
      const daysInMonth = new Date(year, month, 0).getDate();
      const dailyData: any[] = [];

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

        const dayEvents = (events || []).filter(
          (e) => e.event_date === dateStr,
        );
        const dayOrders = (orders || []).filter(
          (o) =>
            o.delivered_at &&
            localDateIn(new Date(o.delivered_at), zone) === dateStr,
        );

        const procurementSpend = dayOrders.reduce(
          (sum, o) => sum + (o.total_cost || o.final_price || 0),
          0,
        );
        const bottlesSold = dayOrders.reduce(
          (sum, o) => sum + (o.bottles_total || o.quantity || 0),
          0,
        );

        dailyData.push({
          date: dateStr,
          procurement_spend: procurementSpend,
          bottles_sold: bottlesSold,
          events: dayEvents,
          order_count: dayOrders.length,
        });
      }

      return {
        year,
        month,
        restaurant_id: restaurantId,
        daily: dailyData,
        monthly_procurement_spend: dailyData.reduce(
          (sum, d) => sum + d.procurement_spend,
          0,
        ),
        monthly_bottles: dailyData.reduce((sum, d) => sum + d.bottles_sold, 0),
      };
    } catch (error) {
      this.logger.error(`Calendar revenue fetch failed: ${error.message}`);
      throw error;
    }
  }

  // ==========================================================================
  // STATS
  // ==========================================================================

  async getStats(restaurantId: string): Promise<DashboardStatsDto> {
    const client = this.dbService.getClient();

    try {
      const [inventoryResult, lowStockResult, ordersResult, zoneResult] =
        await Promise.allSettled([
          client
            .from("restaurant_inventory")
            .select("id, stock_live, bottle_size_ml")
            .eq("restaurant_id", restaurantId)
            .is("deleted_at", null)
            .eq("is_active", true),
          client
            .from("v_low_stock_items")
            .select("id")
            .eq("restaurant_id", restaurantId),
          client
            .from("procurement_orders")
            .select("id, status, total_cost, final_price, bottles_total, quantity, delivered_at")
            .eq("restaurant_id", restaurantId),
          this.houseZone(client, restaurantId),
        ]);

      // A failed read used to become an empty list, so a cellar that could
      // not be read rendered "0 · across 0 wines" — absence reported as
      // health (DASH-W3). The cellar, low-stock and order reads now fail the
      // call, and the page shows its em dash for "unknown". A
      // `wine_consumption_log` read used to ride along here and feed nothing;
      // it is gone (DASH-W8).
      const inventory = rowsOrThrow(inventoryResult, "restaurant_inventory");
      const lowStock = rowsOrThrow(lowStockResult, "v_low_stock_items");
      const orders = rowsOrThrow(ordersResult, "procurement_orders");
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
          }) || UNNAMED_WINE;
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
            message: `${wineLabel(item) || UNNAMED_WINE} — out of stock`,
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
        client
          .from("wine_consumption_log")
          .select("id, volume_ml, quantity, created_at")
          .eq("restaurant_id", restaurantId)
          .gte("created_at", sinceStr),
      ]);

      const orders =
        ordersResult.status === "fulfilled"
          ? ordersResult.value.data || []
          : [];
      const consumption =
        consumptionResult.status === "fulfilled"
          ? consumptionResult.value.data || []
          : [];

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
