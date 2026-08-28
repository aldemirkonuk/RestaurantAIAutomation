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
import { PosMappingReviewService } from "./pos-mapping-review.service";
import {
  ListSaleUnitReviewQueryDto,
  SetSaleUnitBatchDto,
  SetSaleUnitDto,
} from "./dto/pos-mapping-review.dto";

/**
 * POS Hub — multi-POS ingestion surface.
 *
 *   GET  /pos-hub/providers                      registry + coverage summary
 *   GET  /pos-hub/status/:restaurantId           ingestion stats by source
 *   POST /pos-hub/webhook/:provider/:restaurantId   push path (webhooks/middleware)
 *   POST /pos-hub/import/:restaurantId           batch import (canonical JSON)
 *   GET/POST /pos-hub/mappings/:restaurantId     pos_item_mappings CRUD
 *   GET  /pos-hub/mappings/:restaurantId/sale-unit-review   rows missing a unit, with evidence
 *   POST /pos-hub/mappings/:restaurantId/sale-unit          batch: the human's answers
 *   POST /pos-hub/mappings/:restaurantId/:mappingId/sale-unit   one answer
 */
@ApiTags("pos-hub")
// Guarded at class level. Only the provider webhook is @Public() — it authenticates
// by HMAC signature instead (PosHubService.verifyWebhookSignature, fails closed,
// keyed per (provider, restaurant)).
// Before this, catalog-match approve/reject were reachable unauthenticated, so the
// human approval gate could be operated by anyone for any restaurant.
@UseGuards(JwtAuthGuard)
@Controller("pos-hub")
export class PosHubController {
  constructor(
    private readonly posHub: PosHubService,
    private readonly catalogMatcher: CatalogMatcherService,
    private readonly mappingReview: PosMappingReviewService,
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
      "Normalizes the provider payload into canonical checks, upserts pos_checks (idempotent on external check id), and — for closed checks — depletes stock via apply_stock_movement/record_glass_pour. Use provider 'generic_webhook' with the canonical JSON shape to bridge any POS today. Requires a hex HMAC-SHA256 signature in X-Pos-Hub-Signature, keyed per (provider, restaurant): POS_WEBHOOK_SECRET_<PROVIDER>__<RESTAURANT_ID> then POS_WEBHOOK_SECRET_<PROVIDER> — both signing '<provider>:<restaurantId>.' + rawBody — falling back to the legacy process-wide POS_HUB_WEBHOOK_SECRET over the raw body alone. Fails closed when no secret is configured.",
  })
  @ApiHeader({
    name: "X-Pos-Hub-Signature",
    description:
      "Hex HMAC-SHA256. With a scoped secret (POS_WEBHOOK_SECRET_<PROVIDER>[__<RESTAURANT_ID>]) the signed message is `<provider>:<restaurantId>.` + rawBody; on the legacy POS_HUB_WEBHOOK_SECRET fallback it is rawBody alone.",
    required: true,
  })
  async webhook(
    @Param("provider") provider: string,
    @Param("restaurantId") restaurantId: string,
    @Body() payload: unknown,
    @Headers("x-pos-hub-signature") signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ) {
    // B17/B28: HMAC guard, fail closed (see PosHubService.verifyWebhookSignature).
    // The provider and restaurant from the path are passed as the identity the
    // key is resolved for AND (on a scoped secret) signed over, so a signature
    // minted for one tenant cannot authenticate another's payload.
    if (
      !this.posHub.verifyWebhookSignature(request.rawBody, signature, {
        provider,
        restaurantId,
      })
    ) {
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

  // ==========================================================================
  // Sale-unit review — read the evidence, a human writes the answer.
  //
  // Inherits the class-level @UseGuards(JwtAuthGuard) and is deliberately NOT
  // @Public(): the only unauthenticated route on this controller is the
  // provider webhook, which authenticates by HMAC instead. These three write
  // and read the mapping table that decides how much stock a sale depletes,
  // which is exactly the kind of route the catalog-match guard fix above was
  // added for.
  // ==========================================================================

  @Get("mappings/:restaurantId/sale-unit-review")
  @ApiOperation({
    summary: "Mappings still missing a sale_unit, with the evidence to decide",
    description:
      "Every mapping whose sale_unit is null, each carrying: the POS identity (item_name, external_item_id, source), the linked restaurant_inventory row (wine_name, bottle_size_ml, pour_size_ml, menu_price_current, menu_price_glass) or an inventory_link of 'unmapped'/'dangling' when there isn't one, and the observed POS line price from recent closed checks (count, min, max, latest). Observed price and bottle price are returned as separate raw numbers — no ratio, no suggested unit: sale_unit is never inferred (decision B36). `unit_if_unanswered` states what applyStockEffects books today if the row stays null; it is a description of current behaviour, not a recommendation.",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  async saleUnitReview(
    @Param("restaurantId") restaurantId: string,
    @Query() query: ListSaleUnitReviewQueryDto,
  ) {
    try {
      return await this.mappingReview.listNeedingSaleUnit(restaurantId, {
        includeAnswered: query.includeAnswered,
        checkLimit: query.checkLimit,
      });
    } catch (error) {
      throw new HttpException(
        error.message || "Sale-unit review failed",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post("mappings/:restaurantId/sale-unit")
  @ApiOperation({
    summary: "Record sale units for many mappings in one pass",
    description:
      "Body: { items: [{ mapping_id, sale_unit }] }. Each entry is applied independently — one bad id does not discard the rest — and the response reports per-entry ok/error. Only 'glass' and 'bottle' are accepted; the value written is the one sent, never derived.",
  })
  async setSaleUnitBatch(
    @Param("restaurantId") restaurantId: string,
    @Body() body: SetSaleUnitBatchDto,
  ) {
    try {
      return await this.mappingReview.setSaleUnitBatch(
        restaurantId,
        body.items,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Sale-unit batch update failed",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post("mappings/:restaurantId/:mappingId/sale-unit")
  @ApiOperation({
    summary: "Record the sale unit for one mapping",
    description:
      "Body: { sale_unit: 'glass' | 'bottle' }. Loads the existing row and changes only sale_unit, so the inventory link, is_wine and category survive the write.",
  })
  @ApiParam({ name: "mappingId", description: "pos_item_mappings.id" })
  async setSaleUnit(
    @Param("restaurantId") restaurantId: string,
    @Param("mappingId") mappingId: string,
    @Body() body: SetSaleUnitDto,
  ) {
    try {
      return await this.mappingReview.setSaleUnit(
        restaurantId,
        mappingId,
        body.sale_unit,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Sale-unit update failed",
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
