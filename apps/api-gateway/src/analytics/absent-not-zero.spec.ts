import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { separableExtremes, type WeekdayProfile } from "./engine/comparisons";

/**
 * Regression guard — three places where analytics answered an ABSENCE with a
 * confident value (filed as `/reports` §9.2-9.4, fixed 2026-09-03).
 *
 *   1. `financial.cogs` / `financial.revenue` were unconditional sums, and
 *      `E.stats.sum([]) === 0`. Both loaders degrade a FAILED query to `[]`,
 *      so "the read failed" and "this restaurant bought nothing in a year"
 *      rendered as the same `$0`.
 *   2. `forecast.totalForecastDemand` was `result ? sum : 0`, and — worse —
 *      `toDailySeries` zero-fills, so a restaurant with no consumption feed
 *      hands Holt-Winters 120 zeros, HW "fits" them, and the endpoint
 *      published a 14-day projection of nothing as a prediction.
 *   3. `seasonality.bestDay` / `worstDay` came from a `reduce` that resolves an
 *      exact tie to whichever weekday came first, so a flat week named Sunday
 *      as both the busiest and the quietest night.
 *
 * Every test below fails against the pre-fix tree. They are one file because
 * they are one fault: a system reporting on itself reports absence as health
 * unless it is forced to prove presence.
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

const analytics = (rows: Rows) =>
  new AnalyticsService({ getClient: () => makeClient(rows) } as any);

const advanced = (rows: Rows) =>
  new AdvancedAnalyticsService(
    { getClient: () => makeClient(rows) } as any,
    { getDemandForecast: async () => ({}) } as any,
    {} as any,
    {} as any,
  );

/** A priced, on-hand inventory row. */
const STOCKED = {
  id: "inv-1",
  wine_name: "Invoiced Chablis",
  stock_live: 5,
  menu_price_current: 60,
  last_purchase_price: 20,
  threshold_min: 2,
  master_wine_id: "mw-1",
};

/** A delivered order that really was placed. */
const DELIVERED = {
  id: "po-1",
  provider_id: "prov-1",
  total_cost: 480,
  final_price: null,
  bottles_total: 12,
  quantity: 12,
  status: "DELIVERED",
  delivered_at: new Date(Date.now() - 10 * 86400000).toISOString(),
  created_at: new Date(Date.now() - 14 * 86400000).toISOString(),
};

/** One consumption row per day for `n` days, ending today. */
const consumption = (n: number, qty: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => ({
    inventory_id: "inv-1",
    consumption_type: "bottle",
    quantity: qty(i),
    volume_ml: null,
    created_at: new Date(Date.now() - (n - 1 - i) * 86400000).toISOString(),
    restaurant_inventory: { master_wine_id: "mw-1" },
  }));

// ---------------------------------------------------------------------------
// 1. financial.cogs / financial.revenue
// ---------------------------------------------------------------------------

