import { AnalyticsService } from "./analytics.service";

/**
 * Cost-math lane 3.1, the wiring: getFinancialSummary reads the cost of what
 * the till sold and its net sales through two house-scoped functions, only
 * for a caller who sees sales, and a failed read is null, never 0.
 */

const RESTAURANT = "44444444-4444-4444-4444-444444444444";
const NOW = Date.now();

const STOCKED = {
  id: "inv-1",
  wine_name: "Stamped Chablis",
  stock_live: 5,
  menu_price_current: 60,
  last_purchase_price: 20,
  threshold_min: 2,
  master_wine_id: "mw-1",
};

const SALES = {
  items: [{ inventory_id: "inv-1", sales: 900, in_house: true }],
  checks: 30,
  lines: 30,
  unmapped_lines: 0,
  unreadable_lines: 0,
};
const COST = {
  items: [
    {
      inventory_id: "inv-1",
      bottles_out: 15,
      bottles_back: 0,
      cost: "300.000000",
      settled_after_sale: "0",
      uncosted_out: 0,
      uncosted_back: 0,
      in_house: true,
    },
  ],
  cost: "300.000000",
  settled_after_sale: "0",
  rows: 15,
  rows_unstamped: 0,
  first_move_at: new Date(NOW - 59 * 86400000).toISOString(),
};

function service(rpc: Record<string, { data: unknown; error: unknown }>) {
  const calls: Array<[string, any]> = [];
  const client = {
    from: jest.fn((table: string) => {
      const b: any = {};
      for (const m of ["select", "eq", "neq", "gt", "gte", "lt", "lte", "is", "or", "not", "order", "limit", "in", "range"])
        b[m] = jest.fn(() => b);
      b.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
      b.then = (ok: any, no: any) =>
        Promise.resolve({ data: table === "restaurant_inventory" ? [STOCKED] : [], error: null, count: table === "restaurant_inventory" ? 1 : 0 }).then(ok, no);
      return b;
    }),
    rpc: jest.fn((fn: string, args: any) => {
      calls.push([fn, args]);
      return Promise.resolve(rpc[fn] ?? { data: null, error: { message: `no ${fn}` } });
    }),
  };
  return { svc: new AnalyticsService({ getClient: () => client } as any), calls };
}

describe("the financial summary reads what the till sold", () => {
  it("prints the stamped cost over net sales for a caller who sees sales", async () => {
    const { svc, calls } = service({
      pos_item_sales: { data: SALES, error: null },
      pos_cost_of_goods: { data: COST, error: null },
    });
    const out: any = await svc.getFinancialSummary(RESTAURANT, 0, { withSales: true });
    expect(out.cogs).toBe(300);
    expect(out.revenue).toBe(900);
    expect(out.grossMarginDollars).toBe(600);
    expect(out.cogsRatio).toBeCloseTo(1 / 3, 9);
    expect(out.salesWithheld).toBe(false);
    // 60 days of till: DIO = stock at cost × span ÷ cost of what sold.
    expect(out.cogsWindow.spanDays).toBe(60);
    expect(out.daysInventoryOutstanding).toBeCloseTo((100 * 60) / 300, 9);
    const fns = calls.map(([fn]) => fn).sort();
    expect(fns).toEqual(["pos_cost_of_goods", "pos_item_sales"]);
    for (const [, args] of calls) {
      expect(args.p_restaurant_id).toBe(RESTAURANT);
      const since = Date.parse(args.p_since);
      expect(Math.abs(NOW - 365 * 86400000 - since)).toBeLessThan(60_000);
    }
  });

  it("hands on the earlier-sale late prices and the costed items' cost, both apart from cogs", async () => {
    const withVoid = {
      ...COST,
      items: [
        ...COST.items,
        {
          inventory_id: "inv-2",
          bottles_out: 2,
          bottles_back: 1,
          cost: "40.000000",
          settled_after_sale: "0",
          settled_on_earlier_sales: "0",
          uncosted_out: 0,
          uncosted_back: 1,
          in_house: true,
        },
      ],
      settled_on_earlier_sales: "7.250000",
    };
    const { svc } = service({
      pos_item_sales: { data: SALES, error: null },
      pos_cost_of_goods: { data: withVoid, error: null },
    });
    const out: any = await svc.getFinancialSummary(RESTAURANT, 0, { withSales: true });
    expect(out.cogs).toBeNull();
    expect(out.cogsRatio).toBeNull();
    expect(out.costOfCostedItems).toEqual({ amount: 300, items: 1, of: 2 });
    expect(out.settledOnEarlierSales).toBe(7.25);
  });

  it("does not read the till at all for a caller without sales", async () => {
    const { svc, calls } = service({});
    const out: any = await svc.getFinancialSummary(RESTAURANT);
    expect(calls).toEqual([]);
    expect(out.cogs).toBeNull();
    expect(out.revenue).toBeNull();
    expect(out.salesWithheld).toBe(true);
    expect(out.basis.cogs).toContain("owners and managers only");
  });

  it("reads a failed cost read as null, never 0, and keeps net sales", async () => {
    const { svc } = service({
      pos_item_sales: { data: SALES, error: null },
      pos_cost_of_goods: { data: null, error: { code: "42883", message: "boom" } },
    });
    const out: any = await svc.getFinancialSummary(RESTAURANT, 0, { withSales: true });
    expect(out.cogs).toBeNull();
    expect(out.revenue).toBe(900);
    expect(out.grossMargin).toBeNull();
    expect(out.basis.cogs).toContain("could not be read");
  });
});
