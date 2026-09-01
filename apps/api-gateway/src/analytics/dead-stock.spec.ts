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
