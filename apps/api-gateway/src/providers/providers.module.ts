import { Module } from "@nestjs/common";
import { ProvidersController } from "./providers.controller";
import { ProvidersService } from "./providers.service";
import { ProviderIntelligenceController } from "./provider-intelligence.controller";
import { ProviderIntelligenceService } from "./provider-intelligence.service";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { EventsModule } from "../events/events.module";
import { ProcurementModule } from "../procurement/procurement.module";

/**
 * ProcurementModule is imported for `createRetroactiveOrder`, which records an
 * off-app invoice as a delivered order and must do so through the same
 * `ProcurementService.createOrder` every other order goes through.
 *
 * Not a forwardRef, and deliberately so: nothing ProcurementModule imports —
 * Database, Auth, Events, InventoryLedger, Orchestrator, Communications,
 * Websocket, Notifications — reaches back to ProvidersModule, so this edge
 * creates no cycle. Nest resolves a genuine cycle by injecting `undefined` at
 * runtime rather than failing the build, so `scripts/check_gateway_boots.sh` is
 * what proves this rather than the type checker.
 */
@Module({
  imports: [DatabaseModule, AuthModule, EventsModule, ProcurementModule],
  controllers: [ProvidersController, ProviderIntelligenceController],
  providers: [ProvidersService, ProviderIntelligenceService],
  exports: [ProvidersService, ProviderIntelligenceService],
})
export class ProvidersModule {}
