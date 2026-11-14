import { Test, TestingModule } from "@nestjs/testing";
import { DashboardService } from "./dashboard.service";
import { DatabaseService } from "../database/database.service";
import { ProcurementOrderStatus } from "../procurement/dto/procurement.dto";

/**
 * Invariant: every dashboard spend figure is a sum of delivered orders in the
 * house's money (an order naming no currency is the house's). An order in any
 * other currency is never added in and never converted: the figure it falls
 * in is null, the order is counted by its code, and the sentence says so. The
 * same rule the reports keep (`analytics/order-cost.ts`).
 */

/** Like PostgREST: a row carries only the columns the select named. */
function project(rows: any[], cols: string): any[] {
  const names = cols.split(",").map((c) => c.trim());
  return rows.map((r) =>
    Object.fromEntries(names.filter((n) => n in r).map((n) => [n, r[n]])),
  );
}

function makeClient(
  rowsByTable: Record<string, any[]>,
  opts: { currencyReadFails?: boolean } = {},
) {
  const passthrough = [
    "eq", "neq", "gt", "gte", "lt", "lte", "is", "or", "not", "order", "limit", "in", "range",
  ];
  const reads: string[] = [];
  const client = {
    reads,
    from: jest.fn((table: string) => {
      let cols = "";
      const builder: any = {};
      for (const method of passthrough) builder[method] = jest.fn(() => builder);
      builder.select = jest.fn((c: string) => {
        cols = c;
        reads.push(`${table}:${c}`);
        return builder;
      });
      builder.then = (resolve: any, reject: any) => {
        const fail =
          opts.currencyReadFails && table === "restaurants" && cols === "currency";
        return Promise.resolve(
          fail
            ? { data: null, error: { message: "connection reset" } }
            : { data: project(rowsByTable[table] ?? [], cols), error: null },
        ).then(resolve, reject);
      };
      return builder;
    }),
  };
  return client;
}

const order = (over: Record<string, any>) => ({
  status: ProcurementOrderStatus.DELIVERED,
  total_cost: null,
  final_price: null,
  currency: null,
  bottles_total: 6,
  quantity: 6,
  created_at: "2026-07-01T00:00:00Z",
  ...over,
});

// "Today" is 2026-08-15 (UTC house).
const JULY_TRY = order({ total_cost: 1000, currency: "TRY", delivered_at: "2026-07-04T10:00:00Z" });
const AUG9_TRY = order({ total_cost: 250, currency: "TRY", delivered_at: "2026-08-09T10:00:00Z" });
const AUG9_UNNAMED = order({ total_cost: 100, delivered_at: "2026-08-09T11:00:00Z" });
const AUG10_EUR = order({ total_cost: 40, currency: "EUR", delivered_at: "2026-08-10T10:00:00Z" });
const TODAY_USD = order({ total_cost: 30, currency: "usd", delivered_at: "2026-08-15T09:00:00Z" });
const AUG10_TRY_UNCOSTED = order({ currency: "TRY", delivered_at: "2026-08-10T12:00:00Z" });

const OTHER_MONEY = /not in house currency/;

