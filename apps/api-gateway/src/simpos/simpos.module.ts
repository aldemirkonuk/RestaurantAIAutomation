import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SimposController } from "./simpos.controller";
import { SimposService } from "./simpos.service";
import { ScenarioVerifyService } from "./scenario-verify.service";

/**
 * SimPOS module — the fake POS terminal's backend (SimPOS testbed plan,
 * decisions C23-C31). Intentionally has no dependency on PosHubModule; the
 * two only ever talk over the signed webhook (decision C25).
 *
 * ADR 0093 adds the scenario harness, and with it the first inbound
 * dependencies this module has ever had:
 *
 *   AnalyticsModule     GoalsService (the method `GET analytics/pos-revenue`
 *                       calls), TableAnalyticsService, InsightGeneratorService
 *   NotificationsModule LowStockAlertsService
 *
 * That does NOT weaken C25. C25 is about how SimPOS WRITES into Mudavym —
 * only over the signed webhook, and that is still the only write path. The
 * verifier is a READER: it exists to compare what the product did against
 * what the scenario expected, and a verifier that could not read the product
 * would be verifying nothing. No cycle: neither analytics nor notifications
 * imports this module, so no `forwardRef` is needed here — and
 * `scripts/check_gateway_boots.sh` proves that against the real injector
 * rather than trusting this comment.
 */
@Module({
  // AuthModule supplies TokenBlacklistService, which JwtAuthGuard injects. The
  // guard resolves in THIS module's context, so without this import the whole
  // app fails to boot — not just these routes. AuthModule is not @Global().
  // This is the exact defect that crash-looped production on 2026-08-24
  // (PosHubModule, AnalyticsModule); scripts/check_gateway_boots.sh now catches
  // it in CI, and does for this module too.
  imports: [AuthModule, DatabaseModule, AnalyticsModule, NotificationsModule],
  controllers: [SimposController],
  providers: [SimposService, ScenarioVerifyService],
  exports: [SimposService, ScenarioVerifyService],
})
export class SimposModule {}
