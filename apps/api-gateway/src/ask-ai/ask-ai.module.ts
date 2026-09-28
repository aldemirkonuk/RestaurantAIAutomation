import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { ProcurementModule } from "../procurement/procurement.module";
import { AskAiController } from "./ask-ai.controller";
import { AskAiService } from "./ask-ai.service";
import { ReadingsModule } from "../ask-readings/readings.module";
import { BoundAskController } from "./bound-ask.controller";
import { BoundAskService } from "./bound-ask.service";
import { SettingsModule } from "../settings/settings.module";

/**
 * AuthModule is required, not optional: AskAiController is guarded by
 * JwtAuthGuard, and a guard resolves in the context of the module declaring the
 * controller. Omitting it aborts application startup — the failure LogsModule
 * and one-tap-actions both hit earlier in this milestone, and the one
 * `scripts/check_gateway_boots.sh` exists to catch.
 *
 * ProcurementModule supplies the executors. Ask AI depends on procurement and
 * procurement knows nothing about Ask AI, which keeps the dependency acyclic —
 * Nest fails circular forwardRefs by injecting undefined at runtime rather than
 * erroring at build time.
 *
 * SettingsModule is imported for `SettingsService.isFeatureEnabled` (ADR 0145,
 * 2026-09-22, round 6z — "/ask waits for new Settings (Recommended)"):
 * `BoundAskService.submit` refuses per house until `mudavym_design_settings`
 * is on for that house. No cycle: `SettingsModule`'s own imports
 * (`OrganizationsModule`, `AuthModule`, `DatabaseModule`,
 * `SettingsAuditModule`, `VendorTermsModule`) do not reach back to
 * `AskAiModule`, `ProcurementModule` or `ReadingsModule`.
 *
 * ModelClientModule is @Global, so ModelClientService and NfVerdictService need
 * no import line.
 */
@Module({
  imports: [DatabaseModule, ConfigModule, AuthModule, ProcurementModule, ReadingsModule, SettingsModule],
  controllers: [AskAiController, BoundAskController],
  providers: [AskAiService, BoundAskService],
  exports: [AskAiService],
})
export class AskAiModule {}
