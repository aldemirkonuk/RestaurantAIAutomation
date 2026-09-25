import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { SettingsAuditModule } from "../settings-audit/settings-audit.module";
import { PricingController } from "./pricing.controller";
import { TargetMarginService } from "./target-margin.service";
import { MarginAdviceService } from "./margin-advice.service";
import { PriceLocksService } from "./price-locks.service";

/**
 * A house's own price, its target margin, and advice toward it (ADR 0193).
 *
 * Imported by `AnalyticsModule` only (the live recommendations feed reads
 * `MarginAdviceService` and `PriceLocksService`), which is also how this module's controller is
 * registered. `InventoryModule` and `MenusModule` do NOT import it: they write
 * prices through `setHouseMenuPrice`, a plain function in
 * `house-menu-price.ts`, and `InventoryModule` imports `OrganizationsModule`
 * itself for the owner/manager check. It imports nothing that imports it
 * back: Database, Auth, Organizations and SettingsAudit import only Database
 * and Auth.
 */
@Module({
  imports: [DatabaseModule, AuthModule, OrganizationsModule, SettingsAuditModule],
  controllers: [PricingController],
  providers: [TargetMarginService, MarginAdviceService, PriceLocksService],
  exports: [TargetMarginService, MarginAdviceService, PriceLocksService],
})
export class PricingModule {}
