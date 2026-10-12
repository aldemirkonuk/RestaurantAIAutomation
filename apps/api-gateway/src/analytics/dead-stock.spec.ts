import { AnalyticsService } from "./analytics.service";

/**
 * Regression guard — `deadStockCapital` must measure what its label says.
 *
 * It was defined as a stock-DEPTH test (`qty > max(thresholdMin * 3, 12)`)
 * with no consumption join at all, while recommendations.service.ts renders
 * the total to managers as capital "locked in slow inventory" and advises
 * discounting the top names to cost. A wine that sold every night but was
 * stocked deep therefore appeared as dead capital — and the attached advice,
 * applied to a best seller, destroys margin. The number and its label are now
 * the same claim: on hand, and not moving.
 *
 * The load-bearing negative case is the last one: a restaurant with no
 * movement feed at all gets `null`, not "your entire cellar is dead". Zero
 * consumption rows are an absence of evidence, not evidence of absence
 * (ADR 0020 — .planning/decisions/0020-no-fabricated-answers.md).
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

const RESTAURANT = "22222222-2222-2222-2222-222222222222";
const recently = new Date(Date.now() - 3 * 86400000).toISOString();

/**
 * Two wines, both stocked far above the old depth trigger
 * (`qty > max(threshold_min * 3, 12)`), so the pre-fix definition called both
 * of them dead. Only one of them has actually stopped selling.
 */
const FAST_MOVER = {
  id: "inv-fast",
  wine_name: "Nightly Albarino",
  stock_live: 40,
  menu_price_current: 50,
  last_purchase_price: 20,
  threshold_min: 4,
  master_wine_id: "mw-fast",
};
const IDLE = {
  id: "inv-idle",
  wine_name: "Forgotten Barolo",
  stock_live: 30,
  menu_price_current: 90,
  last_purchase_price: 30,
  threshold_min: 4,
  master_wine_id: "mw-idle",
};

const build = (rows: Rows) =>
  new AnalyticsService({ getClient: () => makeClient(rows) } as any);

