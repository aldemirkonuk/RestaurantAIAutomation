import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { McpRuntimeService } from "./mcp-runtime.service";
import { McpSecretService } from "./mcp-secret.service";

/**
 * The half of the model-context register that talks to something.
 *
 * Split from `mcp-connections/` on purpose: that module owns rows, this one
 * owns the wire. The register can be read, written and revoked with this module
 * absent — which is exactly what it did between 2026-09-03's first and second
 * builds — and this module has no database dependency at all, so its specs can
 * drive a real HTTP server without a Supabase double anywhere near them.
 *
 * It is imported by `McpConnectionsModule`, not by `AppModule`. Nothing else in
 * the gateway speaks MCP, and a module registered globally for one consumer is
 * how a runtime becomes ambient before anyone decides it should be.
 */
@Module({
  imports: [ConfigModule],
  providers: [McpRuntimeService, McpSecretService],
  exports: [McpRuntimeService, McpSecretService],
})
export class McpRuntimeModule {}