describe("DashboardService — spend is summed in the house's money only", () => {
  let service: DashboardService;
  const db = { getClient: jest.fn() };
  let client: ReturnType<typeof makeClient>;

  const load = (
    orders: any[],
    house: string | null = "TRY",
    opts: { currencyReadFails?: boolean } = {},
  ) => {
    client = makeClient(
      {
        procurement_orders: orders,
        restaurants: [{ timezone: "UTC", currency: house }],
      },
      opts,
    );
    db.getClient.mockReturnValue(client);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-08-15T12:00:00Z"));
    const module: TestingModule = await Test.createTestingModule({
      providers: [DashboardService, { provide: DatabaseService, useValue: db }],
    }).compile();
    service = module.get(DashboardService);
  });

  afterEach(() => jest.useRealTimers());

  describe("getStats — today / week / month", () => {
    it("sums house-money and unnamed orders as one figure, with nothing held back", async () => {
      load([AUG9_TRY, AUG9_UNNAMED, JULY_TRY]);
      const s: any = await service.getStats("r1");
      expect(s.weekProcurementSpend).toBe(350);
      expect(s.monthProcurementSpend).toBe(350);
      expect(s.notInHouseCurrency).toEqual({ today: {}, week: {}, month: {} });
      expect(s.houseCurrencyUnread).toBe(false);
    });

    it("withholds only the windows holding a EUR order, counts it by code, and names it", async () => {
      load([AUG9_TRY, AUG10_EUR]);
      const s: any = await service.getStats("r1");
      // Not 290 (lira plus euros), and not 250 (the euros left out).
      expect(s.weekProcurementSpend).toBeNull();
      expect(s.monthProcurementSpend).toBeNull();
      expect(s.todayProcurementSpend).toBe(0);
      expect(s.notInHouseCurrency).toEqual({ today: {}, week: { EUR: 1 }, month: { EUR: 1 } });
      expect(s.uncostedOrders).toEqual({ today: 0, week: 0, month: 0 });
      expect(s.unread.weekProcurementSpend).toMatch(OTHER_MONEY);
      expect(s.unread.weekProcurementSpend).toContain("1 in EUR; the house keeps TRY");
      expect(s.unread.todayProcurementSpend).toBeNull();
    });

    it("reads a lower-case code as its currency", async () => {
      load([TODAY_USD]);
      const s: any = await service.getStats("r1");
      expect(s.todayProcurementSpend).toBeNull();
      expect(s.notInHouseCurrency.today).toEqual({ USD: 1 });
    });

    it("counts an uncosted house order apart from an order in other money", async () => {
      load([AUG10_EUR, AUG10_TRY_UNCOSTED]);
      const s: any = await service.getStats("r1");
      expect(s.weekProcurementSpend).toBeNull();
      expect(s.uncostedOrders.week).toBe(1);
      expect(s.notInHouseCurrency.week).toEqual({ EUR: 1 });
      expect(s.unread.weekProcurementSpend).toMatch(/no recorded cost/);
    });

    it("with no house currency named, an order that names one is not the house's", async () => {
      load([AUG9_TRY], null);
      const s: any = await service.getStats("r1");
      expect(s.weekProcurementSpend).toBeNull();
      expect(s.notInHouseCurrency.week).toEqual({ TRY: 1 });
      expect(s.unread.weekProcurementSpend).toMatch(/has not named its currency/);
    });

    it("a failed house-currency read withholds the spend and says so, and keeps the counts", async () => {
      load([AUG9_TRY, AUG9_UNNAMED], "TRY", { currencyReadFails: true });
      const s: any = await service.getStats("r1");
      expect(s.weekProcurementSpend).toBeNull();
      expect(s.houseCurrencyUnread).toBe(true);
      expect(s.unread.weekProcurementSpend).toMatch(/could not be read/);
      expect(s.todayProcurementSpend).toBe(0);
      expect(s.totalWines).toBe(0);
    });

    it("does not read the house's currency when no order names one", async () => {
      load([AUG9_UNNAMED]);
      const s: any = await service.getStats("r1");
      expect(s.weekProcurementSpend).toBe(100);
      expect(client.reads).not.toContain("restaurants:currency");
    });
  });

  describe("getCalendarRevenue — each day and the month", () => {
    it("withholds the EUR day and the month, and keeps the lira day", async () => {
      load([AUG9_TRY, AUG9_UNNAMED, AUG10_EUR]);
      const r: any = await service.getCalendarRevenue("r1", 2026, 8);
      const aug9 = r.daily.find((d: any) => d.date === "2026-08-09");
      const aug10 = r.daily.find((d: any) => d.date === "2026-08-10");
      expect(aug9).toMatchObject({ procurement_spend: 350, not_in_house_currency: {} });
      expect(aug10.procurement_spend).toBeNull();
      expect(aug10.not_in_house_currency).toEqual({ EUR: 1 });
      expect(aug10.uncosted_orders).toBe(0);
      expect(aug10.procurement_spend_unread).toMatch(OTHER_MONEY);
      expect(aug10.order_count).toBe(1);
      expect(r.monthly_procurement_spend).toBeNull();
      expect(r.monthly_not_in_house_currency).toEqual({ EUR: 1 });
      expect(r.monthly_procurement_spend_unread).toMatch(OTHER_MONEY);
      expect(r.house_currency_unread).toBe(false);
    });

    it("says when the house's currency could not be read", async () => {
      load([AUG10_EUR], "TRY", { currencyReadFails: true });
      const r: any = await service.getCalendarRevenue("r1", 2026, 8);
      expect(r.house_currency_unread).toBe(true);
      expect(r.monthly_procurement_spend).toBeNull();
      expect(r.monthly_procurement_spend_unread).toMatch(/could not be read/);
    });
  });

  describe("getDashboardSummary — all time, this month, by month", () => {
    it("withholds the total and the EUR month, and keeps July", async () => {
      load([JULY_TRY, AUG9_TRY, AUG10_EUR]);
      const r: any = (await service.getDashboardSummary("r1")).procurementSpend;
      expect(r.totalProcurementSpend).toBeNull();
      expect(r.monthlyProcurementSpend).toBeNull();
      expect(r.notInHouseCurrency).toEqual({ total: { EUR: 1 }, thisMonth: { EUR: 1 } });
      expect(r.unread.totalProcurementSpend).toMatch(OTHER_MONEY);
      const [july, aug] = r.spendByMonth;
      expect(july).toMatchObject({ month: "2026-07", spend: 1000, notInHouseCurrency: {} });
      expect(aug).toMatchObject({ month: "2026-08", spend: null, notInHouseCurrency: { EUR: 1 } });
    });

    it("sums an all-lira house as before", async () => {
      load([JULY_TRY, AUG9_TRY, AUG9_UNNAMED]);
      const r: any = (await service.getDashboardSummary("r1")).procurementSpend;
      expect(r.totalProcurementSpend).toBe(1350);
      expect(r.monthlyProcurementSpend).toBe(350);
    });
  });

  describe("getSalesChart — each bucket", () => {
    it("withholds the EUR bucket and keeps the lira one", async () => {
      load([JULY_TRY, AUG10_EUR]);
      const p: any[] = await service.getSalesChart("r1", "year");
      expect(p[0]).toMatchObject({ date: "2026-07", procurementSpend: 1000, notInHouseCurrency: {} });
      expect(p[1]).toMatchObject({ date: "2026-08", procurementSpend: null, notInHouseCurrency: { EUR: 1 } });
      expect(p[1].unread).toMatch(OTHER_MONEY);
    });
  });
});
