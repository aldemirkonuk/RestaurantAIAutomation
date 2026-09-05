import { VendorComparisonService } from "./vendor-comparison.service";
import { MIN_OUTLIER_SAMPLE } from "./vendor-site-sighting";

/**
 * The service is a thin adapter — its job is to hand database rows to the
 * consensus engine without mangling them. So these tests check the handoff and
 * the one decision the service does make: that a failed query is not
 * indistinguishable from an empty market.
 */

interface Calls {
  or: string[];
  eq: Array<[string, any]>;
  inserted: any[];
}

function makeService(
  rows: any[],
  error: any = null,
  opts: {
    wine?: { producer: string; name: string; vintage: number | null } | null;
    insertError?: any;
  } = {},
) {
  const calls: Calls = { or: [], eq: [], inserted: [] };

  // A PostgREST builder is thenable: every filter returns the builder and the
  // query only executes when it is awaited. The service chains .eq()/.or()
  // AFTER .limit(), so limit must return the builder too — modelling it as a
  // terminal call is what a first attempt at this mock gets wrong.
  const observations: any = {
    select: () => observations,
    gte: () => observations,
    order: () => observations,
    limit: () => observations,
    eq: (col: string, val: any) => {
      calls.eq.push([col, val]);
      return observations;
    },
    or: (clause: string) => {
      calls.or.push(clause);
      return observations;
    },
    insert: (payload: any) => {
      calls.inserted.push(payload);
      return {
        select: () => ({
          single: async () => ({
            data: opts.insertError
              ? null
              : { id: "obs-1", observed_at: payload.observed_at },
            error: opts.insertError ?? null,
          }),
        }),
      };
    },
    then: (resolve: any) => resolve({ data: rows, error }),
  };

  // The library lookup is a separate table with a different terminal call.
  // `wine: null` models "that id is not in the library", which must narrow the
  // query rather than fail the request.
  const library: any = {
    select: () => library,
    eq: () => library,
    maybeSingle: async () => ({
      data: opts.wine === undefined ? defaultWine : opts.wine,
      error: null,
    }),
  };

  const databaseService = {
    supabase: {
      from: (table: string) =>
        table === "master_wine_library" ? library : observations,
    },
  } as any;

  return { svc: new VendorComparisonService(databaseService), calls };
}

const defaultWine = {
  producer: "Domaine Test",
  name: "Chablis 1er Cru",
  vintage: 2019,
};

