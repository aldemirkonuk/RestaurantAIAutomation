import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/decorators/public.decorator";
import { buildVendorHead } from "../seo/vendor-head";
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
  @ApiParam({
    name: "slug",
    description: "Subdomain label for the vendor page",
  })
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
   *
   * It is the document mudavym.com serves in the catalogue's own head
   * (seo/vendor-head.ts, ADR 0158), so there is one statement of the catalogue.
   * The canonical URL is computed; it used to be a caller-supplied `?url=`,
   * which let any request write any URL into the markup.
   */
  @Get(":slug/jsonld")
  @Public()
  @ApiOperation({ summary: "schema.org WebPage > ItemList for a published vendor page" })
  async getJsonLd(@Param("slug") slug: string) {
    const page = await this.vendorPortalService.getPublishedPage(slug);
    return buildVendorHead(page).jsonLd;
  }
}
