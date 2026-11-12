import { Test, TestingModule } from "@nestjs/testing";
import { DashboardService } from "./dashboard.service";
import { DatabaseService } from "../database/database.service";
import { ProcurementOrderStatus } from "../procurement/dto/procurement.dto";

/**
 * Invariant: a spend figure is the whole sum of recorded order costs in its
 * bucket, or null with the count of orders there that carry no recorded cost.
 * A recorded 0 is no recorded cost; a bucket with none uncosted sums as before.
 */

function makeClient(rowsByTable: Record<string, any[]>) {
  const passthrough = [
    "select", "eq", "neq", "gt", "gte", "lt", "lte", "is", "or", "not", "order", "limit", "in", "range",
  ];
  return {
    from: jest.fn((table: string) => {
      const builder: any = {};
      for (const method of passthrough) builder[method] = jest.fn(() => builder);
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(
          resolve,
          reject,
        );
      return builder;
    }),
  };
}

const order = (over: Record<string, any>) => ({
  status: ProcurementOrderStatus.DELIVERED,
  total_cost: null,
  final_price: null,
  bottles_total: 6,
  quantity: 6,
  created_at: "2026-07-01T00:00:00Z",
  ...over,
});

const JULY_COSTED = order({ total_cost: 1000, delivered_at: "2026-07-04T10:00:00Z" });
const AUG_COSTED = order({ total_cost: 250, delivered_at: "2026-08-09T10:00:00Z" });
const AUG_COSTED_BY_FINAL = order({ final_price: 100, delivered_at: "2026-08-09T11:00:00Z" });
// Delivered 10 Aug with nothing recorded.
const AUG_UNCOSTED = order({ delivered_at: "2026-08-10T10:00:00Z" });
const AUG_ZERO = order({ total_cost: 0, final_price: null, delivered_at: "2026-08-15T09:00:00Z" });

const NO_COST = /no recorded cost/;

