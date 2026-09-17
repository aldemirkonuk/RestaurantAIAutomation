import { NOT_CONTRIBUTED_ONLY } from "../price-register/visibility";
import { ObservationRow, priceBelowAverage } from "./price-below-average";
import { VendorComparisonService } from "./vendor-comparison.service";

/**
 * The market-price box's arithmetic, and the one decision the service makes
 * around it: that a failed sweep is not an empty market.
 *
 * These tests are written so that removing the honesty rules breaks them —
 * a mean that swallows its own latest value, a two-point "average", a
 * currency conversion nobody recorded, or a query error rendered as "nothing
 * is cheap" each fails a named case below.
 */

const DAY = 86_400_000;

function obs(
  daysAgo: number,
  price: number,
  extra: Partial<ObservationRow> = {},
): ObservationRow {
  return {
    master_wine_id: "11111111-1111-1111-1111-111111111111",
    signature_hash: null,
    product_name_raw: "Bodega Álvaro Rioja Reserva 2019",
    vendor_name_raw: "Terra Nostra",
    provider_id: null,
    source_type: "quote",
    observed_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
    raw_price: price,
    currency: "EUR",
    pack_size: 1,
    unit_volume_ml: 750,
    yield_factor: 1,
    ...extra,
  };
}

describe("priceBelowAverage", () => {
  it("compares the newest sighting against the mean of the EARLIER ones", () => {
    // 20, 20, 20 earlier; 16 now. Mean of the earlier three is 20, so the
    // drop is 4 (20%). If the latest were folded into its own average the
    // mean would be 19 and the drop 15.8% — the number this test pins.
    const rows = [obs(20, 20), obs(14, 20), obs(7, 20), obs(1, 16)];
    const out = priceBelowAverage(rows);

    expect(out.averageExcludesLatest).toBe(true);
    expect(out.items).toHaveLength(1);
    const item = out.items[0];
    expect(item.average.unitPrice).toBeCloseTo(20, 6);
    expect(item.average.observations).toBe(3);
    expect(item.latest.unitPrice).toBeCloseTo(16, 6);
    expect(item.absoluteBelow).toBeCloseTo(4, 6);
    expect(item.fractionBelow).toBeCloseTo(0.2, 6);
  });

  it("refuses to call two sightings an average", () => {
    const out = priceBelowAverage([obs(9, 20), obs(3, 20), obs(1, 10)], {
      minObservations: 3,
    });
    expect(out.items).toEqual([]);
    expect(out.skipped.thinHistory).toBe(1);
    // The reader is still told what was looked at, so an empty box can be read.
    // `comparisons` added 2026-09-04 with the class gate: one product, one
    // class, so the two agree here. They diverge only when a product carries
    // sightings of more than one class.
    expect(out.scanned).toEqual({
      observations: 3,
      products: 1,
      comparisons: 1,
    });
  });

  it("drops a group whose window mixes currencies rather than converting", () => {
    const rows = [
      obs(20, 20),
      obs(14, 20),
      obs(7, 20),
      obs(1, 12, { currency: "USD" }),
    ];
    const out = priceBelowAverage(rows);
    expect(out.items).toEqual([]);
    expect(out.skipped.mixedCurrency).toBe(1);
  });

  it("normalises pack size and volume before comparing, and drops what it cannot", () => {
    // A case of twelve 375ml half-bottles at 96.00 is 8.00 a bottle, which is
    // 16.00 per 750ml reference — the same unit as the singles above.
    const rows = [
      obs(20, 20),
      obs(14, 20),
      obs(7, 20),
      obs(1, 96, { pack_size: 12, unit_volume_ml: 375 }),
    ];
    const out = priceBelowAverage(rows);
    expect(out.items[0].latest.unitPrice).toBeCloseTo(16, 6);

    const broken = priceBelowAverage([
      obs(20, 20),
      obs(14, 20),
      obs(7, 20),
      obs(1, 10, { pack_size: 0 }),
    ]);
    expect(broken.skipped.unnormalisable).toBe(1);
  });

  it("will not group sightings that carry no identity at all", () => {
    const out = priceBelowAverage([
      obs(3, 20, { master_wine_id: null, signature_hash: null }),
      obs(1, 10, { master_wine_id: null, signature_hash: null }),
    ]);
    expect(out.skipped.noProductKey).toBe(2);
    expect(out.scanned.products).toBe(0);
  });

  it("ignores a drop too small to be news, and counts it", () => {
    const out = priceBelowAverage([
      obs(20, 20),
      obs(14, 20),
      obs(7, 20),
      obs(1, 19.9),
    ]);
    expect(out.items).toEqual([]);
    expect(out.skipped.notBelow).toBe(1);
  });

  it("ranks the deepest discount first and honours the limit", () => {
    const other = (daysAgo: number, price: number): ObservationRow =>
      obs(daysAgo, price, {
        master_wine_id: "22222222-2222-2222-2222-222222222222",
        product_name_raw: "Chablis 1er Cru Montmains",
      });
    const out = priceBelowAverage(
      [
        obs(20, 20),
        obs(14, 20),
        obs(7, 20),
        obs(1, 18), // 10% below
        other(20, 30),
        other(14, 30),
        other(7, 30),
        other(1, 21), // 30% below
      ],
      { limit: 1 },
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0].productName).toBe("Chablis 1er Cru Montmains");
    expect(out.scanned.products).toBe(2);
  });

  it("reports an empty register as empty rather than as nothing being cheap", () => {
    const out = priceBelowAverage([]);
    expect(out.items).toEqual([]);
    expect(out.scanned).toEqual({
      observations: 0,
      products: 0,
      comparisons: 0,
    });
  });
});

