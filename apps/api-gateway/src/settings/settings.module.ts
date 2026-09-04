import { Module } from "@nestjs/common";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";
import { ApprovalThresholdsService } from "./approval-thresholds.service";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { SettingsAuditModule } from "../settings-audit/settings-audit.module";
import { VendorTermsModule } from "../vendor-terms/vendor-terms.module";
import { OrganizationsModule } from "../organizations/organizations.module";

/**
 * Settings, and the two registers the fourth pass gave it.
 *
 * `SettingsAuditModule` and `VendorTermsModule` are imported HERE rather than
 * registered in `app.module.ts`, following `McpConnectionsModule`'s import of
 * `McpRuntimeModule` (`mcp-connections/mcp-connections.module.ts:23`). Nest
 * mounts the controllers of every module in the graph, so `/vendor-terms` and
 * `/settings-audit` come up under the entry `AppModule` already has for
 * settings (`app.module.ts:116`) and no shared file changes.
 *
 * `ApprovalThresholdsService` lives in THIS module rather than in one of its
 * own, because a threshold is a setting on the restaurant in the same sense a
 * feature flag is — `/settings/approval-thresholds` sits beside
 * `/settings/feature-flags`, under the same guards, in the same controller.
 *
 * `OrganizationsModule` is imported for `assertCanManageRestaurant`: only an
 * owner or a manager may write a threshold (ADR 0116, the founder's call). It
 * exports one service and imports only Database and Auth, so this adds no cycle
 * — and `ProcurementModule` now imports THIS module for
 * `ApprovalThresholdsService`, which is why nothing here may ever import
 * procurement back.
 */
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    SettingsAuditModule,
    VendorTermsModule,
    OrganizationsModule,
  ],
  controllers: [SettingsController],
  providers: [SettingsService, ApprovalThresholdsService],
  exports: [SettingsService, ApprovalThresholdsService],
})
export class SettingsModule {}
