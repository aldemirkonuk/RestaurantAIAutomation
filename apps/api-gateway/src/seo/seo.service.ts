import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { VendorPortalService } from "../vendor-portal/vendor-portal.service";
import { CANONICAL_ORIGIN, VendorHeadPayload, buildVendorHead, vendorCanonical } from "./vendor-head";

/**
 * The sitemap and the vendor head, read from the published catalogue.
 *
 * Only `is_published` rows are ever read, with an explicit column list (the
 * VendorPortalService rule: a `select("*")` would ship `edit_token`). An
 * unpublished page and a missing one are the same 404, so nothing here lets a
 * stranger enumerate drafts.
 *
 * Scale: a vendor sitemap file holds at most VENDORS_PER_SITEMAP URLs, sized
 * under PostgREST's default 1,000-row response cap so a page is never
 * silently truncated. The sitemaps.org limit is 50,000 files per index, so
 * one index covers 50 million catalogues before it needs a second level.
 */

export const VENDORS_PER_SITEMAP = 1000;
export const PAGES_SITEMAP_URL = `${CANONICAL_ORIGIN}/sitemap-pages.xml`;

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function vendorSitemapUrl(page: number): string {
  return `${CANONICAL_ORIGIN}/sitemap-vendors-${page}.xml`;
}

/** The W3C date form sitemaps accept; an unparseable value emits nothing. */
function lastmodOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

@Injectable()
export class SeoService {
  private readonly logger = new Logger(SeoService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly vendorPortalService: VendorPortalService,
  ) {}

  async publishedVendorCount(): Promise<number> {
    const { count, error } = await this.databaseService.supabase
      .from("vendor_portal_pages")
      .select("slug", { count: "exact", head: true })
      .eq("is_published", true);
    if (error || count === null) {
      // A failed count must not become "zero catalogues": the index would
      // drop every vendor file and a crawler would read that as removal.
      this.logger.warn("Published vendor count failed");
      throw new ServiceUnavailableException("Sitemap is temporarily unavailable");
    }
    return count;
  }

  /** /sitemap.xml: the pages file always, one vendor file per started block. */
  async sitemapIndex(): Promise<string> {
    const count = await this.publishedVendorCount();
    const files = [PAGES_SITEMAP_URL];
    for (let page = 1; page <= Math.ceil(count / VENDORS_PER_SITEMAP); page += 1) {
      files.push(vendorSitemapUrl(page));
    }
    return [
      XML_HEADER,
      `<sitemapindex xmlns="${SITEMAP_NS}">`,
      ...files.map((loc) => `  <sitemap><loc>${escapeXml(loc)}</loc></sitemap>`),
      "</sitemapindex>",
      "",
    ].join("\n");
  }

  /**
   * /sitemap-vendors-N.xml. A page past the last published block is a 404,
   * never an empty `<urlset>` (invalid against the sitemaps.org schema).
   *
   * `lastmod` is the page's `updated_at`, which migration
   * 20260917020000 keeps true: a trigger bumps it on any change to the page
   * or to one of its listings.
   */
  async vendorSitemap(page: number): Promise<string> {
    const from = (page - 1) * VENDORS_PER_SITEMAP;
    const { data, error } = await this.databaseService.supabase
      .from("vendor_portal_pages")
      .select("slug, updated_at")
      .eq("is_published", true)
      .order("slug", { ascending: true })
      .range(from, from + VENDORS_PER_SITEMAP - 1);
    if (error) {
      this.logger.warn(`Vendor sitemap ${page} read failed`);
      throw new ServiceUnavailableException("Sitemap is temporarily unavailable");
    }
    if (!data || data.length === 0) {
      throw new NotFoundException("No such sitemap");
    }
    const urls = data.map((row: { slug: string; updated_at: unknown }) => {
      const lastmod = lastmodOf(row.updated_at);
      return `  <url><loc>${escapeXml(vendorCanonical(row.slug))}</loc>${
        lastmod ? `<lastmod>${lastmod}</lastmod>` : ""
      }</url>`;
    });
    return [XML_HEADER, `<urlset xmlns="${SITEMAP_NS}">`, ...urls, "</urlset>", ""].join("\n");
  }

  async vendorHead(slug: string): Promise<VendorHeadPayload> {
    const page = await this.vendorPortalService.getPublishedPage(slug);
    return buildVendorHead(page);
  }
}
