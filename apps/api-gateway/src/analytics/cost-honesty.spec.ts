import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { resolveUnitCost, summarizeCostBasis } from "./inventory-cost";

/**
 * Regression guard — analytics never invents what a bottle cost.
 *
 * Both services resolved unit cost as
 *
 *     lot?.has_invoice_cost && lot?.wac
 *       ? lot.wac
 *       : Number(i.last_purchase_price) || (unitPrice ? unitPrice * 0.6 : 0);
 *
 * `0.6` appeared in no ADR, comment or doc. `last_purchase_price` has no write
 * site anywhere in the repo and is NULL on all 72 production inventory rows,
 * and `inventory_lots` holds 2 rows — so the measured branch covered ~2 rows
 * and the invented one covered ~70. Two endpoints then labelled the result
 * `"WAC (lot rollup)"` in their `basis` strings, which is the failure mode
 * ADR 0051 calls worst: a confident lie that survives review.
 *
 * Every test below fails against the pre-fix tree. The load-bearing ones are
 * the `basis` assertions — a number can be argued about, a label that names a
 * source the value did not come from cannot.
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

const RESTAURANT = "33333333-3333-3333-3333-333333333333";
const recently = new Date(Date.now() - 3 * 86400000).toISOString();

/** The production shape: a menu price, and no recorded cost of any kind. */
const UNPRICED = {
  id: "inv-unpriced",
  wine_name: "Uncosted Nebbiolo",
  stock_live: 10,
  menu_price_current: 100,
  last_purchase_price: null,
  threshold_min: 2,
  master_wine_id: "mw-unpriced",
};

/** A row whose cost really was recorded. */
const RECORDED = {
  id: "inv-recorded",
  wine_name: "Invoiced Chablis",
  stock_live: 5,
  menu_price_current: 60,
  last_purchase_price: 20,
  threshold_min: 2,
  master_wine_id: "mw-recorded",
};

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

// ---------------------------------------------------------------------------
// resolveUnitCost — the single decision point
// ---------------------------------------------------------------------------

