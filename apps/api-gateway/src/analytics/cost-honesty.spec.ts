import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { resolveUnitCost, summarizeCostBasis } from "./inventory-cost";
import { METRIC_REGISTRY } from "./metric-registry";
import { readFileSync } from "fs";
import { join } from "path";

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

/** What `.rpc("pos_item_sales")` answers; unset reads as a failed read. */
type Rpc = { data?: unknown; error?: unknown };

function makeClient(rowsByTable: Rows, rpc: Rpc = {}) {
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
      // `eq` and `in` filter a row only on a column the fixture row carries,
      // so a fixture that sets `is_active: false` is a row the active cellar
      // read leaves out, and every older fixture (no such column) reads as
      // before.
      const keep: Array<(r: any) => boolean> = [];
      builder.eq = jest.fn((k: string, v: unknown) => {
        keep.push((r) => !(k in r) || r[k] === v);
        return builder;
      });
      builder.in = jest.fn((k: string, vs: unknown[]) => {
        keep.push((r) => !(k in r) || vs.includes(r[k]));
        return builder;
      });
      builder.maybeSingle = jest.fn(() =>
        Promise.resolve({ data: null, error: null }),
      );
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({
          data: (rowsByTable[table] ?? []).filter((r) =>
            keep.every((k) => k(r)),
          ),
          error: null,
        }).then(resolve, reject);
      return builder;
    }),
    rpc: jest.fn(() =>
      Promise.resolve({ data: rpc.data ?? null, error: rpc.error ?? null }),
    ),
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

const analytics = (rows: Rows, rpc?: Rpc) =>
  new AnalyticsService({ getClient: () => makeClient(rows, rpc) } as any);