describe("deadStockCapital measures movement, not depth", () => {
  it("excludes a deep-stocked wine that is still selling", async () => {
    const svc = build({
      restaurant_inventory: [FAST_MOVER, IDLE],
      wine_consumption_log: [
        {
          inventory_id: FAST_MOVER.id,
          quantity: 6,
          created_at: recently,
          restaurant_inventory: { master_wine_id: FAST_MOVER.master_wine_id },
        },
      ],
    });

    const out = await svc.getFinancialSummary(RESTAURANT);

    expect(out.deadStockTop.map((d: any) => d.name)).toEqual([
      "Forgotten Barolo",
    ]);
    // 30 bottles × $30 last_purchase_price. The fast mover's 40 × $20 = $800
    // was counted as dead capital before the consumption join.
    expect(out.deadStockCapital).toBe(900);
  });

  it("does not let a zero-quantity log row count as movement", async () => {
    const svc = build({
      restaurant_inventory: [FAST_MOVER, IDLE],
      wine_consumption_log: [
        {
          inventory_id: FAST_MOVER.id,
          quantity: 6,
          created_at: recently,
          restaurant_inventory: { master_wine_id: FAST_MOVER.master_wine_id },
        },
        // A zero-quantity row is not movement — it must not rescue the Barolo.
        {
          inventory_id: IDLE.id,
          quantity: 0,
          volume_ml: 0,
          created_at: recently,
          restaurant_inventory: { master_wine_id: IDLE.master_wine_id },
        },
      ],
    });

    const out = await svc.getFinancialSummary(RESTAURANT);
    expect(out.deadStockTop.map((d: any) => d.name)).toEqual([
      "Forgotten Barolo",
    ]);
  });

  it("matches movement through the master wine as well as the inventory row", async () => {
    // Same wine, second inventory row: consumption logged against one must not
    // mark the other dead. Under-matching here tells a manager to discount a
    // best seller.
    const svc = build({
      restaurant_inventory: [FAST_MOVER, { ...FAST_MOVER, id: "inv-fast-2" }],
      wine_consumption_log: [
        {
          inventory_id: FAST_MOVER.id,
          quantity: 6,
          created_at: recently,
          restaurant_inventory: { master_wine_id: FAST_MOVER.master_wine_id },
        },
      ],
    });

    const out = await svc.getFinancialSummary(RESTAURANT);
    expect(out.deadStockTop).toEqual([]);
    expect(out.deadStockCapital).toBe(0);
  });

  it("does not count a wine listed inside the window as dead (F-1415)", async () => {
    // Listed 20 days ago: it has not had 90 days to sell. The Barolo, listed
    // a year ago, has.
    const daysAgo = (n: number) =>
      new Date(Date.now() - n * 86400000).toISOString();
    const svc = build({
      restaurant_inventory: [
        { ...FAST_MOVER, created_at: daysAgo(400) },
        { ...IDLE, created_at: daysAgo(365) },
        {
          ...IDLE,
          id: "inv-new",
          wine_name: "New Arrival Rioja",
          master_wine_id: "mw-new",
          created_at: daysAgo(20),
        },
      ],
      wine_consumption_log: [
        {
          inventory_id: FAST_MOVER.id,
          quantity: 6,
          created_at: recently,
          restaurant_inventory: { master_wine_id: FAST_MOVER.master_wine_id },
        },
      ],
    });

    const out = await svc.getFinancialSummary(RESTAURANT);
    expect(out.deadStockTop.map((d: any) => d.name)).toEqual([
      "Forgotten Barolo",
    ]);
    expect(out.deadStockCapital).toBe(900);
  });

  it("reports null — never the whole cellar — when nothing records movement", async () => {
    const svc = build({
      restaurant_inventory: [FAST_MOVER, IDLE],
      wine_consumption_log: [],
    });

    const out = await svc.getFinancialSummary(RESTAURANT);
    expect(out.deadStockCapital).toBeNull();
    expect(out.deadStockTop).toEqual([]);
    expect(out.basis.deadStock).toContain("wine_consumption_log");
  });

  it("keeps the recommendation from firing on a null", async () => {
    // recommendations.service.ts guards with `(deadStockCapital ?? 0) > 0`.
    const svc = build({
      restaurant_inventory: [FAST_MOVER, IDLE],
      wine_consumption_log: [],
    });
    const out = await svc.getFinancialSummary(RESTAURANT);
    expect((out.deadStockCapital ?? 0) > 0).toBe(false);
  });
});

/**
 * F-1412 — turns and days of stock are taken over the days the house has
 * records for, not always a year. A house open sixty days set its sixty days
 * of purchases against today's cellar as if they were a year's, so turns
 * read about a sixth of the truth and days of stock six times too many.
 */

