import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { AuthModule } from "../auth/auth.module";
import { CellarModule } from "../cellar/cellar.module";
import { DistributorDiscoveryModule } from "../distributor-discovery/distributor-discovery.module";
import { InventoryModule } from "../inventory/inventory.module";
import { LogsModule } from "../logs/logs.module";
import { McpRuntimeModule } from "../mcp-runtime/mcp-runtime.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { ProcurementModule } from "../procurement/procurement.module";
import { VendorIntelModule } from "../vendor-intel/vendor-intel.module";
import { McpCredentialAuthGuard } from "./mcp-credential-auth.guard";
import { McpCredentialsService } from "./mcp-credentials.service";
import { McpKeysController } from "./mcp-keys.controller";
import { McpServerController } from "./mcp-server.controller";
import { McpServerService } from "./mcp-server.service";
import { McpToolReadersService } from "./mcp-tool-readers.service";

/**
 * The Mudavym MCP SERVER — the inbound half of model context.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LIVES IN THE GATEWAY AND NOT IN `packages/mcp-server/` (ADR 0132)
 * ---------------------------------------------------------------------------
 * §8 step 3 of the capability note proposed a third workspace beside `database`
 * and `ui`, reasoning from the gateway's Dockerfile. Reading that Dockerfile
 * settles it the other way: line 39 copies `apps/api-gateway/dist` and nothing
 * else, so a `packages/mcp-server/` would not be in the deployed image at all
 * without a Dockerfile change, a second build target and a second process to
 * operate. The tools' whole value is that they call the SAME service the page
 * calls — which means being inside the injector those services live in. A
 * separate package could only reach them over HTTP, which is a second query
 * path wearing a network hop.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IMPORTS SEVEN FEATURE MODULES
 * ---------------------------------------------------------------------------
 * One import per read, and each one is the module that already owns that read.
 * Nothing here queries Supabase for domain data; the only tables this module
 * touches are its own two (`mcp_server_credentials`, `mcp_server_call_log`),
 * through `McpCredentialsService`. If a service's answer changes, this server's
 * answer changes with it — which is the point.
 *
 * `McpRuntimeModule` is imported for exactly one thing: the protocol revision
 * the client half already pinned. Borrowing the constant is cheaper than a
 * second pin that can drift.
 */
@Module({
  imports: [
    // `McpKeysController` carries `@UseGuards(JwtAuthGuard)`, and a guard
    // resolves in the context of the module that declares its controller.
    // AuthModule is not `@Global()`, so omitting this import does not break one
    // route — it kills the whole boot, which is what `check_gateway_boots.sh`
    // caught here on the first run.
    AuthModule,
    McpRuntimeModule,
    OrganizationsModule,
    InventoryModule,
    ProcurementModule,
    DistributorDiscoveryModule,
    VendorIntelModule,
    AnalyticsModule,
    LogsModule,
    CellarModule,
  ],
  controllers: [McpServerController, McpKeysController],
  providers: [
    McpServerService,
    McpToolReadersService,
    McpCredentialsService,
    McpCredentialAuthGuard,
  ],
  exports: [McpCredentialsService],
})
export class McpServerModule {}
