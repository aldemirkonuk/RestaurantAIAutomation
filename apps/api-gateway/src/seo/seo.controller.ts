import { Controller, Get, NotFoundException, Param, Res } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "../auth/decorators/public.decorator";
import { RateLimit } from "../common/rate-limit";
import { SeoService } from "./seo.service";

/**
 * The crawl surface's data half (ADR 0158).
 *
 * Public on purpose, and read-only: every byte here is already public on a
 * published catalogue page. mudavym.com reaches these routes two ways, and
 * neither exposes the gateway host to a crawler:
 *
 * - /sitemap.xml and /sitemap-vendors-N.xml are Vercel rewrites to the XML
 *   routes, so the file a crawler reads lives on mudavym.com. They carry
 *   `s-maxage` so Vercel's CDN answers repeat reads for an hour.
 * - /v/:slug is rendered by the web middleware, which calls `vendors/:slug/head`
 *   server to server.
 *
 * Rate limits are per client IP and route. The head route's caller is Vercel's
 * middleware, whose few egress addresses share one budget across every slug,
 * so it gets a budget sized for a crawler walking the catalogue rather than
 * the 100/min default.
 */
@ApiTags("SEO (public)")
@Controller("seo")
export class SeoController {
  constructor(private readonly seoService: SeoService) {}

  @Get("sitemap.xml")
  @Public()
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "seo-sitemap" })
  @ApiOperation({ summary: "Sitemap index for mudavym.com" })
  async sitemapIndex(@Res() res: Response): Promise<void> {
    sendXml(res, await this.seoService.sitemapIndex());
  }

  @Get("sitemap-vendors/:page")
  @Public()
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "seo-sitemap" })
  @ApiOperation({ summary: "One block of published vendor catalogue URLs" })
  @ApiParam({ name: "page", description: "1-based block number" })
  async vendorSitemap(@Param("page") raw: string, @Res() res: Response): Promise<void> {
    if (!/^[1-9]\d{0,5}$/.test(raw)) throw new NotFoundException("No such sitemap");
    sendXml(res, await this.seoService.vendorSitemap(Number(raw)));
  }

  @Get("vendors/:slug/head")
  @Public()
  @RateLimit({ limit: 600, windowSeconds: 60, keyPrefix: "seo-head" })
  @ApiOperation({ summary: "Head, structured data and body facts for /v/:slug" })
  async vendorHead(@Param("slug") slug: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "public, max-age=60");
    return this.seoService.vendorHead(slug);
  }
}

function sendXml(res: Response, xml: string): void {
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600");
  res.send(xml);
}