function makeHouseClient(rowsByTable: Rows, house: any) {
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
    "range",
  ];
  return {
    from: jest.fn((table: string) => {
      const builder: any = {};
      for (const m of passthrough) builder[m] = jest.fn(() => builder);
      builder.maybeSingle = jest.fn(() =>
        Promise.resolve({
          data: table === "restaurants" ? house : null,
          error: null,
        }),
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

const YOUNG_HOUSE = "33333333-3333-3333-3333-333333333333";
const ago = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

// One wine worth $1,000 at cost; $2,000 bought and delivered.
const WINE = {
  id: "inv-1",
  wine_name: "House Red",
  stock_live: 50,
  menu_price_current: 40,
  last_purchase_price: 20,
  threshold_min: 4,
  master_wine_id: "mw-1",
};
const order = (deliveredDaysAgo: number) => ({
  id: `o-${deliveredDaysAgo}`,
  provider_id: "p-1",
  total_cost: 2000,
  status: "delivered",
  delivered_at: ago(deliveredDaysAgo),
  created_at: ago(deliveredDaysAgo + 2),
});

const summary = (house: any, orders: any[]) =>
  new AnalyticsService({
    getClient: () =>
      makeHouseClient(
        { restaurant_inventory: [WINE], procurement_orders: orders },
        house,
      ),
  } as any).getFinancialSummary(YOUNG_HOUSE);

describe("turns and days of stock over the house's own span (F-1412)", () => {
  it("takes a sixty-day-old house's purchases over sixty days, not a year", async () => {
    const out = await summary({ currency: "USD", created_at: ago(59) }, [
      order(59),
    ]);
    // $2,000 over 60 days against $1,000 held: 2 turns in 60 days, so
    // about 12.2 a year and 30 days of stock — not 2 turns and 182.5 days.
    expect(out.turnsPeriodDays).toBe(60);
    expect(out.inventoryTurnover).toBeCloseTo((2 * 365) / 60, 5);
    expect(out.daysInventoryOutstanding).toBeCloseTo(30, 5);
    expect(out.basis.turns).toContain("60 days");
  });

  it("starts the span at an order delivered before the house was set up", async () => {
    const out = await summary({ currency: "USD", created_at: ago(10) }, [
      order(89),
    ]);
    expect(out.turnsPeriodDays).toBe(90);
    expect(out.daysInventoryOutstanding).toBeCloseTo(45, 5);
  });

  it("keeps a year for a house older than a year", async () => {
    const out = await summary({ currency: "USD", created_at: ago(900) }, [
      order(50),
    ]);
    expect(out.turnsPeriodDays).toBe(365);
    expect(out.inventoryTurnover).toBeCloseTo(2, 5);
    expect(out.daysInventoryOutstanding).toBeCloseTo(182.5, 5);
  });

  it("gives no turns under a month of records, and says why", async () => {
    const out = await summary({ currency: "USD", created_at: ago(9) }, [
      order(9),
    ]);
    expect(out.cogs).toBe(2000);
    expect(out.inventoryTurnover).toBeNull();
    expect(out.daysInventoryOutstanding).toBeNull();
    expect(out.basis.turns).toContain("10 days of buying on record");
  });

  // F-1493: COGS holds delivered orders only, so the span is the days of
  // buying, not the days since sign-up.
  it("starts the span at the first delivery, not at sign-up (F-1493)", async () => {
    const out = await summary({ currency: "USD", created_at: ago(80) }, [
      order(60),
    ]);
    // $2,000 over the 61 days of buying against $1,000 held: 30.5 days of
    // stock, not 40.5 over the 81 days since sign-up.
    expect(out.turnsPeriodDays).toBe(61);
    expect(out.daysInventoryOutstanding).toBeCloseTo(30.5, 5);
    expect(out.inventoryTurnover).toBeCloseTo((2 * 365) / 61, 5);
  });

  // F-1491: the reason a young house's turns are withheld, in plain words,
  // and the span a scaled figure is taken over.
  it("says why a house under a month of buying has no turns (F-1491)", async () => {
    const out = await summary({ currency: "USD", created_at: ago(45) }, [
      order(20),
    ]);
    expect(out.inventoryTurnover).toBeNull();
    expect(out.turnsSpanShort).toBe(true);
    expect(out.turnsSpanNote).toBe(
      "Turns and days of stock need 30 days of buying on record; this house has 21 days, counted from its first delivery.",
    );
  });

  it("names the days a scaled figure is taken over, and nothing over a year (F-1491)", async () => {
    const young = await summary({ currency: "USD", created_at: ago(59) }, [
      order(59),
    ]);
    expect(young.turnsSpanShort).toBe(false);
    expect(young.turnsSpanNote).toContain(
      "the 60 days since this house's first delivery",
    );
    const old = await summary({ currency: "USD", created_at: ago(900) }, [
      order(50),
    ]);
    expect(old.turnsSpanNote).toBeNull();
  });
});
