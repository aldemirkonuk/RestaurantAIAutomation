/**
 * The tier-4 sighting judgement, and the comparison gate that keeps it away
 * from a quote.
 *
 * Every case here is one of the founder's 2026-09-04 conditions, or one of
 * ADR 0117's five legs. Nothing is asserted about a network.
 */

import {
  MIN_OUTLIER_SAMPLE,
  SCRAPE_SOURCE_TYPE,
  SCRAPE_TRUST_TIER,
  decideScrapeSighting,
  isOutlierAgainstPriors,
  readPageStatedDate,
} from "./vendor-site-sighting";
import {
  comparisonClassOf,
  priceBelowAverage,
  ObservationRow,
} from "./price-below-average";
import { parseCrawlDelay, isPathAllowed } from "./vendor-page-extraction";

const BASE = {
  restaurantId: "11111111-1111-1111-1111-111111111111",
  url: "https://merchant.example/wines",
  providerId: "22222222-2222-2222-2222-222222222222",
  vendorCatalogueId: null,
  vendorName: "Merchant Ltd",
  productName: "Chablis 1er Cru",
  signatureHash: "a".repeat(64),
  price: 42,
  currency: "USD",
  packSize: 1,
  unitVolumeMl: 750,
  pageStatedDate: null as string | null,
  fetchedAt: "2026-09-04T10:00:00.000Z",
  contentHash: "b".repeat(64),
  httpStatus: 200,
  parseConfidence: 0.8,
};

describe("decideScrapeSighting — the label", () => {
  it("writes tier 4 / website_scrape, the page URL, and the content hash", () => {
    const d = decideScrapeSighting(BASE);
    expect(d.write).toBe(true);
    if (!d.write) throw new Error("unreachable");
    expect(d.row.source_type).toBe(SCRAPE_SOURCE_TYPE);
    expect(d.row.source_type).toBe("website_scrape");
    expect(d.row.trust_tier).toBe(SCRAPE_TRUST_TIER);
    expect(d.row.trust_tier).toBe(4);
    expect(d.row.source_url).toBe(BASE.url);
    expect(d.row.source_ref).toBe(`${BASE.url}#${BASE.productName}`);
    expect(d.row.content_hash).toBe(BASE.contentHash);
    expect(d.row.restaurant_id).toBe(BASE.restaurantId);
  });

  it("never writes a tenant-less row", () => {
    const d = decideScrapeSighting({ ...BASE, restaurantId: null });
    expect(d.write).toBe(false);
    if (d.write) throw new Error("unreachable");
    expect(d.reason).toBe("no_restaurant");
  });
});

describe("decideScrapeSighting — the date", () => {
  it("puts the page's own claim in effective_date and OUR clock in observed_at", () => {
    const d = decideScrapeSighting({
      ...BASE,
      pageStatedDate: "2026-08-01T00:00:00.000Z",
    });
    if (!d.write) throw new Error("expected a sighting");
    // observed_at is when WE saw it, always. The comparison window reads this
    // column, and it must be a fact about our reading rather than a claim on a
    // page we do not control.
    expect(d.row.observed_at).toBe(BASE.fetchedAt);
    // effective_date is when the vendor says the price applies from.
    expect(d.row.effective_date).toBe("2026-08-01");
    expect(d.row.raw.dateBasis).toBe("page_stated");
    expect(d.row.raw.undated).toBe(false);
    expect(d.row.raw.fetchedAt).toBe(BASE.fetchedAt);
    expect(d.row.raw.pageStatedDate).toBe("2026-08-01T00:00:00.000Z");
  });

  it("a page's claimed date NEVER moves the sighting out of the read window", () => {
    // The defect this mapping exists to prevent: a page claiming an effective
    // date two months back, read today. Under the first cut this row landed
    // outside a 30-day window keyed on observed_at and vanished from the
    // comparison; a forward claim would have kept a stale price inside one.
    const old = decideScrapeSighting({
      ...BASE,
      pageStatedDate: "2026-07-01T00:00:00.000Z",
    });
    const undated = decideScrapeSighting({ ...BASE, pageStatedDate: null });
    if (!old.write || !undated.write) throw new Error("expected sightings");
    expect(old.row.observed_at).toBe(undated.row.observed_at);
    expect(old.row.observed_at).toBe(BASE.fetchedAt);
    // The claim is not lost — it is just in the column that means "applies from".
    expect(old.row.effective_date).toBe("2026-07-01");
    expect(undated.row.effective_date).toBeNull();
  });

  it("flags an UNDATED page and claims no effective date at all", () => {
    const d = decideScrapeSighting({ ...BASE, pageStatedDate: null });
    if (!d.write) throw new Error("expected a sighting");
    expect(d.row.observed_at).toBe(BASE.fetchedAt);
    expect(d.row.raw.undated).toBe(true);
    expect(d.row.raw.dateBasis).toBe("fetch_time_undated");
    // The vendor never claimed an effective date, so we do not invent one.
    expect(d.row.effective_date).toBeNull();
    expect(d.row.raw.pageStatedDate).toBeNull();
  });
});

