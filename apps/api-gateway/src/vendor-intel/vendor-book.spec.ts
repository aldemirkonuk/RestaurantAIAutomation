import { vendorPriceConsensus } from "../analytics/engine/vendor-price-consensus";
import { VendorComparisonService } from "./vendor-comparison.service";

/**
 * The /vendor-prices rebuild (2026-09-11) asked the register for three things
 * it did not return: the row behind each rung of the ladder, the provenance a
 * reader needs to open the thing a price was read from, and a way in that
 * starts from a VENDOR rather than a bottle. Each is asserted here, plus the
 * two write-side honesty fixes that came with them — a typed price keeps the
 * currency it was quoted in, and the name of the person who typed it.
 *
 * The PostgREST builder is thenable, so the fake below returns itself from
 * every filter and resolves only when awaited — the same shape the sibling
 * spec models, with `.ilike()` added because the vendor's book keys on a name
 * when it has no provider id.
 */

interface Calls {
  select: string[];
  eq: Array<[string, any]>;
  ilike: Array<[string, any]>;
  or: string[];
  limit: number[];
  inserted: any[];
}

function makeService(rows: any[], error: any = null) {
  const calls: Calls = { select: [], eq: [], ilike: [], or: [], limit: [], inserted: [] };
  const observations: any = {
    select: (cols: string) => {
      calls.select.push(cols);
      return observations;
    },
    gte: () => observations,
    order: () => observations,
    limit: (n: number) => {
      calls.limit.push(n);
      return observations;
    },
    eq: (col: string, val: any) => {
      calls.eq.push([col, val]);
      return observations;
    },
    ilike: (col: string, val: any) => {
      calls.ilike.push([col, val]);
      return observations;
    },
    or: (clause: string) => {
      calls.or.push(clause);
      return observations;
    },
    is: () => observations,
    insert: (payload: any) => {
      calls.inserted.push(payload);
      return {
        select: () => ({
          single: async () => ({
            data: { id: "obs-new", observed_at: payload.observed_at },
            error: null,
          }),
        }),
      };
    },
    then: (resolve: any) => resolve({ data: rows, error }),
  };
  const library: any = {
    select: () => library,
    eq: () => library,
    maybeSingle: async () => ({
      data: { producer: "Domaine Test", name: "Chablis 1er Cru", vintage: 2019 },
      error: null,
    }),
  };
  const databaseService = {
    supabase: {
      from: (table: string) => (table === "master_wine_library" ? library : observations),
    },
  } as any;
  return { svc: new VendorComparisonService(databaseService), calls };
}

const HOUSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROVIDER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const WINE_ID = "11111111-2222-3333-4444-555555555555";

const row = (over: Record<string, any> = {}) => ({
  id: "row-1",
  restaurant_id: HOUSE,
  provider_id: PROVIDER,
  vendor_catalogue_id: null,
  vendor_name_raw: "Kavaklidere",
  product_name_raw: "Chablis 1er Cru",
  master_wine_id: WINE_ID,
  identity_id: null,
  source_type: "invoice",
  trust_tier: 1,
  source_ref: "receipt_verified:order-9",
  source_url: null,
  raw_price: 240,
  currency: "TRY",
  pack_size: 12,
  unit_volume_ml: 750,
  yield_factor: 1,
  parse_confidence: null,
  observed_at: "2026-09-01T10:00:00.000Z",
  effective_date: "2026-09-01",
  is_outlier: false,
  outlier_reason: "Judged clean at write time against 4 earlier sighting(s).",
  outlier_basis: "write_time",
  outlier_judged_at: "2026-09-01T10:00:01.000Z",
  raw: { origin: "own_paper", orderId: "order-9", statedUnit: "case" },
  ...over,
});

