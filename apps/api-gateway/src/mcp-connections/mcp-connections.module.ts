import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { McpRuntimeModule } from "../mcp-runtime/mcp-runtime.module";
import { McpConnectionsController } from "./mcp-connections.controller";
import { McpConnectionsService } from "./mcp-connections.service";

/**
 * Model-context (MCP) servers as a first-class register on `/profile`.
 *
 * Built 2026-09-03 to close gap G4 in `.planning/06-pages/profile.md` §9, which
 * read "nothing exists" — no table, no module, no route. The page's rail was
 * honest about that and the founder asked for the thing instead of the dash.
 *
 * Extended the same day to close G9 ("nothing calls a model-context server").
 * `McpRuntimeModule` is imported HERE rather than registered in `AppModule`:
 * this is the runtime's only consumer, and a wire client registered globally
 * for one caller is how a capability becomes ambient before anyone decides it
 * should be. Nothing changes in `app.module.ts` as a result — the entry it
 * already has for this module now pulls the runtime in with it.
 */
@Module({
  imports: [DatabaseModule, AuthModule, McpRuntimeModule],
  controllers: [McpConnectionsController],
  providers: [McpConnectionsService],
  exports: [McpConnectionsService],
})
export class McpConnectionsModule {}