describe("readPageStatedDate", () => {
  it("reads a labelled date", () => {
    expect(
      readPageStatedDate("Prices effective 12 March 2026. Chablis $42"),
    ).toBe(new Date("12 March 2026").toISOString());
    expect(
      readPageStatedDate("Price list as of 2026-03-12\nChablis 42"),
    ).not.toBeNull();
  });

  it("ignores an unlabelled date — a vintage is not a price-list date", () => {
    expect(readPageStatedDate("Chablis 1er Cru 2019 — $42.00")).toBeNull();
    expect(readPageStatedDate("© 2024 Merchant Ltd. Chablis $42")).toBeNull();
  });

  it("ignores a future date", () => {
    expect(
      readPageStatedDate(
        "Prices effective 1 January 2099",
        new Date("2026-09-04"),
      ),
    ).toBeNull();
  });
});

describe("decideScrapeSighting — the unit", () => {
  it("REFUSES a page that prints no bottle size rather than assuming 750", () => {
    const d = decideScrapeSighting({ ...BASE, unitVolumeMl: null });
    expect(d.write).toBe(false);
    if (d.write) throw new Error("unreachable");
    expect(d.reason).toBe("no_bottle_volume");
    expect(d.message).toContain("375ml");
  });

  it("scales a half-bottle to the 750ml reference rather than ranking it flat", () => {
    const half = decideScrapeSighting({ ...BASE, unitVolumeMl: 375 });
    if (!half.write) throw new Error("expected a sighting");
    // 42 for 375ml is 84 per 750ml — dearer, not cheaper. This is the exact
    // inversion the refusal above exists to prevent.
    expect(half.normalizedUnitPrice).toBeCloseTo(84, 6);
  });

  it("refuses a zero price and a zero pack", () => {
    expect(decideScrapeSighting({ ...BASE, price: 0 })).toMatchObject({
      write: false,
      reason: "bad_price",
    });
    expect(decideScrapeSighting({ ...BASE, packSize: 0 })).toMatchObject({
      write: false,
      reason: "bad_pack",
    });
  });
});

describe("the outlier judgement is the own-paper judgement", () => {
  it("re-exports the same floor, and does not flag below it", () => {
    expect(MIN_OUTLIER_SAMPLE).toBe(5);
    // Four priors + the candidate is exactly the floor; three is below it.
    expect(isOutlierAgainstPriors([10, 10, 10], 9999)).toBe(false);
  });

  it("flags a wild value once the sample floor is met", () => {
    expect(isOutlierAgainstPriors([10, 10.2, 9.8, 10.1], 9999)).toBe(true);
    expect(isOutlierAgainstPriors([10, 10.2, 9.8, 10.1], 10.05)).toBe(false);
  });

  it("writes the flag onto the row, and still writes the row", () => {
    const d = decideScrapeSighting(BASE, { isOutlier: true });
    if (!d.write) throw new Error("expected a sighting");
    expect(d.row.is_outlier).toBe(true);
    expect(d.row.raw_price).toBe(42);
  });
});

describe("robots.txt", () => {
  it("honours a Disallow", () => {
    const robots = "User-agent: *\nDisallow: /wines\n";
    expect(isPathAllowed(robots, "/wines", "WineOpsBot")).toBe(false);
    expect(isPathAllowed(robots, "/about", "WineOpsBot")).toBe(true);
  });

  it("reads a Crawl-delay, preferring the group that names us", () => {
    expect(parseCrawlDelay("User-agent: *\nCrawl-delay: 5\n")).toBe(5);
    expect(
      parseCrawlDelay(
        "User-agent: *\nCrawl-delay: 5\nUser-agent: WineOpsBot\nCrawl-delay: 30\n",
        "WineOpsBot",
      ),
    ).toBe(30);
    expect(parseCrawlDelay("User-agent: *\nDisallow:\n")).toBeNull();
    expect(parseCrawlDelay("User-agent: *\nCrawl-delay: soon\n")).toBeNull();
  });
});