describe("VendorComparisonService.belowTrailingAverage", () => {
  function makeService(rows: any[] | null, error: any = null) {
    const calls: { or: string[]; eq: Array<[string, any]> } = {
      or: [],
      eq: [],
    };
    const q: any = {
      select: () => q,
      gte: () => q,
      order: () => q,
      limit: () => q,
      eq: (c: string, v: any) => {
        calls.eq.push([c, v]);
        return q;
      },
      or: (clause: string) => {
        calls.or.push(clause);
        return q;
      },
      then: (resolve: any) => resolve({ data: rows, error }),
    };
    const db: any = { supabase: { from: () => q } };
    return { service: new VendorComparisonService(db), calls };
  }

  it("reads market rows and this tenant's own, and no other tenant's", async () => {
    const { service, calls } = makeService([]);
    await service.belowTrailingAverage({ restaurantId: "rest-1" });
    // Both clauses, in this order, and nothing else. The scope now comes from
    // `scopePriceRegisterRead` (ADR 0117 addendum) rather than being spelled
    // here, and the third visibility state is excluded FIRST -- before any
    // scope has had a chance to widen the read.
    expect(calls.or).toEqual([
      NOT_CONTRIBUTED_ONLY,
      "restaurant_id.is.null,restaurant_id.eq.rest-1",
    ]);
    // Outlier-ness is the consensus pass's verdict; this sweep obeys it.
    expect(calls.eq).toContainEqual(["is_outlier", false]);
  });

  it("never returns a row contributed under a floor, whoever it belongs to", async () => {
    // The state has no row in it and no read may return one (ADR 0117
    // addendum). Asserted on the PREDICATE rather than on rows, because a
    // fixture with no contributed row would pass whether or not the clause
    // was applied.
    const { service, calls } = makeService([]);
    await service.belowTrailingAverage({ restaurantId: "rest-1" });
    expect(calls.or[0]).toBe(NOT_CONTRIBUTED_ONLY);
    expect(NOT_CONTRIBUTED_ONLY).toContain("visibility.neq.contributed_aggregate_only");
  });

  it("throws when the register cannot be read, instead of returning an empty box", async () => {
    const { service } = makeService(null, { message: "connection reset" });
    await expect(
      service.belowTrailingAverage({ restaurantId: "rest-1" }),
    ).rejects.toThrow(/Could not read the price register/);
  });

  it("states the window it swept alongside the answer", async () => {
    const { service } = makeService([]);
    const out = await service.belowTrailingAverage({
      restaurantId: "rest-1",
      windowDays: 30,
    });
    expect(out.window.days).toBe(30);
    expect(new Date(out.window.from).getTime()).toBeLessThan(Date.now());
    expect(out.scanned.observations).toBe(0);
  });
});
