import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class InventorySummaryDto {
  @ApiProperty({ description: "Total number of inventory items" })
  totalItems: number;

  @ApiProperty({ description: "Total number of bottles in stock" })
  totalBottles: number;

  @ApiProperty({ description: "Number of low stock items" })
  lowStockCount: number;

  @ApiProperty({ description: "Number of critical (zero stock) items" })
  criticalCount: number;

  @ApiProperty({ description: "Number of healthy stock items" })
  healthyCount: number;
}

export class OrderSummaryDto {
  @ApiProperty({ description: "Orders awaiting approval" })
  pending: any[];

  @ApiProperty({ description: "Orders in transit" })
  inTransit: any[];

  @ApiProperty({ description: "Total pending orders count" })
  pendingCount: number;

  @ApiProperty({ description: "Total in transit count" })
  inTransitCount: number;
}

export class NotificationSummaryDto {
  @ApiProperty({ description: "Recent notifications" })
  recent: any[];

  @ApiProperty({ description: "Unread count" })
  unreadCount: number;
}

export class ReportSummaryDto {
  @ApiPropertyOptional({ description: "Latest report" })
  latest: any | null;

  @ApiPropertyOptional({ description: "Last generated date" })
  lastGeneratedAt: string | null;
}

export class CalendarSummaryDto {
  @ApiProperty({ description: "Upcoming events in the next 7 days" })
  upcoming: any[];

  @ApiProperty({ description: "Number of events today" })
  todayCount: number;

  @ApiProperty({ description: "Number of delivery events this week" })
  deliveriesThisWeek: number;
}

/**
 * Money the restaurant PAID ITS VENDORS, aggregated from delivered
 * `procurement_orders`. This is cost, not income.
 *
 * It used to be called `RevenueSummaryDto` and its fields `totalRevenue` /
 * `monthlyRevenue` / `revenueByMonth`, which inverted the economics of the
 * owner's headline KPI: every dollar spent on wine was presented as a dollar
 * earned. Nothing about the query changed in the rename — only the claim it
 * makes. Real sales revenue would come from `pos_checks`, which this service
 * does not read.
 */
export class ProcurementSpendSummaryDto {
  @ApiProperty({
    description:
      "Total spent with vendors on delivered orders (all time). NOT revenue.",
  })
  totalProcurementSpend: number;

  @ApiProperty({ description: "Vendor spend this month" })
  monthlyProcurementSpend: number;

  @ApiProperty({ description: "Total bottles delivered by vendors" })
  totalBottlesDelivered: number;

  @ApiProperty({ description: "Vendor spend by month [{month, spend, bottles}]" })
  spendByMonth: any[];
}

export class ServiceErrorDto {
  @ApiProperty({ description: "Service name that failed" })
  service: string;

  @ApiProperty({ description: "Error message" })
  message: string;
}

export class DashboardSummaryDto {
  @ApiProperty({ description: "Inventory summary", type: InventorySummaryDto })
  inventory: InventorySummaryDto | null;

  @ApiProperty({ description: "Orders summary", type: OrderSummaryDto })
  orders: OrderSummaryDto | null;

  @ApiProperty({
    description: "Notifications summary",
    type: NotificationSummaryDto,
  })
  notifications: NotificationSummaryDto | null;

  @ApiProperty({ description: "Reports summary", type: ReportSummaryDto })
  reports: ReportSummaryDto | null;

  @ApiProperty({ description: "Calendar summary", type: CalendarSummaryDto })
  calendar: CalendarSummaryDto | null;

  @ApiProperty({
    description: "Vendor spend summary (money paid out, not earned)",
    type: ProcurementSpendSummaryDto,
  })
  procurementSpend: ProcurementSpendSummaryDto | null;

  @ApiProperty({
    description: "List of service errors",
    type: [ServiceErrorDto],
  })
  errors: ServiceErrorDto[];

  @ApiProperty({ description: "Timestamp of the response" })
  timestamp: string;

  @ApiProperty({ description: "Whether all services responded successfully" })
  allServicesHealthy: boolean;
}

// ============================================================================
// DASHBOARD STATS
// ============================================================================

export class DashboardStatsDto {
  @ApiProperty() totalWines: number;
  @ApiProperty() totalBottles: number;
  @ApiProperty() totalVolumeMl: number;
  @ApiProperty() totalVolumeOz: number;
  @ApiProperty() lowStockItems: number;
  @ApiProperty() pendingOrders: number;

  // These three were `todaySales` / `weekSales` / `monthSales`, and `monthSales`
  // is what the web dashboard rendered under the heading "Total Revenue". They
  // are sums of `procurement_orders.total_cost` for delivered orders — vendor
  // invoices, i.e. money leaving the restaurant. No sale is involved.
  @ApiProperty({ description: "Vendor spend on orders delivered today" })
  todayProcurementSpend: number;

  @ApiProperty({ description: "Vendor spend on orders delivered in the last 7 days" })
  weekProcurementSpend: number;

  @ApiProperty({ description: "Vendor spend on orders delivered in the last 30 days" })
  monthProcurementSpend: number;
}

// ============================================================================
// ACTIVITY FEED
// ============================================================================

export class ActivityItemDto {
  @ApiProperty() id: string;
  @ApiProperty() type: string;
  @ApiProperty() title: string;
  @ApiProperty() description: string;
  @ApiProperty() timestamp: string;
  @ApiPropertyOptional() entityId?: string;
  @ApiPropertyOptional() entityType?: string;
}

// ============================================================================
// ALERTS
// ============================================================================

export class AlertDto {
  @ApiProperty() id: string;
  @ApiProperty() type: string;
  @ApiProperty() severity: string;
  @ApiProperty() title: string;
  @ApiProperty() message: string;
  @ApiPropertyOptional() actionUrl?: string;
  @ApiProperty() createdAt: string;
}

// ============================================================================
// SALES CHART
// ============================================================================

/**
 * One bucket of the `GET /dashboard/sales-chart/:id` series.
 *
 * The route name is frozen (it is a published path), but the money in here is
 * NOT sales. `procurementSpend` is summed from delivered
 * `procurement_orders.total_cost` — money the restaurant PAYS its vendors. The
 * field used to be called `revenue`, which inverted the sign of the number for
 * every consumer that plotted it. `glasses` comes from `wine_consumption_log`.
 * Real sales revenue lives in `pos_checks` and is not read by this endpoint.
 */
export class SalesChartPointDto {
  @ApiProperty() date: string;

  @ApiProperty({
    description:
      "Vendor spend on orders delivered in this bucket. NOT sales revenue.",
  })
  procurementSpend: number;

  @ApiProperty() bottles: number;
  @ApiProperty() glasses: number;
}

// ============================================================================
// INVENTORY BREAKDOWN
// ============================================================================

export class InventoryBreakdownDto {
  @ApiProperty() byType: { type: string; count: number; value: number }[];
  @ApiProperty() byStatus: { status: string; count: number }[];
  @ApiProperty() byLocation: { location: string; count: number }[];
}
