import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
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
  imports: [DatabaseModule],
  controllers: [PosHubController],
  providers: [PosHubService],
  exports: [PosHubService],
})
export class PosHubModule {}
