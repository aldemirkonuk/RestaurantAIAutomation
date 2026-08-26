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
      orders?.filter(
        (o) => o.status === "pending" || o.status === "awaiting_approval",
      ) || [];
    const inTransit =
      orders?.filter(
        (o) => o.status === "in_transit" || o.status === "ordered",
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
        .eq("status", "delivered");

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

      // Fetch calendar events for the month
      const { data: events } = await client
        .from("calendar_events")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .gte("event_date", startDate)
        .lt("event_date", endDate)
        .order("event_date", { ascending: true });

      // Fetch delivered orders for the month
      const { data: orders } = await client
        .from("procurement_orders")
        .select(
          "id, final_price, total_cost, bottles_total, quantity, delivered_at, wine_name, status",
        )
        .eq("restaurant_id", restaurantId)
        .eq("status", "delivered")
        .gte("delivered_at", startDate)
        .lt("delivered_at", endDate);

      // Build per-day data
      const daysInMonth = new Date(year, month, 0).getDate();
      const dailyData: any[] = [];

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

        const dayEvents = (events || []).filter(
          (e) => e.event_date === dateStr,
        );
        const dayOrders = (orders || []).filter(
          (o) => o.delivered_at && o.delivered_at.startsWith(dateStr),
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
      const [inventoryResult, lowStockResult, ordersResult, consumptionResult] =
        await Promise.allSettled([
          client
            .from("restaurant_inventory")
            .select("id, stock_live, bottle_size_ml")
            .eq("restaurant_id", restaurantId),
          client
            .from("v_low_stock_items")
            .select("id")
            .eq("restaurant_id", restaurantId),
          client
            .from("procurement_orders")
            .select("id, status, total_cost, final_price, created_at")
            .eq("restaurant_id", restaurantId),
          client
            .from("wine_consumption_log")
            .select("id, volume_ml, created_at")
            .eq("restaurant_id", restaurantId),
        ]);

      const inventory =
        inventoryResult.status === "fulfilled"
          ? inventoryResult.value.data || []
          : [];
      const lowStock =
        lowStockResult.status === "fulfilled"
          ? lowStockResult.value.data || []
          : [];
      const orders =
        ordersResult.status === "fulfilled"
          ? ordersResult.value.data || []
          : [];
      const consumption =
        consumptionResult.status === "fulfilled"
          ? consumptionResult.value.data || []
          : [];

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
      const pendingOrders = orders.filter(
        (o) => o.status === "pending" || o.status === "awaiting_approval",
      ).length;

      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      const weekAgo = new Date(now.getTime() - 7 * 86400000)
        .toISOString()
        .split("T")[0];
      const monthAgo = new Date(now.getTime() - 30 * 86400000)
        .toISOString()
        .split("T")[0];

      // Sums vendor invoices on delivered procurement orders. This was named
      // `salesFrom` and published as todaySales/weekSales/monthSales, which the
      // web dashboard rendered as "Total Revenue" — the exact opposite of what
      // the number is. Nothing here is a sale.
      const spendSince = (items: any[], since: string) =>
        items
          .filter((o) => o.created_at && o.created_at >= since)
          .reduce((sum, o) => sum + (o.total_cost || o.final_price || 0), 0);

      const deliveredOrders = orders.filter((o) => o.status === "delivered");

      return {
        totalWines,
        totalBottles,
        totalVolumeMl,
        totalVolumeOz,
        lowStockItems,
        pendingOrders,
        todayProcurementSpend: spendSince(deliveredOrders, todayStr),
        weekProcurementSpend: spendSince(deliveredOrders, weekAgo),
        monthProcurementSpend: spendSince(deliveredOrders, monthAgo),
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
            .select("id, status, created_at, updated_at")
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
            .select("id, master_wine_id, stock_live, updated_at")
            .eq("restaurant_id", restaurantId)
            .order("updated_at", { ascending: false })
            .limit(limit),
        ]);

      const activities: ActivityItemDto[] = [];

      const orders =
        ordersResult.status === "fulfilled"
          ? ordersResult.value.data || []
          : [];
      for (const o of orders) {
        activities.push({
          id: `order-${o.id}`,
          type: "order",
          title: `Order ${o.status}`,
          description: `Order ${o.status}`,
          timestamp: o.updated_at || o.created_at,
          entityId: o.id,
          entityType: "procurement_order",
        });
      }

      const events =
        eventsResult.status === "fulfilled"
          ? eventsResult.value.data || []
          : [];
      for (const e of events) {
        const payload =
          typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload;
        activities.push({
          id: `event-${e.id}`,
          type: e.event_type || "event",
          title: payload?.title || e.event_type || "Event",
          description: payload?.description || payload?.action || e.event_type,
          timestamp: e.created_at,
          entityId: e.id,
          entityType: "event",
        });
      }

      const inventory =
        inventoryResult.status === "fulfilled"
          ? inventoryResult.value.data || []
          : [];
      for (const i of inventory) {
        activities.push({
          id: `inv-${i.id}`,
          type: "inventory_change",
          title: "Inventory updated",
          description: `Stock: ${i.stock_live} bottles`,
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
            .select("id, master_wine_id, stock_live, threshold_min, wine_name")
            .eq("restaurant_id", restaurantId),
          client
            .from("procurement_orders")
            .select("id, status, expected_delivery_date, created_at")
            .eq("restaurant_id", restaurantId)
            .in("status", ["pending", "awaiting_approval", "ordered"]),
          client
            .from("restaurant_inventory")
            .select("id, master_wine_id, stock_live, updated_at, wine_name")
            .eq("restaurant_id", restaurantId)
            .eq("stock_live", 0),
        ]);

      const lowStock =
        lowStockResult.status === "fulfilled"
          ? lowStockResult.value.data || []
          : [];
      for (const item of lowStock) {
        alerts.push({
          id: `low-stock-${item.id}`,
          type: "low_stock",
          severity: item.stock_live === 0 ? "critical" : "warning",
          title: "Low Stock",
          message: `${item.wine_name || item.master_wine_id} has ${item.stock_live} bottles (min: ${item.threshold_min || 0})`,
          actionUrl: `/inventory?highlight=${item.id}`,
          createdAt: new Date().toISOString(),
        });
      }

      const overdue =
        overdueResult.status === "fulfilled"
          ? overdueResult.value.data || []
          : [];
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

      const outOfStock =
        inventoryResult.status === "fulfilled"
          ? inventoryResult.value.data || []
          : [];
      for (const item of outOfStock) {
        if (!lowStock.find((ls) => ls.id === item.id)) {
          alerts.push({
            id: `out-of-stock-${item.id}`,
            type: "out_of_stock",
            severity: "critical",
            title: "Out of Stock",
            message: `${item.wine_name || item.master_wine_id} is completely out of stock`,
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
          .eq("status", "delivered")
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