describe("the ladder names the row behind each rung", () => {
  it("carries the observation id through the engine unchanged", () => {
    const r = vendorPriceConsensus([
      { id: "a", price: 20, sourceType: "invoice", observedAt: new Date() },
      { id: "b", price: 30, sourceType: "quote", observedAt: new Date() },
      { price: 25, sourceType: "manual", observedAt: new Date() },
    ]);
    expect(r.ladder.map((q) => q.id)).toEqual(["a", null, "b"]);
  });

  it("returns each observation with its provenance and which side of the boundary it sits on", async () => {
    const { svc, calls } = makeService([
      row(),
      row({ id: "row-2", restaurant_id: null, source_type: "website_scrape", trust_tier: 4, source_ref: "https://v.test/p#Chablis", source_url: "https://v.test/p", raw: {} }),
    ]);
    const out = await svc.compare({ masterWineId: WINE_ID, restaurantId: HOUSE });

    expect(out.consensus.ladder.map((q) => q.id).sort()).toEqual(["row-1", "row-2"]);
    const [own, market] = out.observations;
    expect(own).toMatchObject({
      id: "row-1",
      scope: "house",
      sourceType: "invoice",
      trustTier: 1,
      sourceRef: "receipt_verified:order-9",
      currency: "TRY",
      packSize: 12,
      isOutlier: false,
      outlierBasis: "write_time",
      raw: { orderId: "order-9", statedUnit: "case" },
    });
    expect(market.scope).toBe("market");
    expect(market.sourceUrl).toBe("https://v.test/p");
    // The read named every column the page prints — id, verdict, raw — and
    // never `restaurant_id` on the wire: `scope` is the word, not the key.
    expect(calls.select[0]).toMatch(/\bid\b/);
    expect(calls.select[0]).toMatch(/outlier_reason/);
    expect(calls.select[0]).toMatch(/\braw\b/);
    expect(own).not.toHaveProperty("restaurantId");
  });

  it("prints a never-judged row as never judged, not as clean", async () => {
    const { svc } = makeService([row({ outlier_reason: null, outlier_basis: null, outlier_judged_at: null })]);
    const out = await svc.compare({ masterWineId: WINE_ID, restaurantId: HOUSE });
    expect(out.observations[0].outlierReason).toBeNull();
    expect(out.observations[0].isOutlier).toBe(false);
  });
});

describe("a vendor's book", () => {
  it("keys on the provider id when it has one, under the house-and-market boundary", async () => {
    const { svc, calls } = makeService([row()]);
    const book = await svc.vendorBook({ restaurantId: HOUSE, providerId: PROVIDER });

    expect(calls.eq).toContainEqual(["provider_id", PROVIDER]);
    expect(calls.ilike).toEqual([]);
    expect(calls.or.some((c) => c.includes(`restaurant_id.eq.${HOUSE}`))).toBe(true);
    expect(calls.or.some((c) => c.includes("restaurant_id.is.null"))).toBe(true);
    expect(book.items).toHaveLength(1);
    expect(book.count).toBe(1);
    expect(book.complete).toBe(true);
    expect(book.scope).toMatch(/no other house/);
  });

  it("keys on the typed vendor name when no provider row exists", async () => {
    const { svc, calls } = makeService([row({ provider_id: null })]);
    await svc.vendorBook({ restaurantId: HOUSE, vendorName: "Kavaklidere" });
    expect(calls.ilike).toEqual([["vendor_name_raw", "Kavaklidere"]]);
    expect(calls.eq.some(([c]) => c === "provider_id")).toBe(false);
  });

  it("refuses a read that names no vendor at all", async () => {
    const { svc } = makeService([]);
    await expect(svc.vendorBook({ restaurantId: HOUSE })).rejects.toThrow(/Name the vendor/);
  });

  it("reports a full page as a floor, never as a total", async () => {
    const two = [row(), row({ id: "row-2" })];
    const { svc, calls } = makeService(two);
    const book = await svc.vendorBook({ restaurantId: HOUSE, providerId: PROVIDER, limit: 2 });
    expect(calls.limit).toEqual([2]);
    expect(book.limit).toBe(2);
    expect(book.complete).toBe(false);
    expect(book.count).toBe(2);
  });

  it("throws with the reason when the register cannot be read — an empty book is a different sentence", async () => {
    const { svc } = makeService([], { message: "connection reset" });
    await expect(
      svc.vendorBook({ restaurantId: HOUSE, providerId: PROVIDER }),
    ).rejects.toThrow(/connection reset/);
  });
});

describe("a typed price keeps its currency and its author", () => {
  it("stores the currency the caller stated, upper-cased", async () => {
    const { svc, calls } = makeService([]);
    await svc.recordManualObservation({
      masterWineId: WINE_ID,
      price: 900,
      currency: "try",
      restaurantId: HOUSE,
      userId: "u1",
      enteredByLabel: "Aylin",
    });
    expect(calls.inserted[0].currency).toBe("TRY");
    expect(calls.inserted[0].raw.enteredByLabel).toBe("Aylin");
    expect(calls.inserted[0].raw.enteredBy).toBe("u1");
  });

  it("falls back to USD only when nothing was said, and keeps a blank label as null", async () => {
    const { svc, calls } = makeService([]);
    await svc.recordManualObservation({
      masterWineId: WINE_ID,
      price: 30,
      restaurantId: HOUSE,
      enteredByLabel: "   ",
    });
    expect(calls.inserted[0].currency).toBe("USD");
    expect(calls.inserted[0].raw.enteredByLabel).toBeNull();
  });
});
