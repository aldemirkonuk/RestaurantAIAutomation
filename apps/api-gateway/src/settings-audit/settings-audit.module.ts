import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { SettingsAuditController } from "./settings-audit.controller";
import { SettingsAuditService } from "./settings-audit.service";

/**
 * The settings trail — one writer shape, one reader, no editor.
 *
 * NOT registered in `app.module.ts`. `SettingsModule` imports it, the way
 * `McpConnectionsModule` imports `McpRuntimeModule`
 * (`mcp-connections/mcp-connections.module.ts:23`), so the controller is
 * mounted by the entry `AppModule` already has for settings and no shared file
 * changes. `SettingsModule` is also its only consumer today; a global
 * registration would make an audit writer ambient for callers nobody has
 * reviewed, which is how a log starts collecting rows nobody can interpret.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [SettingsAuditController],
  providers: [SettingsAuditService],
  exports: [SettingsAuditService],
})
export class SettingsAuditModule {}
