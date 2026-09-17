import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { PublicVendorListing, PublicVendorPage } from "../vendor-portal/vendor-portal.service";
import { SeoController } from "./seo.controller";
import { SeoService, VENDORS_PER_SITEMAP, escapeXml } from "./seo.service";
import { buildVendorHead, clip, formatOf, priceOf } from "./vendor-head";

/**
 * The claims the served catalogue makes to machines. Each case is a rule the
 * old builder (VendorPortalService.buildJsonLd) broke; see vendor-head.ts.
 */

function listing(overrides: Partial<PublicVendorListing> = {}): PublicVendorListing {
  return {
    id: "l-1",
    productName: "Barolo Bussia",
    producer: "Prunotto",
    vintage: 2019,
    region: "Piedmont",
    country: "Italy",
    grapeVarieties: "Nebbiolo",
    price: 240,
    currency: "EUR",
    packSize: 6,
    volumeMl: 750,
    unitLabel: "case",
    inStock: null,
    minOrderQuantity: null,
    leadTimeDays: null,
    notes: null,
    ...overrides,
  };
}

function page(listings: PublicVendorListing[], overrides: Partial<PublicVendorPage> = {}): PublicVendorPage {
  return {
    slug: "acme-wines",
    displayName: "Acme Wines",
    tagline: null,
    about: null,
    logoUrl: null,
    contactEmail: null,
    contactPhone: null,
    websiteUrl: null,
    updatedAt: "2026-09-01T00:00:00Z",
    listings,
    ...overrides,
  };
}

function offerOf(head: ReturnType<typeof buildVendorHead>, i = 0): any {
  return (head.jsonLd as any).mainEntity.itemListElement[i].item.offers;
}

describe("vendor head: what the catalogue claims", () => {
  it("states no availability when the vendor did not", () => {
    const head = buildVendorHead(page([listing({ inStock: null }), listing({ inStock: false })]));
    expect(offerOf(head, 0)).not.toHaveProperty("availability");
    expect(offerOf(head, 1).availability).toBe("https://schema.org/OutOfStock");
    expect(head.page.listings[0].inStock).toBeNull();
  });

  it("never publishes a region as the country", () => {
    const head = buildVendorHead(page([listing({ country: null, region: "Piedmont" })]));
    const item = (head.jsonLd as any).mainEntity.itemListElement[0].item;
    expect(item).not.toHaveProperty("countryOfOrigin");
    expect(item.additionalProperty).toContainEqual({ "@type": "PropertyValue", name: "Region", value: "Piedmont" });
    const withCountry = buildVendorHead(page([listing()]));
    expect((withCountry.jsonLd as any).mainEntity.itemListElement[0].item.countryOfOrigin).toEqual({
      "@type": "Country",
      name: "Italy",
    });
  });

  it("says a case price is for the case, and minimum order is the only eligibleQuantity", () => {
    const offer = offerOf(buildVendorHead(page([listing({ minOrderQuantity: 2 })])));
    expect(offer.price).toBe(240);
    expect(offer.includesObject).toMatchObject({ "@type": "TypeAndQuantityNode", amountOfThisGood: 6, unitText: "case" });
    expect(offer.eligibleQuantity).toEqual({ "@type": "QuantitativeValue", minValue: 2 });
    const single = offerOf(buildVendorHead(page([listing({ packSize: 1, unitLabel: null })])));
    expect(single).not.toHaveProperty("includesObject");
    expect(single).not.toHaveProperty("eligibleQuantity");
  });

  it("emits no offer without a price, and a vintage is not a production date", () => {
    const head = buildVendorHead(page([listing({ price: null })]));
    const item = (head.jsonLd as any).mainEntity.itemListElement[0].item;
    expect(item).not.toHaveProperty("offers");
    expect(item).not.toHaveProperty("productionDate");
    expect(item.additionalProperty).toContainEqual({ "@type": "PropertyValue", name: "Vintage", value: 2019 });
    expect(head.page.listings[0].price).toBeNull();
  });

  it("computes the canonical, credits the vendor, and never names Mudavym as seller", () => {
    const head = buildVendorHead(
      page([listing()], { logoUrl: "https://cdn.acme.test/logo.png", websiteUrl: "javascript:alert(1)" }),
    );
    expect(head.canonical).toBe("https://mudavym.com/v/acme-wines");
    expect((head.jsonLd as any)["@id"]).toBe(head.canonical);
    expect((head.jsonLd as any).publisher).toEqual({
      "@type": "Organization",
      name: "Acme Wines",
      logo: "https://cdn.acme.test/logo.png",
    });
    expect(head.page.websiteUrl).toBeNull();
    expect(JSON.stringify(head.jsonLd)).not.toMatch(/"seller":\{[^}]*Mudavym/);
    expect(head.title).toBe("Acme Wines catalogue");
    expect(head.title).not.toContain("—");
  });

  it("describes the page from the vendor's own words, clipped, or by count", () => {
    expect(buildVendorHead(page([], { tagline: "Natural wine importer." })).description).toBe("Natural wine importer.");
    expect(buildVendorHead(page([], { about: "We import from Italy. Since 1990." })).description).toBe("We import from Italy.");
    expect(buildVendorHead(page([listing(), listing()])).description).toBe("2 listings published by Acme Wines.");
    expect(clip("word ".repeat(80), 160).length).toBeLessThanOrEqual(160);
  });

  it("prints the format and price the page prints", () => {
    expect(formatOf(listing())).toBe("6-pack · 750ml · case");
    expect(formatOf(listing({ packSize: 1, volumeMl: 1500, unitLabel: null }))).toBe("1.5L");
    expect(priceOf(listing())).toBe("€240.00 per pack");
    expect(priceOf(listing({ packSize: 1, currency: "USD", price: 20 }))).toBe("$20.00");
    expect(priceOf(listing({ currency: "ZZZ" as string }))).toMatch(/240\.00/);
  });
});

