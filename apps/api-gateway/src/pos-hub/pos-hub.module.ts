import { Module, forwardRef } from "@nestjs/common";
import { AreaRoutingModule } from "../areas/area-routing.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { CatalogMatcherService } from "./catalog-matcher.service";
import { PosHubController } from "./pos-hub.controller";
import { PosHubService } from "./pos-hub.service";
import { PosMappingReviewService } from "./pos-mapping-review.service";
import { PosHistoryImportService } from "./pos-history-import.service";

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
  // AreaRoutingModule: the refused-checks bell note applies Away (ADR 0218,
  // ADR 0281 amended 2026-10-05). It imports only the database, so it joins
  // no cycle.
  imports: [
    AuthModule,
    DatabaseModule,
    forwardRef(() => NotificationsModule),
    AreaRoutingModule,
    // r109 g3: the history import is owner or manager only.
    OrganizationsModule,
  ],
  controllers: [PosHubController],
  providers: [PosHubService, CatalogMatcherService, PosMappingReviewService, PosHistoryImportService],
  exports: [PosHubService, CatalogMatcherService, PosMappingReviewService],
})
export class PosHubModule {}
