import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../../auth/auth.module";
import { CommunicationsModule } from "../../communications/communications.module";
import { AnalyticsModule } from "../analytics.module";
import { RecommendationDigestController } from "./recommendation-digest.controller";
import { RecommendationDigestService } from "./recommendation-digest.service";

/**
 * The recommendations digest sender (ADR 0149 row 26).
 *
 * A module of its own rather than a provider inside AnalyticsModule, because it
 * needs `GmailService` and `ScheduledTenantsService` from CommunicationsModule,
 * and AnalyticsModule is imported BY NotificationsModule, McpServerModule and
 * SimposModule: adding a communications edge to it would widen every one of
 * those graphs. Nothing imports this module except AppModule, so it adds no
 * edge to any existing ring — `check_gateway_boots.sh` is what proves that.
 */
@Module({
  // AuthModule supplies TokenBlacklistService, which JwtAuthGuard injects in
  // this module's context.
  imports: [DatabaseModule, AuthModule, AnalyticsModule, CommunicationsModule],
  controllers: [RecommendationDigestController],
  providers: [RecommendationDigestService],
})
export class RecommendationDigestModule {}
