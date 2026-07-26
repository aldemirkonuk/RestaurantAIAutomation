import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from "@nestjs/swagger";
import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { RecommendationsService } from "./recommendations.service";
import {
  RecommendationActionsService,
  RecommendationStatus,
} from "./recommendation-actions.service";
import { TableAnalyticsService } from "./table-analytics.service";
import { GoalsService } from "./goals.service";
import { ConsultantsService } from "./consultants.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { InsightSchedulerService } from "./insights/insight-scheduler.service";
import { Persona } from "./metric-registry";

/**
 * Analytics Controller — the quantitative API surface.
 *
 * Endpoints map onto the four engine lenses:
 *   • /metrics                  — the formula library (metric registry)
 *   • /financial/:id            — P&L & capital-efficiency (COGS%, GMROI, turnover)
 *   • /inventory-science/:id    — EOQ, safety stock, reorder, ABC-XYZ, stockout P
 *   • /risk/:id                 — HHI, Gini, VaR/CVaR, Sharpe, drawdown
 *   • /forecast/:id             — Holt-Winters demand projection
 */
@ApiTags("analytics")
@Controller("analytics")
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly advanced: AdvancedAnalyticsService,
    private readonly recommendationsService: RecommendationsService,
    private readonly recommendationActions: RecommendationActionsService,
    private readonly tableAnalytics: TableAnalyticsService,
    private readonly goalsService: GoalsService,
    private readonly consultantsService: ConsultantsService,
    private readonly insightGenerator: InsightGeneratorService,
    private readonly scheduler: InsightSchedulerService,
  ) {}

  @Get("metrics")
  @ApiOperation({
    summary: "List available analytics metrics (formula library)",
    description:
      "Returns the metric registry — every computable metric with its formula, theorem lineage, personas, and satisfied catalogue feature ids. Filterable by persona or domain.",
  })
  @ApiQuery({
    name: "persona",
    required: false,
    enum: [
      "manager",
      "trader",
      "private_equity",
      "economist",
      "statistician",
      "operations",
    ],
  })
  @ApiQuery({ name: "domain", required: false })
  @ApiResponse({ status: 200, description: "Metric registry" })
  getMetrics(
    @Query("persona") persona?: Persona,
    @Query("domain") domain?: string,
  ) {
    return this.analyticsService.getMetricCatalog({ persona, domain });
  }

  @Get("financial/:restaurantId")
  @ApiOperation({
    summary: "Financial & capital-efficiency summary",
    description:
      "COGS %, gross margin, prime cost, inventory turnover, DIO, GMROI, and dead-stock capital lock.",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiQuery({
    name: "labor",
    required: false,
    description: "Labor $ for prime-cost calc (optional)",
  })
  async getFinancial(
    @Param("restaurantId") restaurantId: string,
    @Query("labor") laborStr?: string,
  ) {
    try {
      const labor = laborStr ? parseFloat(laborStr) : 0;
      return await this.analyticsService.getFinancialSummary(
        restaurantId,
        Number.isFinite(labor) ? labor : 0,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to compute financial summary",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("inventory-science/:restaurantId")
  @ApiOperation({
    summary: "Inventory-science replenishment analytics",
    description:
      "Per-SKU EOQ, dynamic safety stock, reorder point, stockout probability, days-of-cover, and ABC-XYZ classification.",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiQuery({
    name: "serviceLevel",
    required: false,
    description: "Cycle service level 0-1 (default 0.95)",
  })
  @ApiQuery({
    name: "leadTimeDays",
    required: false,
    description: "Average vendor lead time in days (default 7)",
  })
  async getInventoryScience(
    @Param("restaurantId") restaurantId: string,
    @Query("serviceLevel") serviceLevelStr?: string,
    @Query("leadTimeDays") leadTimeStr?: string,
  ) {
    try {
      return await this.analyticsService.getInventoryScience(restaurantId, {
        serviceLevel: serviceLevelStr ? parseFloat(serviceLevelStr) : undefined,
        leadTimeDays: leadTimeStr ? parseFloat(leadTimeStr) : undefined,
      });
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to compute inventory science",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("risk/:restaurantId")
  @ApiOperation({
    summary: "Risk & concentration profile",
    description:
      "Vendor concentration (HHI), revenue concentration (Gini), and demand risk (VaR/CVaR, Sharpe, Sortino, max drawdown).",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  async getRisk(@Param("restaurantId") restaurantId: string) {
    try {
      return await this.analyticsService.getRiskProfile(restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to compute risk profile",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("forecast/:restaurantId")
  @ApiOperation({
    summary: "Demand forecast",
    description:
      "Holt-Winters (weekly-seasonal) demand projection with Holt/SES fallback and backtest accuracy (MAE/RMSE/MAPE/MASE).",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiQuery({
    name: "masterWineId",
    required: false,
    description: "Forecast a single wine (omit for aggregate)",
  })
  @ApiQuery({
    name: "horizon",
    required: false,
    description: "Days to forecast (default 14)",
  })
  async getForecast(
    @Param("restaurantId") restaurantId: string,
    @Query("masterWineId") masterWineId?: string,
    @Query("horizon") horizonStr?: string,
  ) {
    try {
      return await this.analyticsService.getDemandForecast(restaurantId, {
        masterWineId,
        horizon: horizonStr ? parseInt(horizonStr, 10) : undefined,
      });
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to compute forecast",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // Insights — stored feed, on-demand generation, catalog, prefs
  // ==========================================================================

  @Get("insight-catalog")
  @ApiOperation({
    summary: "Insight candidate-type catalog summary",
    description:
      "Total candidate types (dimension × measure × comparator) and per-category counts. Each type multiplies by live entities at runtime.",
  })
  getInsightCatalog() {
    return this.insightGenerator.getCatalogSummary();
  }

  @Get("insight-catalog/types")
  @ApiOperation({
    summary: "Full enumerated insight catalog (Browse All 375 Types)",
    description:
      "Every dimension × measure × comparator candidate type with category and data requirements. Pass restaurantId to also receive which requirements this restaurant satisfies (computable vs blocked).",
  })
  @ApiQuery({ name: "restaurantId", required: false })
  async getInsightCatalogTypes(@Query("restaurantId") restaurantId?: string) {
    const catalog = this.insightGenerator.getCatalogTypes();
    if (!restaurantId) return { ...catalog, available: null };
    try {
      const available = await this.insightGenerator.getAvailability(restaurantId);
      return { ...catalog, available };
    } catch {
      return { ...catalog, available: null };
    }
  }

  @Get("insights/:restaurantId")
  @ApiOperation({
    summary: "Plain-language insight feed",
    description:
      "Stored top insights (instant). Pass refresh=true to recompute now; categories=a,b to filter.",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiQuery({ name: "refresh", required: false })
  @ApiQuery({ name: "categories", required: false })
  @ApiQuery({ name: "limit", required: false })
  async getInsights(
    @Param("restaurantId") restaurantId: string,
    @Query("refresh") refresh?: string,
    @Query("categories") categoriesStr?: string,
    @Query("limit") limitStr?: string,
  ) {
    try {
      const categories = categoriesStr
        ? (categoriesStr.split(",").map((c) => c.trim()) as any)
        : undefined;
      if (refresh === "true") {
        return await this.insightGenerator.generate(restaurantId, {
          categories,
          persist: true,
        });
      }
      const stored = await this.insightGenerator.getStored(restaurantId, {
        categories,
        limit: limitStr ? parseInt(limitStr, 10) : undefined,
      });
      if (stored.length > 0) return { source: "stored", insights: stored };
      // cold start: compute live once and persist
      return await this.insightGenerator.generate(restaurantId, {
        categories,
        persist: true,
      });
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch insights",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("insight-prefs/:restaurantId")
  @ApiOperation({ summary: "Per-category insight refresh preferences" })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  async getInsightPrefs(@Param("restaurantId") restaurantId: string) {
    return this.scheduler.getPrefs(restaurantId);
  }

  @Put("insight-prefs/:restaurantId/:category")
  @ApiOperation({
    summary: "Set refresh cadence for an insight category",
    description:
      "Body: { cadence: hourly|daily|weekly|manual, hourOfDay?, enabled? }",
  })
  async setInsightPref(
    @Param("restaurantId") restaurantId: string,
    @Param("category") category: string,
    @Body() body: { cadence?: string; hourOfDay?: number; enabled?: boolean },
  ) {
    try {
      return await this.scheduler.setPref(restaurantId, category, body || {});
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to set preference",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ==========================================================================
  // Tables / floor geometry / staff / basket
  // ==========================================================================

  @Get("tables/:restaurantId")
  @ApiOperation({ summary: "List floor tables (geometry facts)" })
  async listTables(@Param("restaurantId") restaurantId: string) {
    return this.tableAnalytics.listTables(restaurantId);
  }

  @Post("tables/:restaurantId")
  @ApiOperation({
    summary: "Create/update a floor table",
    description:
      "Body: { label, seats, zone?, is_outdoor?, distance_to_kitchen_m?, distance_to_bar_m?, distance_to_pool_m?, x_pos?, y_pos? }. Upserts on (restaurant, label).",
  })
  async upsertTable(
    @Param("restaurantId") restaurantId: string,
    @Body() body: any,
  ) {
    try {
      return await this.tableAnalytics.upsertTable(restaurantId, body || {});
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to upsert table",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get("venue/:restaurantId")
  @ApiOperation({
    summary: "Venue feature profile (pool, outside bar, outdoor...)",
  })
  async getVenue(@Param("restaurantId") restaurantId: string) {
    return this.tableAnalytics.getVenueProfile(restaurantId);
  }

  @Put("venue/:restaurantId")
  @ApiOperation({
    summary: "Set venue feature profile",
    description:
      "Body: { features: { has_pool: true, has_outside_bar: false, ... } }",
  })
  async setVenue(
    @Param("restaurantId") restaurantId: string,
    @Body() body: { features?: Record<string, unknown> },
  ) {
    try {
      return await this.tableAnalytics.setVenueProfile(
        restaurantId,
        body?.features ?? {},
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to set venue profile",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get("table-performance/:restaurantId")
  @ApiOperation({
    summary:
      "Per-table metrics + geometry correlations + learned driver weights",
    description:
      "Avg check, revenue/seat, wine attach, tip% per table; Pearson + seats-controlled partial correlations vs kitchen/bar/pool distance; ridge-learned attribute weights.",
  })
  @ApiQuery({ name: "sinceDays", required: false })
  async getTablePerformance(
    @Param("restaurantId") restaurantId: string,
    @Query("sinceDays") sinceDaysStr?: string,
  ) {
    return this.tableAnalytics.getTablePerformance(
      restaurantId,
      sinceDaysStr ? parseInt(sinceDaysStr, 10) : undefined,
    );
  }

  @Get("waiters/:restaurantId")
  @ApiOperation({
    summary: "Waiter performance — raw and table-adjusted",
    description:
      "Per-server revenue, avg check, wine attach, tip%; peer ranks; ridge fixed-effects 'adjusted plus-minus' controlling for table assignments.",
  })
  @ApiQuery({ name: "sinceDays", required: false })
  async getWaiters(
    @Param("restaurantId") restaurantId: string,
    @Query("sinceDays") sinceDaysStr?: string,
  ) {
    return this.tableAnalytics.getWaiterPerformance(
      restaurantId,
      sinceDaysStr ? parseInt(sinceDaysStr, 10) : undefined,
    );
  }

  @Get("basket/:restaurantId")
  @ApiOperation({
    summary: "Item-pair affinity (market basket)",
    description:
      "Support/confidence/lift/χ² for item pairs on the same check — wine-wine now, food-wine when POS items land.",
  })
  async getBasket(@Param("restaurantId") restaurantId: string) {
    return this.tableAnalytics.getBasketAffinity(restaurantId);
  }

  @Get("hot-tables/:restaurantId")
  @ApiOperation({
    summary: "Live table surge watchlist",
    description:
      "Open checks whose $/min pace is ≥2σ (robust) above that table's history — tables to focus on right now.",
  })
  async getHotTables(@Param("restaurantId") restaurantId: string) {
    return this.tableAnalytics.getHotTables(restaurantId);
  }

  // ==========================================================================
  // Goals — metric-linked, AI-assisted
  // ==========================================================================

  @Get("goals/:restaurantId")
  @ApiOperation({
    summary: "List goals (status=active|all|achieved|missed|archived)",
  })
  @ApiQuery({ name: "status", required: false })
  async listGoals(
    @Param("restaurantId") restaurantId: string,
    @Query("status") status?: string,
  ) {
    return this.goalsService.listGoals(restaurantId, status || "active");
  }

  @Post("goals/:restaurantId")
  @ApiOperation({
    summary: "Create a metric-linked goal",
    description:
      "Body: { name, metricKey (wine_revenue|bottles_sold|purchase_spend|checks|avg_check|wine_attach_rate), targetValue, deadline?, period?, direction? }",
  })
  async createGoal(
    @Param("restaurantId") restaurantId: string,
    @Body() body: any,
  ) {
    try {
      return await this.goalsService.createGoal(restaurantId, body || {});
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to create goal",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get("goals/:restaurantId/:goalId/progress")
  @ApiOperation({
    summary: "Goal progress with AI assistance",
    description:
      "Current value, pace vs linear schedule, Holt projection to deadline, and suggested actions pulled from the insight feed.",
  })
  async getGoalProgress(
    @Param("restaurantId") restaurantId: string,
    @Param("goalId") goalId: string,
  ) {
    try {
      return await this.goalsService.getGoalProgress(restaurantId, goalId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to compute goal progress",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put("goals/:restaurantId/:goalId/status")
  @ApiOperation({
    summary: "Update goal status (active|achieved|missed|archived)",
  })
  async updateGoalStatus(
    @Param("restaurantId") restaurantId: string,
    @Param("goalId") goalId: string,
    @Body() body: { status?: string },
  ) {
    try {
      return await this.goalsService.updateGoalStatus(
        restaurantId,
        goalId,
        body?.status || "",
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to update goal",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ==========================================================================
  // Consultant agents (toggle-gated LLM layer, default OFF)
  // ==========================================================================

  @Get("consultants/:restaurantId")
  @ApiOperation({ summary: "Consultant toggle state + available personas" })
  async getConsultants(@Param("restaurantId") restaurantId: string) {
    return {
      enabled: await this.consultantsService.isEnabled(restaurantId),
      personas: Object.keys(ConsultantsService.PERSONAS),
    };
  }

  @Put("consultants/:restaurantId/toggle")
  @ApiOperation({
    summary: "Enable/disable consultant agents",
    description: "Body: { enabled: boolean }. Default is disabled.",
  })
  async toggleConsultants(
    @Param("restaurantId") restaurantId: string,
    @Body() body: { enabled?: boolean },
  ) {
    return this.consultantsService.setEnabled(
      restaurantId,
      body?.enabled === true,
    );
  }

  @Post("consult/:restaurantId")
  @ApiOperation({
    summary: "Run a consultant persona over the analytics evidence pack",
    description:
      "Body: { persona: finance|economics|statistics|physics }. Returns weighted claims + simple resolutions, every claim citing evidence paths. Gated by the toggle (default off).",
  })
  async consult(
    @Param("restaurantId") restaurantId: string,
    @Body() body: { persona?: string },
  ) {
    try {
      return await this.consultantsService.consult(
        restaurantId,
        body?.persona || "finance",
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Consultant run failed",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // Advanced lenses + combination endpoints
  // ==========================================================================

  @Get("menu-engineering/:restaurantId")
  @ApiOperation({
    summary: "Menu engineering quadrants",
    description:
      "Stars / Plowhorses / Puzzles / Dogs from margin (unit_price − WAC) × velocity, with a concrete action per quadrant.",
  })
  async getMenuEngineering(@Param("restaurantId") restaurantId: string) {
    return this.advanced.getMenuEngineering(restaurantId);
  }

  @Get("vendor-scorecard/:restaurantId")
  @ApiOperation({
    summary: "Vendor scorecard",
    description:
      "Per-vendor lead-time distribution (mean/median/p90/σ), on-time rate, unit-price trend, spend share + HHI.",
  })
  async getVendorScorecard(@Param("restaurantId") restaurantId: string) {
    return this.advanced.getVendorScorecard(restaurantId);
  }

  @Get("seasonality/:restaurantId")
  @ApiOperation({
    summary: "Seasonality profile",
    description:
      "Weekday demand profile, weekly seasonal factors (classical decomposition), 28-day trend, per-category best/worst days.",
  })
  async getSeasonality(@Param("restaurantId") restaurantId: string) {
    return this.advanced.getSeasonality(restaurantId);
  }

  @Get("cashflow/:restaurantId")
  @ApiOperation({
    summary: "Cashflow & spend pacing",
    description:
      "30-day purchasing spend vs prior, Holt 4-week projection, committed open-order exposure.",
  })
  async getCashflow(@Param("restaurantId") restaurantId: string) {
    return this.advanced.getCashflow(restaurantId);
  }

  @Get("wine/:restaurantId/:masterWineId")
  @ApiOperation({
    summary: "Wine-360 (combination)",
    description:
      "One wine, every lens: demand profile, days of cover, stockout probability, reorder point, forecast, rank, margin.",
  })
  async getWine360(
    @Param("restaurantId") restaurantId: string,
    @Param("masterWineId") masterWineId: string,
  ) {
    return this.advanced.getWine360(restaurantId, masterWineId);
  }

  @Get("overview/:restaurantId")
  @ApiOperation({
    summary: "Full overview (combination of all endpoints)",
    description:
      "Financial + risk + inventory + menu engineering + seasonality + cashflow + insights + goals in one parallel call (API-bus pattern).",
  })
  async getOverview(@Param("restaurantId") restaurantId: string) {
    return this.advanced.getOverview(restaurantId);
  }

  @Get("recommendations/:restaurantId")
  @ApiOperation({
    summary: "Actionable recommendations (active feed)",
    description:
      "Deterministic rule engine translating computed numbers into actions — each item carries the observation, the action, the rationale, the rule key, an urgency, and the manager's stored disposition (pinned/acted/feedback). Dismissed/snoozed/done cards are filtered out unless includeHidden=true.",
  })
  @ApiQuery({ name: "includeHidden", required: false })
  async getRecommendations(
    @Param("restaurantId") restaurantId: string,
    @Query("includeHidden") includeHidden?: string,
  ) {
    try {
      return await this.recommendationsService.getRecommendations(restaurantId, {
        includeHidden: includeHidden === "true",
      });
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to compute recommendations",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("recommendations/:restaurantId/action")
  @ApiOperation({
    summary: "Set a recommendation's disposition (NEW-284…NEW-298)",
    description:
      "Body: { ruleKey, status?, reason?, snoozeUntil?, pinned?, acted?, feedback?, snapshot? }. Upserts the manager's action on a card so it survives recompute. Reused by the Reports insight panel with ruleKey 'insight:<candidate_key>'.",
  })
  async setRecommendationAction(
    @Param("restaurantId") restaurantId: string,
    @Body()
    body: {
      ruleKey?: string;
      status?: RecommendationStatus;
      reason?: string | null;
      snoozeUntil?: string | null;
      pinned?: boolean;
      acted?: boolean;
      feedback?: "helpful" | "not_helpful" | null;
      assignedTo?: string | null;
      assignedName?: string | null;
      snapshot?: {
        observation?: string;
        recommendation?: string;
        category?: string;
        urgency?: string;
      };
      createdBy?: string;
    },
  ) {
    try {
      if (!body?.ruleKey) throw new Error("ruleKey is required");
      return await this.recommendationActions.setAction(
        restaurantId,
        body.ruleKey,
        {
          status: body.status,
          reason: body.reason,
          snoozeUntil: body.snoozeUntil,
          pinned: body.pinned,
          acted: body.acted,
          feedback: body.feedback,
          assignedTo: body.assignedTo,
          assignedName: body.assignedName,
        },
        body.snapshot,
        body.createdBy,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to set recommendation action",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post("recommendations/:restaurantId/bulk-action")
  @ApiOperation({
    summary: "Bulk-set disposition on many cards (NEW-293)",
    description:
      "Body: { items: [{ ruleKey, snapshot? }], status?, reason?, snoozeUntil?, pinned? }.",
  })
  async bulkRecommendationAction(
    @Param("restaurantId") restaurantId: string,
    @Body()
    body: {
      items?: Array<{
        ruleKey: string;
        snapshot?: {
          observation?: string;
          recommendation?: string;
          category?: string;
          urgency?: string;
        };
      }>;
      status?: RecommendationStatus;
      reason?: string | null;
      snoozeUntil?: string | null;
      pinned?: boolean;
      createdBy?: string;
    },
  ) {
    try {
      const items = Array.isArray(body?.items) ? body.items : [];
      if (items.length === 0) throw new Error("items[] is required");
      const updated = await this.recommendationActions.bulkSetAction(
        restaurantId,
        items,
        {
          status: body.status,
          reason: body.reason,
          snoozeUntil: body.snoozeUntil,
          pinned: body.pinned,
        },
        body.createdBy,
      );
      return { updated };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to bulk-set recommendation actions",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get("recommendations/:restaurantId/actions")
  @ApiOperation({
    summary: "Cards in a given disposition (snoozed/dismissed/done tabs)",
  })
  @ApiQuery({ name: "status", required: false, example: "dismissed" })
  async listRecommendationActions(
    @Param("restaurantId") restaurantId: string,
    @Query("status") status?: string,
  ) {
    try {
      const s = (status || "all") as RecommendationStatus | "all";
      return {
        items: await this.recommendationActions.listByStatus(restaurantId, s),
      };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to list recommendation actions",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("recommendations/:restaurantId/history")
  @ApiOperation({ summary: "Acted/dismissed/completed history (NEW-302)" })
  async recommendationHistory(@Param("restaurantId") restaurantId: string) {
    try {
      return { items: await this.recommendationActions.listHistory(restaurantId) };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to load recommendation history",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("recommendations/:restaurantId/digest")
  @ApiOperation({ summary: "Daily recommendation digest preferences (NEW-303)" })
  async getRecommendationDigest(@Param("restaurantId") restaurantId: string) {
    return this.recommendationActions.getDigestPref(restaurantId);
  }

  @Put("recommendations/:restaurantId/digest")
  @ApiOperation({
    summary: "Set daily recommendation digest preferences (NEW-303)",
    description:
      "Body: { digestEnabled?, digestHour?, digestMinUrgency?, recipientEmail? }. Persists the manager's toggle; the scheduled send is feature-flagged in the analytics scheduler.",
  })
  async setRecommendationDigest(
    @Param("restaurantId") restaurantId: string,
    @Body()
    body: {
      digestEnabled?: boolean;
      digestHour?: number;
      digestMinUrgency?: string;
      recipientEmail?: string | null;
    },
  ) {
    try {
      return await this.recommendationActions.setDigestPref(restaurantId, body || {});
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to set digest preferences",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ==========================================================================
  // HEALTH
  // ==========================================================================

  @Get("health")
  @ApiOperation({ summary: "Analytics service health check" })
  healthCheck() {
    return {
      status: "healthy",
      service: "analytics",
      timestamp: new Date().toISOString(),
    };
  }
}
