import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { McpConnectionsController } from "./mcp-connections.controller";
import { McpConnectionsService } from "./mcp-connections.service";

/**
 * Model-context (MCP) servers as a first-class register on `/profile`.
 *
 * Built 2026-09-03 to close gap G4 in `.planning/06-pages/profile.md` §9, which
 * read "nothing exists" — no table, no module, no route. The page's rail was
 * honest about that and the founder asked for the thing instead of the dash.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [McpConnectionsController],
  providers: [McpConnectionsService],
  exports: [McpConnectionsService],
})
export class McpConnectionsModule {}
