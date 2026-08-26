import {
  Controller,
  Get,
  Param,
  Query,
  HttpException,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { DashboardService } from "./dashboard.service";
import {
  DashboardSummaryDto,
  DashboardStatsDto,
  ActivityItemDto,
  AlertDto,
  SalesChartPointDto,
  InventoryBreakdownDto,
} from "./dto/dashboard-summary.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

/**
 * Dashboard Controller - Aggregated API endpoints
 *
 * Implements the API Bus/Aggregator pattern:
 * - Single endpoint replaces multiple frontend calls
 * - Parallel backend processing
 * - Graceful degradation on partial failures
 */
@ApiTags("dashboard")
/**
 * OD-20 — guarded at class level 2026-08-25.
 *
 * This controller had no guard and no @Public(). It was not protected by
 * TenantGuard either: that guard fails OPEN by design —
 * "If no authenticated user, allow through — JwtAuthGuard should enforce where
 * required" (tenant.guard.ts) — and nothing here required it.
 *
 * Verified live before the fix: GET /api/v1/dashboard/stats/<uuid> returned 200
 * with JSON to an unauthenticated caller.
 *
 * Routes that are genuinely public must now say so with @Public(), so intent is
 * recorded rather than inferred from an absent decorator.
 */
@UseGuards(JwtAuthGuard)
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Get aggregated dashboard summary
   *
   * This endpoint aggregates data from:
   * - Inventory service (summary stats)
   * - Procurement service (pending orders)
   * - Notifications service (recent alerts)
   * - Reports service (latest report)
   *
   * Benefits:
   * - Reduces frontend API calls from 4+ to 1
   * - Parallel backend processing (~400ms vs ~1.5s sequential)
   * - Graceful degradation if any service fails
   */
  @Get("summary/:restaurantId")
  @ApiOperation({
    summary: "Get aggregated dashboard summary",
    description:
      "Fetches inventory, orders, notifications, and reports data in parallel and returns a combined response. Implements graceful degradation - if one service fails, others still return data.",
  })
  @ApiParam({
    name: "restaurantId",
    description: "Restaurant UUID",
    example: "123e4567-e89b-12d3-a456-426614174000",
  })
  @ApiResponse({
    status: 200,
    description: "Returns aggregated dashboard data",
    type: DashboardSummaryDto,
  })
  @ApiResponse({
    status: 500,
    description: "Internal server error",
  })
  async getDashboardSummary(
    @Param("restaurantId") restaurantId: string,
  ): Promise<DashboardSummaryDto> {
    try {
      return await this.dashboardService.getDashboardSummary(restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch dashboard summary",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Per-day procurement figures for a specific month.
   *
   * The route name `calendar-revenue` is frozen, but nothing here is revenue:
   * `daily[].procurement_spend` and `monthly_procurement_spend` are sums of
   * delivered `procurement_orders` — money paid to vendors. Joined with
   * calendar events for the day overlays.
   */
  @Get("calendar-revenue/:restaurantId")
  @ApiOperation({
    summary: "Get per-day vendor spend and calendar events for a given month",
    description:
      "Returns per-day vendor SPEND (`procurement_spend`, summed from delivered procurement orders — money out, not sales revenue) plus calendar events for the requested month. The `calendar-revenue` path name is a legacy misnomer kept for compatibility.",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiQuery({
    name: "year",
    required: false,
    description: "Year (defaults to current)",
  })
  @ApiQuery({
    name: "month",
    required: false,
    description: "Month 1-12 (defaults to current)",
  })
  @ApiResponse({
    status: 200,
    description: "Per-day vendor spend and calendar events",
  })
  async getCalendarRevenue(
    @Param("restaurantId") restaurantId: string,
    @Query("year") yearStr?: string,
    @Query("month") monthStr?: string,
  ) {
    try {
      const now = new Date();
      const year = yearStr ? parseInt(yearStr) : now.getFullYear();
      const month = monthStr ? parseInt(monthStr) : now.getMonth() + 1;
      return await this.dashboardService.getCalendarRevenue(
        restaurantId,
        year,
        month,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch calendar revenue",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // STATS
  // ==========================================================================

  @Get("stats/:restaurantId")
  @ApiOperation({
    summary: "Get dashboard stat cards",
    description:
      "Aggregated stats: wines, bottles, volume, low stock, pending orders, sales.",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiResponse({
    status: 200,
    description: "Dashboard stats",
    type: DashboardStatsDto,
  })
  async getStats(
    @Param("restaurantId") restaurantId: string,
  ): Promise<DashboardStatsDto> {
    try {
      return await this.dashboardService.getStats(restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch dashboard stats",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // ACTIVITY
  // ==========================================================================

  @Get("activity/:restaurantId")
  @ApiOperation({
    summary: "Get recent activity feed",
    description:
      "Combined feed of recent orders, inventory changes, and events.",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Max items (default 20)",
  })
  @ApiResponse({
    status: 200,
    description: "Activity feed",
    type: [ActivityItemDto],
  })
  async getActivity(
    @Param("restaurantId") restaurantId: string,
    @Query("limit") limitStr?: string,
  ): Promise<ActivityItemDto[]> {
    try {
      const limit = limitStr ? parseInt(limitStr, 10) : 20;
      return await this.dashboardService.getActivity(restaurantId, limit);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch activity feed",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // ALERTS
  // ==========================================================================

  @Get("alerts/:restaurantId")
  @ApiOperation({
    summary: "Get active alerts",
    description: "Low stock warnings, overdue orders, expiring items.",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiResponse({ status: 200, description: "Active alerts", type: [AlertDto] })
  async getAlerts(
    @Param("restaurantId") restaurantId: string,
  ): Promise<AlertDto[]> {
    try {
      return await this.dashboardService.getAlerts(restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch alerts",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // SALES CHART
  // ==========================================================================

  @Get("sales-chart/:restaurantId")
  @ApiOperation({
    summary: "Get the procurement-spend time series",
    description:
      "Time-series data for vendor SPEND (`procurementSpend`, summed from delivered procurement orders — money out, not sales revenue), bottles delivered, and glasses poured. The `sales-chart` path name is a legacy misnomer kept for compatibility.",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiQuery({
    name: "period",
    required: false,
    enum: ["day", "week", "month", "year"],
    description: "Chart period",
  })
  @ApiResponse({
    status: 200,
    description: "Procurement-spend time series",
    type: [SalesChartPointDto],
  })
  async getSalesChart(
    @Param("restaurantId") restaurantId: string,
    @Query("period") period?: "day" | "week" | "month" | "year",
  ): Promise<SalesChartPointDto[]> {
    try {
      return await this.dashboardService.getSalesChart(
        restaurantId,
        period || "month",
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch sales chart",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // INVENTORY BREAKDOWN
  // ==========================================================================

  @Get("inventory-breakdown/:restaurantId")
  @ApiOperation({
    summary: "Get inventory breakdown by type, status, and location",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiResponse({
    status: 200,
    description: "Inventory breakdown",
    type: InventoryBreakdownDto,
  })
  async getInventoryBreakdown(
    @Param("restaurantId") restaurantId: string,
  ): Promise<InventoryBreakdownDto> {
    try {
      return await this.dashboardService.getInventoryBreakdown(restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch inventory breakdown",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // HEALTH
  // ==========================================================================

  @Get("health")
  @ApiOperation({ summary: "Dashboard service health check" })
  @ApiResponse({ status: 200, description: "Service is healthy" })
  async healthCheck() {
    return {
      status: "healthy",
      service: "dashboard",
      timestamp: new Date().toISOString(),
    };
  }
}
