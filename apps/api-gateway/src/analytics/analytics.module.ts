import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { DevTruthController } from "./dev-truth.controller";
import { DevTruthService } from "./dev-truth.service";
import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { RecommendationsService } from "./recommendations.service";
import { RecommendationActionsService } from "./recommendation-actions.service";
import { RecommendationHistoryRetention } from "./recommendation-history-retention";
import { TableAnalyticsService } from "./table-analytics.service";
import { GoalsService } from "./goals.service";
import { GoalScenarioRequestsService } from "./goal-scenario-requests.service";
import { ConsultantsService } from "./consultants.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { InsightSchedulerService } from "./insights/insight-scheduler.service";
import { DayExclusionsService } from "./insights/day-exclusions.service";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
// ADR 0193: the live recommendations feed reads price advice toward the
// house's target margin. PricingModule imports nothing that imports this back.
import { PricingModule } from "../pricing/pricing.module";

/**
 * Analytics Module — the quantitative core of WineOps.
 *
 * Wraps the pure analytics engine (`./engine`) with a data-fetching service
 * and REST surface. The engine has zero framework/DB dependencies and is
 * exhaustively unit-tested (`engine/*.spec.ts`); this module wires it to live
 * Supabase data and exposes it for the dashboard and AI layers.
 */
@Module({
  // AuthModule supplies TokenBlacklistService, which JwtAuthGuard injects. The
  // guard resolves in *this* module's context, so without this import the whole
  // app fails to boot — not just this route. AuthModule is not @Global().
  imports: [DatabaseModule, AuthModule, PricingModule],
  // DevTruthController guards itself with a 404 in production rather than
  // being conditionally registered — a route that vanishes is indistinguishable
  // from one that never existed, which is the confusion these surfaces exist to
  // remove rather than add to.
  controllers: [AnalyticsController, DevTruthController],
  providers: [
    AnalyticsService,
    AdvancedAnalyticsService,
    RecommendationsService,
    RecommendationActionsService,
    TableAnalyticsService,
    GoalsService,
    // ADR 0120 Q4 — a house may REQUEST a scenario in words; it may not author
    // one. Deliberately a separate provider from GoalsService: nothing it
    // stores is read back into the catalogue, and keeping them apart is what
    // makes that seam visible in the wiring rather than only in the comments.
    GoalScenarioRequestsService,
    ConsultantsService,
    InsightGeneratorService,
    DevTruthService,
    InsightSchedulerService,
    // The engine's one hook for "do not count this day" — closures, buyouts,
    // outages the manager has ruled out of every baseline.
    DayExclusionsService,
    // ADR 0191 round 4: a name leaves the recommendation history after two
    // years (the act stays) — the daily sweep of migration 20260925120300.
    RecommendationHistoryRetention,
  ],
  // TableAnalyticsService joined the exports for ADR 0093: the scenario
  // verifier asks table performance whether it can see the day's tables, and
  // an unexported provider would have forced a second, drifting copy of that
  // aggregation inside SimposModule.
  //
  // AdvancedAnalyticsService joined them for OD-81: a report export reads the
  // cashflow, seasonality, menu-engineering and overview cuttings through the
  // same service the /reports page's endpoints call
  // (reports/exports/report-cutting-reader.service.ts), rather than a copy.
  //
  // RecommendationsService joined for ADR 0149 row 26: the digest sender quotes
  // the SAME feed the page reads, and a second copy of the rule engine inside
  // the digest module would be two engines that can disagree.
  exports: [
    AnalyticsService,
    AdvancedAnalyticsService,
    InsightGeneratorService,
    GoalsService,
    TableAnalyticsService,
    RecommendationsService,
  ],
})
export class AnalyticsModule {}