describe("resolveUnitCost never invents a number", () => {
  it("returns null, not 0.6 × menu price, when nothing recorded a cost", () => {
    expect(resolveUnitCost({ last_purchase_price: null }, null)).toEqual({
      unitCost: null,
      costBasis: "unknown",
    });
  });

  it("returns null rather than 0 — an unknown cost is not a free bottle", () => {
    const { unitCost } = resolveUnitCost({}, undefined);
    expect(unitCost).toBeNull();
    expect(unitCost).not.toBe(0);
  });

  it("keeps the real path: an invoiced lot WAC wins over everything", () => {
    expect(
      resolveUnitCost(
        { last_purchase_price: 20 },
        { has_invoice_cost: true, wac: 31.5 },
      ),
    ).toEqual({ unitCost: 31.5, costBasis: "invoice_lot_wac" });
  });

  it("reads a recorded last_purchase_price when there is no invoiced lot", () => {
    expect(resolveUnitCost({ last_purchase_price: "18.25" }, null)).toEqual({
      unitCost: 18.25,
      costBasis: "last_purchase_price",
    });
  });

  it("treats an invoiced WAC of 0 as measured — that is how samples are recorded", () => {
    // inventory.service.ts records sample bottles as unitCost 0 / provenance
    // "sample". The old expression read that 0 as falsy and fabricated a cost
    // for a bottle that provably cost nothing.
    expect(
      resolveUnitCost(
        { last_purchase_price: null },
        { has_invoice_cost: true, wac: 0 },
      ),
    ).toEqual({ unitCost: 0, costBasis: "invoice_lot_wac" });
  });

  it("does not treat has_invoice_cost with a null wac as a measurement", () => {
    expect(
      resolveUnitCost({}, { has_invoice_cost: true, wac: null }).costBasis,
    ).toBe("unknown");
  });

  it("reports coverage instead of hiding the gap", () => {
    const cov = summarizeCostBasis([
      { unitCost: 12, costBasis: "invoice_lot_wac" },
      { unitCost: null, costBasis: "unknown" },
      { unitCost: null, costBasis: "unknown" },
    ]);
    expect(cov).toMatchObject({
      total: 3,
      priced: 1,
      unpriced: 2,
      complete: false,
    });
    expect(cov.byBasis.unknown).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getFinancialSummary
// ---------------------------------------------------------------------------

describe("getFinancialSummary tells the truth about an uncosted cellar", () => {
  const build = (inventoryRows: any[]) =>
    analytics({
      restaurant_inventory: inventoryRows,
      wine_consumption_log: [
        {
          inventory_id: RECORDED.id,
          quantity: 3,
          created_at: recently,
          restaurant_inventory: { master_wine_id: RECORDED.master_wine_id },
        },
      ],
    });

  it("nulls every cost-derived field when an on-hand row has no cost", async () => {
    const out = await build([UNPRICED, RECORDED]).getFinancialSummary(
      RESTAURANT,
    );

    expect(out.inventoryValue).toBeNull();
    expect(out.grossMarginDollars).toBeNull();
    expect(out.grossMargin).toBeNull();
    expect(out.cogsRatio).toBeNull();
    expect(out.primeCostRatio).toBeNull();
    expect(out.inventoryTurnover).toBeNull();
    expect(out.daysInventoryOutstanding).toBeNull();
    expect(out.gmroi).toBeNull();
  });

  it("does not let the null become a zero anywhere in the payload", async () => {
    const out = await build([UNPRICED, RECORDED]).getFinancialSummary(
      RESTAURANT,
    );
    // The pre-fix payload reported a fabricated $600 + $100 valuation here.
    for (const field of [
      "inventoryValue",
      "grossMarginDollars",
      "inventoryTurnover",
      "gmroi",
    ] as const) {
      expect(out[field]).not.toBe(0);
      expect(out[field]).toBeNull();
    }
  });

  it("keeps revenue and COGS, which do not depend on unit cost", async () => {
    const out = await build([UNPRICED, RECORDED]).getFinancialSummary(
      RESTAURANT,
    );
    // 10 × 100 + 5 × 60 — menu price is recorded for both rows.
    expect(out.revenue).toBe(1300);
    expect(out.cogs).toBe(0);
  });

  it("stops the basis claiming WAC for a value that never touched WAC", async () => {
    const out = await build([UNPRICED, RECORDED]).getFinancialSummary(
      RESTAURANT,
    );
    expect(out.basis.inventoryValue).not.toBe("on-hand qty × WAC (lot rollup)");
    expect(out.basis.inventoryValue).toContain("no recorded cost");
    expect(out.basis.inventoryValue).toContain("1 of 2");
  });

  it("names the size of the gap so a page can say it out loud", async () => {
    const out = await build([UNPRICED, RECORDED]).getFinancialSummary(
      RESTAURANT,
    );
    expect(out.costCoverage).toMatchObject({
      total: 2,
      priced: 1,
      unpriced: 1,
      complete: false,
    });
  });

  it("still reports real numbers when every on-hand row is costed", async () => {
    const out = await build([RECORDED]).getFinancialSummary(RESTAURANT);
    expect(out.inventoryValue).toBe(100); // 5 × 20
    expect(out.costCoverage.complete).toBe(true);
    expect(out.basis.inventoryValue).toContain(
      "every row in scope has a recorded cost",
    );
  });

  it("does not let a zero-quantity uncosted row block the valuation", async () => {
    // A row holding no bottles contributes 0 whatever it cost — that is a
    // knowable zero, and blocking on it would be false modesty.
    const out = await build([
      RECORDED,
      { ...UNPRICED, stock_live: 0 },
    ]).getFinancialSummary(RESTAURANT);
    expect(out.inventoryValue).toBe(100);
  });

  it("withholds deadStockCapital when an idle row has no recorded cost", async () => {
    const out = await build([UNPRICED, RECORDED]).getFinancialSummary(
      RESTAURANT,
    );
    // UNPRICED never moved, so it IS dead stock — we simply cannot price it.
    expect(out.deadStockTop.map((d: any) => d.name)).toEqual([
      "Uncosted Nebbiolo",
    ]);
    expect(out.deadStockTop[0].value).toBeNull();
    expect(out.deadStockCapital).toBeNull();
    // recommendations.service.ts gates the "discount these to cost" advice on
    // `(deadStockCapital ?? 0) > 0`, so a null must withhold it.
    expect((out.deadStockCapital ?? 0) > 0).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getInventoryScience
// ---------------------------------------------------------------------------

describe("getInventoryScience", () => {
  const build = () =>
    analytics({
      restaurant_inventory: [UNPRICED, RECORDED],
      wine_consumption_log: [
        {
          inventory_id: RECORDED.id,
          quantity: 2,
          created_at: recently,
          restaurant_inventory: { master_wine_id: RECORDED.master_wine_id },
        },
      ],
    });

  it("nulls per-SKU value, cost and EOQ for an uncosted row", async () => {
    const out = await build().getInventoryScience(RESTAURANT);
    const row = out.skus.find((s: any) => s.id === UNPRICED.id)!;
    expect(row.inventoryValue).toBeNull();
    expect(row.unitCost).toBeNull();
    expect(row.eoq).toBeNull();
    expect(row.costBasis).toBe("unknown");
  });

  it("keeps the demand science, which owes nothing to cost", async () => {
    const out = await build().getInventoryScience(RESTAURANT);
    const row = out.skus.find((s: any) => s.id === UNPRICED.id)!;
    expect(row.onHand).toBe(10);
    expect(row.xyzClass).not.toBeUndefined();
  });

  it("withholds abcClass entirely — a Pareto needs a known total", async () => {
    const out = await build().getInventoryScience(RESTAURANT);
    expect(out.skus.every((s: any) => s.abcClass === null)).toBe(true);
  });

  it("classifies again once every on-hand row is costed", async () => {
    const svc = analytics({
      restaurant_inventory: [RECORDED],
      wine_consumption_log: [],
    });
    const out = await svc.getInventoryScience(RESTAURANT);
    expect(out.skus.every((s: any) => s.abcClass !== null)).toBe(true);
    expect(out.skus[0].inventoryValue).toBe(100);
  });

  it("carries a basis at all — it previously had none", async () => {
    const out = await build().getInventoryScience(RESTAURANT);
    expect(out.basis).toBeDefined();
    expect(out.basis.inventoryValue).toContain("no recorded cost");
    expect(out.costCoverage.unpriced).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getMenuEngineering
// ---------------------------------------------------------------------------

describe("getMenuEngineering", () => {
  const build = () =>
    advanced({
      restaurant_inventory: [UNPRICED, RECORDED],
      wine_consumption_log: [
        {
          inventory_id: RECORDED.id,
          quantity: 4,
          created_at: recently,
          restaurant_inventory: { master_wine_id: RECORDED.master_wine_id },
        },
      ],
    });

  it("nulls margin, margin % and the quadrant for an uncosted wine", async () => {
    const out = await build().getMenuEngineering(RESTAURANT);
    const row = out.items.find((i: any) => i.id === UNPRICED.id)!;
    expect(row.marginPerBottle).toBeNull();
    expect(row.marginPct).toBeNull();
    expect(row.quadrant).toBeNull();
    expect(row.action).toBeNull();
  });

  it("does not file an uncosted wine as a dog", async () => {
    // Pre-fix, a 0.6 fabrication decided the margin axis; with a plain `0`
    // default it would land under the median and be labelled "candidate to
    // delist" — advice generated from a number nobody measured.
    const out = await build().getMenuEngineering(RESTAURANT);
    const row = out.items.find((i: any) => i.id === UNPRICED.id)!;
    expect(row.quadrant).not.toBe("dog");
    expect(out.counts.unclassified).toBe(1);
  });

  it("keeps classifying the wine that does have a recorded cost", async () => {
    const out = await build().getMenuEngineering(RESTAURANT);
    const row = out.items.find((i: any) => i.id === RECORDED.id)!;
    expect(row.marginPerBottle).toBe(40); // 60 − 20
    expect(row.quadrant).not.toBeNull();
  });

  it("takes the margin median over costed wines only", async () => {
    const out = await build().getMenuEngineering(RESTAURANT);
    expect(out.medians.marginPerBottle).toBe(40);
  });

  it("nulls the median when nothing is costed, instead of reporting 0", async () => {
    const svc = advanced({
      restaurant_inventory: [UNPRICED],
      wine_consumption_log: [],
    });
    const out = await svc.getMenuEngineering(RESTAURANT);
    expect(out.medians.marginPerBottle).toBeNull();
    expect(out.items[0].quadrant).toBeNull();
  });

  it("stops the basis claiming WAC for a margin that never touched WAC", async () => {
    const out = await build().getMenuEngineering(RESTAURANT);
    expect(out.basis.margin).not.toBe("unit_price − WAC (lot rollup)");
    expect(out.basis.margin).toContain("no recorded cost");
    expect(out.basis.margin).toContain("1 of 2");
  });

  it("does not produce NaN in the item ordering", async () => {
    const out = await build().getMenuEngineering(RESTAURANT);
    expect(out.items).toHaveLength(2);
    expect(out.items[0].id).toBe(RECORDED.id);
    expect(out.items[1].id).toBe(UNPRICED.id);
  });
});

// ---------------------------------------------------------------------------
// getWine360
// ---------------------------------------------------------------------------

describe("getWine360", () => {
  it("nulls unitCost and margin, and says which source answered", async () => {
    const svc = advanced({
      restaurant_inventory: [UNPRICED],
      wine_consumption_log: [],
    });
    const out = await svc.getWine360(RESTAURANT, UNPRICED.master_wine_id);
    expect(out.unitCost).toBeNull();
    expect(out.marginPerBottle).toBeNull();
    expect(out.costBasis).toBe("unknown");
    expect(out.basis.unitCost).toContain("no recorded cost");
  });

  it("keeps a recorded cost and its margin", async () => {
    const svc = advanced({
      restaurant_inventory: [RECORDED],
      wine_consumption_log: [],
    });
    const out = await svc.getWine360(RESTAURANT, RECORDED.master_wine_id);
    expect(out.unitCost).toBe(20);
    expect(out.marginPerBottle).toBe(40);
    expect(out.basis.unitCost).toContain("last_purchase_price");
  });
});
