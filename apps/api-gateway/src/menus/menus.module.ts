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
import { OrganizationsModule } from "../organizations/organizations.module";

@Module({
  imports: [DatabaseModule, AuthModule, WinesModule, OrchestratorModule, OrganizationsModule],
  controllers: [MenusController, MenuVersionsController, OnboardingController],
  providers: [MenusService, CsvParserService, ScanParserService],
  exports: [MenusService],
})
export class MenusModule {}
