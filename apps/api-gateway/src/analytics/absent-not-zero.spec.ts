import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { separableExtremes, type WeekdayProfile } from "./engine/comparisons";
import * as E from "./engine";

/**
 * Regression guard — three places where analytics answered an ABSENCE with a
 * confident value (filed as `/reports` §9.2-9.4, fixed 2026-09-03).
 *
 *   1. `financial.cogs` / `financial.revenue` were unconditional sums, and
 *      `E.stats.sum([]) === 0`. Both loaders degrade a FAILED query to `[]`,
 *      so "the read failed" and "this restaurant bought nothing in a year"
 *      rendered as the same `$0`. Since ADR 0298 both read the till (one call
 *      to public.pos_item_sales): cost of goods is the bottles the POS moved
 *      at their recorded cost, not delivered purchases, and sales are POS
 *      line sales, not menu price × bottles on hand. The old two figures keep
 *      their own names (`deliveredPurchases`, `shelfValueAtMenuPrice`) and
 *      feed no ratio. Section 4 holds the revenue Gini to the same till.
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

/** What the fake's `.rpc("pos_item_sales")` answers. Unset is a null payload,
 *  which the service reads as a failed read (not the function's shape). */
type Rpc = { data?: unknown; error?: unknown; throws?: boolean };

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
    rpc: jest.fn(() =>
      rpc.throws
        ? Promise.reject(new Error("fetch failed"))
        : Promise.resolve({ data: rpc.data ?? null, error: rpc.error ?? null }),
    ),
  };
}

const RESTAURANT = "33333333-3333-3333-3333-333333333333";

const analytics = (rows: Rows, rpc?: Rpc) =>
  new AnalyticsService({ getClient: () => makeClient(rows, rpc) } as any);

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86400000).toISOString();

/** A pos_item_sales payload, in the function's own snake_case shape. */
const till = (over: Record<string, unknown> = {}) => ({
  data: {
    items: [],
    checks: 0,
    lines: 0,
    unmapped_lines: 0,
    unmapped_sales: 0,
    unreadable_lines: 0,
    first_sale_at: null,
    ...over,
  },
});

