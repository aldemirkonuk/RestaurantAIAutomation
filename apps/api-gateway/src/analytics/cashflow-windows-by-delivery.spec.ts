import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { ProcurementOrderStatus } from "../procurement/dto/procurement.dto";

/**
 * F-1146: Spend pacing read its orders by `created_at` over 180 days, while
 * it files the paid-out days by `delivered_at` and Figures of record windows
 * COGS on `delivered_at`. A futures order placed in March and delivered in
 * October was in COGS but not in "Paid out, the last 30 days"; while it was
 * still open past 180 days it was in neither Committed nor Open orders.
 *
 * The stub below APPLIES the filters it is given (eq, in, not in, gte), as
 * PostgREST does, so a created_at window drops the old orders here exactly as
 * it would in production. A permissive stub would pass against the old code.
 */

type Row = Record<string, any>;

function filteringClient(rows: Record<string, Row[]>) {
  return {
    from(table: string) {
      const preds: Array<(r: Row) => boolean> = [];
      const b: any = {
        select: () => b,
        order: () => b,
        limit: () => b,
        gt: (col: string, v: any) => (preds.push((r) => r[col] > v), b),
        eq: (col: string, v: any) => (preds.push((r) => r[col] === v), b),
        in: (col: string, vs: any[]) => (
          preds.push((r) => vs.includes(r[col])),
          b
        ),
        not: (col: string, op: string, list: string) => {
          if (op !== "in") throw new Error(`unstubbed not.${op}`);
          const vs = list
            .replace(/^\(|\)$/g, "")
            .split(",")
            .map((s) => s.replace(/"/g, ""));
          preds.push((r) => r[col] != null && !vs.includes(r[col]));
          return b;
        },
        gte: (col: string, v: any) => (
          preds.push((r) => r[col] != null && r[col] >= v),
          b
        ),
        maybeSingle: () =>
          Promise.resolve({
            data: (rows[table] ?? [])[0] ?? null,
            error: null,
          }),
        then: (resolve: any, reject: any) => {
          const data = (rows[table] ?? []).filter((r) =>
            preds.every((p) => p(r)),
          );
          return Promise.resolve({
            data,
            error: null,
            count: data.length,
          }).then(resolve, reject);
        },
      };
      return b;
    },
  };
}

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86400000).toISOString();

const order = (
  id: string,
  status: ProcurementOrderStatus,
  created: number,
  delivered: number | null,
  cost: number,
) => ({
  id,
  restaurant_id: "r1",
  provider_id: "p1",
  providers: { name: "Bordeaux négociant" },
  total_cost: cost,
  final_price: cost,
  currency: "USD",
  bottles_total: 12,
  quantity: 12,
  created_at: daysAgo(created),
  delivered_at: delivered === null ? null : daysAgo(delivered),
  expected_delivery_date: null,
  status,
});

function service(orders: Row[]) {
  const client = filteringClient({
    procurement_orders: orders,
    restaurants: [{ id: "r1", timezone: null, country: null, currency: "USD" }],
  });
  return new AdvancedAnalyticsService(
    { getClient: () => client } as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

describe("spend pacing reads deliveries by when they arrived (F-1146)", () => {
  it("counts a futures order placed 220 days ago and delivered 5 days ago as this month's spend", async () => {
    const out = await service([
      order("en-primeur", ProcurementOrderStatus.DELIVERED, 220, 5, 4800),
      order("recent", ProcurementOrderStatus.DELIVERED, 10, 8, 200),
    ]).getCashflow("r1");
    expect(out.spendLast30d).toBe(5000);
  });

  it("leaves out a delivery that arrived before the window, however recently it was placed", async () => {
    const out = await service([
      order("old-arrival", ProcurementOrderStatus.DELIVERED, 200, 190, 999),
    ]).getCashflow("r1");
    expect(out.spendLast30d).toBe(0);
    expect(out.spendPrev30d).toBe(0);
  });

  it("keeps an order still out with the vendor in Committed and Open orders, however old", async () => {
    const out = await service([
      order("backorder", ProcurementOrderStatus.IN_TRANSIT, 240, null, 3000),
      order("fresh", ProcurementOrderStatus.CONFIRMED, 3, null, 500),
      order("done", ProcurementOrderStatus.COMPLETED, 400, 300, 700),
    ]).getCashflow("r1");
    expect(out.openOrderCount).toBe(2);
    expect(out.committedOpenOrders).toBe(3500);
  });

  it("keeps an old partly received order among the orders in neither figure", async () => {
    const out = await service([
      order(
        "partly",
        ProcurementOrderStatus.PARTIALLY_RECEIVED,
        300,
        null,
        1200,
      ),
    ]).getCashflow("r1");
    expect(out.notCounted.partlyReceived).toBe(1);
    expect(out.notCounted.orderValue).toBe(1200);
  });
});
