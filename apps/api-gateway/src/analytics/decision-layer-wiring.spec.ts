import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { RecommendationsService } from "./recommendations.service";

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

const recommendations = (rows: Rows) => {
  const db = { getClient: () => makeClient(rows) } as any;
  const analyticsSvc = new AnalyticsService(db);
  return new RecommendationsService(
    analyticsSvc,
    {
      getMenuEngineering: async () => null,
      getSeasonality: async () => null,
      getCashflow: async () => null,
    } as any,
    { generate: async () => ({ insights: [] }) } as any,
    { listGoals: async () => [] } as any,
    {
      getStateMap: async () => new Map(),
      logImpressions: async () => {},
    } as any,
    db,
  );
};

/**
 * `threshold_min` is 5 on every fixture ON PURPOSE.
 *
 * An earlier version of these fixtures used 2 and 4 — values that look like
 * per-wine operator choices, and which made a `threshold_min` reorder
 * fallback look reasonable in the tests while being false in production.
 * 5 is the actual import default (`baseline_from_production.sql:1614`), and
 * production has `count(distinct threshold_min) = 1` in all five tenants
 * (measured 2026-09-02) — the column has never been touched by anyone.
 * A fixture that disagrees with production is how a false claim gets a
 * passing test.
 */
const SYSTEM_DEFAULT_THRESHOLD_MIN = 5;

/** Invoiced cost and a menu price — everything the critical ratio needs. */
const COSTED = {
  id: "inv-costed",
  wine_name: "Invoiced Chablis",
  stock_live: 5,
  menu_price_current: 60,
  last_purchase_price: 20,
  threshold_min: SYSTEM_DEFAULT_THRESHOLD_MIN,
  master_wine_id: "mw-costed",
};

/** The production shape: a menu price and no recorded cost at all. */
const UNCOSTED = {
  id: "inv-uncosted",
  wine_name: "Uncosted Nebbiolo",
  stock_live: 1,
  menu_price_current: 100,
  last_purchase_price: null,
  threshold_min: SYSTEM_DEFAULT_THRESHOLD_MIN,
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
    // And it does NOT fall through to threshold_min. `stock_live` 1 is under
    // the threshold of 5, so a fallback would have fired here and stamped the
    // row `operator_threshold_min` — a provenance claim that is false for
    // every row in production.
    expect(row.needsReorder).toBeNull();
    expect(row.reorderTriggerBasis).toBe("unavailable");
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
    expect(row.reorderTriggerBasis).toBe("unavailable");
    expect(row.needsReorder).toBeNull();
    // And the endpoint says WHICH input is missing, rather than leaving a
    // reader to infer it from a page of nulls.
    expect(out.scienceAvailability.missingInputs).toContain("delivered_orders");
    expect(out.scienceAvailability.computable).toBe(0);
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

  it("reports how much of σ_LT is sampling noise instead of gating on an invented n", async () => {
    const two = await analytics(base([5, 9])).getInventoryScience(RESTAURANT);
    expect(two.params.leadTimeObservations).toBe(2);
    // 1/sqrt(2*(2-1)) = 0.7071 — the σ_LT from two deliveries is ±71%, and
    // the King formula squares it.
    expect(two.params.leadTimeStdevRelativeStandardError).toBeCloseTo(
      0.7071,
      3,
    );
    expect(two.basis.leadTimeVariance).toContain("71%");
    const many = await analytics(
      base([5, 9, 6, 8, 7, 7, 4, 10, 6, 8, 7]),
    ).getInventoryScience(RESTAURANT);
    expect(many.params.leadTimeStdevRelativeStandardError).toBeLessThan(0.25);
  });
});

// ---------------------------------------------------------------------------
// threshold_min is a system default and must never be read as a decision
// ---------------------------------------------------------------------------