/** A pos_item_sales payload: per item [bottles out, sales], 60 days of till. */
const till = (sold: Record<string, [number, number]>) => ({
  data: {
    items: Object.entries(sold).map(([id, [bottles, sales]]) => ({
      inventory_id: id,
      sales,
      units: bottles,
      lines: 1,
      bottles_out: bottles,
      mapped: true,
    })),
    checks: 4,
    lines: Object.keys(sold).length,
    unmapped_lines: 0,
    unmapped_sales: 0,
    unreadable_lines: 0,
    first_sale_at: new Date(Date.now() - 60 * 86400000).toISOString(),
  },
});

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
  /** By default the till sold 3 bottles of RECORDED, the costed wine, for 180. */
  const build = (
    inventoryRows: any[],
    rpc: Rpc = till({ [RECORDED.id]: [3, 180] }),
  ) =>
    analytics(
      {
        restaurant_inventory: inventoryRows,
        wine_consumption_log: [
          {
            inventory_id: RECORDED.id,
            quantity: 3,
            created_at: recently,
            restaurant_inventory: { master_wine_id: RECORDED.master_wine_id },
          },
        ],
      },
      rpc,
    );

  it("nulls the capital ratios when an on-hand row has no cost", async () => {
    const out = await build([UNPRICED, RECORDED]).getFinancialSummary(
      RESTAURANT,
    );
    // Turns, DIO and GMROI divide by today's inventory at cost.
    expect(out.inventoryValue).toBeNull();
    expect(out.inventoryTurnover).toBeNull();
    expect(out.daysInventoryOutstanding).toBeNull();
    expect(out.gmroi).toBeNull();
  });

  it("keeps the margin ratios, which need only what sold and its cost", async () => {
    // Only RECORDED sold, and it carries a cost: 3 × 20 = 60 against 180.
    // An uncosted bottle still on the shelf did not sell, so it is in
    // neither side of these (ADR 0298).
    const out = await build([UNPRICED, RECORDED]).getFinancialSummary(
      RESTAURANT,
    );
    expect(out.cogs).toBe(60);
    expect(out.revenue).toBe(180);
    expect(out.grossMarginDollars).toBe(120);
    expect(out.cogsRatio).toBeCloseTo(1 / 3, 10);
    expect(out.grossMargin).toBeCloseTo(2 / 3, 10);
  });

  it("does not let the null become a zero anywhere in the payload", async () => {
    const out = await build([UNPRICED, RECORDED]).getFinancialSummary(
      RESTAURANT,
    );
    // The pre-fix payload reported a fabricated $600 + $100 valuation here.
    for (const field of [
      "inventoryValue",
      "inventoryTurnover",
      "daysInventoryOutstanding",
      "gmroi",
    ] as const) {
      expect(out[field]).not.toBe(0);
      expect(out[field]).toBeNull();
    }
  });

  it("keeps sales, which do not depend on unit cost", async () => {
    const out = await build(
      [UNPRICED, RECORDED],
      till({ [UNPRICED.id]: [2, 200], [RECORDED.id]: [3, 180] }),
    ).getFinancialSummary(RESTAURANT);
    // What the till took for both, whatever either cost.
    expect(out.revenue).toBe(380);
    expect(out.basis.revenue).toContain("4 checks");
  });

  it("withholds COGS when an item that sold has no recorded cost (fork a)", async () => {
    // Founder fork 2026-10-04: "Withhold, say N of M (Recommended)". Summing
    // the costed part (3 × 20 = 60) would be a floor wearing a total's label.
    // UNPRICED is sold out here, so the on-hand valuation is complete and is
    // NOT what withholds this: the cost of what sold is.
    const out = await build(
      [{ ...UNPRICED, stock_live: 0 }, RECORDED],
      till({ [UNPRICED.id]: [2, 200], [RECORDED.id]: [3, 180] }),
    ).getFinancialSummary(RESTAURANT);
    expect(out.inventoryValue).toBe(100);
    expect(out.cogs).toBeNull();
    expect(out.cogs).not.toBe(60);
    expect(out.cogsCoverage).toMatchObject({
      total: 2,
      priced: 1,
      unpriced: 1,
      complete: false,
      bottlesSold: 5,
      bottlesCosted: 3,
    });
    expect(out.basis.cogs).toContain(
      "1 of 2 items that sold carry a recorded cost",
    );
    for (const field of [
      "grossMarginDollars",
      "grossMargin",
      "cogsRatio",
      "primeCostRatio",
      "inventoryTurnover",
      "daysInventoryOutstanding",
      "gmroi",
    ] as const) {
      expect(out[field]).toBeNull();
    }
  });

  // PR #617's audit at 847f2470d: a sold item deleted on /inventory (a soft
  // delete, is_active = false) was missing from the active read, so it read
  // as "has no recorded cost" and withheld cost of goods for the whole
  // house, though its row still held its cost.
  /** Deleted on /inventory: inactive, sold out, and its cost still recorded. */
  const RETIRED = {
    id: "inv-retired",
    wine_name: "Delisted Barolo",
    stock_live: 0,
    menu_price_current: 90,
    last_purchase_price: 30,
    threshold_min: 0,
    master_wine_id: "mw-retired",
    is_active: false,
  };
  const ACTIVE_RECORDED = { ...RECORDED, is_active: true };

  it("costs an item that sold and was deleted from its own row", async () => {
    const out = await build(
      [ACTIVE_RECORDED, RETIRED],
      till({ [RETIRED.id]: [1, 90], [RECORDED.id]: [3, 180] }),
    ).getFinancialSummary(RESTAURANT);
    // 1 × 30 for the deleted Barolo, 3 × 20 for the Chablis.
    expect(out.cogs).toBe(90);
    expect(out.cogsCoverage).toMatchObject({
      total: 2,
      priced: 2,
      unpriced: 0,
      complete: true,
      itemsNoLongerActive: 1,
      itemsNotInBooks: 0,
      itemsCostUnread: 0,
    });
    expect(out.basis.cogs).toContain(
      "1 of these rows is no longer active and read all the same",
    );
    expect(out.basis.cogs).not.toContain("no recorded cost (");
    // The deleted row is not on hand: the cellar value is the active one.
    expect(out.inventoryValue).toBe(100);
  });

  it("costs a deleted item from its lots' WAC, through the same resolveUnitCost", async () => {
    const out = await analytics(
      {
        restaurant_inventory: [
          ACTIVE_RECORDED,
          { ...RETIRED, last_purchase_price: null },
        ],
        inventory_lot_rollup: [
          {
            inventory_id: RETIRED.id,
            live_qty: 2,
            wac: 25,
            has_invoice_cost: true,
            wac_qty: 2,
          },
        ],
      },
      till({ [RETIRED.id]: [2, 180], [RECORDED.id]: [3, 180] }),
    ).getFinancialSummary(RESTAURANT);
    expect(out.cogs).toBe(2 * 25 + 3 * 20);
    expect(out.cogsCoverage.byBasis).toMatchObject({
      invoice_lot_wac: 1,
      last_purchase_price: 1,
      unknown: 0,
    });
  });

  it("withholds when a deleted item's row has no recorded cost, and says that", async () => {
    const out = await build(
      [ACTIVE_RECORDED, { ...RETIRED, last_purchase_price: null }],
      till({ [RETIRED.id]: [1, 90], [RECORDED.id]: [3, 180] }),
    ).getFinancialSummary(RESTAURANT);
    expect(out.cogs).toBeNull();
    expect(out.cogsCoverage).toMatchObject({
      priced: 1,
      unpriced: 1,
      itemsNoLongerActive: 1,
      itemsNotInBooks: 0,
    });
    expect(out.basis.cogs).toContain(
      "1 of 2 items that sold carry a recorded cost",
    );
    expect(out.basis.cogs).toContain("no recorded cost (1)");
  });

  it("names an item with no inventory row as no longer in the books, not uncosted", async () => {
    const out = await build(
      [ACTIVE_RECORDED],
      till({ "inv-gone": [1, 90], [RECORDED.id]: [3, 180] }),
    ).getFinancialSummary(RESTAURANT);
    expect(out.cogs).toBeNull();
    expect(out.cogsCoverage).toMatchObject({
      total: 2,
      priced: 1,
      unpriced: 1,
      itemsNoLongerActive: 0,
      itemsNotInBooks: 1,
      itemsCostUnread: 0,
    });
    expect(out.basis.cogs).toContain(
      "1 of 2 items that sold carry a recorded cost",
    );
    expect(out.basis.cogs).toContain(
      "1 item that sold is no longer in the books (no inventory row of this house)",
    );
    // The one row the books hold is costed; no row is said to lack a cost.
    expect(out.basis.cogs).toContain("every row in scope has a recorded cost");
    expect(out.basis.cogs).not.toContain("have no recorded cost");
  });

  it("withholds and says the read failed when a deleted item's row cannot be read", async () => {
    // The second restaurant_inventory read (the sold-item cost read) fails.
    const client: any = makeClient(
      { restaurant_inventory: [ACTIVE_RECORDED, RETIRED] },
      till({ [RETIRED.id]: [1, 90], [RECORDED.id]: [3, 180] }),
    );
    const from = client.from;
    let reads = 0;
    client.from = jest.fn((table: string) => {
      if (table !== "restaurant_inventory" || ++reads === 1) return from(table);
      const failed: any = {};
      for (const m of ["select", "eq", "in"]) failed[m] = jest.fn(() => failed);
      failed.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: null, error: { message: "timeout" } }).then(
          resolve,
          reject,
        );
      return failed;
    });
    const out = await new AnalyticsService({
      getClient: () => client,
    } as any).getFinancialSummary(RESTAURANT);
    expect(reads).toBe(2);
    expect(out.cogs).toBeNull();
    expect(out.cogsCoverage).toMatchObject({
      itemsCostUnread: 1,
      itemsNotInBooks: 0,
      itemsNoLongerActive: 0,
    });
    expect(out.basis.cogs).toContain("the read of its row failed");
    expect(out.basis.cogs).not.toContain("no longer in the books");
    expect(out.basis.cogs).not.toContain("no recorded cost");
  });

  it("reads no row twice when every item that sold is active", async () => {
    const client: any = makeClient(
      { restaurant_inventory: [ACTIVE_RECORDED, RETIRED] },
      till({ [RECORDED.id]: [3, 180] }),
    );
    const out = await new AnalyticsService({
      getClient: () => client,
    } as any).getFinancialSummary(RESTAURANT);
    expect(out.cogs).toBe(60);
    expect(
      client.from.mock.calls.filter(
        ([t]: [string]) => t === "restaurant_inventory",
      ),
    ).toHaveLength(1);
  });

  it("withholds COGS when the till cannot say, delivered orders or not", async () => {
    // This assertion once read `expect(out.cogs).toBe(0)`, then summed the
    // delivered orders. Neither is what sold (A-046, ADR 0298).
    const out = await analytics(
      {
        restaurant_inventory: [RECORDED],
        procurement_orders: [
          {
            id: "po-1",
            provider_id: "prov-1",
            total_cost: 480,
            bottles_total: 12,
            status: "DELIVERED",
            delivered_at: recently,
            created_at: recently,
          },
        ],
      },
      { error: { message: "timeout" } },
    ).getFinancialSummary(RESTAURANT);
    expect(out.cogs).toBeNull();
    expect(out.cogs).not.toBe(480);
    expect(out.deliveredPurchases).toBe(480);
    expect(out.basis.cogs).toContain("null");
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

// ---------------------------------------------------------------------------
// METRIC_REGISTRY claims only what a served field computes (AW16)
// ---------------------------------------------------------------------------

/**
 * The registry is the vocabulary the consultant and the metric pages read, so
 * a `computed: true` it cannot back is a claim made to the founder. It said
 * true for all 33 entries, seven of which no served field computes
 * (year-on-year growth, an early-payment APR, a newsvendor order, price
 * elasticity, an optimal markup, a CUSUM break, a drawdown that is 0 by
 * construction), and it named the Gini, the COGS ratio, turnover, DIO and
 * GMROI after a revenue and a cost of goods they did not read. Every `true` below must map to a field a real service call returns,
 * or, for the three lenses that need a whole other service stood up, to the
 * source line that computes it. A new `true` without an entry here fails.
 */
describe("METRIC_REGISTRY claims only what a served field computes", () => {
  type Lens =
    | "financial"
    | "science"
    | "risk"
    | "forecast"
    | "seasonality"
    | "menu"
    | "cashflow";
  const SERVED: Record<
    string,
    { lens: Lens; path: string } | { file: string; pattern: RegExp }
  > = {
    wine_cogs_ratio: { lens: "financial", path: "cogsRatio" },
    prime_cost_ratio: { lens: "financial", path: "primeCostRatio" },
    gross_margin_by_tier: { lens: "financial", path: "grossMargin" },
    inventory_turnover: { lens: "financial", path: "inventoryTurnover" },
    days_inventory_outstanding: {
      lens: "financial",
      path: "daysInventoryOutstanding",
    },
    gmroi: { lens: "financial", path: "gmroi" },
    dead_stock_capital: { lens: "financial", path: "deadStockCapital" },
    eoq: { lens: "science", path: "skus.0.eoq" },
    safety_stock: { lens: "science", path: "skus.0.safetyStock" },
    reorder_point: { lens: "science", path: "skus.0.reorderPoint" },
    stockout_probability: {
      lens: "science",
      path: "skus.0.stockoutProbability",
    },
    abc_xyz_classification: { lens: "science", path: "skus.0.abcClass" },
    vendor_concentration_hhi: { lens: "risk", path: "vendorConcentration.hhi" },
    revenue_gini: { lens: "risk", path: "revenueConcentration.gini" },
    demand_var: { lens: "risk", path: "demandRisk.historicalVar95" },
    revenue_sharpe: { lens: "risk", path: "demandRisk.sharpe" },
    demand_forecast: { lens: "forecast", path: "totalForecastDemand" },
    seasonal_decomposition: {
      lens: "seasonality",
      path: "weeklySeasonalFactors",
    },
    weekday_seasonality: { lens: "seasonality", path: "weekdayProfile" },
    menu_engineering: { lens: "menu", path: "items.0.quadrant" },
    spend_pacing: { lens: "cashflow", path: "paceDeltaPct" },
    vendor_lead_time: {
      file: "advanced-analytics.service.ts",
      pattern: /leadTimeDays: \{[^}]*stdev: E\.stdev\(/,
    },
    vendor_price_trend: {
      file: "advanced-analytics.service.ts",
      pattern: /trendPerOrderPct: E\.trendPerPeriodPct\(/,
    },
    sales_correlation: {
      file: "table-analytics.service.ts",
      pattern: /E\.pearson\(/,
    },
    anomaly_zscore: {
      file: "insights/insight-generator.service.ts",
      pattern: /E\.robustZScore\(/,
    },
    recommendations: {
      file: "recommendations.service.ts",
      pattern: /async getRecommendations\(/,
    },
  };

  const pick = (o: unknown, path: string) =>
    path.split(".").reduce<any>((v, k) => (v == null ? undefined : v[k]), o);

  it("has an entry here for every `computed: true`, and for nothing else", () => {
    const claimed = METRIC_REGISTRY.filter((m) => m.computed)
      .map((m) => m.key)
      .sort();
    expect(claimed).toEqual(Object.keys(SERVED).sort());
  });

  it("finds every claimed field on a real service call", async () => {
    const consumed = [
      {
        inventory_id: RECORDED.id,
        quantity: 3,
        created_at: recently,
        restaurant_inventory: { master_wine_id: RECORDED.master_wine_id },
      },
    ];
    const rows = {
      restaurant_inventory: [RECORDED],
      wine_consumption_log: consumed,
    };
    const svc = analytics(rows, till({ [RECORDED.id]: [3, 180] }));
    const out: Record<Lens, unknown> = {
      financial: await svc.getFinancialSummary(RESTAURANT),
      science: await svc.getInventoryScience(RESTAURANT),
      risk: await svc.getRiskProfile(RESTAURANT),
      forecast: await svc.getDemandForecast(RESTAURANT),
      seasonality: await advanced(rows).getSeasonality(RESTAURANT),
      menu: await advanced(rows).getMenuEngineering(RESTAURANT),
      cashflow: await advanced(rows).getCashflow(RESTAURANT),
    };
    const missing: string[] = [];
    for (const [key, where] of Object.entries(SERVED)) {
      if ("lens" in where) {
        if (pick(out[where.lens], where.path) === undefined)
          missing.push(`${key} → ${where.lens}.${where.path}`);
      } else {
        const src = readFileSync(join(__dirname, where.file), "utf8");
        if (!where.pattern.test(src)) missing.push(`${key} → ${where.file}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("says false for what nothing serves", () => {
    const off = METRIC_REGISTRY.filter((m) => !m.computed)
      .map((m) => m.key)
      .sort();
    expect(off).toEqual(
      [
        "early_payment_apr",
        "newsvendor_event_order",
        "optimal_markup",
        "price_elasticity",
        "revenue_max_drawdown",
        "structural_break_cusum",
        "yoy_growth",
      ].sort(),
    );
  });

  it("describes the till where a measure reads the till (A-018, A-046)", () => {
    const text = (key: string) => {
      const m = METRIC_REGISTRY.find((x) => x.key === key)!;
      return `${m.name} ${m.description} ${m.formula}`;
    };
    expect(text("revenue_gini")).toContain("POS");
    expect(text("revenue_gini")).not.toMatch(/on[- ]hand|stock value/i);
    for (const key of [
      "wine_cogs_ratio",
      "inventory_turnover",
      "days_inventory_outstanding",
      "gmroi",
    ]) {
      expect(text(key)).toContain("POS");
      expect(text(key)).not.toMatch(/purchas/i);
    }
    // Labour is the caller's figure; the text must not imply a feed.
    expect(text("prime_cost_ratio")).toMatch(/labou?r/i);
    expect(text("prime_cost_ratio")).toContain("?labor=");
  });
});
