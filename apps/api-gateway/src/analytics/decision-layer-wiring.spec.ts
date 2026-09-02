import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";

/**
 * Regression guard — the L5 decision layer is actually CALLED with real inputs.
 *
 * Two defects, both of the same species: a decision module that computed the
 * right thing from the wrong inputs, and said nothing about it.
 *
 *  1. `serviceLevel = 0.95` in `getInventoryScience`. Not a policy — a claim
 *     that Cu/Co = 19 for every SKU on the list simultaneously. It is now the
 *     newsvendor critical ratio Cu/(Cu+Co), per SKU, from that SKU's own menu
 *     price, recorded cost and holding cost.
 *
 *  2. `safetyStock`'s `leadTimeStdev` was optional and NO caller passed it, so
 *     the King formula's d̄²·σ_LT² term was structurally zero everywhere — in
 *     the same service whose vendor scorecard was computing that very standard
 *     deviation and whose payload note claimed it "feeds the King safety-stock
 *     formula".
 *
 * The load-bearing tests here are the two marked THE PROOF: they fail against
 * the pre-fix tree because the pre-fix tree's answer does not move when the
 * inputs move. A test that only checks a number exists cannot tell a wired
 * module from an unwired one.
 */

type Rows = Record<string, any[]>;

function makeClient(rowsByTable: Rows) {
  const passthrough = [
    "select",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "is",
    "or",
    "not",
    "order",
    "limit",
    "in",
  ];
  return {
    from: jest.fn((table: string) => {
      const builder: any = {};
      for (const m of passthrough) builder[m] = jest.fn(() => builder);
      builder.maybeSingle = jest.fn(() =>
        Promise.resolve({ data: null, error: null }),
      );
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(
          resolve,
          reject,
        );
      return builder;
    }),
  };
}

const RESTAURANT = "44444444-4444-4444-4444-444444444444";

const analytics = (rows: Rows) =>
  new AnalyticsService({ getClient: () => makeClient(rows) } as any);

const advanced = (rows: Rows) =>
  new AdvancedAnalyticsService(
    { getClient: () => makeClient(rows) } as any,
    {
      getDemandForecast: async () => ({
        totalForecastDemand: null,
        model: "none",
      }),
    } as any,
    {} as any,
    {} as any,
  );

/** Invoiced cost and a menu price — everything the critical ratio needs. */
const COSTED = {
  id: "inv-costed",
  wine_name: "Invoiced Chablis",
  stock_live: 5,
  menu_price_current: 60,
  last_purchase_price: 20,
  threshold_min: 2,
  master_wine_id: "mw-costed",
};

/** The production shape: a menu price and no recorded cost at all. */
const UNCOSTED = {
  id: "inv-uncosted",
  wine_name: "Uncosted Nebbiolo",
  stock_live: 1,
  menu_price_current: 100,
  last_purchase_price: null,
  threshold_min: 4,
  master_wine_id: "mw-uncosted",
};

const daysAgo = (d: number) =>
  new Date(Date.now() - d * 86400000).toISOString();

/** A dense enough demand series that mean and stdev are both positive. */
function consumption(masterWineId: string, inventoryId: string) {
  return [1, 3, 5, 8, 12, 17, 23, 31, 44, 58].map((d, k) => ({
    inventory_id: inventoryId,
    quantity: (k % 4) + 1,
    created_at: daysAgo(d),
    restaurant_inventory: { master_wine_id: masterWineId },
  }));
}

/**
 * Delivered orders whose order→delivery gaps are exactly `gaps`, so a test can
 * hold the MEAN fixed and move only the variance.
 */
function deliveries(gaps: number[]) {
  return gaps.map((gap, k) => ({
    id: `po-${k}`,
    inventory_id: COSTED.id,
    provider_id: "prov-1",
    status: "DELIVERED",
    created_at: daysAgo(300 - k * 10 + gap),
    delivered_at: daysAgo(300 - k * 10),
    total_cost: 240,
    final_price: 240,
    bottles_total: 12,
    quantity: 1,
    expected_delivery_date: null,
  }));
}