describe("threshold_min never becomes a reorder trigger", () => {
  // The production shape, reproduced: no cost, no menu price, no delivered
  // order, no consumption, stock at 0, and a threshold every row shares.
  const productionShape = (): Rows => ({
    restaurant_inventory: [
      {
        ...UNCOSTED,
        id: "p1",
        stock_live: 0,
        menu_price_current: null,
        master_wine_id: "mw-p1",
      },
      {
        ...UNCOSTED,
        id: "p2",
        stock_live: 0,
        menu_price_current: null,
        master_wine_id: "mw-p2",
      },
    ],
    wine_consumption_log: [],
    procurement_orders: [],
    inventory_lot_rollup: [],
  });

  it("does not turn the whole cellar into a reorder list", async () => {
    const out =
      await analytics(productionShape()).getInventoryScience(RESTAURANT);
    // Every row is at or below its threshold (0 <= 5). A threshold fallback
    // would return reorderCount === skuCount here, each row claiming an
    // operator set that trigger.
    expect(out.skuCount).toBe(2);
    expect(out.reorderCount).toBe(0);
    expect(out.reorderList).toHaveLength(0);
    for (const s of out.skus as any[]) {
      expect(s.needsReorder).toBeNull();
      expect(s.reorderTriggerBasis).toBe("unavailable");
    }
  });

  it("no row anywhere claims operator provenance for a trigger", async () => {
    const out =
      await analytics(productionShape()).getInventoryScience(RESTAURANT);
    const bases = (out.skus as any[]).map((s) => s.reorderTriggerBasis);
    expect(bases).not.toContain("operator_threshold_min");
    expect(JSON.stringify(out)).not.toContain("operator_threshold_min");
  });

  it("still reports the recorded value, labelled as the default it is", async () => {
    const out =
      await analytics(productionShape()).getInventoryScience(RESTAURANT);
    expect((out.skus[0] as any).thresholdMin).toBe(
      SYSTEM_DEFAULT_THRESHOLD_MIN,
    );
    expect(out.basis.reorderTrigger).toContain("DEFAULT 3 NOT NULL");
    expect(out.basis.reorderTrigger).toContain("not an operator decision");
  });

  it("names all three missing inputs, so an empty list is not read as health", async () => {
    const out =
      await analytics(productionShape()).getInventoryScience(RESTAURANT);
    expect(out.scienceAvailability.missingInputs.sort()).toEqual([
      "consumption",
      "cost_and_price",
      "delivered_orders",
    ]);
    expect(out.scienceAvailability.computable).toBe(0);
    expect(out.scienceAvailability.note).toContain("NOT MEASURED");
  });
});

// ---------------------------------------------------------------------------
// The below-0.5 regime the hardcoded 0.95 made unreachable
// ---------------------------------------------------------------------------

