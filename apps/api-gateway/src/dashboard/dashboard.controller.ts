import {
  BadRequestException,
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
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { policyFor } from "../ask-readings/reading-data-classes";

/** The caller's role IN THE HOUSE THE TOKEN NAMES (jwt.strategy.ts). */
type Caller = { role?: string | null } | undefined;

/**
 * Does this role see the house's sales? Read from the /ask role table, so
 * "who sees sales" is decided in one place (ROLE_POLICY: owner and manager
 * see `sales`, staff do not). `policyFor` reads an unknown or missing role as
 * staff, so a caller whose role cannot be told sees no sales (ADR 0290 §5).
 */
export function seesHouseSales(role: string | null | undefined): boolean {
  return policyFor(role).sees.includes("sales");
}

/** A `year` / `month` query value: absent is null, anything else must be whole and in range. */
function calendarPart(
  raw: string | undefined,
  name: string,
  min: number,
  max: number,
): number | null {
  if (raw === undefined || raw === "") return null;
  const n = /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadRequestException(
      `${name} must be a whole number from ${min} to ${max}`,
    );
  }
  return n;
}

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
   * The month calendar, filed on the house's own days (ADR 0290).
   *
   * The route name `calendar-revenue` is frozen. `procurement_spend` is money
   * paid to vendors; `net_sales` is the register's net takings, sent only to
   * a role that sees sales (staff get `sales_withheld: true` and the register
   * is not read). With no year or month the house's own month is shown.
   */
  @Get("calendar-revenue/:restaurantId")
  @ApiOperation({
    summary:
      "Get per-day net sales, vendor spend and calendar events for a month",
    description:
      "Returns, per house day: `net_sales` and `checks` (sum of `pos_checks.subtotal` over checks not voided; only for roles that see sales), vendor SPEND (`procurement_spend`, delivered procurement orders — money out, not sales), and calendar events. Days are filed in `restaurants.timezone`; a house with none gets null day figures and `zone_unset: true`. The `calendar-revenue` path name is a legacy misnomer kept for compatibility.",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiQuery({
    name: "year",
    required: false,
    description: "Year (defaults to the house's current year)",
  })
  @ApiQuery({
    name: "month",
    required: false,
    description: "Month 1-12 (defaults to the house's current month)",
  })
  @ApiResponse({
    status: 200,
    description: "Per-day net sales, vendor spend and calendar events",
  })
  async getCalendarRevenue(
    @Param("restaurantId") restaurantId: string,
    @Query("year") yearStr?: string,
    @Query("month") monthStr?: string,
    @CurrentUser() user?: Caller,
  ) {
    const year = calendarPart(yearStr, "year", 1970, 9999);
    const month = calendarPart(monthStr, "month", 1, 12);
    try {
      return await this.dashboardService.getCalendarRevenue(
        restaurantId,
        year,
        month,
        { withSales: seesHouseSales(user?.role) },
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