describe("the comparison gate — never beside a quote", () => {
  const row = (over: Partial<ObservationRow>): ObservationRow => ({
    master_wine_id: "33333333-3333-3333-3333-333333333333",
    signature_hash: null,
    product_name_raw: "Chablis",
    vendor_name_raw: "V",
    provider_id: null,
    source_type: "invoice",
    observed_at: "2026-09-01T00:00:00.000Z",
    raw_price: 100,
    currency: "USD",
    pack_size: 1,
    unit_volume_ml: 750,
    yield_factor: 1,
    ...over,
  });

  it("classes a scrape apart from every quoted source", () => {
    expect(comparisonClassOf("website_scrape")).toBe("public_site");
    for (const q of [
      "invoice",
      "quote",
      "api_catalog",
      "chat",
      "social",
      "manual",
    ]) {
      expect(comparisonClassOf(q)).toBe("quoted");
    }
    // An unrecognised type gets its OWN class rather than joining the quotes.
    expect(comparisonClassOf("posted_wholesale")).toBe(
      "other:posted_wholesale",
    );
    expect(comparisonClassOf(null)).toBe("other:unstated");
  });

  it("does not let a cheap scrape beat an average built from invoices", () => {
    const rows = [
      row({ observed_at: "2026-09-01T00:00:00.000Z", raw_price: 100 }),
      row({ observed_at: "2026-09-02T00:00:00.000Z", raw_price: 100 }),
      row({ observed_at: "2026-09-03T00:00:00.000Z", raw_price: 100 }),
      // The tier-4 page price, arriving last and half the money.
      row({
        observed_at: "2026-09-04T00:00:00.000Z",
        raw_price: 50,
        source_type: "website_scrape",
      }),
    ];
    const out = priceBelowAverage(rows, { minObservations: 3 });
    // Before the gate this produced one item at −50%. Now the quoted group has
    // no later sighting to compare (its own latest is one of the three), and
    // the scrape stands alone in its class with no history.
    expect(out.items).toHaveLength(0);
    expect(out.publicSiteItems).toHaveLength(0);
    expect(out.scanned.products).toBe(1);
    expect(out.scanned.comparisons).toBe(2);
    expect(out.byClass).toEqual({ quoted: 3, public_site: 1 });
  });

  it("still reports a scrape-only drop, on its own line", () => {
    const scrape = (d: string, p: number) =>
      row({ observed_at: d, raw_price: p, source_type: "website_scrape" });
    const out = priceBelowAverage(
      [
        scrape("2026-09-01T00:00:00.000Z", 100),
        scrape("2026-09-02T00:00:00.000Z", 100),
        scrape("2026-09-03T00:00:00.000Z", 100),
        scrape("2026-09-04T00:00:00.000Z", 50),
      ],
      { minObservations: 3 },
    );
    expect(out.items).toHaveLength(0);
    expect(out.publicSiteItems).toHaveLength(1);
    expect(out.publicSiteItems[0].sourceClass).toBe("public_site");
    expect(out.publicSiteItems[0].fractionBelow).toBeCloseTo(0.5, 6);
    expect(out.classesRanked).toEqual(["quoted"]);
  });

  it("ranks a quoted drop as it always did", () => {
    const out = priceBelowAverage(
      [
        row({ observed_at: "2026-09-01T00:00:00.000Z", raw_price: 100 }),
        row({ observed_at: "2026-09-02T00:00:00.000Z", raw_price: 100 }),
        row({ observed_at: "2026-09-03T00:00:00.000Z", raw_price: 100 }),
        row({
          observed_at: "2026-09-04T00:00:00.000Z",
          raw_price: 50,
          source_type: "quote",
        }),
      ],
      { minObservations: 3 },
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0].sourceClass).toBe("quoted");
    expect(out.items[0].fractionBelow).toBeCloseTo(0.5, 6);
  });

  it("ranks an unrecognised class nowhere, and counts it", () => {
    const odd = (d: string, p: number) =>
      row({ observed_at: d, raw_price: p, source_type: "posted_wholesale" });
    const out = priceBelowAverage(
      [
        odd("2026-09-01T00:00:00.000Z", 100),
        odd("2026-09-02T00:00:00.000Z", 100),
        odd("2026-09-03T00:00:00.000Z", 100),
        odd("2026-09-04T00:00:00.000Z", 50),
      ],
      { minObservations: 3 },
    );
    expect(out.items).toHaveLength(0);
    expect(out.publicSiteItems).toHaveLength(0);
    expect(out.skipped.unrecognisedClass).toBe(1);
  });
});
