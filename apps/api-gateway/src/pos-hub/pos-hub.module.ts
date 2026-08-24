import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { CatalogMatcherService } from "./catalog-matcher.service";
import { PosHubController } from "./pos-hub.controller";
import { PosHubService } from "./pos-hub.service";

/**
 * POS Hub Module — the multiPOS foundation.
 *
 * One canonical check contract, one ingestion pipeline, one mapping table —
 * every provider (25+ in the registry, from Square to Simpra) becomes a thin
 * adapter instead of a bespoke integration. Analytics reads pos_checks only.
 */
@Module({
  // AuthModule supplies TokenBlacklistService, which JwtAuthGuard injects. The
  // guard resolves in *this* module's context, so without this import the whole
  // app fails to boot — not just this route. AuthModule is not @Global().
  imports: [AuthModule, DatabaseModule, forwardRef(() => NotificationsModule)],
  controllers: [PosHubController],
  providers: [PosHubService, CatalogMatcherService],
  exports: [PosHubService, CatalogMatcherService],
})
export class PosHubModule {}
