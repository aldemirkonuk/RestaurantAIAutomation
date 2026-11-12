import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { resolveUnitCost, summarizeCostBasis } from "./inventory-cost";
import { AnalyticsController } from "./analytics.controller";
import * as marginAdvice from "../pricing/margin-advice.service";

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
        Promise.resolve({ data: rowsByTable[table]?.[0] ?? null, error: null }),
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

  // F-343: a lot costs what its paper said, in that paper's money.
  it("refuses a WAC in another money than the house's — null, never compared", () => {
    expect(
      resolveUnitCost(
        { last_purchase_price: 18 },
        {
          has_invoice_cost: true,
          wac: 20,
          cost_currency: "EUR",
          cost_currency_count: 1,
        },
        "TRY",
      ),
    ).toEqual({ unitCost: null, costBasis: "other_currency" });
  });

  it("refuses a WAC that averages two currencies, even with no house currency", () => {
    expect(
      resolveUnitCost(
        {},
        {
          has_invoice_cost: true,
          wac: 20,
          cost_currency: null,
          cost_currency_count: 2,
        },
        null,
      ).costBasis,
    ).toBe("other_currency");
  });

  it("keeps a WAC in the house's money, or one whose lots state no currency", () => {
    const lot = {
      has_invoice_cost: true,
      wac: 20,
      cost_currency: "try",
      cost_currency_count: 1,
    };
    expect(resolveUnitCost({}, lot, "TRY")).toEqual({
      unitCost: 20,
      costBasis: "invoice_lot_wac",
    });
    expect(
      resolveUnitCost(
        {},
        { has_invoice_cost: true, wac: 20, cost_currency_count: 0 },
        "TRY",
      ).unitCost,
    ).toBe(20);
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

  it("F-1652: a row costed for some of its bottles is priced, but never complete", () => {
    const cov = summarizeCostBasis([
      { unitCost: 12, costBasis: "invoice_lot_wac" },
      {
        unitCost: 600,
        costBasis: "invoice_lot_wac_partial",
        uncostedBottles: 24,
      },
    ]);
    expect(cov).toMatchObject({
      total: 2,
      priced: 2,
      unpriced: 0,
      partial: 1,
      uncostedBottles: 24,
      complete: false,
    });
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
          consumption_type: "bottle",
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

  // F-133: the page counted the uncosted rows but never named them.
  it("names each on-hand row that has no recorded cost", async () => {
    const out: any = await build([UNPRICED, RECORDED]).getFinancialSummary(
      RESTAURANT,
    );
    expect(out.uncosted).toEqual([
      { id: UNPRICED.id, name: UNPRICED.wine_name, qty: UNPRICED.stock_live },
    ]);
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

  it("keeps revenue, which does not depend on unit cost", async () => {
    const out = await build([UNPRICED, RECORDED]).getFinancialSummary(
      RESTAURANT,
    );
    // 10 × 100 + 5 × 60 — menu price is recorded for both rows.
    expect(out.revenue).toBe(1300);
    expect(out.basis.revenue).toContain("2 inventory rows valued");
  });

  it("withholds COGS when no delivered order came back at all", async () => {
    // This assertion used to read `expect(out.cogs).toBe(0)`. There is no
    // procurement_orders fixture here, so the loader returned [] — and it
    // returns [] for a FAILED query too. $0 claimed "this restaurant bought
    // nothing in a year" on the strength of an empty array (fixed 2026-09-03).
    const out = await build([UNPRICED, RECORDED]).getFinancialSummary(
      RESTAURANT,
    );
    expect(out.cogs).toBeNull();
    expect(out.cogs).not.toBe(0);
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

  it("F-644: one uncosted wine leaves the priced wines' value standing, and says how many it left out", async () => {
    const out = await build([UNPRICED, RECORDED]).getFinancialSummary(
      RESTAURANT,
    );
    // The whole-cellar figure stays withheld: a part is not the whole.
    expect(out.inventoryValue).toBeNull();
    // The priced wines are still worth what they are worth.
    expect(out.pricedInventoryValue).toBe(100); // 5 × 20
    expect(out.costCoverage.unpriced).toBe(1);
    expect(out.basis.pricedInventoryValue).toContain("costCoverage.unpriced");
  });

  it("reports no priced value when no on-hand wine carries a cost", async () => {
    const out = await build([UNPRICED]).getFinancialSummary(RESTAURANT);
    expect(out.pricedInventoryValue).toBeNull();
  });

  it("still reports real numbers when every on-hand row is costed", async () => {
    const out = await build([RECORDED]).getFinancialSummary(RESTAURANT);
    expect(out.inventoryValue).toBe(100); // 5 × 20
    expect(out.pricedInventoryValue).toBe(100);
    expect(out.costCoverage.complete).toBe(true);
    expect(out.basis.inventoryValue).toContain(
      "every row in scope has a recorded cost",
    );
  });

  it("does not value stock bought in another money against a menu in the house's (F-343)", async () => {
    const lot = {
      inventory_id: RECORDED.id,
      live_qty: 5,
      wac: 20,
      has_invoice_cost: true,
      wac_qty: 5,
      cost_currency: "EUR",
      cost_currency_count: 1,
    };
    const rows = {
      restaurant_inventory: [RECORDED],
      inventory_lot_rollup: [lot],
    };
    const out = await analytics({
      ...rows,
      restaurants: [{ currency: "TRY" }],
    }).getFinancialSummary(RESTAURANT);
    expect(out.inventoryValue).toBeNull();
    expect(out.grossMarginDollars).toBeNull();
    expect(out.basis.inventoryValue).toContain(
      "different currency from the house's",
    );
    // The same lot in the house's own money is valued as before: 5 × 20.
    const same = await analytics({
      ...rows,
      restaurants: [{ currency: "EUR" }],
    }).getFinancialSummary(RESTAURANT);
    expect(same.inventoryValue).toBe(100);
  });

  // F-1652: 24 bottles loaded with no cost, then 12 invoiced at 600. The WAC
  // is the 12's; the other 24 were never costed.
  const PART = { ...RECORDED, stock_live: 36, last_purchase_price: null };
  const partLot = {
    inventory_id: RECORDED.id,
    live_qty: 36,
    wac: 600,
    has_invoice_cost: true,
    wac_qty: 12,
  };

  it("F-1652: values a partly costed wine at its costed bottles only, and never calls the cellar whole", async () => {
    const out = await analytics({
      restaurant_inventory: [PART],
      inventory_lot_rollup: [partLot],
    }).getFinancialSummary(RESTAURANT);
    // Not 36 × 600 = 21,600: 24 of those bottles carry no cost.
    expect(out.inventoryValue).toBeNull();
    expect(out.pricedInventoryValue).toBe(7200); // 12 × 600
    expect(out.costCoverage).toMatchObject({
      complete: false,
      partial: 1,
      uncostedBottles: 24,
    });
    expect(out.basis.inventoryValue).not.toContain(
      "every row in scope has a recorded cost",
    );
    expect(out.basis.inventoryValue).toContain("only part of their bottles");
    expect(out.grossMarginDollars).toBeNull();
  });

  it("F-1654: says which uncosted wines carry a typed-in or order-price cost", async () => {
    const out = await analytics({
      restaurant_inventory: [{ ...RECORDED, last_purchase_price: null }],
      inventory_lot_rollup: [
        {
          ...partLot,
          live_qty: 5,
          wac: 20,
          wac_qty: 5,
          has_invoice_cost: false,
        },
      ],
    }).getFinancialSummary(RESTAURANT);
    expect(out.pricedInventoryValue).toBeNull();
    expect(out.costCoverage.unpriced).toBe(1);
    expect(out.notInvoicedWines).toBe(1);
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

/**
 * F-574: a wine with no bottle price is left out of the sell-price valuation
 * and the margin, and counted, instead of being valued at $0 while its cost
 * still counted — which pushed gross margin and the COGS ratio down, and could
 * take margin below zero, with nothing saying why.
 */
describe("getFinancialSummary leaves an unpriced wine out of sales and margin (F-574)", () => {
  /** Costed at $20, on hand, and not on the list by the bottle. */
  const GLASS_ONLY = {
    ...RECORDED,
    id: "inv-glass-only",
    wine_name: "Glass-only Rioja",
    stock_live: 10,
    menu_price_current: null,
    master_wine_id: "mw-glass-only",
  };
  const build = (inventoryRows: any[]) =>
    analytics({ restaurant_inventory: inventoryRows });

  it("values only the priced wines and takes margin over the same bottles", async () => {
    const out = await build([RECORDED, GLASS_ONLY]).getFinancialSummary(
      RESTAURANT,
    );
    // RECORDED: 5 × $60 sold against 5 × $20 cost. GLASS_ONLY adds neither.
    expect(out.revenue).toBe(300);
    expect(out.grossMarginDollars).toBe(200);
    expect(out.grossMargin).toBeCloseTo(200 / 300);
    expect(out.cogsRatio).toBeCloseTo(100 / 300);
    // The cellar at cost still holds every on-hand bottle.
    expect(out.inventoryValue).toBe(300);
  });

  it("says how many on-hand wines were left out", async () => {
    const out = await build([RECORDED, GLASS_ONLY]).getFinancialSummary(
      RESTAURANT,
    );
    expect(out.priceCoverage).toEqual({ total: 2, priced: 1, unpriced: 1 });
    expect(out.basis.revenue).toContain("1 with no bottle price left out");
  });

  it("states no valuation, not $0, when no wine carries a bottle price", async () => {
    const out = await build([GLASS_ONLY]).getFinancialSummary(RESTAURANT);
    expect(out.revenue).toBeNull();
    expect(out.grossMargin).toBeNull();
    expect(out.basis.revenue).toContain("carries a bottle price");
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
          consumption_type: "bottle",
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
          consumption_type: "bottle",
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

// F-1587: a house whose till prices include tax (ADR 0341 §6). The margin is
// on the price without tax, by margin advice's rule, or refused with a reason.
describe("getMenuEngineering on a house whose prices include tax (F-1587)", () => {
  const HOUSE = {
    currency: "TRY",
    tax_basis: "prices_include_tax",
    tax_basis_confirmed_at: "2026-10-01T09:00:00Z",
    timezone: "Europe/Istanbul",
    country: "TR",
  };
  const RATE = {
    id: "r1",
    version: 1,
    key_kind: "house",
    key: "",
    rate: 0.2,
    effective_from: "2026-01-01",
    effective_to: null,
  };
  const PRE_TAX = {
    id: "inv-pre-tax",
    wine_name: "Kalecik Karası",
    stock_live: 6,
    menu_price_current: 600,
    last_purchase_price: 200,
    last_purchase_price_tax_basis: "excludes_tax",
    master_wine_id: "mw-pre-tax",
  };
  const UNSTATED = {
    ...PRE_TAX,
    id: "inv-unstated",
    wine_name: "Öküzgözü",
    last_purchase_price_tax_basis: null,
    master_wine_id: "mw-unstated",
  };
  const build = (house: Record<string, unknown> = HOUSE, rates = [RATE]) =>
    advanced({
      restaurants: [house],
      house_tax_rates: rates,
      restaurant_inventory: [PRE_TAX, UNSTATED],
      wine_consumption_log: [],
    });

  it("works the margin on the price without tax (600 with 20% inside, cost 200: 60%, not 66.7%)", async () => {
    const out = await build().getMenuEngineering(RESTAURANT);
    const row = out.items.find((i: any) => i.id === PRE_TAX.id)!;
    expect(row.marginPerBottle).toBeCloseTo(300, 6);
    expect(row.marginPct).toBeCloseTo(0.6, 6);
    expect(row.marginRefusal).toBeNull();
    expect(out.basis.margin).toContain("without tax");
  });

  it("refuses a margin on a cost not proven without tax, by name, and does not call it uncosted", async () => {
    const out = await build().getMenuEngineering(RESTAURANT);
    const row = out.items.find((i: any) => i.id === UNSTATED.id)!;
    expect(row.marginPerBottle).toBeNull();
    expect(row.marginPct).toBeNull();
    expect(row.quadrant).toBeNull();
    expect(row.marginRefusal).toMatch(/^No margin: cost basis not stated/);
    expect(out.counts.taxRefused).toBe(1);
    expect(out.counts.unclassified).toBe(0);
  });

  it("refuses every margin when no tax rate is in force", async () => {
    const out = await build(HOUSE, []).getMenuEngineering(RESTAURANT);
    for (const row of out.items) {
      expect(row.marginPerBottle).toBeNull();
      expect(row.marginRefusal).toMatch(
        /no tax rate of this house is in force/,
      );
    }
    expect(out.counts.taxRefused).toBe(2);
  });

  it("on a failed basis read says it could not be read, never that prices include tax (F-1626)", async () => {
    const spy = jest
      .spyOn(marginAdvice, "readAdviceTaxTerms")
      .mockResolvedValue({ terms: null, error: "connection reset" });
    try {
      const out: any = await build({
        currency: "TRY",
        tax_basis: "prices_exclude_tax",
        tax_basis_confirmed_at: "2026-10-01T09:00:00Z",
        timezone: "America/Detroit",
        country: "US",
      }).getMenuEngineering(RESTAURANT);
      expect(out.taxBasisUnread).toBe(true);
      expect(out.basis.margin).toContain("could not be read");
      expect(out.basis.margin).not.toContain("Your till prices include tax");
      for (const row of out.items)
        expect(row.marginRefusal).toMatch(/could not be read/);
    } finally {
      spy.mockRestore();
    }
  });

  it("leaves a US house exactly as before: gross price, no new keys", async () => {
    const out = await build({
      currency: "TRY",
      tax_basis: "prices_exclude_tax",
      tax_basis_confirmed_at: "2026-10-01T09:00:00Z",
      timezone: "America/Detroit",
      country: "US",
    }).getMenuEngineering(RESTAURANT);
    const row = out.items.find((i: any) => i.id === UNSTATED.id)!;
    expect(row.marginPerBottle).toBe(400);
    expect("marginRefusal" in row).toBe(false);
    expect("taxRefused" in out.counts).toBe(false);
    expect(out.basis.margin).not.toContain("without tax");
    expect("taxBasisUnread" in out).toBe(false);
  });
});

// F-1715 (sim 57): the House register's gross margin, COGS ratio and GMROI
// were taken on the shelf price with KDV inside while menu engineering on the
// same page was pre-tax: 66.7% beside 60% for one wine.
describe("getFinancialSummary on a house whose prices include tax (F-1715)", () => {
  const HOUSE = {
    currency: "TRY",
    tax_basis: "prices_include_tax",
    tax_basis_confirmed_at: "2026-10-01T09:00:00Z",
    timezone: "Europe/Istanbul",
    country: "TR",
  };
  const RATE = {
    id: "r1",
    version: 1,
    key_kind: "house",
    key: "",
    rate: 0.2,
    effective_from: "2026-01-01",
    effective_to: null,
  };
  /** 1,200 TL with 20% KDV inside, bought at 400 TL before tax. */
  const WINE = {
    id: "inv-1200",
    wine_name: "Boğazkere",
    stock_live: 1,
    menu_price_current: 1200,
    last_purchase_price: 400,
    last_purchase_price_tax_basis: "excludes_tax",
    threshold_min: 0,
    master_wine_id: "mw-1200",
  };
  const build = (
    house: Record<string, unknown> = HOUSE,
    rates: any[] = [RATE],
    wine: Record<string, unknown> = WINE,
  ) =>
    analytics({
      restaurants: [house],
      house_tax_rates: rates,
      restaurant_inventory: [wine],
    });

  it("takes sales without tax: (1000 - 400) / 1000 = 60%, not 66.7%", async () => {
    const out: any = await build().getFinancialSummary(RESTAURANT);
    expect(out.revenue).toBeCloseTo(1000, 6);
    expect(out.grossMargin).toBeCloseTo(0.6, 6);
    expect(out.cogsRatio).toBeCloseTo(0.4, 6);
    expect(out.gmroi).toBeCloseTo(600 / 400, 6);
    expect(out.marginTaxNote).toMatch(/worked out on prices without it/);
  });

  it("withholds the margins on a cost not recorded without tax, and says why", async () => {
    const out: any = await build(HOUSE, [RATE], {
      ...WINE,
      last_purchase_price_tax_basis: null,
    }).getFinancialSummary(RESTAURANT);
    expect(out.revenue).toBeCloseTo(1000, 6);
    expect(out.grossMargin).toBeNull();
    expect(out.cogsRatio).toBeNull();
    expect(out.gmroi).toBeNull();
    expect(out.primeCostRatio).toBeNull();
    expect(out.marginTaxNote).toMatch(/1 wine on hand has a cost not recorded/);
    // The cellar at cost is still the cellar at cost.
    expect(out.inventoryValue).toBe(400);
  });

  it("withholds the valuation and margins when no rate is in force", async () => {
    const out: any = await build(HOUSE, []).getFinancialSummary(RESTAURANT);
    expect(out.revenue).toBeNull();
    expect(out.grossMargin).toBeNull();
    expect(out.marginTaxNote).toMatch(/no tax rate in force today/);
  });

  it("a failed basis read refuses the margins and never says prices include tax", async () => {
    const spy = jest
      .spyOn(marginAdvice, "readAdviceTaxTerms")
      .mockResolvedValue({ terms: null, error: "connection reset" });
    try {
      const out: any = await build().getFinancialSummary(RESTAURANT);
      expect(out.grossMargin).toBeNull();
      expect(out.marginTaxNote).toMatch(/could not be read/);
      expect(out.marginTaxNote).not.toMatch(/Your till prices include tax/);
    } finally {
      spy.mockRestore();
    }
  });

  it("leaves a US house and an unset one exactly as before: shelf price, no new key (control)", async () => {
    for (const house of [
      { ...HOUSE, tax_basis: "prices_exclude_tax", country: "US", timezone: "America/Detroit" },
      { ...HOUSE, tax_basis: "unset" },
    ]) {
      const out: any = await build(house).getFinancialSummary(RESTAURANT);
      expect(out.revenue).toBe(1200);
      expect(out.grossMargin).toBeCloseTo(800 / 1200, 6);
      expect("marginTaxNote" in out).toBe(false);
    }
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

  it("gives no margin for a cost bought in another money (F-343)", async () => {
    const svc = advanced({
      restaurant_inventory: [RECORDED],
      wine_consumption_log: [],
      restaurants: [{ currency: "TRY" }],
      inventory_lot_rollup: [
        {
          inventory_id: RECORDED.id,
          live_qty: 5,
          wac: 20,
          has_invoice_cost: true,
          wac_qty: 5,
          cost_currency: "EUR",
          cost_currency_count: 1,
        },
      ],
    });
    const out = await svc.getWine360(RESTAURANT, RECORDED.master_wine_id);
    expect(out.unitCost).toBeNull();
    expect(out.marginPerBottle).toBeNull();
    expect(out.costBasis).toBe("other_currency");
  });
});

describe("F-203 — staff read no house money on the analytics lenses", () => {
  /**
   * F-203: the analytics lenses sent every signed-in member the house's money.
   * Staff now get each lens with its prices, costs, margins and spend omitted
   * and `amountsWithheld: true`; owners and managers get it whole.
   */
  const menu = () => ({
    counts: { star: 1, unclassified: 0, unmeasured: 0 },
    medians: { velocityPerDay: 0.4, marginPerBottle: 31 },
    items: [
      {
        id: "i1",
        name: "Barolo",
        velocityPerDay: 0.5,
        marginPerBottle: 42,
        marginPct: 0.61,
        costBasis: "invoiced",
        quadrant: "star",
        action: "Protect",
      },
    ],
  });
  const cashflow = () => ({
    basis: { outflow: "delivered procurement_orders" },
    spendLast30d: 1200,
    spendPrev30d: 900,
    paceDeltaPct: 33,
    projectedNext4Weeks: [300, 310, 320, 330],
    committedOpenOrders: 640,
    openOrderCount: 3,
  });
  const vendors = () => ({
    vendors: [
      {
        vendorId: "v1",
        vendorName: "Kermit",
        orders: 4,
        delivered: 3,
        spend: 2100,
        onTimeRate: 0.75,
        unitPrice: { mean: 22, latest: 24, trendPerOrderPct: 3 },
      },
    ],
    concentration: { hhi: 1, effectiveVendors: 1 },
  });
  const wine = () => ({
    masterWineId: "w1",
    onHand: 6,
    unitPrice: 90,
    unitCost: 38,
    marginPerBottle: 52,
    costBasis: "invoiced",
    daysOfCover: 12,
  });
  const financial = () => ({
    costCoverage: { total: 2, priced: 2, unpriced: 0, complete: true },
    inventoryValue: 5400,
    cogs: 22000,
    revenue: 61000,
    grossMarginDollars: 39000,
    grossMargin: 0.64,
    cogsRatio: 0.36,
    primeCostRatio: null,
    inventoryTurnover: 4.1,
    daysInventoryOutstanding: 89,
    gmroi: 7.2,
    deadStockCapital: 800,
    deadStockTop: [
      { name: "Old Rioja", value: 800, qty: 10, costBasis: "wac" },
    ],
  });

  function controllerWith(advanced: Record<string, unknown>, analytics = {}) {
    const none = {} as never;
    return new AnalyticsController(
      analytics as never,
      advanced as never,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
    );
  }

  const ctl = () =>
    controllerWith(
      {
        getMenuEngineering: async () => menu(),
        getCashflow: async () => cashflow(),
        getVendorScorecard: async () => vendors(),
        getWine360: async () => wine(),
        getOverview: async () => ({
          financial: financial(),
          cashflow: cashflow(),
          seasonality: { bestDay: "Fri" },
          menuEngineering: { counts: menu().counts, top: menu().items },
          inventory: {
            reorderCount: 1,
            reorderTop: [
              { id: "s1", onHand: 2, unitCost: 38, inventoryValue: 76 },
            ],
            skuCount: 1,
          },
          activeGoals: [],
        }),
      },
      { getFinancialSummary: async () => financial() },
    );

  const staff = { role: "staff" };

  it("menu engineering keeps velocity and quadrant, drops every margin", async () => {
    const m = (await ctl().getMenuEngineering("r1", staff)) as any;
    expect(m.amountsWithheld).toBe(true);
    expect(m.medians).toEqual({ velocityPerDay: 0.4 });
    expect(m.items[0]).not.toHaveProperty("marginPerBottle");
    expect(m.items[0]).not.toHaveProperty("marginPct");
    expect(m.items[0]).toMatchObject({ velocityPerDay: 0.5, quadrant: "star" });
    expect(m.counts.star).toBe(1);
  });

  it("cashflow keeps the order count and pace, drops spend and what is owed", async () => {
    const c = (await ctl().getCashflow("r1", staff)) as any;
    for (const k of [
      "spendLast30d",
      "spendPrev30d",
      "projectedNext4Weeks",
      "committedOpenOrders",
    ])
      expect(c).not.toHaveProperty(k);
    expect(c).toMatchObject({
      openOrderCount: 3,
      paceDeltaPct: 33,
      amountsWithheld: true,
    });
  });

  it("the vendor lens keeps on-time and counts, drops spend and unit prices", async () => {
    const v = (await ctl().getVendorScorecard("r1", staff)) as any;
    expect(v.vendors[0]).not.toHaveProperty("spend");
    expect(v.vendors[0]).not.toHaveProperty("unitPrice");
    expect(v.vendors[0]).toMatchObject({ orders: 4, onTimeRate: 0.75 });
    expect(v.amountsWithheld).toBe(true);
  });

  it("one wine keeps its menu price and cover, drops its cost and margin", async () => {
    const w = (await ctl().getWine360("r1", "w1", staff)) as any;
    expect(w).not.toHaveProperty("unitCost");
    expect(w).not.toHaveProperty("marginPerBottle");
    expect(w).toMatchObject({ unitPrice: 90, daysOfCover: 12 });
  });

  it("the financial lens keeps turns and days, drops values, margins and capital", async () => {
    const f = (await ctl().getFinancial("r1", undefined, staff)) as any;
    for (const k of [
      "inventoryValue",
      "cogs",
      "revenue",
      "grossMarginDollars",
      "grossMargin",
      "cogsRatio",
      "gmroi",
      "deadStockCapital",
    ])
      expect(f).not.toHaveProperty(k);
    expect(f).toMatchObject({
      inventoryTurnover: 4.1,
      daysInventoryOutstanding: 89,
    });
    expect(f.deadStockTop[0]).toEqual({
      name: "Old Rioja",
      qty: 10,
      costBasis: "wac",
    });
  });

  it("the overview cuts every lens it carries the same way", async () => {
    const o = (await ctl().getOverview("r1", staff)) as any;
    expect(o.amountsWithheld).toBe(true);
    expect(o.financial).not.toHaveProperty("cogs");
    expect(o.cashflow).not.toHaveProperty("spendLast30d");
    expect(o.menuEngineering.top[0]).not.toHaveProperty("marginPerBottle");
    expect(o.inventory.reorderTop[0]).toEqual({ id: "s1", onHand: 2 });
    expect(o.seasonality).toEqual({ bestDay: "Fri" });
  });

  it("a session with no role is cut too", async () => {
    const c = (await ctl().getCashflow("r1", {})) as any;
    expect(c).not.toHaveProperty("spendLast30d");
  });

  it.each(["owner", "manager"])("a %s gets every lens whole", async (role) => {
    const u = { role };
    expect(await ctl().getMenuEngineering("r1", u)).toEqual(menu());
    expect(await ctl().getCashflow("r1", u)).toEqual(cashflow());
    expect(await ctl().getVendorScorecard("r1", u)).toEqual(vendors());
    expect(await ctl().getWine360("r1", "w1", u)).toEqual(wine());
    expect(await ctl().getFinancial("r1", undefined, u)).toEqual(financial());
  });
});