describe("a critical ratio under 0.5 is surfaced, not silently dropped", () => {
  // Thin margin ($22 menu on a $20 bottle) and slow movement, so the cost of
  // holding a spare exceeds the margin lost on a miss: Cu < Co, CR < 0.5,
  // z < 0, and safety stock goes negative.
  const thinMargin = (): Rows => ({
    restaurant_inventory: [
      {
        ...COSTED,
        menu_price_current: 22,
        last_purchase_price: 20,
        stock_live: 3,
      },
    ],
    wine_consumption_log: [
      {
        inventory_id: COSTED.id,
        quantity: 1,
        created_at: daysAgo(40),
        restaurant_inventory: { master_wine_id: COSTED.master_wine_id },
      },
    ],
    procurement_orders: deliveries(ERRATIC),
    inventory_lot_rollup: [],
  });

  it("flags understockOptimal rather than vanishing from the list", async () => {
    const row = costedRow(
      await analytics(thinMargin()).getInventoryScience(RESTAURANT),
    );
    expect(row.serviceLevel).toBeLessThan(0.5);
    expect(row.serviceLevelZ).toBeLessThan(0);
    expect(row.safetyStock).toBeLessThan(0);
    // It is NOT on the reorder list — correctly, because the model says hold
    // less than lead-time demand. The defect would be arriving there with no
    // way to tell this from a healthy well-stocked row.
    expect(row.needsReorder).toBe(false);
    expect(row.reorderTriggerBasis).toBe(
      "king_reorder_point_understock_optimal",
    );
    expect(row.understockOptimal).toBe(true);
  });

  it("an explicit caller service level below 0.5 is flagged the same way", async () => {
    const row = costedRow(
      await analytics(base(ERRATIC)).getInventoryScience(RESTAURANT, {
        serviceLevel: 0.4,
      }),
    );
    expect(row.understockOptimal).toBe(true);
    expect(row.serviceLevelZ).toBeLessThan(0);
  });

  it("the basis explains the regime before a reader meets a negative number", async () => {
    const out = await analytics(thinMargin()).getInventoryScience(RESTAURANT);
    expect(out.basis.reorderScience).toContain("NEGATIVE");
    expect(out.basis.reorderScience).toContain("understockOptimal");
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
    expect(out.basis.orderQuantity).toContain("DEFAULT 1 NOT NULL");
    expect(out.basis.shelfLife).toContain("no shelf-life");
    // All three tables, named. `vendor_price_list_items` does not exist and
    // an earlier version of this basis cited it.
    for (const table of [
      "vendor_price_observations",
      "vendor_portal_listings",
      "procurement_document_lines",
    ]) {
      expect(out.basis.orderQuantity).toContain(table);
    }
    expect(out.basis.orderQuantity).not.toContain("vendor_price_list_items");
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

// ---------------------------------------------------------------------------
// The recommendation that drafts a PO, and the one that says why it cannot
// ---------------------------------------------------------------------------

describe("a capability that switches off says so", () => {
  const keysOf = (out: any) => out.recommendations.map((r: any) => r.ruleKey);

  const productionShape = (): Rows => ({
    restaurant_inventory: [
      { ...UNCOSTED, stock_live: 0, menu_price_current: null },
    ],
    wine_consumption_log: [],
    procurement_orders: [],
    inventory_lot_rollup: [],
  });

  it("stockout_imminent cannot fire without a measured lead time", async () => {
    const out =
      await recommendations(productionShape()).getRecommendations(RESTAURANT);
    // Correct: its stockout probability is null, not low. On `main` this fired
    // off a lead time that defaulted to 7 with nothing behind it.
    expect(keysOf(out)).not.toContain("stockout_imminent");
  });

  it("...and the absence gets its own card naming the missing inputs", async () => {
    const out =
      await recommendations(productionShape()).getRecommendations(RESTAURANT);
    // `stockout_imminent` is the ONLY rule mapped to "Draft PO"
    // (apps/web/src/pages/Recommendations.tsx:113). Without this card the
    // action just disappears from the page with nothing explaining it.
    expect(keysOf(out)).toContain("reorder_science_unavailable");
    const card = out.recommendations.find(
      (r: any) => r.ruleKey === "reorder_science_unavailable",
    )!;
    expect(card.category).toBe("inventory");
    expect(card.observation).toContain("recorded cost");
    expect(card.observation).toContain("delivered");
    expect(card.rationale).toContain("NOT MEASURED");
  });

  it("no card ever prints a 0.0-day replenishment or a 0-bottle reorder point", async () => {
    const out =
      await recommendations(productionShape()).getRecommendations(RESTAURANT);
    const text = JSON.stringify(out.recommendations);
    expect(text).not.toContain("0.0-day");
    expect(text).not.toContain("reorder point is 0 bottles");
  });

  it("the unavailable card stands down once the science can be computed", async () => {
    const out = await recommendations(base(ERRATIC)).getRecommendations(
      RESTAURANT,
    );
    expect(keysOf(out)).not.toContain("reorder_science_unavailable");
  });
});