const STEADY = [7, 7, 7, 7, 7, 7];
// Same mean (7), far more spread.
const ERRATIC = [1, 1, 7, 7, 13, 13];

const base = (gaps: number[]): Rows => ({
  restaurant_inventory: [COSTED],
  wine_consumption_log: consumption(COSTED.master_wine_id, COSTED.id),
  procurement_orders: deliveries(gaps),
  inventory_lot_rollup: [],
});

const costedRow = (out: any) =>
  out.skus.find((s: any) => s.id === COSTED.id) as any;

// ---------------------------------------------------------------------------
// The critical ratio replaces the asserted 0.95
// ---------------------------------------------------------------------------

describe("service level is derived, not asserted", () => {
  it("a costed SKU carries its own critical ratio, and it is not 0.95", async () => {
    const out = await analytics(base(STEADY)).getInventoryScience(RESTAURANT);
    const row = costedRow(out);
    expect(row.serviceLevel).not.toBeNull();
    expect(row.serviceLevelBasis).toBe("critical_ratio Cu/(Cu+Co)");
    expect(row.serviceLevel).not.toBeCloseTo(0.95, 3);
    // Cu = 60 - 20 = 40 on a $20 bottle held at 26%/yr: the true ratio is far
    // above 0.95, so the old literal was UNDER-protecting this wine.
    expect(row.serviceLevel).toBeGreaterThan(0.95);
    expect(row.underageCost).toBeCloseTo(40, 6);
    expect(row.overageCost).toBeGreaterThan(0);
    expect(row.serviceLevel).toBeCloseTo(
      row.underageCost / (row.underageCost + row.overageCost),
      12,
    );
  });

  it("params no longer publishes a scalar 0.95 as if a policy chose it", async () => {
    const out = await analytics(base(STEADY)).getInventoryScience(RESTAURANT);
    expect(out.params.serviceLevel).toBeNull();
    expect(out.params.serviceLevelSource).toContain("per-SKU critical ratio");
    expect(out.basis.serviceLevel).toContain("Cu/(Cu+Co)");
    expect(out.serviceLevelCoverage).toEqual({
      total: 1,
      derived: 1,
      stated: 0,
      unavailable: 0,
    });
  });

  it("an uncosted SKU reports null and a reason — it does not borrow 0.95", async () => {
    const rows = base(STEADY);
    rows.restaurant_inventory = [COSTED, UNCOSTED];
    const out = await analytics(rows).getInventoryScience(RESTAURANT);
    const row = out.skus.find((s: any) => s.id === UNCOSTED.id)!;
    expect(row.serviceLevel).toBeNull();
    expect(row.serviceLevelBasis).toContain("unit_cost_unknown");
    expect(row.reorderPoint).toBeNull();
    expect(row.safetyStock).toBeNull();
    // ...but the operator's own recorded trigger still works, so the reorder
    // list does not empty out. stock_live 1 <= threshold_min 4.
    expect(row.needsReorder).toBe(true);
    expect(row.reorderTriggerBasis).toBe("operator_threshold_min");
    expect(out.serviceLevelCoverage.unavailable).toBe(1);
  });

  it("an explicit caller value overrides the maths and says so", async () => {
    const out = await analytics(base(STEADY)).getInventoryScience(RESTAURANT, {
      serviceLevel: 0.8,
    });
    const row = costedRow(out);
    expect(row.serviceLevel).toBe(0.8);
    expect(row.serviceLevelBasis).toBe("caller_specified");
    expect(out.params.serviceLevel).toBe(0.8);
  });

  // THE PROOF (1/2). Against the pre-fix tree every SKU used z(0.95) and this
  // difference is exactly zero.
  it("the wired answer differs from the hardcoded 0.95 answer", async () => {
    const wired = costedRow(
      await analytics(base(STEADY)).getInventoryScience(RESTAURANT),
    );
    const asIfHardcoded = costedRow(
      await analytics(base(STEADY)).getInventoryScience(RESTAURANT, {
        serviceLevel: 0.95,
      }),
    );
    expect(wired.avgDailyDemand).toBeCloseTo(asIfHardcoded.avgDailyDemand, 12);
    expect(wired.safetyStock).not.toBeCloseTo(asIfHardcoded.safetyStock, 6);
    expect(wired.safetyStock).toBeGreaterThan(asIfHardcoded.safetyStock);
    expect(wired.reorderPoint).toBeGreaterThan(asIfHardcoded.reorderPoint);
  });
});

