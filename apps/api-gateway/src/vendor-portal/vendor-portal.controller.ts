import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/decorators/public.decorator";
import { VendorPortalService } from "./vendor-portal.service";

/**
 * Public vendor catalogue.
 *
 * Genuinely public — no JWT, no tenant. A vendor's published list is meant to
 * be readable by their customers, by us, and by any crawler; that is the point
 * of hosting it. Everything returned here is catalogue data a vendor chose to
 * publish. Negotiated rates live in vendor_price_observations scoped to a
 * restaurant and never appear on this route.
 */
@ApiTags("Vendor Portal (public)")
@Controller("vendor-portal")
export class VendorPortalController {
  constructor(private readonly vendorPortalService: VendorPortalService) {}

  @Get(":slug")
  @Public()
  @ApiOperation({ summary: "Fetch a published vendor catalogue page by slug" })
  @ApiParam({ name: "slug", description: "Subdomain label for the vendor page" })
  async getPage(@Param("slug") slug: string) {
    const page = await this.vendorPortalService.getPublishedPage(slug);
    return { success: true, page };
  }

  /**
   * The same catalogue as schema.org JSON-LD.
   *
   * Split from the page payload rather than embedded because the two have
   * different consumers and different cache lifetimes: the app renders from
   * the former, crawlers and our own ingester read the latter.
   */
  @Get(":slug/jsonld")
  @Public()
  @ApiOperation({ summary: "schema.org ItemList for a published vendor page" })
  async getJsonLd(@Param("slug") slug: string, @Query("url") url?: string) {
    const page = await this.vendorPortalService.getPublishedPage(slug);
    return this.vendorPortalService.buildJsonLd(page, url ?? "");
  }
}
