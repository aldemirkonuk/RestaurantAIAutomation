import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  RawBodyRequest,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Public } from "../auth/decorators/public.decorator";
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { CatalogMatcherService } from "./catalog-matcher.service";
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
// Guarded at class level. Only the provider webhook is @Public() — it authenticates
// by HMAC signature instead (pos-hub.service.ts:96-121, fails closed).
// Before this, catalog-match approve/reject were reachable unauthenticated, so the
// human approval gate could be operated by anyone for any restaurant.
@UseGuards(JwtAuthGuard)
@Controller("pos-hub")
export class PosHubController {
  constructor(
    private readonly posHub: PosHubService,
    private readonly catalogMatcher: CatalogMatcherService,
  ) {}

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

  @Public() // authenticated by HMAC signature, not JWT
  @Post("webhook/:provider/:restaurantId")
  @ApiOperation({
    summary: "Ingest a POS webhook payload",
    description:
      "Normalizes the provider payload into canonical checks, upserts pos_checks (idempotent on external check id), and — for closed checks — depletes stock via apply_stock_movement/record_glass_pour. Use provider 'generic_webhook' with the canonical JSON shape to bridge any POS today. Requires an HMAC-SHA256 signature over the raw body, hex-encoded, in X-Pos-Hub-Signature, keyed by POS_HUB_WEBHOOK_SECRET.",
  })
  @ApiHeader({
    name: "X-Pos-Hub-Signature",
    description: "HMAC-SHA256(rawBody, POS_HUB_WEBHOOK_SECRET), hex-encoded",
    required: true,
  })
  async webhook(
    @Param("provider") provider: string,
    @Param("restaurantId") restaurantId: string,
    @Body() payload: unknown,
    @Headers("x-pos-hub-signature") signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ) {
    // B17/B28: shared-secret guard, fail closed (see PosHubService.verifyWebhookSignature).
    if (!this.posHub.verifyWebhookSignature(request.rawBody, signature)) {
      throw new HttpException(
        "Webhook signature verification failed",
        HttpStatus.UNAUTHORIZED,
      );
    }
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

  @Post("catalog-match/:restaurantId")
  @ApiOperation({
    summary:
      "Pull the POS catalog and match it against inventory (decisions D32-39)",
    description:
      "Body: { source }. Pulls the POS-side catalog (only 'simpos' is wired today), matches every unmapped item against restaurant_inventory via external id / SKU / trigram tiers (thresholds shared with the invoice line-matcher), auto-maps at >=0.9 confidence when unambiguous, and queues everything else in pos_catalog_match_proposals. Never overwrites an existing mapping silently.",
  })
  async catalogMatch(
    @Param("restaurantId") restaurantId: string,
    @Body() body: { source?: string },
  ) {
    try {
      return await this.catalogMatcher.pullAndMatch(
        restaurantId,
        body?.source || "simpos",
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Catalog match failed",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get("catalog-match/:restaurantId/proposals")
  @ApiOperation({
    summary: "List pending (or other-status) catalog match proposals",
  })
  async listProposals(
    @Param("restaurantId") restaurantId: string,
    @Query("status") status?: string,
  ) {
    return this.catalogMatcher.listProposals(restaurantId, status || "pending");
  }

  @Post("catalog-match/:restaurantId/proposals/:proposalId/approve")
  @ApiOperation({
    summary: "Approve a proposal — writes the pos_item_mappings row",
  })
  async approveProposal(
    @Param("restaurantId") restaurantId: string,
    @Param("proposalId") proposalId: string,
  ) {
    try {
      return await this.catalogMatcher.approveProposal(
        restaurantId,
        proposalId,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Approve failed",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post("catalog-match/:restaurantId/proposals/:proposalId/reject")
  @ApiOperation({ summary: "Reject a proposal — leaves the item unmapped" })
  async rejectProposal(
    @Param("restaurantId") restaurantId: string,
    @Param("proposalId") proposalId: string,
  ) {
    try {
      return await this.catalogMatcher.rejectProposal(restaurantId, proposalId);
    } catch (error) {
      throw new HttpException(
        error.message || "Reject failed",
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
