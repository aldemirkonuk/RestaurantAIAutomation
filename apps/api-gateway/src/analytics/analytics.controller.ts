import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
  UseGuards,
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
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { InsightSchedulerService } from "./insights/insight-scheduler.service";
import {
  annotatedCandidates,
  catalogCoverage,
} from "./insights/insight-implementations";
import { DataRequirement } from "./insights/insight-catalog";
import { DayExclusionsService } from "./insights/day-exclusions.service";
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
/**
 * `horizon` reaches `new Array(horizon)` in the smoothers, so an unbounded
 * value is a resource-exhaustion vector, not just a silly input — CodeQL
 * flagged it as js/resource-exhaustion at forecasting.ts:49.
 *
 * Two failure modes, both closed here rather than in the engine, because the
 * boundary is where untrusted input should stop:
 *  - `?horizon=999999999` allocated a billion-element array.
 *  - `?horizon=abc` produced NaN. The previous `parseInt(...) ?? 14` did NOT
 *    catch that: `??` tests for null/undefined, and NaN is neither, so the NaN
 *    flowed through and `new Array(NaN)` yields an empty forecast reported as
 *    a successful one.
 *
 * Anything unparseable or out of range returns undefined so the service applies
 * its own default, rather than this silently substituting a number the caller
 * did not ask for.
 */
const MAX_FORECAST_HORIZON = 365;

function parseHorizon(raw?: string): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > MAX_FORECAST_HORIZON) return undefined;
  return n;
}

