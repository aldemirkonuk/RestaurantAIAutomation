import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { PosHubService } from "./pos-hub.service";

/**
 * POS Hub — multi-POS ingestion surface.
 *
 *   GET  /pos-hub/providers                      registry + coverage summary
 *   GET  /pos-hub/status/:restaurantId           ingestion stats by source
 *   POST /pos-hub/webhook/:provider/:restaurantId   push path (webhooks/middleware)
 *   POST /pos-hub/import/:restaurantId           batch import (canonical JSON)
 *   GET/POST /pos-hub/mappings/:restaurantId     pos_item_mappings CRUD
 */
@ApiTags("pos-hub")
@Controller("pos-hub")
export class PosHubController {
  constructor(private readonly posHub: PosHubService) {}

  @Get("providers")
  @ApiOperation({
    summary: "POS provider registry",
    description:
      "All supported/planned providers across tiers (cloud, enterprise, partner-gated, Türkiye) with adapter status and capabilities.",
  })
  getProviders() {
    return this.posHub.getProviders();
  }

  @Get("status/:restaurantId")
  @ApiOperation({ summary: "Ingestion status by source (30-day window)" })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  getStatus(@Param("restaurantId") restaurantId: string) {
    return this.posHub.getStatus(restaurantId);
  }

  @Post("webhook/:provider/:restaurantId")
  @ApiOperation({
    summary: "Ingest a POS webhook payload",
    description:
      "Normalizes the provider payload into canonical checks and upserts pos_checks (idempotent on external check id). Use provider 'generic_webhook' with the canonical JSON shape to bridge any POS today.",
  })
  async webhook(
    @Param("provider") provider: string,
    @Param("restaurantId") restaurantId: string,
    @Body() payload: unknown,
  ) {
    try {
      return await this.posHub.ingest(restaurantId, provider, payload);
    } catch (error) {
      throw new HttpException(
        error.message || "Ingestion failed",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post("import/:restaurantId")
  @ApiOperation({
    summary: "Batch-import historical checks",
    description:
      "Body: array of CanonicalCheck (or {checks: [...]}) — the csv_import path for nightly exports and backfills.",
  })
  async importChecks(
    @Param("restaurantId") restaurantId: string,
    @Body() payload: unknown,
  ) {
    try {
      return await this.posHub.ingest(restaurantId, "csv_import", payload);
    } catch (error) {
      throw new HttpException(
        error.message || "Import failed",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get("mappings/:restaurantId")
  @ApiOperation({ summary: "List POS item → wine mappings" })
  async listMappings(@Param("restaurantId") restaurantId: string) {
    return this.posHub.listItemMappings(restaurantId);
  }

  @Post("mappings/:restaurantId")
  @ApiOperation({
    summary: "Create/update a POS item mapping",
    description:
      "Body: { source?, external_item_id?, item_name?, is_wine, master_wine_id?, inventory_id?, category? }. source '*' applies across providers.",
  })
  async upsertMapping(
    @Param("restaurantId") restaurantId: string,
    @Body() body: any,
  ) {
    try {
      return await this.posHub.upsertItemMapping(restaurantId, body || {});
    } catch (error) {
      throw new HttpException(
        error.message || "Mapping failed",
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
