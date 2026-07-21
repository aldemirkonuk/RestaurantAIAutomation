import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
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

/**
 * Analytics Module — the quantitative core of WineOps.
 *
 * Wraps the pure analytics engine (`./engine`) with a data-fetching service
 * and REST surface. The engine has zero framework/DB dependencies and is
 * exhaustively unit-tested (`engine/*.spec.ts`); this module wires it to live
 * Supabase data and exposes it for the dashboard and AI layers.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    AdvancedAnalyticsService,
    RecommendationsService,
    RecommendationActionsService,
    TableAnalyticsService,
    GoalsService,
    ConsultantsService,
    InsightGeneratorService,
    InsightSchedulerService,
  ],
  exports: [AnalyticsService, InsightGeneratorService, GoalsService],
})
export class AnalyticsModule {}