@ApiTags("analytics")
@Controller("analytics")
// Every route here is tenant-scoped and several cost money: POST /consult/:id
// reaches ConsultantsService -> api.anthropic.com. Without this guard the class
// was unauthenticated by omission (no @UseGuards, no @Public), so an anonymous
// caller could flip PUT /consultants/:id/toggle on and drive the paid model.
@UseGuards(JwtAuthGuard)
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
    private readonly dayExclusions: DayExclusionsService,
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
        horizon: parseHorizon(horizonStr),
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
    summary: "Full enumerated insight catalog (Browse All Types)",
    description:
      "Every dimension × measure × comparator candidate type with category, data requirements, and whether a generator implements it today. Pass restaurantId to also receive which requirements this restaurant satisfies. `coverage` is the honest split: computable now = implemented AND data available; the rest are blocked on data or not built yet (ADR 0020 — the catalogue is a roadmap, not a capability claim).",
  })
  @ApiQuery({ name: "restaurantId", required: false })
  async getInsightCatalogTypes(@Query("restaurantId") restaurantId?: string) {
    const catalog = this.insightGenerator.getCatalogTypes();
    // `implemented` per type + the coverage split are the only honest basis for
    // a "computable now" figure; data availability alone counted the roadmap.
    const candidates = annotatedCandidates();
    const unknown = {
      ...catalog,
      candidates,
      available: null,
      coverage: catalogCoverage(null),
    };
    if (!restaurantId) return unknown;
    try {
      const available =
        await this.insightGenerator.getAvailability(restaurantId);
      return {
        ...catalog,
        candidates,
        available,
        coverage: catalogCoverage(new Set<DataRequirement>(available)),
      };
    } catch {
      // Availability unknown — say so with nulls rather than guessing a count.
      return unknown;
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
      "Body: { name, metricKey (wine_revenue|bottles_sold|purchase_spend|checks|avg_check|wine_attach_rate), targetValue, deadline?, period?, direction?, sourceRuleKey? }. " +
      "`sourceRuleKey` records which recommendation the goal came from; it is validated against the rule catalogue and an unknown key is a 400, never a stored string nothing resolves. Absent means a person typed it.",
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

  @Get("goals/:restaurantId/progress")
  @ApiOperation({
    summary: "Progress for every goal of one status, in one call",
    description:
      "listGoals alone cannot drive a progress bar: `current_value` is a stored column refreshed only when one goal's progress is opened, so a bar drawn off the list reads 0% for a goal that is half done. This recomputes each one. Capped at 6 goals and it reports the cap rather than applying it silently.",
  })
  @ApiQuery({ name: "status", required: false })
  async listGoalsWithProgress(
    @Param("restaurantId") restaurantId: string,
    @Query("status") status?: string,
  ) {
    try {
      return await this.goalsService.listGoalsWithProgress(
        restaurantId,
        status || "active",
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to compute goal progress",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch("goals/:restaurantId/:goalId")
  @ApiOperation({
    summary: "Edit a goal (name, targetValue, deadline, direction, period)",
    description:
      "metricKey is deliberately not editable: baseline_value was measured against the old metric and every progress figure is computed against that baseline. Archive and set a new goal instead.",
  })
  async updateGoal(
    @Param("restaurantId") restaurantId: string,
    @Param("goalId") goalId: string,
    @Body() body: any,
  ) {
    try {
      return await this.goalsService.updateGoal(restaurantId, goalId, body || {});
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to update goal",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post("goals/:restaurantId/:goalId/cutting-spec")
  @ApiOperation({
    summary: "Ask the assistant which catalogued analysis shows this goal",
    description:
      "The model CONFIGURES the deterministic engine — it returns an analysis id, a drawing and a window, every one of them validated against a closed catalogue server-side (report-cuttings.ts). It never writes a figure, a sentence on a chart, or a new analysis. Without ANTHROPIC_API_KEY the route answers `available:false` with the reason and proposes nothing.",
  })
  async proposeGoalCuttingSpec(
    @Param("restaurantId") restaurantId: string,
    @Param("goalId") goalId: string,
  ) {
    try {
      return await this.goalsService.proposeCuttingSpec(restaurantId, goalId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to propose a cutting",
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

  // ==========================================================================
  // POS-backed sales revenue (OD-85)
  // ==========================================================================

  @Get("pos-revenue/:restaurantId")
  @ApiOperation({
    summary: "Sales revenue booked through the POS, over a day range",
    description:
      "Sum of non-voided `pos_checks.total` plus the per-wine bottle/glass breakdown for the same window. " +
      "`posConnected: false` means this restaurant has never had a POS check land — `revenue` and `checkCount` " +
      "are then `null`, NOT `0`, and every consumer must render an empty state rather than a figure. " +
      "Reuses the same query goal progress runs on, so the two can never disagree.",
  })
  @ApiQuery({
    name: "days",
    required: false,
    description: "Window length in days (1–365, default 30).",
  })
  @ApiResponse({ status: 200, description: "POS revenue window" })
  async getPosRevenue(
    @Param("restaurantId") restaurantId: string,
    @Query("days") days?: string,
  ) {
    const parsed = Number.parseInt(days ?? "", 10);
    const span = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1), 365)
      : 30;
    try {
      const window = await this.goalsService.getPosRevenueWindow(
        restaurantId,
        span,
      );
      // Skipped entirely when no POS is wired: there is nothing to break down,
      // and issuing the query anyway would only make "no POS" cost two round
      // trips to discover.
      const consumption = window.posConnected
        ? await this.analyticsService.getPosConsumptionBreakdown(
            restaurantId,
            window.from,
            window.to,
          )
        : [];
      return { ...window, consumption };
    } catch (error) {
      // Deliberately a 500 rather than an empty payload: "we could not load
      // this" and "you have no POS" are different sentences, and the UI shows
      // different things for each.
      throw new HttpException(
        error.message || "Failed to load POS revenue",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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
      return await this.recommendationsService.getRecommendations(
        restaurantId,
        {
          includeHidden: includeHidden === "true",
        },
      );
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
      return {
        items: await this.recommendationActions.listHistory(restaurantId),
      };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to load recommendation history",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ---- Days the engine must not count (the exclusion store) ---------------
  //
  // The second half of "if the person says dismiss, it should be avoided at
  // all costs": a dismissal silences an ENTRY, an exclusion removes a DAY from
  // the arithmetic underneath every entry. A closure that dragged the Wednesday
  // average down is not answered by hiding the sentence — the average is still
  // wrong. Stored separately from `recommendation_actions` on purpose: one is
  // what a manager did with a card, the other is what the analysis may look at.

  @Get("exclusions/:restaurantId")
  @ApiOperation({
    summary: "Business dates excluded from the analytics baselines",
    description:
      "Closures, buyouts and outages the manager has ruled out. `readable:false` means the store could not be read AT ALL — which is not the same as an empty list, and the caller must not present its numbers as clean.",
  })
  async listDayExclusions(@Param("restaurantId") restaurantId: string) {
    return this.dayExclusions.list(restaurantId);
  }

  @Post("exclusions/:restaurantId")
  @ApiOperation({
    summary: "Exclude a business date from every baseline",
    description: "Body: { businessDate: 'YYYY-MM-DD', reason?, createdBy? }.",
  })
  async excludeDay(
    @Param("restaurantId") restaurantId: string,
    @Body()
    body: { businessDate?: string; reason?: string | null; createdBy?: string },
  ) {
    try {
      if (!body?.businessDate) throw new Error("businessDate is required");
      return await this.dayExclusions.exclude(
        restaurantId,
        body.businessDate,
        body.reason ?? null,
        body.createdBy ?? null,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to exclude the day",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete("exclusions/:restaurantId/:businessDate")
  @ApiOperation({ summary: "Put an excluded business date back in the analysis" })
  async includeDay(
    @Param("restaurantId") restaurantId: string,
    @Param("businessDate") businessDate: string,
  ) {
    try {
      await this.dayExclusions.include(restaurantId, businessDate);
      return { restored: businessDate };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to restore the day",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get("recommendations/:restaurantId/digest")
  @ApiOperation({
    summary: "Daily recommendation digest preferences (NEW-303)",
  })
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
      return await this.recommendationActions.setDigestPref(
        restaurantId,
        body || {},
      );
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
