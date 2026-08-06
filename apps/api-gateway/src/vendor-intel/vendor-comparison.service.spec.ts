import { VendorComparisonService } from "./vendor-comparison.service";

/**
 * The service is a thin adapter — its job is to hand database rows to the
 * consensus engine without mangling them. So these tests check the handoff and
 * the one decision the service does make: that a failed query is not
 * indistinguishable from an empty market.
 */

function makeService(rows: any[], error: any = null) {
  // A PostgREST builder is thenable: every filter returns the builder and the
  // query only executes when it is awaited. The service chains .eq()/.or()
  // AFTER .limit(), so limit must return the builder too — modelling it as a
  // terminal call is what a first attempt at this mock gets wrong.
  const q: any = {
    select: () => q,
    gte: () => q,
    order: () => q,
    limit: () => q,
    eq: () => q,
    or: () => q,
    then: (resolve: any) => resolve({ data: rows, error }),
  };
  const databaseService = { supabase: { from: () => q } } as any;
  return new VendorComparisonService(databaseService);
}

const row = (over: Record<string, any> = {}) => ({
  provider_id: null,
  vendor_name_raw: "A Vendor",
  product_name_raw: "Chablis 1er Cru",
  source_type: "website_scrape",
  source_url: "https://example.test/x",
  raw_price: 20,
  currency: "USD",
  pack_size: 1,
  unit_volume_ml: 750,
  yield_factor: 1,
  parse_confidence: 0.8,
  observed_at: new Date(Date.now() - 86_400_000).toISOString(),
  ...over,
});

describe("VendorComparisonService", () => {
  it("normalises a case price so it ranks against bottle prices", async () => {
    const svc = makeService([
      row({ vendor_name_raw: "Case Seller", raw_price: 228, pack_size: 12 }),
      row({ vendor_name_raw: "Bottle Seller", raw_price: 21.75, pack_size: 1 }),
    ]);

    const out = await svc.compare({ masterWineId: "w1" });

    // $228 / 12 = $19/unit, which beats $21.75 despite the bigger headline.
    expect(out.consensus.bestVendorName).toBe("Case Seller");
    expect(out.consensus.bestPrice).toBeCloseTo(19, 6);
  });

  it("keeps a lost-decimal scrape out of the recommendation", async () => {
    const svc = makeService([
      row({ vendor_name_raw: "A", raw_price: 20 }),
      row({ vendor_name_raw: "B", raw_price: 21 }),
      row({ vendor_name_raw: "C", raw_price: 20.5 }),
      // $21.75 scraped as $2175 — the failure this whole pipeline is built for.
      row({ vendor_name_raw: "Bad Parse", raw_price: 2175 }),
    ]);

    const out = await svc.compare({ masterWineId: "w1" });

    expect(out.consensus.outlierCount).toBe(1);
    expect(out.consensus.bestVendorName).not.toBe("Bad Parse");
    expect(
      out.consensus.ladder.find((q) => q.vendorName === "Bad Parse")?.isOutlier,
    ).toBe(true);
  });

  it("labels every source so the UI can depict them", async () => {
    const svc = makeService([
      row({ source_type: "invoice" }),
      row({ source_type: "quote" }),
      row({ source_type: "website_scrape" }),
    ]);

    const out = await svc.compare({ masterWineId: "w1" });

    expect(out.consensus.sourceBreakdown).toEqual({
      invoice: 1,
      quote: 1,
      website_scrape: 1,
    });
  });

  it("returns the 7/30/90 windows", async () => {
    const svc = makeService([row()]);
    const out = await svc.compare({ masterWineId: "w1" });
    expect(out.trends.map((t) => t.windowDays)).toEqual([7, 30, 90]);
  });

  it("returns an explained empty result when nothing has been observed", async () => {
    const svc = makeService([]);
    const out = await svc.compare({ masterWineId: "w1" });

    expect(out.consensus.bestPrice).toBeNull();
    expect(out.consensus.ladder).toHaveLength(0);
    expect(out.consensus.notes.join(" ")).toMatch(/no usable price observations/i);
  });

  it("throws on a query failure instead of reporting an empty market", async () => {
    // The distributor-search mistake: "no vendor sells this" and "the query
    // broke" must not render identically.
    const svc = makeService([], { message: "connection reset" });
    await expect(svc.compare({ masterWineId: "w1" })).rejects.toThrow(
      "connection reset",
    );
  });

  it("passes the raw observations through for the audit panel", async () => {
    const svc = makeService([row({ raw_price: 20, pack_size: 1 })]);
    const out = await svc.compare({ masterWineId: "w1" });

    expect(out.observations).toHaveLength(1);
    expect(out.observations[0]).toMatchObject({
      vendorName: "A Vendor",
      sourceType: "website_scrape",
      rawPrice: 20,
      sourceUrl: "https://example.test/x",
    });
  });
});