function supabaseReturning(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const chain: any = {};
  for (const m of ["from", "select", "eq", "order"]) chain[m] = jest.fn(() => chain);
  chain.range = jest.fn(() => Promise.resolve(result));
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

describe("sitemaps", () => {
  function service(result: { data?: unknown; error?: unknown; count?: number | null }) {
    const supabase = supabaseReturning(result);
    return new SeoService({ supabase } as any, {} as any);
  }

  it("the index lists the pages file always and one vendor file per started block", async () => {
    const none = await service({ count: 0, error: null }).sitemapIndex();
    expect(none).toContain("<loc>https://mudavym.com/sitemap-pages.xml</loc>");
    expect(none).not.toContain("sitemap-vendors");

    const many = await service({ count: VENDORS_PER_SITEMAP + 1, error: null }).sitemapIndex();
    expect(many).toContain("sitemap-vendors-1.xml");
    expect(many).toContain("sitemap-vendors-2.xml");
    expect(many).not.toContain("sitemap-vendors-3.xml");
  });

  it("a failed count is a 503, never an index with the vendors missing", async () => {
    await expect(service({ count: null, error: { message: "x" } }).sitemapIndex()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("a vendor block lists canonical URLs with lastmod; past the end is a 404, never an empty urlset", async () => {
    const xml = await service({
      data: [{ slug: "acme-wines", updated_at: "2026-09-01T10:00:00+00:00" }],
      error: null,
    }).vendorSitemap(1);
    expect(xml).toContain("<url><loc>https://mudavym.com/v/acme-wines</loc><lastmod>2026-09-01T10:00:00.000Z</lastmod></url>");
    await expect(service({ data: [], error: null }).vendorSitemap(9)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service({ data: null, error: { message: "x" } }).vendorSitemap(1)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("escapes XML", () => {
    expect(escapeXml(`<a & 'b'>"`)).toBe("&lt;a &amp; &apos;b&apos;&gt;&quot;");
  });

  it("the controller refuses a block number that is not a positive integer", async () => {
    const controller = new SeoController({ vendorSitemap: jest.fn() } as any);
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;
    for (const bad of ["0", "-1", "1.5", "abc", "01", "1234567"]) {
      await expect(controller.vendorSitemap(bad, res)).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it("serves XML with a CDN cache lifetime", async () => {
    const controller = new SeoController({ sitemapIndex: jest.fn(async () => "<x/>") } as any);
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;
    await controller.sitemapIndex(res);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/xml; charset=utf-8");
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "public, max-age=0, s-maxage=3600");
    expect(res.send).toHaveBeenCalledWith("<x/>");
  });
});