describe("DashboardService — an uncosted delivered order is unknown, not $0", () => {
  let service: DashboardService;
  const db = { getClient: jest.fn() };

  const load = (orders: any[]) =>
    db.getClient.mockReturnValue(
      makeClient({
        procurement_orders: orders,
        restaurants: [{ timezone: "UTC" }],
      }),
    );

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-08-15T12:00:00Z"));
    const module: TestingModule = await Test.createTestingModule({
      providers: [DashboardService, { provide: DatabaseService, useValue: db }],
    }).compile();
    service = module.get(DashboardService);
  });

  afterEach(() => jest.useRealTimers());

  describe("getDashboardSummary — GET /dashboard/summary/:id (procurementSpend)", () => {
    it("sums every costed order as before", async () => {
      load([JULY_COSTED, AUG_COSTED, AUG_COSTED_BY_FINAL]);
      const r: any = (await service.getDashboardSummary("r1")).procurementSpend;
      expect(r.totalProcurementSpend).toBe(1350);
      expect(r.monthlyProcurementSpend).toBe(350);
      expect(r.uncostedOrders).toEqual({ total: 0, thisMonth: 0 });
      expect(r.spendByMonth.map((m: any) => [m.month, m.spend, m.uncosted])).toEqual([
        ["2026-07", 1000, 0],
        ["2026-08", 350, 0],
      ]);
    });

    it("nulls the total, the month and that month's point when the month holds an uncosted order", async () => {
      load([JULY_COSTED, AUG_COSTED, AUG_UNCOSTED]);
      const r: any = (await service.getDashboardSummary("r1")).procurementSpend;
      expect(r.totalProcurementSpend).toBeNull();
      expect(r.monthlyProcurementSpend).toBeNull();
      expect(r.uncostedOrders).toEqual({ total: 1, thisMonth: 1 });
      expect(r.unread.totalProcurementSpend).toMatch(NO_COST);
      expect(r.unread.monthlyProcurementSpend).toMatch(NO_COST);
      const [july, aug] = r.spendByMonth;
      expect(july).toMatchObject({ month: "2026-07", spend: 1000, uncosted: 0, unread: null });
      expect(aug).toMatchObject({ month: "2026-08", spend: null, uncosted: 1 });
      expect(aug.unread).toMatch(NO_COST);
    });

    it("counts total_cost 0 with final_price null as uncosted", async () => {
      load([AUG_ZERO]);
      const r: any = (await service.getDashboardSummary("r1")).procurementSpend;
      expect(r.totalProcurementSpend).toBeNull();
      expect(r.uncostedOrders.total).toBe(1);
    });
  });

  describe("getCalendarRevenue — GET /dashboard/calendar-revenue/:id (per-day procurement_spend)", () => {
    it("sums a costed day and a month with no uncosted order as before", async () => {
      load([AUG_COSTED, AUG_COSTED_BY_FINAL]);
      const r: any = await service.getCalendarRevenue("r1", 2026, 8);
      const day = r.daily.find((d: any) => d.date === "2026-08-09");
      expect(day).toMatchObject({ procurement_spend: 350, uncosted_orders: 0, procurement_spend_unread: null });
      expect(r.monthly_procurement_spend).toBe(350);
    });

    it("gives a day holding an uncosted order null + the count + a sentence, and keeps its neighbour", async () => {
      load([AUG_COSTED, AUG_UNCOSTED]);
      const r: any = await service.getCalendarRevenue("r1", 2026, 8);
      const bad = r.daily.find((d: any) => d.date === "2026-08-10");
      expect(bad.procurement_spend).toBeNull();
      expect(bad.uncosted_orders).toBe(1);
      expect(bad.procurement_spend_unread).toMatch(NO_COST);
      expect(bad.order_count).toBe(1);
      expect(r.daily.find((d: any) => d.date === "2026-08-09").procurement_spend).toBe(250);
      expect(r.daily.find((d: any) => d.date === "2026-08-11").procurement_spend).toBe(0);
    });

    it("nulls the month rather than sum the known days short", async () => {
      load([AUG_COSTED, AUG_ZERO]);
      const r: any = await service.getCalendarRevenue("r1", 2026, 8);
      expect(r.monthly_procurement_spend).toBeNull();
      expect(r.monthly_uncosted_orders).toBe(1);
      expect(r.monthly_procurement_spend_unread).toMatch(NO_COST);
    });
  });

  describe("getStats — GET /dashboard/stats/:id (today / week / month spend)", () => {
    it("sums costed windows as before", async () => {
      load([AUG_COSTED, JULY_COSTED]);
      const s: any = await service.getStats("r1");
      expect(s.todayProcurementSpend).toBe(0);
      expect(s.weekProcurementSpend).toBe(250);
      expect(s.monthProcurementSpend).toBe(250);
      expect(s.uncostedOrders).toEqual({ today: 0, week: 0, month: 0 });
    });

    it("nulls only the windows that hold the uncosted order", async () => {
      load([AUG_COSTED, AUG_UNCOSTED]);
      const s: any = await service.getStats("r1");
      expect(s.todayProcurementSpend).toBe(0);
      expect(s.weekProcurementSpend).toBeNull();
      expect(s.monthProcurementSpend).toBeNull();
      expect(s.uncostedOrders).toEqual({ today: 0, week: 1, month: 1 });
      expect(s.unread.weekProcurementSpend).toMatch(NO_COST);
      expect(s.unread.todayProcurementSpend).toBeNull();
    });

    it("counts total_cost 0 with final_price null as uncosted today", async () => {
      load([AUG_ZERO]);
      const s: any = await service.getStats("r1");
      expect(s.todayProcurementSpend).toBeNull();
      expect(s.uncostedOrders.today).toBe(1);
      expect(s.unread.todayProcurementSpend).toMatch(NO_COST);
    });
  });

  describe("getSalesChart — GET /dashboard/sales-chart/:id (bucket procurementSpend)", () => {
    it("sums costed buckets as before", async () => {
      load([JULY_COSTED, AUG_COSTED]);
      const p: any[] = await service.getSalesChart("r1", "year");
      expect(p.map((x) => [x.date, x.procurementSpend, x.uncosted])).toEqual([
        ["2026-07", 1000, 0],
        ["2026-08", 250, 0],
      ]);
    });

    it("nulls the bucket holding an uncosted order and sums the other", async () => {
      load([JULY_COSTED, AUG_COSTED, AUG_UNCOSTED]);
      const p: any[] = await service.getSalesChart("r1", "year");
      expect(p[0]).toMatchObject({ date: "2026-07", procurementSpend: 1000, uncosted: 0, unread: null });
      expect(p[1]).toMatchObject({ date: "2026-08", procurementSpend: null, uncosted: 1 });
      expect(p[1].unread).toMatch(NO_COST);
    });

    it("counts total_cost 0 with final_price null as uncosted", async () => {
      load([AUG_ZERO]);
      const p: any[] = await service.getSalesChart("r1", "year");
      expect(p[0].procurementSpend).toBeNull();
      expect(p[0].uncosted).toBe(1);
    });
  });
});