// ---------------------------------------------------------------------------
// Lead-time variance reaches the function that accepts it
// ---------------------------------------------------------------------------

describe("lead-time variance is measured and passed", () => {
  it("mean and stdev come from delivered procurement_orders", async () => {
    const out = await analytics(base(ERRATIC)).getInventoryScience(RESTAURANT);
    expect(out.params.leadTimeObservations).toBe(ERRATIC.length);
    expect(out.params.leadTimeDays).toBeCloseTo(7, 6);
    expect(out.params.leadTimeStdevDays).toBeGreaterThan(0);
    expect(out.basis.leadTimeVariance).toContain("σ_LT");
    expect(costedRow(out).leadTimeVarianceIncluded).toBe(true);
  });

  // THE PROOF (2/2). Same mean lead time, same demand, same costs — only the
  // DISPERSION of the deliveries differs. Against the pre-fix tree σ_LT never
  // reached safetyStock, so these two were byte-identical.
  it("an erratic vendor produces strictly more safety stock than a steady one at the same mean", async () => {
    const steady = costedRow(
      await analytics(base(STEADY)).getInventoryScience(RESTAURANT),
    );
    const erratic = costedRow(
      await analytics(base(ERRATIC)).getInventoryScience(RESTAURANT),
    );
    // Asserted FIRST and on the number, so that against the pre-fix tree this
    // fails as "3.546962914818218 is not greater than 3.546962914818218" —
    // the defect itself — rather than as a missing field.
    expect(erratic.safetyStock).toBeGreaterThan(steady.safetyStock);
    expect(erratic.reorderPoint).toBeGreaterThan(steady.reorderPoint);
    // ...and nothing else moved: same demand, same costs, same service level.
    expect(steady.avgDailyDemand).toBeCloseTo(erratic.avgDailyDemand, 12);
    expect(steady.serviceLevel).toBeCloseTo(erratic.serviceLevel, 12);
  });

  it("one delivery gives a mean but no σ_LT, and the payload says so", async () => {
    const out = await analytics(base([7])).getInventoryScience(RESTAURANT);
    expect(out.params.leadTimeDays).toBeCloseTo(7, 6);
    expect(out.params.leadTimeStdevDays).toBeNull();
    expect(out.basis.leadTimeVariance).toContain("UNMEASURED");
    expect(out.basis.leadTimeVariance).toContain("LOWER BOUND");
    expect(costedRow(out).leadTimeVarianceIncluded).toBe(false);
  });

  it("no deliveries at all: lead time is unknown, not 7", async () => {
    const rows = base(STEADY);
    rows.procurement_orders = [];
    const out = await analytics(rows).getInventoryScience(RESTAURANT);
    expect(out.params.leadTimeDays).toBeNull();
    expect(out.basis.leadTime).toContain("unknown");
    const row = costedRow(out);
    expect(row.reorderPoint).toBeNull();
    expect(row.stockoutProbability).toBeNull();
    // The operator's threshold still drives the trigger.
    expect(row.reorderTriggerBasis).toBe("operator_threshold_min");
  });

  it("an undelivered order contributes no lead time", async () => {
    const rows = base(STEADY);
    rows.procurement_orders = [
      ...deliveries(STEADY),
      {
        id: "po-open",
        inventory_id: COSTED.id,
        status: "IN_TRANSIT",
        created_at: daysAgo(3),
        delivered_at: null,
      },
    ];
    const out = await analytics(rows).getInventoryScience(RESTAURANT);
    expect(out.params.leadTimeObservations).toBe(STEADY.length);
  });
});

