import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService, FINANCIAL_TILL_DAYS_DEFAULT, financialTillDays } from "./analytics.service";

/**
 * r36 invoices R2: the figures of record speak about the till window the page
 * picked. What sold, what it cost and what was bought read the same days; a
 * caller that names no window keeps the year it always read.
 */

const RESTAURANT = "55555555-5555-5555-5555-555555555555";
const DAY = 86400000;

const SALES = { items: [{ inventory_id: "inv-1", sales: 900, in_house: true }], checks: 30, lines: 30, unmapped_lines: 0, unreadable_lines: 0 };
const COST = {
  items: [{ inventory_id: "inv-1", bottles_out: 15, bottles_back: 0, cost: "300", settled_after_sale: "0", uncosted_out: 0, uncosted_back: 0, in_house: true }],
  cost: "300",
  settled_after_sale: "0",
  rows: 15,
  rows_unstamped: 0,
  first_move_at: new Date(Date.now() - 20 * DAY).toISOString(),
};

function service() {
  const rpcCalls: Array<[string, any]> = [];
  const ordersSince: string[] = [];
  const client = {
    from: jest.fn((table: string) => {
      const b: any = {};
      for (const m of ["select", "eq", "neq", "gt", "lt", "lte", "is", "or", "not", "order", "limit", "in", "range"])
        b[m] = jest.fn(() => b);
      b.gte = jest.fn((col: string, v: string) => {
        if (table === "procurement_orders" && col === "delivered_at") ordersSince.push(v);
        return b;
      });
      b.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
      b.then = (ok: any, no: any) =>
        Promise.resolve({
          data: table === "procurement_orders" ? [{ id: "o1", total_cost: 120, status: "delivered", delivered_at: new Date().toISOString() }] : [],
          error: null,
          count: table === "procurement_orders" ? 1 : 0,
        }).then(ok, no);
      return b;
    }),
    rpc: jest.fn((fn: string, args: any) => {
      rpcCalls.push([fn, args]);
      return Promise.resolve({ data: fn === "pos_item_sales" ? SALES : COST, error: null });
    }),
  };
  return { svc: new AnalyticsService({ getClient: () => client } as any), rpcCalls, ordersSince };
}

const daysBefore = (iso: string) => (Date.now() - Date.parse(iso)) / DAY;

describe("financialTillDays — the days the figures of record speak about", () => {
  it("keeps the year when no window is named or it is not a number", () => {
    expect(FINANCIAL_TILL_DAYS_DEFAULT).toBe(365);
    expect(financialTillDays(undefined)).toBe(365);
    expect(financialTillDays(null)).toBe(365);
    expect(financialTillDays("")).toBe(365);
    expect(financialTillDays("thirty")).toBe(365);
  });

  it("reads a whole number of days and holds it between 1 and 365", () => {
    expect(financialTillDays("30")).toBe(30);
    expect(financialTillDays(7)).toBe(7);
    expect(financialTillDays(90.9)).toBe(90);
    expect(financialTillDays("0")).toBe(1);
    expect(financialTillDays("-4")).toBe(1);
    expect(financialTillDays("400")).toBe(365);
    expect(financialTillDays(365)).toBe(365);
    expect(financialTillDays(1)).toBe(1);
  });
});

describe("getFinancialSummary over the till window", () => {
  it("reads what sold, what it cost and what was bought over the same 30 days", async () => {
    const { svc, rpcCalls, ordersSince } = service();
    const out: any = await svc.getFinancialSummary(RESTAURANT, 0, { withSales: true, tillDays: 30 });
    expect(rpcCalls.map(([fn]) => fn).sort()).toEqual(["pos_cost_of_goods", "pos_item_sales"]);
    for (const [, args] of rpcCalls) expect(daysBefore(args.p_since)).toBeCloseTo(30, 2);
    expect(ordersSince).toHaveLength(1);
    expect(daysBefore(ordersSince[0])).toBeCloseTo(30, 2);
    expect(out.tillWindowDays).toBe(30);
    expect(out.cogs).toBe(300);
    expect(out.basis.cogs).toContain("(30 days)");
    expect(out.basis.revenue).toContain("(30 days)");
    expect(out.basis.deliveredPurchases).toContain("Delivered orders over the last 30 days");
    expect(out.basis.deliveredPurchases).not.toContain("365");
  });

  it("says one day in the singular", async () => {
    const { svc } = service();
    const out: any = await svc.getFinancialSummary(RESTAURANT, 0, { withSales: true, tillDays: 1 });
    expect(out.tillWindowDays).toBe(1);
    expect(out.basis.deliveredPurchases).toContain("Delivered orders over the last day —");
  });

  it("keeps the year for a caller that names no window (goals, recommendations, the MCP reader)", async () => {
    const { svc, rpcCalls, ordersSince } = service();
    const out: any = await svc.getFinancialSummary(RESTAURANT, 0, { withSales: true });
    for (const [, args] of rpcCalls) expect(daysBefore(args.p_since)).toBeCloseTo(365, 2);
    expect(daysBefore(ordersSince[0])).toBeCloseTo(365, 2);
    expect(out.tillWindowDays).toBe(365);
    expect(out.basis.deliveredPurchases).toContain("over the last 365 days");
  });

  it("a caller without sales still reads what was bought over the window it named", async () => {
    const { svc, rpcCalls, ordersSince } = service();
    const out: any = await svc.getFinancialSummary(RESTAURANT, 0, { tillDays: 7 });
    expect(rpcCalls).toEqual([]);
    expect(daysBefore(ordersSince[0])).toBeCloseTo(7, 2);
    expect(out.tillWindowDays).toBe(7);
    expect(out.basis.cogs).toContain("(7 days)");
  });
});

describe("GET /analytics/financial/:rid?days=", () => {
  function controller() {
    const getFinancialSummary = jest.fn(async (...args: unknown[]) => ({ args }));
    const c = new AnalyticsController(
      { getFinancialSummary } as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
    return { c, getFinancialSummary };
  }

  it("hands the window on, read as whole days, beside the caller's sales gate", async () => {
    const { c, getFinancialSummary } = controller();
    await c.getFinancial(RESTAURANT, undefined, { role: "owner" }, "30");
    await c.getFinancial(RESTAURANT, undefined, { role: "staff" }, "900");
    expect(getFinancialSummary.mock.calls).toEqual([
      [RESTAURANT, 0, { withSales: true, tillDays: 30 }],
      [RESTAURANT, 0, { withSales: false, tillDays: 365 }],
    ]);
  });

  it("names no window when the request names none, so the year stays the year", async () => {
    const { c, getFinancialSummary } = controller();
    await c.getFinancial(RESTAURANT, undefined, { role: "manager" });
    expect(getFinancialSummary.mock.calls[0][2]).toStrictEqual({ withSales: true });
  });
});
