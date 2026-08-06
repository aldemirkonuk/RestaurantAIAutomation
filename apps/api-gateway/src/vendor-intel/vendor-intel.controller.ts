import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { VendorComparisonService } from "./vendor-comparison.service";
import { VendorPageExtractorService } from "./vendor-page-extractor.service";

/**
 * Vendor price intelligence.
 *
 * Owner/manager only. Vendor pricing is commercially sensitive — it is the
 * restaurant's negotiating position — so it is deliberately not visible to
 * staff-level accounts, matching the role gate on the pricing column.
 */
@ApiTags("Vendor Intelligence")
@ApiBearerAuth()
@Controller("vendor-intel")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("owner", "manager")
export class VendorIntelController {
  constructor(
    private readonly comparison: VendorComparisonService,
    private readonly extractor: VendorPageExtractorService,
  ) {}

  @Get("compare")
  @ApiOperation({
    summary:
      "Vendor price ladder + 7/30/90d trends for one product, across all sources",
  })
  async compare(
    @CurrentUser() user: { restaurantId: string },
    @Query("masterWineId") masterWineId?: string,
    @Query("signatureHash") signatureHash?: string,
    @Query("windowDays") windowDays?: string,
  ) {
    if (!masterWineId && !signatureHash) {
      throw new BadRequestException(
        "Provide masterWineId or signatureHash to identify the product.",
      );
    }
    const parsedWindow = windowDays ? Number(windowDays) : undefined;
    const result = await this.comparison.compare({
      masterWineId,
      signatureHash,
      restaurantId: user.restaurantId,
      windowDays:
        parsedWindow && Number.isFinite(parsedWindow)
          ? parsedWindow
          : undefined,
    });
    return { success: true, ...result };
  }

  /**
   * Kick a scrape manually. Owner-only: it makes outbound requests in the
   * restaurant's name and costs model tokens, so it should not be a
   * one-click action for every manager.
   */
  @Post("scrape")
  @Roles("owner")
  @ApiOperation({ summary: "Extract prices from one vendor page" })
  async scrape(
    @Body()
    body: {
      url: string;
      providerId?: string;
      vendorCatalogueId?: string;
      vendorName?: string;
      dryRun?: boolean;
    },
  ) {
    if (!body?.url) throw new BadRequestException("url is required");
    const result = await this.extractor.extractFromUrl({
      url: body.url,
      providerId: body.providerId ?? null,
      vendorCatalogueId: body.vendorCatalogueId ?? null,
      vendorName: body.vendorName ?? null,
      dryRun: body.dryRun ?? false,
    });
    return { success: true, result };
  }

  @Post("sweep")
  @Roles("owner")
  @ApiOperation({
    summary:
      "Sweep active vendor_catalogue websites (sequential, rate-limited)",
  })
  async sweep(@Body() body: { limit?: number; dryRun?: boolean }) {
    const results = await this.extractor.sweepCatalogue({
      limit: body?.limit,
      dryRun: body?.dryRun ?? false,
    });
    return {
      success: true,
      swept: results.length,
      observationsWritten: results.reduce(
        (a, r) => a + r.observationsWritten,
        0,
      ),
      results,
    };
  }
}