/** The till sold 3 bottles of STOCKED for 180 over 60 days. */
const SOLD_THREE = till({
  items: [
    {
      inventory_id: "inv-1",
      sales: 180,
      units: 3,
      lines: 2,
      bottles_out: 3,
      mapped: true,
    },
  ],
  checks: 2,
  lines: 3,
  unmapped_lines: 1,
  unmapped_sales: 9,
  first_sale_at: daysAgo(60),
});

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
  it("returns null COGS and sales when the POS sales read fails, and says so", async () => {
    const out: any = await analytics(
      { restaurant_inventory: [STOCKED], procurement_orders: [DELIVERED] },
      { error: { message: "permission denied" } },
    ).getFinancialSummary(RESTAURANT);
    expect(out.cogs).toBeNull();
    expect(out.revenue).toBeNull();
    // The load-bearing assertion: a null with no explanation is half a fix.
    expect(out.basis.cogs).toContain("the POS sales read failed");
    expect(out.basis.revenue).toContain("the POS sales read failed");
    expect(out.salesCoverage).toBeNull();
  });

  it("reads a thrown call or a payload of the wrong shape as a failed read", async () => {
    // The last: an item with no `mapped` flag is not the function's shape.
    const noFlag = till({
      ...SOLD_THREE.data,
      items: [
        { inventory_id: "inv-1", sales: 1, units: 1, lines: 1, bottles_out: 1 },
      ],
    });
    for (const rpc of [
      { throws: true },
      { data: { items: "x" } },
      {},
      noFlag,
    ]) {
      const out: any = await analytics(
        { restaurant_inventory: [STOCKED] },
        rpc,
      ).getFinancialSummary(RESTAURANT);
      expect(out.cogs).toBeNull();
      expect(out.revenue).toBeNull();
      expect(out.basis.cogs).toContain("read failed");
    }
  });

  it("returns null COGS and sales when the till recorded nothing", async () => {
    const out: any = await analytics(
      { restaurant_inventory: [STOCKED], procurement_orders: [DELIVERED] },
      till(),
    ).getFinancialSummary(RESTAURANT);
    expect(out.cogs).toBeNull();
    expect(out.cogs).not.toBe(0);
    expect(out.revenue).toBeNull();
    expect(out.basis.cogs).toContain("recorded no closed check");
    expect(out.basis.revenue).toContain("no closed POS check");
  });

  it("keeps purchases and shelf value under their own names, null when absent", async () => {
    const empty: any = await analytics({}, SOLD_THREE).getFinancialSummary(
      RESTAURANT,
    );
    expect(empty.deliveredPurchases).toBeNull();
    expect(empty.basis.deliveredPurchases).toContain(
      "no delivered order was returned",
    );
    expect(empty.basis.deliveredPurchases).toContain("read that failed");
    expect(empty.shelfValueAtMenuPrice).toBeNull();
    expect(empty.basis.shelfValueAtMenuPrice).toContain(
      "no inventory row was returned",
    );
  });

  it("cost of goods is what sold at its cost, not what was delivered (A-046)", async () => {
    const out: any = await analytics(
      { restaurant_inventory: [STOCKED], procurement_orders: [DELIVERED] },
      SOLD_THREE,
    ).getFinancialSummary(RESTAURANT);
    // 3 bottles out × the recorded cost of 20. The pre-fix figure was 480,
    // the delivered order, printed as "Cost of goods (365d)".
    expect(out.cogs).toBe(60);
    expect(out.deliveredPurchases).toBe(480);
    expect(out.basis.cogs).toContain("1 item, 3 bottles out");
    expect(out.basis.deliveredPurchases).toContain("1 order summed");
    expect(out.cogsCoverage).toMatchObject({
      total: 1,
      priced: 1,
      unpriced: 0,
      complete: true,
      bottlesSold: 3,
      bottlesCosted: 3,
      itemsNetReturned: 0,
    });
  });

  it("sales are what the till took, not menu price × bottles on hand", async () => {
    const out: any = await analytics(
      { restaurant_inventory: [STOCKED] },
      SOLD_THREE,
    ).getFinancialSummary(RESTAURANT);
    expect(out.revenue).toBe(180);
    expect(out.shelfValueAtMenuPrice).toBe(300); // 5 × 60: the old "revenue"
    expect(out.basis.revenue).toContain("2 checks");
    expect(out.basis.revenue).toContain("1 line naming no stock item left out");
    expect(out.salesCoverage).toMatchObject({
      checks: 2,
      lines: 3,
      unmappedLines: 1,
      unmappedSales: 9,
      unreadableLines: 0,
      itemsSoldWithoutStockMove: 0,
    });
    // The ratios divide the till's cost by the till's sales.
    expect(out.grossMarginDollars).toBe(120);
    expect(out.cogsRatio).toBeCloseTo(60 / 180, 10);
    expect(out.grossMargin).toBeCloseTo(120 / 180, 10);
    expect(out.primeCostRatio).toBeCloseTo(60 / 180, 10);
  });

  it("withholds sales when a line names a stock item but cannot be read", async () => {
    const out: any = await analytics(
      { restaurant_inventory: [STOCKED] },
      till({ ...SOLD_THREE.data, unreadable_lines: 1 }),
    ).getFinancialSummary(RESTAURANT);
    expect(out.revenue).toBeNull();
    expect(out.basis.revenue).toContain("cannot be read");
    expect(out.cogsRatio).toBeNull();
  });

  it("withholds cost of goods when the till sold stock but moved none", async () => {
    // The verifier's case: five checks, one item sold for 500, no bottle out
    // (a mapped line flagged not-stock, or a sale the ledger refused). The
    // sum over no rows is 0, which printed a 100% margin and a GMROI of 30.
    const out: any = await analytics(
      { restaurant_inventory: [STOCKED] },
      till({
        items: [
          {
            inventory_id: "inv-1",
            sales: 500,
            units: 5,
            lines: 5,
            bottles_out: 0,
            mapped: true,
          },
        ],
        checks: 5,
        lines: 5,
        first_sale_at: daysAgo(60),
      }),
    ).getFinancialSummary(RESTAURANT);
    expect(out.cogs).toBeNull();
    expect(out.cogs).not.toBe(0);
    expect(out.revenue).toBe(500);
    for (const k of [
      "grossMarginDollars",
      "grossMargin",
      "cogsRatio",
      "primeCostRatio",
      "inventoryTurnover",
      "daysInventoryOutstanding",
      "gmroi",
    ])
      expect(out[k]).toBeNull();
    expect(out.basis.cogs).toContain(
      "1 item sold at the till but the POS moved no stock for any item",
    );
    expect(out.salesCoverage.itemsSoldWithoutStockMove).toBe(1);
  });

  it("withholds cost of goods when no line sold a stock item and nothing moved", async () => {
    const out: any = await analytics(
      { restaurant_inventory: [STOCKED] },
      till({ checks: 4, lines: 6, unmapped_lines: 6, unmapped_sales: 90 }),
    ).getFinancialSummary(RESTAURANT);
    expect(out.cogs).toBeNull();
    expect(out.inventoryTurnover).toBeNull();
    expect(out.gmroi).toBeNull();
    expect(out.basis.cogs).toContain(
      "4 closed checks, but no line sold a stock item and the POS moved no stock",
    );
  });

  it("keeps cost of goods when one item moved stock, and names the one that did not", async () => {
    const out: any = await analytics(
      { restaurant_inventory: [STOCKED] },
      till({
        ...SOLD_THREE.data,
        items: [
          ...(SOLD_THREE.data.items as object[]),
          {
            inventory_id: "inv-glass",
            sales: 30,
            units: 3,
            lines: 3,
            bottles_out: 0,
            mapped: true,
          },
        ],
      }),
    ).getFinancialSummary(RESTAURANT);
    expect(out.cogs).toBe(60);
    expect(out.basis.cogs).toContain(
      "1 item sold without moving stock, and its cost is not in it",
    );
    expect(out.salesCoverage.itemsSoldWithoutStockMove).toBe(1);
  });

  it("annualises turns, DIO and GMROI from the span the till observed", async () => {
    const out: any = await analytics(
      { restaurant_inventory: [STOCKED] },
      SOLD_THREE,
    ).getFinancialSummary(RESTAURANT);
    expect(out.cogsWindow).toMatchObject({ days: 60 });
    expect(out.inventoryValue).toBe(100); // 5 × 20
    // 60 of cost over 60 days is 365 a year, against 100 on the shelf.
    expect(out.inventoryTurnover).toBeCloseTo(3.65, 10);
    expect(out.daysInventoryOutstanding).toBeCloseTo(100, 10);
    expect(out.gmroi).toBeCloseTo((120 * 365) / 60 / 100, 10);
    expect(out.basis.costDerived).toContain("60 days observed");
  });

  // PR #617's audit at 847f2470d: first_sale_at is the earlier of the first
  // closed check and the first POS stock move, so where they are days apart
  // one figure holds days the other does not. The basis names both dates; it
  // does not correct for it or say how much it moves the figure.
  it("names both clocks when sales start days before the first stock move", async () => {
    const check = daysAgo(60);
    const move = daysAgo(45);
    const out: any = await analytics(
      { restaurant_inventory: [STOCKED] },
      till({
        ...SOLD_THREE.data,
        first_sale_at: check,
        first_check_at: check,
        first_move_at: move,
      }),
    ).getFinancialSummary(RESTAURANT);
    expect(out.cogs).toBe(60);
    expect(out.cogsWindow).toMatchObject({
      since: check,
      days: 60,
      firstCheckAt: check,
      firstMoveAt: move,
    });
    expect(out.basis.cogs).toContain(
      `sales start at the first closed check in the window (${check.slice(0, 10)}) and stock moves at the first POS ledger row (${move.slice(0, 10)}), 15 days later, so cost of goods holds no stock move from those days while sales and the span annualised include them`,
    );
  });

  it("names both clocks when stock moves start days before the first check", async () => {
    const move = daysAgo(60);
    const check = daysAgo(50);
    const out: any = await analytics(
      { restaurant_inventory: [STOCKED] },
      till({
        ...SOLD_THREE.data,
        first_sale_at: move,
        first_check_at: check,
        first_move_at: move,
      }),
    ).getFinancialSummary(RESTAURANT);
    expect(out.basis.cogs).toContain(
      `stock moves start at the first POS ledger row in the window (${move.slice(0, 10)}) and sales at the first closed check (${check.slice(0, 10)}), 10 days later, so sales hold no check from those days while cost of goods and the span annualised include them`,
    );
  });

  it("says nothing of the clocks when they are under a day apart or one is unknown", async () => {
    const at = daysAgo(60);
    for (const clocks of [
      { first_check_at: at, first_move_at: at },
      { first_check_at: at },
      {},
    ]) {
      const out: any = await analytics(
        { restaurant_inventory: [STOCKED] },
        till({ ...SOLD_THREE.data, first_sale_at: at, ...clocks }),
      ).getFinancialSummary(RESTAURANT);
      expect(out.cogs).toBe(60);
      expect(out.basis.cogs).not.toContain("first POS ledger row");
    }
  });

  it("withholds turns, DIO and GMROI under 28 days of till history", async () => {
    const out: any = await analytics(
      { restaurant_inventory: [STOCKED] },
      till({ ...SOLD_THREE.data, first_sale_at: daysAgo(10) }),
    ).getFinancialSummary(RESTAURANT);
    expect(out.cogsWindow).toMatchObject({ days: 10 });
    expect(out.cogs).toBe(60);
    expect(out.inventoryTurnover).toBeNull();
    expect(out.daysInventoryOutstanding).toBeNull();
    expect(out.gmroi).toBeNull();
    // The margin ratios need no annualising and stay.
    expect(out.cogsRatio).toBeCloseTo(60 / 180, 10);
    expect(out.basis.costDerived).toContain("at least 28 days of POS sales");
  });

  it("withholds every ratio that would divide by an absent COGS or sales", async () => {
    // Inventory is fully priced here, so the on-hand cost gate is OPEN; the
    // only thing left to withhold these is the missing COGS and sales.
    const out: any = await analytics(
      { restaurant_inventory: [STOCKED] },
      { error: { message: "timeout" } },
    ).getFinancialSummary(RESTAURANT);
    expect(out.costCoverage.complete).toBe(true);
    expect(out.inventoryValue).toBe(100); // 5 × 20, knowable, and kept
    expect(out.inventoryTurnover).toBeNull();
    expect(out.daysInventoryOutstanding).toBeNull();
    expect(out.gmroi).toBeNull();
    expect(out.cogsRatio).toBeNull();
    expect(out.grossMargin).toBeNull();
    expect(out.basis.costDerived).toContain(
      "null unless cogs and revenue are both known",
    );
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
// 4. risk.revenueConcentration reads the till (A-018)
// ---------------------------------------------------------------------------

describe("revenue concentration weighs what each item sold, not its shelf value", () => {
  /** Five active items: one deep and dear, four thin and cheap. */
  const SHELF = [
    { id: "i1", stock_live: 100, menu_price_current: 100 },
    { id: "i2", stock_live: 1, menu_price_current: 10 },
    { id: "i3", stock_live: 1, menu_price_current: 10 },
    { id: "i4", stock_live: 1, menu_price_current: 10 },
    { id: "i5", stock_live: 1, menu_price_current: 10 },
  ].map((r) => ({ ...r, wine_name: r.id, last_purchase_price: 5 }));
  /** Sales per item; every item named is mapped unless listed in `unmapped`. */
  const sold = (sales: Record<string, number>, unmapped: string[] = []) =>
    till({
      items: Object.entries(sales).map(([id, v]) => ({
        inventory_id: id,
        sales: v,
        units: v > 0 ? 1 : 0,
        lines: v > 0 ? 1 : 0,
        bottles_out: v > 0 ? 1 : 0,
        mapped: !unmapped.includes(id),
      })),
      checks: 9,
      first_sale_at: daysAgo(80),
    });

  it("gives the till's Gini where the shelf's would say 'very few SKUs'", async () => {
    // The fixture is built so the two measures disagree on the verdict: the
    // shelf value (menu × on-hand) is 10000, 10, 10, 10, 10.
    const shelfGini = E.risk.giniCoefficient(
      SHELF.map((r) => r.stock_live * r.menu_price_current),
    ) as number;
    expect(shelfGini).toBeGreaterThan(0.6);

    const sales = { i1: 100, i2: 90, i3: 80, i4: 110, i5: 100 };
    const out: any = await analytics(
      { restaurant_inventory: SHELF },
      sold(sales),
    ).getRiskProfile(RESTAURANT);
    const tillGini = E.risk.giniCoefficient(Object.values(sales)) as number;
    expect(out.revenueConcentration.gini).toBeCloseTo(tillGini, 10);
    expect(out.revenueConcentration.gini).toBeLessThan(0.6);
    expect(out.revenueConcentration.interpretation).toBe("well-distributed");
    expect(out.revenueConcentration.hhi).toBeCloseTo(
      E.finance.herfindahlIndex(Object.values(sales)) as number,
      10,
    );
    expect(out.revenueConcentration.basis).toContain(
      "5 items weighed, 5 with a sale",
    );
  });

  it("weighs a mapped item that sold nothing as 0, and keeps a sold inactive one", async () => {
    // pos_item_sales lists the mapped, silent i2-i5 with zeros; "gone" sold
    // but is no longer active and no mapping points at it now.
    const out: any = await analytics(
      { restaurant_inventory: SHELF },
      sold({ i1: 500, i2: 0, i3: 0, i4: 0, i5: 0, gone: 100 }, ["gone"]),
    ).getRiskProfile(RESTAURANT);
    // Weights: 500, 0, 0, 0, 0 for the active items, plus 100 for "gone".
    expect(out.revenueConcentration.gini).toBeCloseTo(
      E.risk.giniCoefficient([500, 0, 0, 0, 0, 100]) as number,
      10,
    );
    expect(out.revenueConcentration.itemsWeighed).toBe(6);
    expect(out.revenueConcentration.itemsWithSales).toBe(2);
    expect(out.revenueConcentration.interpretation).toBe(
      "revenue rides on very few SKUs",
    );
  });

  it("leaves out an active row no mapping points at: the till cannot sell it (A-013)", async () => {
    // Tuzlu's shape: the imported rows are mapped and sell, and extra menu
    // rows (tea, ayran, cocktails) are active with no mapping. Weighing them
    // as 0 adds k zeros, G' = (nG + k)/(n + k), and here that alone crosses
    // the rule's 0.6 line.
    const sales = { i1: 300, i2: 100, i3: 60, i4: 40, i5: 20 };
    const menuRows = ["m1", "m2", "m3", "m4"].map((id) => ({
      id,
      wine_name: id,
      stock_live: 0,
      menu_price_current: 5,
      last_purchase_price: null,
    }));
    const tillGini = E.risk.giniCoefficient(Object.values(sales)) as number;
    const withZeros = E.risk.giniCoefficient([
      ...Object.values(sales),
      0,
      0,
      0,
      0,
    ]) as number;
    expect(tillGini).toBeLessThan(0.6);
    expect(withZeros).toBeGreaterThan(0.6);
    expect(withZeros).toBeCloseTo((5 * tillGini + 4) / 9, 10);

    const out: any = await analytics(
      { restaurant_inventory: [...SHELF, ...menuRows] },
      sold(sales),
    ).getRiskProfile(RESTAURANT);
    expect(out.revenueConcentration.gini).toBeCloseTo(tillGini, 10);
    expect(out.revenueConcentration.gini).toBeLessThan(0.6);
    expect(out.revenueConcentration.itemsWeighed).toBe(5);
    expect(out.revenueConcentration.activeItemsNotWeighed).toBe(4);
    expect(out.revenueConcentration.basis).toContain(
      "4 active items no mapping points at and that sold nothing are left out",
    );
  });

  it("weighs a mapped item whose voids outweigh its sales as 0, and counts it", async () => {
    // PR #617's audit at 847f2470d: a mapped, active item can net negative in
    // the window (the void of an earlier sale). It sold nothing, so it weighs
    // 0 as the basis says. Unclamped, giniCoefficient dropped it (it keeps
    // only v >= 0) while "items weighed" still counted it.
    const out: any = await analytics(
      { restaurant_inventory: SHELF },
      sold({ i1: 100, i2: 100, i3: -50 }),
    ).getRiskProfile(RESTAURANT);
    expect(out.revenueConcentration.itemsWeighed).toBe(3);
    expect(out.revenueConcentration.itemsWithSales).toBe(2);
    expect(out.revenueConcentration.gini).toBeCloseTo(
      E.risk.giniCoefficient([100, 100, 0]) as number,
      10,
    );
    expect(out.revenueConcentration.gini).toBeCloseTo(1 / 3, 10);
    expect(out.revenueConcentration.hhi).toBeCloseTo(0.5, 10);
    expect(out.revenueConcentration.basis).toContain(
      "3 items weighed, 2 with a sale",
    );
  });

  it("does not weigh a void-only or an inactive mapped item that sold nothing", async () => {
    const sales = { i1: 100, i2: 90, i3: 80, i4: 110, i5: 100 };
    const out: any = await analytics(
      { restaurant_inventory: SHELF },
      till({
        ...sold(sales).data,
        items: [
          ...(sold(sales).data.items as object[]),
          // ADR 0011 B19: a void with no sale in the window, not active.
          {
            inventory_id: "void-only",
            sales: 0,
            units: 0,
            lines: 0,
            bottles_out: -2,
            mapped: false,
          },
          // A mapping still points at a row that is no longer active.
          {
            inventory_id: "retired",
            sales: 0,
            units: 0,
            lines: 0,
            bottles_out: 0,
            mapped: true,
          },
        ],
      }),
    ).getRiskProfile(RESTAURANT);
    expect(out.revenueConcentration.itemsWeighed).toBe(5);
    expect(out.revenueConcentration.gini).toBeCloseTo(
      E.risk.giniCoefficient(Object.values(sales)) as number,
      10,
    );
  });

  it("is no answer, not an even house, when the till cannot say", async () => {
    for (const rpc of [
      { error: { message: "timeout" } },
      till(),
      till({ checks: 4 }),
      // Mapped items listed with zeros are still no sale.
      sold({ i1: 0, i2: 0 }),
    ]) {
      const out: any = await analytics(
        { restaurant_inventory: SHELF },
        rpc,
      ).getRiskProfile(RESTAURANT);
      expect(out.revenueConcentration.gini).toBeNull();
      expect(out.revenueConcentration.hhi).toBeNull();
      expect(out.revenueConcentration.interpretation).toBe("insufficient data");
    }
  });
});