const WINE_ID = "11111111-2222-3333-4444-555555555555";

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
    const { svc } = makeService([
      row({ vendor_name_raw: "Case Seller", raw_price: 228, pack_size: 12 }),
      row({ vendor_name_raw: "Bottle Seller", raw_price: 21.75, pack_size: 1 }),
    ]);

    const out = await svc.compare({ masterWineId: WINE_ID });

    // $228 / 12 = $19/unit, which beats $21.75 despite the bigger headline.
    expect(out.consensus.bestVendorName).toBe("Case Seller");
    expect(out.consensus.bestPrice).toBeCloseTo(19, 6);
  });

  it("keeps a lost-decimal scrape out of the recommendation", async () => {
    const { svc } = makeService([
      row({ vendor_name_raw: "A", raw_price: 20 }),
      row({ vendor_name_raw: "B", raw_price: 21 }),
      row({ vendor_name_raw: "C", raw_price: 20.5 }),
      // $21.75 scraped as $2175 — the failure this whole pipeline is built for.
      row({ vendor_name_raw: "Bad Parse", raw_price: 2175 }),
    ]);

    const out = await svc.compare({ masterWineId: WINE_ID });

    expect(out.consensus.outlierCount).toBe(1);
    expect(out.consensus.bestVendorName).not.toBe("Bad Parse");
    expect(
      out.consensus.ladder.find((q) => q.vendorName === "Bad Parse")?.isOutlier,
    ).toBe(true);
  });

  it("labels every source so the UI can depict them", async () => {
    const { svc } = makeService([
      row({ source_type: "invoice" }),
      row({ source_type: "quote" }),
      row({ source_type: "website_scrape" }),
    ]);

    const out = await svc.compare({ masterWineId: WINE_ID });

    expect(out.consensus.sourceBreakdown).toEqual({
      invoice: 1,
      quote: 1,
      website_scrape: 1,
    });
  });

  it("returns the 7/30/90 windows", async () => {
    const { svc } = makeService([row()]);
    const out = await svc.compare({ masterWineId: WINE_ID });
    expect(out.trends.map((t) => t.windowDays)).toEqual([7, 30, 90]);
  });

  it("returns an explained empty result when nothing has been observed", async () => {
    const { svc } = makeService([]);
    const out = await svc.compare({ masterWineId: WINE_ID });

    expect(out.consensus.bestPrice).toBeNull();
    expect(out.consensus.ladder).toHaveLength(0);
    expect(out.consensus.notes.join(" ")).toMatch(
      /no usable price observations/i,
    );
  });

  it("throws on a query failure instead of reporting an empty market", async () => {
    // The distributor-search mistake: "no vendor sells this" and "the query
    // broke" must not render identically.
    const { svc } = makeService([], { message: "connection reset" });
    await expect(svc.compare({ masterWineId: WINE_ID })).rejects.toThrow(
      "connection reset",
    );
  });

  it("passes the raw observations through for the audit panel", async () => {
    const { svc } = makeService([row({ raw_price: 20, pack_size: 1 })]);
    const out = await svc.compare({ masterWineId: WINE_ID });

    expect(out.observations).toHaveLength(1);
    expect(out.observations[0]).toMatchObject({
      vendorName: "A Vendor",
      sourceType: "website_scrape",
      rawPrice: 20,
      sourceUrl: "https://example.test/x",
    });
  });

  describe("matching scraped rows to a picked wine", () => {
    it("queries the identity hash as well as the id", async () => {
      // The bug this replaces: a scrape writes signature_hash and no
      // master_wine_id, because it read a name off a page and has no idea
      // which library row that is. Querying only the id returns nothing, and
      // the ladder is empty forever no matter how many scrapes have run.
      const { svc, calls } = makeService([row()]);
      await svc.compare({ masterWineId: WINE_ID });

      expect(calls.or).toHaveLength(1);
      expect(calls.or[0]).toContain(`master_wine_id.eq.${WINE_ID}`);
      expect(calls.or[0]).toMatch(/signature_hash\.eq\.[0-9a-f]{64}/);
    });

    it("falls back to the id alone when the wine is not in the library", async () => {
      const { svc, calls } = makeService([row()], null, { wine: null });
      await svc.compare({ masterWineId: WINE_ID });

      expect(calls.or).toHaveLength(0);
      expect(calls.eq).toContainEqual(["master_wine_id", WINE_ID]);
    });

    it("names the wine from the library, not from a vendor's page", async () => {
      // With no observations the heading has nothing to fall back to, which is
      // exactly when the user most needs to know what they are looking at.
      const { svc } = makeService([]);
      const out = await svc.compare({ masterWineId: WINE_ID });
      expect(out.productName).toBe("Domaine Test Chablis 1er Cru 2019");
    });

    it("reports a bad identifier as the caller's problem, not an outage", async () => {
      // 22P02 is what Postgres returns for a non-uuid. It reached the user as
      // a 500 — an outage message for a typo.
      const { svc } = makeService([], {
        code: "22P02",
        message: 'invalid input syntax for type uuid: "chardonnay"',
      });
      await expect(
        svc.compare({ masterWineId: WINE_ID }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("recordManualObservation", () => {
    const base = {
      masterWineId: WINE_ID,
      price: 240,
      packSize: 12,
      vendorName: "Rep On The Phone",
      restaurantId: "rest-1",
    };

    it("stamps the identity hash so a typed price joins the scraped ladder", async () => {
      const { svc, calls } = makeService([]);
      await svc.recordManualObservation(base);

      const written = calls.inserted[0];
      expect(written.master_wine_id).toBe(WINE_ID);
      expect(written.signature_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("derives trust tier from the source instead of trusting the caller", async () => {
      // A caller that can assert its own tier can rank a guess above an
      // invoice, and the resulting consensus looks exactly as confident.
      const { svc, calls } = makeService([]);
      await svc.recordManualObservation({ ...base, sourceType: "quote" });
      await svc.recordManualObservation({ ...base, sourceType: "social" });

      expect(calls.inserted[0].trust_tier).toBe(2);
      expect(calls.inserted[1].trust_tier).toBe(6);
    });

    it("defaults to the least trusted tier", async () => {
      const { svc, calls } = makeService([]);
      await svc.recordManualObservation(base);
      expect(calls.inserted[0].source_type).toBe("manual");
      expect(calls.inserted[0].trust_tier).toBe(7);
    });

    it("stores null parse confidence, because nothing was parsed", async () => {
      // 1.0 would make a hand-typed number the best-read row in the ladder.
      const { svc, calls } = makeService([]);
      await svc.recordManualObservation(base);
      expect(calls.inserted[0].parse_confidence).toBeNull();
    });

    it("scopes the row to the restaurant that entered it", async () => {
      // A quoted price is a negotiating position, not public market data.
      const { svc, calls } = makeService([]);
      await svc.recordManualObservation(base);
      expect(calls.inserted[0].restaurant_id).toBe("rest-1");
    });

    it("keeps an off-catalogue bottle comparable via the typed name", async () => {
      const { svc, calls } = makeService([]);
      await svc.recordManualObservation({
        price: 30,
        restaurantId: "rest-1",
        productName: "Blanc de Blancs",
        producer: "Schramsberg",
        vintage: 2019,
      });
      expect(calls.inserted[0].master_wine_id).toBeNull();
      expect(calls.inserted[0].signature_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("refuses a price it could never match to anything", async () => {
      const { svc } = makeService([]);
      await expect(
        svc.recordManualObservation({ price: 30, restaurantId: "rest-1" }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects a future observation date", async () => {
      // It would be weighted as maximally recent forever.
      const { svc } = makeService([]);
      await expect(
        svc.recordManualObservation({
          ...base,
          observedAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    describe("the outlier screen, added 2026-09-04", () => {
      // Until this pass, THIS writer was the only one of the three that let
      // `is_outlier` take its column DEFAULT of false — a hand-typed price,
      // trust tier 7, entered the ladder pre-certified as clean while tier-1
      // invoices and tier-4 scrapes both took the test.
      const quoted = (price: number) =>
        row({ source_type: "quote", raw_price: price, pack_size: 1 });

      it("flags a typed price that is deviant against its own class", async () => {
        const { svc, calls } = makeService([
          quoted(20),
          quoted(20.5),
          quoted(19.8),
          quoted(20.2),
        ]);
        await svc.recordManualObservation({
          ...base,
          sourceType: "quote",
          price: 2175,
          packSize: 1,
          unitVolumeMl: 750,
        });

        const w = calls.inserted[0];
        expect(w.is_outlier).toBe(true);
        expect(w.outlier_basis).toBe("write_time");
        expect(typeof w.outlier_judged_at).toBe("string");
        expect(w.outlier_reason).toMatch(/Flagged at write time/);
      });

      it("is never a bound: the number is stored exactly as typed", async () => {
        const { svc, calls } = makeService([
          quoted(20),
          quoted(20.5),
          quoted(19.8),
          quoted(20.2),
        ]);
        const out = await svc.recordManualObservation({
          ...base,
          sourceType: "quote",
          price: 2175,
          packSize: 1,
          unitVolumeMl: 750,
        });

        expect(calls.inserted[0].raw_price).toBe(2175);
        // And the person who typed it is TOLD, rather than finding out later
        // that their price never reached the ladder.
        expect(out.isOutlier).toBe(true);
        expect(out.outlierReason).toMatch(/stays visible/);
      });

      it("clears an ordinary typed price and records that it was judged", async () => {
        const { svc, calls } = makeService([
          quoted(20),
          quoted(20.5),
          quoted(19.8),
          quoted(20.2),
        ]);
        await svc.recordManualObservation({
          ...base,
          sourceType: "quote",
          price: 20.1,
          packSize: 1,
          unitVolumeMl: 750,
        });

        expect(calls.inserted[0].is_outlier).toBe(false);
        expect(calls.inserted[0].outlier_reason).toMatch(
          /Judged clean at write time/,
        );
      });

      it("below the floor it flags nothing AND does not claim the row is clean", async () => {
        const { svc, calls } = makeService([quoted(20), quoted(20.5)]);
        await svc.recordManualObservation({
          ...base,
          sourceType: "quote",
          price: 2175,
          packSize: 1,
          unitVolumeMl: 750,
        });

        expect(calls.inserted[0].is_outlier).toBe(false);
        expect(calls.inserted[0].outlier_reason).toMatch(/^Not judged:/);
        expect(calls.inserted[0].outlier_reason).toContain(
          `floor of ${MIN_OUTLIER_SAMPLE}`,
        );
      });

      it("never lets public-site prices judge a quoted one", async () => {
        // ADR 0117's closing rule. Five scraped list prices near $20 must not
        // make a $95 quote look deviant — they are not the same kind of
        // number. The default `row()` is a website_scrape.
        const { svc, calls } = makeService([row(), row(), row(), row(), row()]);
        await svc.recordManualObservation({
          ...base,
          sourceType: "quote",
          price: 95,
          packSize: 1,
          unitVolumeMl: 750,
        });

        expect(calls.inserted[0].is_outlier).toBe(false);
        expect(calls.inserted[0].outlier_reason).toMatch(/only 0 comparable/);
      });

      it("a register it could not read flags nothing and says so", async () => {
        const { svc, calls } = makeService([], { message: "connection reset" });
        await svc.recordManualObservation({
          ...base,
          sourceType: "quote",
          price: 2175,
        });
        expect(calls.inserted[0].is_outlier).toBe(false);
        expect(calls.inserted[0].outlier_reason).toMatch(/not claimed to be clean/);
      });
    });
  });
});
