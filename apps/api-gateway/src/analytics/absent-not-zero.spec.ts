import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { separableExtremes, type WeekdayProfile } from "./engine/comparisons";
import { GoalsService } from "./goals.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import {
  MixedCurrencySpendError,
  UnpricedSpendError,
} from "../procurement/order-spend";

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
      // The house's zone row (seasonality files on the house's day, F-185);
      // every other single-row read answers nothing.
      builder.maybeSingle = jest.fn(() =>
        Promise.resolve({
          data:
            table === "restaurants" ? (rowsByTable[table]?.[0] ?? null) : null,
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
  it("returns null COGS when no delivered order came back", async () => {
    const out: any = await analytics({
      restaurant_inventory: [STOCKED],
    }).getFinancialSummary(RESTAURANT);
    expect(out.cogs).toBeNull();
    expect(out.cogs).not.toBe(0);
  });

  it("says in the basis WHY the COGS is null", async () => {
    const out: any = await analytics({
      restaurant_inventory: [STOCKED],
    }).getFinancialSummary(RESTAURANT);
    // The load-bearing assertion: a null with no explanation is only half a fix.
    expect(out.basis.cogs).toContain("no delivered order was returned");
    // A failed read no longer lands here as a second possibility: it refuses
    // the summary (F-332), and the basis says so rather than offering it.
    expect(out.basis.cogs).toContain("a failed read refuses the summary");
  });

  it("returns null revenue when no inventory row came back", async () => {
    const out: any = await analytics({}).getFinancialSummary(RESTAURANT);
    expect(out.revenue).toBeNull();
    expect(out.revenue).not.toBe(0);
    expect(out.basis.revenue).toContain("no inventory row was returned");
  });

  it("still reports a real COGS, and counts the orders it summed", async () => {
    const out: any = await analytics({
      restaurant_inventory: [STOCKED],
      procurement_orders: [DELIVERED],
    }).getFinancialSummary(RESTAURANT);
    expect(out.cogs).toBe(480);
    expect(out.basis.cogs).toContain("1 order summed");
    expect(out.revenue).toBe(300); // 5 × 60
    expect(out.basis.revenue).toContain("1 inventory row valued");
  });

  it("never adds orders placed in two currencies into one COGS (F-339)", async () => {
    const out: any = await analytics({
      restaurant_inventory: [STOCKED],
      procurement_orders: [
        { ...DELIVERED, currency: "TRY", total_cost: 12000 },
        { ...DELIVERED, id: "po-2", currency: "EUR", total_cost: 400 },
      ],
    }).getFinancialSummary(RESTAURANT);
    expect(out.cogs).toBeNull();
    expect(out.basis.cogs).toContain("placed in EUR, TRY");
    // F-1054: the page says the currencies, not "no delivered order".
    expect(out.cogsNote).toBe(
      "Ordered in EUR and TRY: with no exchange rate on record these cannot be added into one figure.",
    );
    // One named currency (plus an order that names none) still sums.
    const one: any = await analytics({
      restaurant_inventory: [STOCKED],
      procurement_orders: [
        { ...DELIVERED, currency: "TRY", total_cost: 12000 },
        { ...DELIVERED, id: "po-2", total_cost: 400 },
      ],
    }).getFinancialSummary(RESTAURANT);
    expect(one.cogs).toBe(12400);
    expect(one.cogsNote).toBeNull();
  });

  // F-701: an order placed with no price is written total_cost 0. It used to
  // add $0, or one bottle's `final_price` as the whole order, and say nothing.
  it("leaves a delivered order with no price out of COGS and counts it", async () => {
    const out: any = await analytics({
      restaurant_inventory: [STOCKED],
      procurement_orders: [
        DELIVERED,
        { ...DELIVERED, id: "po-2", total_cost: 0, final_price: 17 },
      ],
    }).getFinancialSummary(RESTAURANT);
    expect(out.cogs).toBe(480);
    expect(out.cogsUnpricedCount).toBe(1);
    expect(out.basis.cogs).toContain("1 order summed");
    expect(out.basis.cogs).toContain(
      "1 delivered order with no price left out",
    );
  });

  it("withholds every ratio that would divide by an absent COGS or revenue", async () => {
    // Inventory is fully priced here, so the cost-coverage gate is OPEN — the
    // only thing left to withhold these is the missing COGS/revenue itself.
    const out: any = await analytics({
      restaurant_inventory: [STOCKED],
    }).getFinancialSummary(RESTAURANT);
    expect(out.costCoverage.complete).toBe(true);
    expect(out.inventoryValue).toBe(100); // 5 × 20 — knowable, and kept
    expect(out.inventoryTurnover).toBeNull();
    expect(out.daysInventoryOutstanding).toBeNull();
    expect(out.basis.costDerived).toContain("absent denominator");
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

/** A house on UTC, so a line's house day is its UTC date. */
const UTC_HOUSE = [{ timezone: "UTC" }];

describe("seasonality withholds a day it cannot separate", () => {
  it("reports null for both days on a week with no movement", async () => {
    const out: any = await advanced({ restaurants: UTC_HOUSE }).getSeasonality(
      RESTAURANT,
    );
    expect(out.bestDay).toBeNull();
    expect(out.worstDay).toBeNull();
    // F-709: days with no movement are closures, not zeros, so nothing is
    // left to tie — the basis says no open day is on record.
    expect(out.tie).toBe(false);
    expect(out.separated).toBe(false);
    expect(out.basis.extremes).toContain("no open day");
  });

  it("does not rank a weekday the house is shut, or a day the manager excluded (F-709)", async () => {
    // Nine weeks, closed every Monday; one excluded buyout lifts a Sunday.
    const rows = consumption(63, (i) => {
      const wd = new Date(Date.now() - (62 - i) * 86400000).getUTCDay();
      return wd === 6 ? 30 : wd === 0 ? 2 : 10;
    }).filter((r) => new Date(r.created_at).getUTCDay() !== 1);
    const sunday = rows.find((r) => new Date(r.created_at).getUTCDay() === 0)!;
    sunday.quantity = 500;
    const buyout = sunday.created_at.substring(0, 10);
    const out: any = await advanced({
      restaurants: UTC_HOUSE,
      wine_consumption_log: rows,
      analytics_day_exclusions: [{ business_date: buyout }],
    }).getSeasonality(RESTAURANT);
    expect(out.weekdayProfile.map((p: any) => p.day)).not.toContain("Monday");
    expect(out.worstDay).toBe("Sunday");
    expect(out.bestDay).toBe("Saturday");
  });

  it("calls a gap reliable only when it stands clear of the spread (F-709)", async () => {
    // Saturday 20.1 against Friday 20.0, with a wobble of ±3 on every day.
    const noisy = consumption(63, (i) => {
      const wd = new Date(Date.now() - (62 - i) * 86400000).getUTCDay();
      const base = wd === 6 ? 20.1 : wd === 5 ? 20 : wd === 0 ? 5 : 10;
      return base + (i % 2 === 0 ? 3 : -3);
    });
    const close: any = await advanced({
      restaurants: UTC_HOUSE,
      wine_consumption_log: noisy,
    }).getSeasonality(RESTAURANT);
    expect(close.bestDay).toBe("Saturday");
    expect(close.separated).toBe(false);

    const clear = consumption(63, (i) => {
      const wd = new Date(Date.now() - (62 - i) * 86400000).getUTCDay();
      const base = wd === 6 ? 40 : wd === 0 ? 2 : 10 + wd;
      return base + (i % 2 === 0 ? 0.5 : -0.5);
    });
    const apart: any = await advanced({
      restaurants: UTC_HOUSE,
      wine_consumption_log: clear,
    }).getSeasonality(RESTAURANT);
    expect(apart.bestDay).toBe("Saturday");
    expect(apart.worstDay).toBe("Sunday");
    expect(apart.separated).toBe(true);
  });

  it("does not report the same day as both busiest and quietest", async () => {
    // The exact pre-fix payload: bestDay === worstDay === "Sunday".
    const out: any = await advanced({ restaurants: UTC_HOUSE }).getSeasonality(
      RESTAURANT,
    );
    expect(out.bestDay).not.toBe("Sunday");
    expect(out.bestDay === out.worstDay && out.bestDay !== null).toBe(false);
  });

  it("names a real busiest and quietest day when the week has a shape", async () => {
    // Seven consecutive days, seven distinct quantities — every weekday ends
    // with a distinct mean, so both extremes are separable.
    const out: any = await advanced({
      restaurants: UTC_HOUSE,
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
// F-701 on every other purchases reader: an order with no price is not $0
// ---------------------------------------------------------------------------

describe("every purchases reader leaves an unpriced order out and says so", () => {
  // `total_cost` 0 is how an order placed with no price is written; the
  // `final_price` 17 is one bottle's price, the old fallback's whole order.
  const UNPRICED = { ...DELIVERED, id: "po-2", total_cost: 0, final_price: 17 };
  const OPEN_UNPRICED = {
    ...UNPRICED,
    id: "po-3",
    status: "IN_TRANSIT",
    delivered_at: null,
  };

  it("cashflow counts the unpriced delivery and the unpriced open order", async () => {
    const out: any = await advanced({
      procurement_orders: [DELIVERED, UNPRICED, OPEN_UNPRICED],
    }).getCashflow(RESTAURANT);
    expect(out.spendLast30d).toBe(480);
    expect(out.spendUnpricedCount).toBe(1);
    expect(out.committedOpenOrders).toBe(0);
    expect(out.committedUnpricedCount).toBe(1);
  });

  it("the vendor scorecard does not take one bottle's price for the order", async () => {
    const out: any = await advanced({
      procurement_orders: [DELIVERED, UNPRICED],
    }).getVendorScorecard(RESTAURANT);
    expect(out.vendors).toHaveLength(1);
    expect(out.vendors[0].spend).toBe(480);
    expect(out.vendors[0].unpricedCount).toBe(1);
    expect(out.vendors[0].unitPrice.mean).toBe(40);
    expect(out.concentration.unpricedCount).toBe(1);
  });

  const goals = (rows: Rows) =>
    new GoalsService(
      { getClient: () => makeClient(rows) } as any,
      { getStored: async () => [] } as any,
      {} as any,
      {} as any,
      {} as any,
      { getFinancialSummary: async () => ({}) } as any,
    );
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  it("the purchase spend goal refuses a total short of an unpriced delivery", async () => {
    const err = await (
      goals({ procurement_orders: [DELIVERED, UNPRICED] }) as any
    )
      .computeMetricWithSeries(
        RESTAURANT,
        "purchase_spend",
        since,
        undefined,
        "UTC",
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnpricedSpendError);
    expect((err as Error).message).toContain(
      "1 delivery in this window carries no price",
    );
  });

  it("the purchase spend goal still totals a window where every order is priced", async () => {
    const out = await (
      goals({ procurement_orders: [DELIVERED] }) as any
    ).computeMetricWithSeries(
      RESTAURANT,
      "purchase_spend",
      since,
      undefined,
      "UTC",
    );
    expect(out.current).toBe(480);
  });

  const insights = (rows: Rows) =>
    new InsightGeneratorService(
      { getClient: () => makeClient(rows) } as any,
      {
        load: async () => ({ dates: new Set<string>(), readable: true }),
      } as any,
      {} as any,
    );

  it("the insight bundle carries an unpriced order as null, never one bottle's price", async () => {
    const bundle = await (
      insights({ procurement_orders: [DELIVERED, UNPRICED] }) as any
    ).loadBundle(RESTAURANT);
    expect(bundle.orders.map((o: any) => o.cost).sort()).toEqual(
      [480, null].sort(),
    );
  });

  it("says nothing about purchasing spend while an order in the window is unpriced", () => {
    const svc = insights({}) as any;
    const pushed: any[] = [];
    const bundle = {
      availability: new Set(["orders"]),
      excludedDates: new Set<string>(),
      orders: [
        { vendorId: "a", vendorName: "A", cost: 480, date: "2026-10-01" },
        { vendorId: "b", vendorName: "B", cost: null, date: "2026-10-02" },
      ],
    };
    svc.computeOrdersFamily(bundle, (r: any) => pushed.push(r));
    expect(pushed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F-1015 (rehit of F-339): the other spend readers add no lira to euros
// ---------------------------------------------------------------------------

describe("no spend reader adds orders paid in two currencies", () => {
  // A lira house buying from a euro importer and a lira supplier.
  const EUR_ORDER = {
    ...DELIVERED,
    id: "po-eur",
    provider_id: "prov-importer",
    currency: "EUR",
    total_cost: 8000,
  };
  const TRY_ORDER = {
    ...DELIVERED,
    id: "po-try",
    provider_id: "prov-local",
    currency: "try",
    total_cost: 300000,
  };
  const UNPRICED = { ...DELIVERED, id: "po-0", total_cost: 0, final_price: 17 };

  it("the risk lens takes no vendor shares across two currencies, and says why", async () => {
    const out: any = await analytics({
      restaurant_inventory: [STOCKED],
      procurement_orders: [EUR_ORDER, TRY_ORDER],
    }).getRiskProfile(RESTAURANT);
    expect(out.vendorConcentration.hhi).toBeNull();
    expect(out.vendorConcentration.effectiveVendors).toBeNull();
    expect(out.vendorConcentration.cr4).toBeNull();
    expect(out.vendorConcentration.vendorCount).toBe(2);
    expect(out.basis.vendorConcentration).toContain("placed in EUR, TRY");
  });

  it("the risk lens leaves an unpriced order out of the shares and counts it", async () => {
    const priced = { ...DELIVERED, provider_id: "prov-2", total_cost: 480 };
    const out: any = await analytics({
      restaurant_inventory: [STOCKED],
      // prov-1's only order carries no price: it is not a vendor at 0 share.
      procurement_orders: [{ ...UNPRICED, provider_id: "prov-1" }, priced],
    }).getRiskProfile(RESTAURANT);
    expect(out.vendorConcentration.hhi).toBe(1);
    expect(out.vendorConcentration.vendorCount).toBe(1);
    expect(out.vendorConcentration.unpricedCount).toBe(1);
    expect(out.basis.vendorConcentration).toContain(
      "1 delivered order with no price left out",
    );
  });

  it("the risk lens still takes shares when one currency is named", async () => {
    const out: any = await analytics({
      restaurant_inventory: [STOCKED],
      procurement_orders: [
        { ...TRY_ORDER, total_cost: 100 },
        {
          ...TRY_ORDER,
          id: "po-2",
          provider_id: "prov-other",
          total_cost: 100,
        },
      ],
    }).getRiskProfile(RESTAURANT);
    expect(out.vendorConcentration.hhi).toBeCloseTo(0.5);
    expect(out.basis.vendorConcentration).toContain(
      "shares of 2 priced orders",
    );
  });

  const goals = (rows: Rows) =>
    new GoalsService(
      { getClient: () => makeClient(rows) } as any,
      { getStored: async () => [] } as any,
      {} as any,
      {} as any,
      {} as any,
      { getFinancialSummary: async () => ({}) } as any,
    );
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  it("the purchase spend goal refuses a total across two currencies", async () => {
    const err = await (
      goals({ procurement_orders: [EUR_ORDER, TRY_ORDER] }) as any
    )
      .computeMetricWithSeries(
        RESTAURANT,
        "purchase_spend",
        since,
        undefined,
        "UTC",
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MixedCurrencySpendError);
    expect((err as Error).message).toContain("paid in EUR and TRY");
  });

  const insights = (rows: Rows) =>
    new InsightGeneratorService(
      { getClient: () => makeClient(rows) } as any,
      {
        load: async () => ({ dates: new Set<string>(), readable: true }),
      } as any,
      {} as any,
    );

  it("the insight bundle carries each order's currency", async () => {
    const bundle = await (
      insights({ procurement_orders: [EUR_ORDER, TRY_ORDER] }) as any
    ).loadBundle(RESTAURANT);
    expect(bundle.orders.map((o: any) => o.currency).sort()).toEqual([
      "EUR",
      "TRY",
    ]);
  });

  const familyOver = (orders: any[], currency: string | null) => {
    const svc = insights({}) as any;
    const pushed: any[] = [];
    svc.computeOrdersFamily(
      {
        availability: new Set(["orders"]),
        excludedDates: new Set<string>(),
        currency,
        locale: null,
        zone: null,
        orders,
      },
      (r: any) => pushed.push(r),
    );
    return pushed;
  };
  const day = (n: number) =>
    new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

  it("says nothing about purchasing spend when the orders were paid in two currencies", () => {
    expect(
      familyOver(
        [
          {
            vendorId: "a",
            vendorName: "A",
            cost: 8000,
            currency: "EUR",
            date: day(3),
          },
          {
            vendorId: "b",
            vendorName: "B",
            cost: 300000,
            currency: "TRY",
            date: day(2),
          },
        ],
        "TRY",
      ),
    ).toEqual([]);
  });

  it("prints vendor shares in the money the orders were paid in", () => {
    const pushed = familyOver(
      [
        {
          vendorId: "a",
          vendorName: "A",
          cost: 900,
          currency: "EUR",
          date: day(3),
        },
        {
          vendorId: "b",
          vendorName: "B",
          cost: 100,
          currency: "EUR",
          date: day(2),
        },
      ],
      "TRY",
    );
    const share = pushed.find(
      (r) => r?.candidateKey === "vendor.purchase_spend.concentration",
    );
    expect(share).toBeDefined();
    expect(share.evidence.currency).toBe("EUR");
  });
});

// ---------------------------------------------------------------------------
// F-1042 (F-339 family): the cashflow and vendor lenses add no lira to euros
// ---------------------------------------------------------------------------

describe("the cashflow and vendor lenses add no lira to euros", () => {
  const EUR = { ...DELIVERED, id: "po-eur", currency: "EUR", total_cost: 400 };
  const TRY = {
    ...DELIVERED,
    id: "po-try",
    currency: "TRY",
    total_cost: 12000,
  };
  const UNPRICED = { ...DELIVERED, id: "po-0", total_cost: 0, final_price: 17 };
  const open = (o: any) => ({
    ...o,
    id: `${o.id}-open`,
    status: "IN_TRANSIT",
    delivered_at: null,
  });

  it("cashflow gives no paid-out figure across two currencies, and says why", async () => {
    const out: any = await advanced({
      procurement_orders: [EUR, TRY, UNPRICED],
    }).getCashflow(RESTAURANT);
    expect(out.spendLast30d).toBeNull();
    expect(out.spendPrev30d).toBeNull();
    expect(out.paceDeltaPct).toBeNull();
    expect(out.projectedNext4Weeks).toBeNull();
    expect(out.spendNote).toContain("EUR and TRY");
    // The unpriced delivery is named, not read as 0.
    expect(out.spendUnpricedCount).toBe(1);
  });

  it("cashflow gives no committed figure across two currencies, and shows each", async () => {
    const out: any = await advanced({
      procurement_orders: [open(EUR), open(TRY), open(UNPRICED)],
    }).getCashflow(RESTAURANT);
    expect(out.committedOpenOrders).toBeNull();
    expect(out.committedByCurrency).toEqual(
      expect.arrayContaining([
        { currency: "EUR", amount: 400 },
        { currency: "TRY", amount: 12000 },
      ]),
    );
    expect(out.committedNote).toContain("Ordered in EUR and TRY");
    expect(out.committedUnpricedCount).toBe(1);
  });

  it("cashflow gives no order value for uncounted orders across two currencies", async () => {
    const approved = (o: any) => ({ ...open(o), status: "APPROVED" });
    const out: any = await advanced({
      procurement_orders: [approved(EUR), approved(TRY)],
    }).getCashflow(RESTAURANT);
    expect(out.notCounted.approved).toBe(2);
    expect(out.notCounted.orderValue).toBeNull();
    expect(out.notCounted.orderValueNote).toContain("EUR and TRY");
  });

  it("cashflow still sums one currency", async () => {
    const out: any = await advanced({
      procurement_orders: [EUR, { ...EUR, id: "po-eur-2" }, open(EUR)],
    }).getCashflow(RESTAURANT);
    expect(out.spendLast30d).toBe(800);
    expect(out.spendNote).toBeNull();
    expect(out.committedOpenOrders).toBe(400);
    expect(out.committedNote).toBeNull();
  });

  it("the vendor scorecard gives a vendor paid in two currencies no spend or price series", async () => {
    const out: any = await advanced({
      procurement_orders: [EUR, TRY, UNPRICED],
    }).getVendorScorecard(RESTAURANT);
    const v = out.vendors[0];
    expect(v.spend).toBeNull();
    expect(v.spendByCurrency).toEqual(
      expect.arrayContaining([
        { currency: "EUR", amount: 400 },
        { currency: "TRY", amount: 12000 },
      ]),
    );
    expect(v.spendNote).toContain("EUR and TRY");
    expect(v.unpricedCount).toBe(1);
    expect(v.unitPrice.mean).toBeNull();
    expect(v.unitPrice.latest).toBeNull();
  });

  it("the vendor scorecard takes no shares across vendors paid in two currencies", async () => {
    const out: any = await advanced({
      procurement_orders: [EUR, { ...TRY, provider_id: "prov-2" }],
    }).getVendorScorecard(RESTAURANT);
    expect(out.vendors.map((v: any) => v.spend).sort()).toEqual(
      [12000, 400].sort(),
    );
    expect(out.concentration.hhi).toBeNull();
    expect(out.concentration.effectiveVendors).toBeNull();
    expect(out.concentration.note).toContain("EUR and TRY");
  });

  it("the vendor scorecard still takes shares in one currency", async () => {
    const out: any = await advanced({
      procurement_orders: [EUR, { ...EUR, id: "po-2", provider_id: "prov-2" }],
    }).getVendorScorecard(RESTAURANT);
    expect(out.concentration.hhi).toBeCloseTo(0.5);
    expect(out.concentration.note).toBeNull();
  });
});
