import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { DevTruthController } from "./dev-truth.controller";
import { DevTruthService } from "./dev-truth.service";
import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { RecommendationsService } from "./recommendations.service";
import { RecommendationActionsService } from "./recommendation-actions.service";
import { TableAnalyticsService } from "./table-analytics.service";
import { GoalsService } from "./goals.service";
import { ConsultantsService } from "./consultants.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { InsightSchedulerService } from "./insights/insight-scheduler.service";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";

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
  imports: [DatabaseModule, AuthModule],
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
    ConsultantsService,
    InsightGeneratorService,
    DevTruthService,
    InsightSchedulerService,
  ],
  exports: [AnalyticsService, InsightGeneratorService, GoalsService],
})
export class AnalyticsModule {}