describe("financial never reports an empty result set as $0", () => {
  // Since cost-math lane 3.1, `cogs` and `revenue` are the till's figures
  // (cost-of-goods.spec.ts pins them). The two stand-ins this guard was
  // written for keep their own names, and their own absence rule, here.
  it("returns null delivered purchases when no delivered order came back", async () => {
    const out: any = await analytics({
      restaurant_inventory: [STOCKED],
    }).getFinancialSummary(RESTAURANT);
    expect(out.deliveredPurchases).toBeNull();
    expect(out.deliveredPurchases).not.toBe(0);
    expect(out.basis.deliveredPurchases).toContain("no delivered order was returned");
    expect(out.basis.deliveredPurchases).toContain("read that failed");
  });

  it("returns null shelf value when no inventory row came back", async () => {
    const out: any = await analytics({}).getFinancialSummary(RESTAURANT);
    expect(out.shelfValueAtMenuPrice).toBeNull();
    expect(out.shelfValueAtMenuPrice).not.toBe(0);
    expect(out.basis.shelfValueAtMenuPrice).toContain("no inventory row was returned");
  });

  it("still reports real purchases and shelf value, which feed no ratio", async () => {
    const out: any = await analytics({
      restaurant_inventory: [STOCKED],
      procurement_orders: [DELIVERED],
    }).getFinancialSummary(RESTAURANT);
    expect(out.deliveredPurchases).toBe(480);
    expect(out.basis.deliveredPurchases).toContain("1 order summed");
    expect(out.shelfValueAtMenuPrice).toBe(300); // 5 × 60
    // Purchases are not the cost of what sold, and the shelf is not sales.
    expect(out.cogs).toBeNull();
    expect(out.revenue).toBeNull();
    expect(out.cogsRatio).toBeNull();
  });

  it("withholds purchases when a delivered order carries no recorded cost, never adding it as $0", async () => {
    const out: any = await analytics({
      restaurant_inventory: [STOCKED],
      procurement_orders: [DELIVERED, { ...DELIVERED, id: "po-2", total_cost: null, final_price: null }],
    }).getFinancialSummary(RESTAURANT);
    expect(out.deliveredPurchases).toBeNull();
    expect(out.basis.deliveredPurchases).toContain("1 of 2 delivered orders carry no recorded cost");
  });

  it("withholds every ratio that would divide by an absent cost of what sold", async () => {
    // Inventory is fully priced here, so the cost-coverage gate is OPEN — the
    // only thing left to withhold these is the missing till figure itself.
    const out: any = await analytics({
      restaurant_inventory: [STOCKED],
    }).getFinancialSummary(RESTAURANT);
    expect(out.costCoverage.complete).toBe(true);
    expect(out.inventoryValue).toBe(100); // 5 × 20 — knowable, and kept
    expect(out.inventoryTurnover).toBeNull();
    expect(out.daysInventoryOutstanding).toBeNull();
    expect(out.salesWithheld).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. forecast.totalForecastDemand
// ---------------------------------------------------------------------------

describe("forecast publishes nothing when there is nothing to project from", () => {
  it("returns null — not 0 — for a restaurant with no consumption at all", async () => {
    const out: any = await analytics({
      wine_consumption_log: [],
    }).getDemandForecast(RESTAURANT);
    expect(out.totalForecastDemand).toBeNull();
    expect(out.totalForecastDemand).not.toBe(0);
    expect(out.modelFitted).toBe(false);
    expect(out.model).toBeNull();
    expect(out.forecast).toEqual([]);
  });

  it("names the reason: every day of the history reads zero", async () => {
    const out: any = await analytics({
      wine_consumption_log: [],
    }).getDemandForecast(RESTAURANT);
    expect(out.basis.model).toContain("reads zero");
    expect(out.basis.total).toContain("no projection to total");
  });

  it("still projects, and still totals, when the log holds real movement", async () => {
    const out: any = await analytics({
      wine_consumption_log: consumption(120, (i) => 4 + (i % 7)),
    }).getDemandForecast(RESTAURANT);
    expect(out.modelFitted).toBe(true);
    expect(out.model).toBe("holt_winters");
    expect(out.forecast).toHaveLength(14);
    expect(typeof out.totalForecastDemand).toBe("number");
    expect(out.totalForecastDemand).toBeGreaterThan(0);
    expect(out.basis.model).toContain("fitted on 120 days");
  });
});

// ---------------------------------------------------------------------------
// 3. seasonality.bestDay / worstDay
// ---------------------------------------------------------------------------

describe("separableExtremes refuses an extreme that is shared", () => {
  const p = (weekday: number, mean: number): WeekdayProfile => ({
    weekday,
    mean,
    median: mean,
    stdev: 0,
    n: 4,
  });

  it("returns both extremes when exactly one weekday holds each", () => {
    const out = separableExtremes([p(0, 1), p(1, 5), p(2, 3)]);
    expect(out.best?.weekday).toBe(1);
    expect(out.worst?.weekday).toBe(0);
    expect(out.tie).toBe(false);
  });

  it("returns nothing for a flat profile — the case that named Sunday twice", () => {
    const flat = [0, 1, 2, 3, 4, 5, 6].map((d) => p(d, 0));
    expect(separableExtremes(flat)).toEqual({
      best: null,
      worst: null,
      tie: true,
    });
  });

  it("withholds only the shared end when one extreme is separable", () => {
    // Two weekdays tie for the top; the bottom is unique. Nulling both would
    // throw away a true answer, so only the ambiguous end is withheld.
    const out = separableExtremes([p(0, 9), p(1, 9), p(2, 2)]);
    expect(out.best).toBeNull();
    expect(out.worst?.weekday).toBe(2);
    expect(out.tie).toBe(true);
  });

  it("calls a single observed weekday unrankable rather than best and worst", () => {
    const out = separableExtremes([p(3, 7)]);
    expect(out.best).toBeNull();
    expect(out.worst).toBeNull();
    expect(out.tie).toBe(true);
  });
});

describe("seasonality withholds a day it cannot separate", () => {
  it("reports null for both days on a week with no movement", async () => {
    const out: any = await advanced({}).getSeasonality(RESTAURANT);
    expect(out.bestDay).toBeNull();
    expect(out.worstDay).toBeNull();
    expect(out.tie).toBe(true);
    expect(out.basis.extremes).toContain("arbitrary tie-break");
  });

  it("does not report the same day as both busiest and quietest", async () => {
    // The exact pre-fix payload: bestDay === worstDay === "Sunday".
    const out: any = await advanced({}).getSeasonality(RESTAURANT);
    expect(out.bestDay).not.toBe("Sunday");
    expect(out.bestDay === out.worstDay && out.bestDay !== null).toBe(false);
  });

  it("names a real busiest and quietest day when the week has a shape", async () => {
    // Seven consecutive days, seven distinct quantities — every weekday ends
    // with a distinct mean, so both extremes are separable.
    const out: any = await advanced({
      wine_consumption_log: consumption(7, (i) => (i + 1) * 3),
    }).getSeasonality(RESTAURANT);
    expect(out.tie).toBe(false);
    expect(typeof out.bestDay).toBe("string");
    expect(typeof out.worstDay).toBe("string");
    expect(out.bestDay).not.toBe(out.worstDay);
    expect(out.basis.extremes).toContain("single weekdays");
  });
});

// ---------------------------------------------------------------------------
// The working the house reads: no table name, no `$`, in every state.
// ---------------------------------------------------------------------------

describe("the financial working is said in the house's words", () => {
  // /reports prints these under "Show the working" and the export prints them
  // in the download (r9 left list, 2026-11-12: a lira house read
  // "delivered procurement_orders … $0 would claim the first").
  const CODE = /\b[a-z]+_[a-z0-9_]+\b|\$|\bqty\b|\bnull\b|\d+d\b/;
  const states: Array<[string, Record<string, any[]>]> = [
    ["nothing came back", {}],
    ["priced and delivered", { restaurant_inventory: [STOCKED], procurement_orders: [DELIVERED] }],
    [
      "an uncosted order",
      {
        restaurant_inventory: [STOCKED],
        procurement_orders: [DELIVERED, { ...DELIVERED, id: "po-2", total_cost: null, final_price: null }],
      },
    ],
  ];
  it.each(states)("%s", async (_label, rows) => {
    const out: any = await analytics(rows).getFinancialSummary(RESTAURANT);
    for (const key of ["deliveredPurchases", "shelfValueAtMenuPrice", "deadStock"]) {
      expect([key, out.basis[key]]).toEqual([key, expect.any(String)]);
      expect([key, out.basis[key]]).not.toEqual([key, expect.stringMatching(CODE)]);
    }
  });
});
