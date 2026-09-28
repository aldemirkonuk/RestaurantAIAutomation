import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { SettingsAuditModule } from "../settings-audit/settings-audit.module";
import { VendorTermsController } from "./vendor-terms.controller";
import { VendorTermsService } from "./vendor-terms.service";

/**
 * Vendor terms as a register of the house's own knowledge.
 *
 * NOT registered in `app.module.ts` — `SettingsModule` imports it, following
 * `McpConnectionsModule`'s import of `McpRuntimeModule`
 * (`mcp-connections/mcp-connections.module.ts:23`). The controller mounts under
 * the entry `AppModule` already has for settings, and no shared file changes.
 *
 * `SettingsAuditModule` is imported rather than injected loose, because every
 * write here has to file who made it and a module that could be constructed
 * without the auditor would allow an unaudited path to exist by accident.
 */
@Module({
  imports: [DatabaseModule, AuthModule, SettingsAuditModule],
  controllers: [VendorTermsController],
  providers: [VendorTermsService],
  exports: [VendorTermsService],
})
export class VendorTermsModule {}
