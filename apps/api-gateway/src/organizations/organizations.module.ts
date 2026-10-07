import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { SettingsAuditModule } from "../settings-audit/settings-audit.module";
import { OrganizationsController } from "./organizations.controller";
import { OrganizationsService } from "./organizations.service";

/**
 * `SettingsAuditModule` is imported for ADR 0289: a house's state or country
 * change is filed in the settings log by `updateLocation`. No cycle:
 * `SettingsAuditModule` imports only Database and Auth, and nothing in its
 * graph imports this module.
 */
@Module({
  imports: [DatabaseModule, AuthModule, SettingsAuditModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
