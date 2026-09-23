import { Module } from "@nestjs/common";
import {
  MenuVersionsController,
  MenusController,
  OnboardingController,
} from "./menus.controller";
import { MenusService } from "./menus.service";
import { CsvParserService } from "./parsers/csv-parser.service";
import { ScanParserService } from "./parsers/scan-parser.service";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { WinesModule } from "../wines/wines.module";
import { OrchestratorModule } from "../common/orchestrator/orchestrator.module";
import { ArrivalController } from "../arrival/arrival.controller";
import { ArrivalService } from "../arrival/arrival.service";
import { SettingsModule } from "../settings/settings.module";
import { CellarModule } from "../cellar/cellar.module";
import { VendorTermsModule } from "../vendor-terms/vendor-terms.module";
import { ProvidersModule } from "../providers/providers.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { OrganizationsModule } from "../organizations/organizations.module";
// The seal on an arrival batch's apply (ADR 0113, codex-audit/C2-adopt.md #2).
// Not circular: SealModule imports only DatabaseModule.
import { SealModule } from "../common/seal/seal.module";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    WinesModule,
    OrchestratorModule,
    SettingsModule,
    CellarModule,
    VendorTermsModule,
    ProvidersModule,
    NotificationsModule,
    OrganizationsModule,
    SealModule,
  ],
  controllers: [MenusController, MenuVersionsController, OnboardingController, ArrivalController],
  providers: [
    MenusService,
    CsvParserService,
    ScanParserService,
    ArrivalService,
  ],
  exports: [MenusService],
})
export class MenusModule {}
