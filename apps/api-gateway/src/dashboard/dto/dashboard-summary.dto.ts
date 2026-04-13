import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InventorySummaryDto {
  @ApiProperty({ description: 'Total number of inventory items' })
  totalItems: number;

  @ApiProperty({ description: 'Total number of bottles in stock' })
  totalBottles: number;

  @ApiProperty({ description: 'Number of low stock items' })
  lowStockCount: number;

  @ApiProperty({ description: 'Number of critical (zero stock) items' })
  criticalCount: number;

  @ApiProperty({ description: 'Number of healthy stock items' })
  healthyCount: number;
}

export class OrderSummaryDto {
  @ApiProperty({ description: 'Orders awaiting approval' })
  pending: any[];

  @ApiProperty({ description: 'Orders in transit' })
  inTransit: any[];

  @ApiProperty({ description: 'Total pending orders count' })
  pendingCount: number;

  @ApiProperty({ description: 'Total in transit count' })
  inTransitCount: number;
}

export class NotificationSummaryDto {
  @ApiProperty({ description: 'Recent notifications' })
  recent: any[];

  @ApiProperty({ description: 'Unread count' })
  unreadCount: number;
}

export class ReportSummaryDto {
  @ApiPropertyOptional({ description: 'Latest report' })
  latest: any | null;

  @ApiPropertyOptional({ description: 'Last generated date' })
  lastGeneratedAt: string | null;
}

export class CalendarSummaryDto {
  @ApiProperty({ description: 'Upcoming events in the next 7 days' })
  upcoming: any[];

  @ApiProperty({ description: 'Number of events today' })
  todayCount: number;

  @ApiProperty({ description: 'Number of delivery events this week' })
  deliveriesThisWeek: number;
}

export class RevenueSummaryDto {
  @ApiProperty({ description: 'Total revenue from delivered orders (all time)' })
  totalRevenue: number;

  @ApiProperty({ description: 'Revenue this month' })
  monthlyRevenue: number;

  @ApiProperty({ description: 'Total bottles delivered' })
  totalBottlesDelivered: number;

  @ApiProperty({ description: 'Revenue by month [{month, revenue, bottles}]' })
  revenueByMonth: any[];
}

export class ServiceErrorDto {
  @ApiProperty({ description: 'Service name that failed' })
  service: string;

  @ApiProperty({ description: 'Error message' })
  message: string;
}

export class DashboardSummaryDto {
  @ApiProperty({ description: 'Inventory summary', type: InventorySummaryDto })
  inventory: InventorySummaryDto | null;

  @ApiProperty({ description: 'Orders summary', type: OrderSummaryDto })
  orders: OrderSummaryDto | null;

  @ApiProperty({ description: 'Notifications summary', type: NotificationSummaryDto })
  notifications: NotificationSummaryDto | null;

  @ApiProperty({ description: 'Reports summary', type: ReportSummaryDto })
  reports: ReportSummaryDto | null;

  @ApiProperty({ description: 'Calendar summary', type: CalendarSummaryDto })
  calendar: CalendarSummaryDto | null;

  @ApiProperty({ description: 'Revenue summary', type: RevenueSummaryDto })
  revenue: RevenueSummaryDto | null;

  @ApiProperty({ description: 'List of service errors', type: [ServiceErrorDto] })
  errors: ServiceErrorDto[];

  @ApiProperty({ description: 'Timestamp of the response' })
  timestamp: string;

  @ApiProperty({ description: 'Whether all services responded successfully' })
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
  @ApiProperty() todaySales: number;
  @ApiProperty() weekSales: number;
  @ApiProperty() monthSales: number;
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

export class SalesChartPointDto {
  @ApiProperty() date: string;
  @ApiProperty() revenue: number;
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