// ---------------------------------------------------------------------------
// Constraints the data cannot yet support — refused, not silently rounded
// ---------------------------------------------------------------------------

describe("case pack and shelf life are refusals, not guesses", () => {
  it("orderQuantity is null with a named blocker, and eoq is untouched", async () => {
    const row = costedRow(
      await analytics(base(STEADY)).getInventoryScience(RESTAURANT),
    );
    expect(row.eoq).toBeGreaterThan(0);
    expect(row.orderQuantity).toBeNull();
    expect(row.orderQuantityBlockedBy).toBe("pack_size_unknown");
    expect(row.shelfLifeCappedQuantity).toBeNull();
    expect(row.shelfLifeBlockedBy).toBe("shelf_life_unknown");
  });

  it("the basis explains why, including the DEFAULT 1 NOT NULL trap", async () => {
    const out = await analytics(base(STEADY)).getInventoryScience(RESTAURANT);
    expect(out.basis.orderQuantity).toContain("pack_size");
    expect(out.basis.orderQuantity).toContain("DEFAULT 1 NOT NULL");
    expect(out.basis.shelfLife).toContain("no shelf-life");
  });
});

// ---------------------------------------------------------------------------
// The per-wine endpoint carried the same two literals
// ---------------------------------------------------------------------------

describe("getWine360 no longer asserts 0.95 and 7", () => {
  it("derives the service level and measures the lead time", async () => {
    const out = await advanced(base(ERRATIC)).getWine360(
      RESTAURANT,
      COSTED.master_wine_id,
    );
    expect(out.serviceLevel).not.toBeNull();
    expect(out.serviceLevel).not.toBeCloseTo(0.95, 3);
    expect(out.leadTimeDays).toBeCloseTo(7, 6);
    expect(out.leadTimeStdevDays).toBeGreaterThan(0);
    expect(out.leadTimeVarianceIncluded).toBe(true);
    expect(out.basis.serviceLevel).toContain("Cu/(Cu+Co)");
    expect(out.safetyStock).not.toBeNull();
  });

  it("refuses rather than inventing when the wine has no recorded cost", async () => {
    const rows = base(ERRATIC);
    rows.restaurant_inventory = [UNCOSTED];
    rows.wine_consumption_log = consumption(
      UNCOSTED.master_wine_id,
      UNCOSTED.id,
    );
    const out = await advanced(rows).getWine360(
      RESTAURANT,
      UNCOSTED.master_wine_id,
    );
    expect(out.serviceLevel).toBeNull();
    expect(out.reorderPoint).toBeNull();
    expect(out.safetyStock).toBeNull();
    expect(out.basis.serviceLevel).toContain("unit_cost_unknown");
  });
});

// ---------------------------------------------------------------------------
// The vendor scorecard's σ_LT and the safety-stock σ_LT are one derivation
// ---------------------------------------------------------------------------

describe("scorecard and safety stock quote the same lead time", () => {
  it("agree on mean, stdev and n for the same restaurant", async () => {
    const rows = base(ERRATIC);
    const card = await advanced(rows).getVendorScorecard(RESTAURANT);
    const sci = await analytics(rows).getInventoryScience(RESTAURANT);
    const vendor = card.vendors[0];
    expect(vendor.leadTimeDays.n).toBe(sci.params.leadTimeObservations);
    expect(vendor.leadTimeDays.mean).toBeCloseTo(sci.params.leadTimeDays!, 9);
    expect(vendor.leadTimeDays.stdev).toBeCloseTo(
      sci.params.leadTimeStdevDays!,
      9,
    );
  });

  it("a single delivery reports stdev null on the scorecard too, never 0", async () => {
    const card = await advanced(base([7])).getVendorScorecard(RESTAURANT);
    expect(card.vendors[0].leadTimeDays.stdev).toBeNull();
    expect(card.vendors[0].leadTimeDays.n).toBe(1);
  });
});
