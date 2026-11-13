/**
 * A spend figure resting on an order with no recorded cost is withheld, with
 * the purchases goal's own sentence, never summed as $0.
 *
 * The /reports "Spend pacing" card drew last month's figures and a projection
 * while the purchases goal refused to score the same window over one uncosted
 * order (browser check, 2026-11-12). `getCashflow` and `getVendorScorecard`
 * summed `total_cost || final_price || 0`; they now read `orderCostOrNull`,
 * the rule #1144 gave the goal.
 */
import { AdvancedAnalyticsService } from "./advanced-analytics.service";

const HOUSE = "house-1";
const NOW = new Date("2026-11-12T12:00:00Z");
const daysAgo = (d: number) =>
  new Date(NOW.getTime() - d * 86400000).toISOString();

type Row = Record<string, any>;

function client(tables: Record<string, Row[]>, failing = new Set<string>()) {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      const q: any = {
        select: () => q,
        // readWholeWindow's keyset steps (reports lane r3). With no count, a
        // short page is the last one.
        order: () => q,
        limit: () => q,
        gt: (c: string, v: string) => (
          filters.push((r) => String(r[c]) > v),
          q
        ),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        gte: (c: string, v: string) => (
          filters.push((r) => r[c] != null && r[c] >= v),
          q
        ),
        in: (c: string, vs: unknown[]) => (
          filters.push((r) => vs.includes(r[c])),
          q
        ),
        // PostgREST's `or=(a.gte.x,b.gte.y)`: any clause passes the row.
        or: (expr: string) => (
          filters.push((r) =>
            expr.split(",").some((clause) => {
              const [c, op, ...rest] = clause.split(".");
              const v = rest.join(".");
              if (op !== "gte") throw new Error(`fake or() does not know ${op}`);
              return r[c] != null && r[c] >= v;
            }),
          ),
          q
        ),
        maybeSingle: () =>
          Promise.resolve({
            data:
              (tables[table] ?? []).filter((r) =>
                filters.every((f) => f(r)),
              )[0] ?? null,
            error: null,
          }),
        then: (res: any, rej: any) =>
          Promise.resolve(
            failing.has(table)
              ? { data: null, error: { code: "57014", message: "timeout" } }
              : {
                  data: (tables[table] ?? []).filter((r) =>
                    filters.every((f) => f(r)),
                  ),
                  error: null,
                },
          ).then(res, rej),
      };
      return q;
    },
  };
}

function order(over: Row): Row {
  return {
    restaurant_id: HOUSE,
    provider_id: "v1",
    providers: { name: "Skurnik" },
    total_cost: 100,
    final_price: 100,
    bottles_total: 10,
    quantity: 10,
    created_at: daysAgo(5),
    ...over,
  };
}

function service(
  restaurants: Row[],
  orders: Row[],
  answers: Row[] = [],
  failing = new Set<string>(),
) {
  const db = client(
    {
      restaurants,
      procurement_orders: orders,
      procurement_order_arrival_answers: answers,
    },
    failing,
  );
  return new AdvancedAnalyticsService(
    { getClient: () => db } as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

function service(orders: Row[]) {
  const db = client({ restaurants: [{ id: HOUSE, timezone: "Europe/Istanbul" }], procurement_orders: orders });
  return new AdvancedAnalyticsService(
    { getClient: () => db } as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

const delivered = (id: string, ago: number, cost: number | null) =>
  order({
    id,
    status: "DELIVERED",
    total_cost: cost,
    final_price: cost,
    created_at: daysAgo(ago + 1),
    delivered_at: daysAgo(ago),
  });

describe("spend pacing: an uncosted order is unknown, never $0", () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it("every order costed: both windows, the pace and the projection are drawn", async () => {
    const out: any = await service([
      delivered("a", 5, 300),
      delivered("b", 40, 200),
      delivered("c", 100, 100),
    ]).getCashflow(HOUSE);
    expect(out.spendLast30d).toBe(300);
    expect(out.spendPrev30d).toBe(200);
    expect(out.projectedNext4Weeks).not.toBeNull();
    expect(out.uncostedOrders).toEqual({ last30d: 0, prev30d: 0, window180d: 0, open: 0 });
    expect(out.unread.spendLast30d).toBeNull();
  });

  it("an uncosted order this month withholds this month, the pace and the projection, and says why", async () => {
    const out: any = await service([
      delivered("a", 5, 300),
      delivered("x", 3, null),
      delivered("b", 40, 200),
    ]).getCashflow(HOUSE);
    expect(out.spendLast30d).toBeNull(); // was 300: the uncosted order read as $0
    expect(out.spendPrev30d).toBe(200); // a window with none is still summed
    expect(out.paceDeltaPct).toBeNull();
    expect(out.projectedNext4Weeks).toBeNull();
    expect(out.uncostedOrders.last30d).toBe(1);
    expect(out.unread.spendLast30d).toMatch(/1 of the 2 delivered orders/);
    expect(out.unread.spendLast30d).toMatch(/no recorded cost/);
    expect(out.unread.spendPrev30d).toBeNull();
  });

  it("a zero cost is no recorded cost either", async () => {
    const out: any = await service([delivered("z", 2, 0)]).getCashflow(HOUSE);
    expect(out.spendLast30d).toBeNull();
  });

  it("an open order with no price is not a $0 commitment", async () => {
    const out: any = await service([
      order({ id: "o1", status: "CONFIRMED", total_cost: 500, final_price: null }),
      order({ id: "o2", status: "CONFIRMED", total_cost: null, final_price: null }),
    ]).getCashflow(HOUSE);
    expect(out.committedOpenOrders).toBeNull();
    expect(out.openOrderCount).toBe(2);
    expect(out.unread.committedOpenOrders).toMatch(/1 of the 2 open orders carries no price yet/);
  });

  it("the vendor scorecard: no $0 unit price, no short spend, no concentration over an unknown", async () => {
    const out: any = await service([
      delivered("a", 5, 100),
      delivered("x", 3, null),
    ]).getVendorScorecard(HOUSE);
    const v = out.vendors[0];
    expect(v.spend).toBeNull();
    expect(v.uncostedDelivered).toBe(1);
    expect(v.spendUnread).toMatch(/no recorded cost/);
    // 100 over 10 bottles; the uncosted order gives no $0 price to the mean.
    expect(v.unitPrice.mean).toBe(10);
    expect(out.concentration.hhi).toBeNull();
  });
});
