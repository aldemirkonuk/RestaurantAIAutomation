import { Test, TestingModule } from "@nestjs/testing";
import { DashboardService } from "./dashboard.service";
import { DatabaseService } from "../database/database.service";
import { mixedSpendNote, spendByCurrency } from "./dashboard.service";
import { statsForRole } from "./amounts-for-role";
import { ProcurementOrderStatus } from "../procurement/dto/procurement.dto";

/**
 * The dashboard summed `procurement_orders` — vendor invoices, money the
 * restaurant PAYS OUT — and published the total as `revenue.totalRevenue`,
 * which the web dashboard rendered under the heading "Total Revenue". The
 * owner's headline KPI therefore reported spend as income: a month of heavy
 * buying read as a month of strong sales.
 *
 * These tests pin the honest naming. They are regression guards, not coverage:
 * if anything re-publishes a procurement sum under a revenue-shaped name, they
 * fail. Real sales revenue lives in `pos_checks` and is not read here.
 */

/**
 * Chainable Supabase stub: every builder method returns itself, and awaiting
 * the builder resolves the rows registered for the table named in `.from()`.
 *
 * `from()` mints a fresh builder per call rather than sharing one — the service
 * fans six queries out through `Promise.allSettled`, so a shared "current table"
 * would be overwritten by the last caller before any of them awaited.
 */
function makeClient(
  rowsByTable: Record<string, any[]>,
  errorsByTable: Record<string, { message: string }> = {},
) {
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
      for (const method of passthrough) {
        builder[method] = jest.fn(() => builder);
      }
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve(
          errorsByTable[table]
            ? { data: null, error: errorsByTable[table] }
            : { data: rowsByTable[table] ?? [], error: null },
        ).then(resolve, reject);
      return builder;
    }),
  };
}

const DELIVERED_ORDERS = [
  {
    status: ProcurementOrderStatus.DELIVERED,
    total_cost: 1000,
    final_price: 900,
    bottles_total: 12,
    quantity: 12,
    delivered_at: "2026-07-04T00:00:00Z",
    created_at: "2026-07-01T00:00:00Z",
  },
  {
    status: ProcurementOrderStatus.DELIVERED,
    total_cost: 250,
    final_price: null,
    bottles_total: 6,
    quantity: 6,
    delivered_at: "2026-08-09T00:00:00Z",
    created_at: "2026-08-02T00:00:00Z",
  },
];

/** Collects every property name in a nested payload. */
function allKeys(value: any, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, found);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      found.push(k);
      allKeys(v, found);
    }
  }
  return found;
}

describe("DashboardService — procurement spend is not revenue", () => {
  let service: DashboardService;

  const db = {
    getRestaurantInventory: jest.fn(),
    getLowStockItems: jest.fn(),
    getProcurementOrders: jest.fn(),
    getClient: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // "This month" is computed from the wall clock, so the August fixture below
    // would drift out of the monthly bucket the moment the real month turned.
    jest.useFakeTimers().setSystemTime(new Date("2026-08-15T12:00:00Z"));
    db.getRestaurantInventory.mockResolvedValue([]);
    db.getLowStockItems.mockResolvedValue([]);
    db.getProcurementOrders.mockResolvedValue([]);
    db.getClient.mockReturnValue(
      makeClient({
        procurement_orders: DELIVERED_ORDERS,
        // The calendar files each day by the house's own clock (ADR 0290); a
        // house with no stated zone gets no figures at all.
        restaurants: [{ timezone: "UTC" }],
      }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [DashboardService, { provide: DatabaseService, useValue: db }],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("reports vendor payments under procurementSpend, never under revenue", async () => {
    const result: any = await service.getDashboardSummary("r1");

    expect(result).toHaveProperty("procurementSpend");
    expect(result).not.toHaveProperty("revenue");
    expect(result.procurementSpend).toEqual({
      totalProcurementSpend: 1250,
      procurementSpendCurrency: null,
      monthlyProcurementSpend: 250,
      procurementSpendByCurrency: [{ currency: null, amount: 1250 }],
      procurementSpendNote: null,
      totalBottlesDelivered: 18,
      spendByMonth: [
        {
          month: "2026-07",
          spend: 1000,
          spendCurrency: null,
          spendByCurrency: [{ currency: null, amount: 1000 }],
          unpricedOrders: 0,
          bottles: 12,
        },
        {
          month: "2026-08",
          spend: 250,
          spendCurrency: null,
          spendByCurrency: [{ currency: null, amount: 250 }],
          unpricedOrders: 0,
          bottles: 6,
        },
      ],
      unpricedOrders: 0,
      monthlyUnpricedOrders: 0,
    });
  });

  it("names the per-month bucket `spend`, so no consumer can read it as income", async () => {
    const result: any = await service.getDashboardSummary("r1");

    for (const bucket of result.procurementSpend.spendByMonth) {
      expect(bucket).toHaveProperty("spend");
      expect(bucket).not.toHaveProperty("revenue");
    }
  });

  it("leaves no revenue-shaped key anywhere in the summary payload", async () => {
    const result = await service.getDashboardSummary("r1");

    const offenders = allKeys(result).filter((k) => /revenue/i.test(k));
    expect(offenders).toEqual([]);
  });

  it("labels the stats endpoint's rolling totals as spend, not sales", async () => {
    const stats: any = await service.getStats("r1");

    expect(stats).toHaveProperty("todayProcurementSpend");
    expect(stats).toHaveProperty("weekProcurementSpend");
    expect(stats).toHaveProperty("monthProcurementSpend");
    expect(stats).not.toHaveProperty("todaySales");
    expect(stats).not.toHaveProperty("weekSales");
    expect(stats).not.toHaveProperty("monthSales");
  });

  // The `sales-chart` route name is frozen — it is a published path — so the
  // payload is the only place the truth can be told. Every point's money field
  // is a `procurement_orders.total_cost` sum.
  it("returns the sales-chart series keyed on procurementSpend, never revenue", async () => {
    const points: any[] = await service.getSalesChart("r1", "year");

    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(point).toHaveProperty("procurementSpend");
      expect(point).not.toHaveProperty("revenue");
    }
    expect(points.map((p) => [p.date, p.procurementSpend])).toEqual([
      ["2026-07", 1000],
      ["2026-08", 250],
    ]);
  });

  // Same for `calendar-revenue`: frozen route, honest payload.
  it("returns calendar figures as procurement_spend, never revenue", async () => {
    const result: any = await service.getCalendarRevenue("r1", 2026, 8);

    const offenders = allKeys(result).filter((k) => /revenue/i.test(k));
    expect(offenders).toEqual([]);
    expect(result).toHaveProperty("monthly_procurement_spend", 250);
    expect(result).not.toHaveProperty("monthly_total");

    const spendDay = result.daily.find((d: any) => d.date === "2026-08-09");
    expect(spendDay.procurement_spend).toBe(250);
    expect(spendDay).not.toHaveProperty("revenue");
  });
});

// F-701: an order placed with no price is written total_cost 0. It used to add
// $0 — or, with a `final_price` set, ONE bottle's price as the whole order —
// and nothing said so. It is now left out of the total and counted.
describe("DashboardService — a delivery with no price is counted, not summed as $0 (F-701)", () => {
  let service: DashboardService;
  const UNPRICED = {
    status: ProcurementOrderStatus.DELIVERED,
    total_cost: 0,
    final_price: 17,
    bottles_total: 12,
    quantity: 12,
    delivered_at: "2026-08-15T09:00:00Z",
    created_at: "2026-08-14T00:00:00Z",
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-15T12:00:00Z"));
    const db = {
      getClient: jest.fn().mockReturnValue(
        makeClient({
          procurement_orders: [...DELIVERED_ORDERS, UNPRICED],
          restaurants: [{ timezone: "UTC" }],
        }),
      ),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [DashboardService, { provide: DatabaseService, useValue: db }],
    }).compile();
    service = module.get<DashboardService>(DashboardService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("the stat cards leave it out of the spend and say how many", async () => {
    const stats: any = await service.getStats("r1");

    expect(stats.todayProcurementSpend).toBe(0);
    expect(stats.todayProcurementUnpriced).toBe(1);
    expect(stats.monthProcurementSpend).toBe(250);
    expect(stats.monthProcurementUnpriced).toBe(1);
    expect(stats.weekProcurementUnpriced).toBe(1);
  });

  it("the spend summary leaves it out and counts it", async () => {
    const result: any = await service.getDashboardSummary("r1");

    expect(result.procurementSpend.totalProcurementSpend).toBe(1250);
    expect(result.procurementSpend.monthlyProcurementSpend).toBe(250);
    expect(result.procurementSpend.unpricedOrders).toBe(1);
    expect(result.procurementSpend.monthlyUnpricedOrders).toBe(1);
    expect(result.procurementSpend.spendByMonth[1].unpricedOrders).toBe(1);
  });

  it("the calendar and the chart add nothing for it, not a bottle's price", async () => {
    const calendar: any = await service.getCalendarRevenue("r1", 2026, 8);
    const day = calendar.daily.find((d: any) => d.date === "2026-08-15");
    expect(day.procurement_spend).toBe(0);

    const points: any[] = await service.getSalesChart("r1", "year");
    const august = points.find((p) => p.date === "2026-08");
    expect(august?.procurementSpend).toBe(250);
    expect(august?.unpricedOrders).toBe(1);
  });
});

// F-1039: the spend summary and the chart summed `total_cost` across every
// order without reading its currency, so a lira house with one euro vendor
// read ₺12,000 + €400 as "12,400 paid". Two named currencies now give null,
// each currency's part, and a sentence saying why (F-339's rule).
describe("DashboardService — spend in two currencies is not added (F-1039)", () => {
  let service: DashboardService;
  const order = (
    total_cost: number,
    currency: string,
    delivered_at: string,
  ) => ({
    status: ProcurementOrderStatus.DELIVERED,
    total_cost,
    final_price: null,
    currency,
    bottles_total: 6,
    quantity: 6,
    delivered_at,
    created_at: delivered_at,
  });

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-15T12:00:00Z"));
    const db = {
      getClient: jest.fn().mockReturnValue(
        makeClient({
          procurement_orders: [
            order(12000, "TRY", "2026-07-04T00:00:00Z"),
            order(5000, "try", "2026-08-09T00:00:00Z"),
            order(400, "EUR", "2026-08-10T00:00:00Z"),
          ],
          restaurants: [{ timezone: "UTC" }],
        }),
      ),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [DashboardService, { provide: DatabaseService, useValue: db }],
    }).compile();
    service = module.get<DashboardService>(DashboardService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("the spend summary gives null, each currency's part, and why", async () => {
    const result: any = await service.getDashboardSummary("r1");
    const spend = result.procurementSpend;

    expect(spend.totalProcurementSpend).toBeNull();
    expect(spend.monthlyProcurementSpend).toBeNull();
    expect(spend.procurementSpendByCurrency).toEqual([
      { currency: "TRY", amount: 17000 },
      { currency: "EUR", amount: 400 },
    ]);
    expect(spend.procurementSpendNote).toBe(
      "Paid in EUR and TRY: with no exchange rate on record these are shown apart, not added into one figure.",
    );
    // A month in one currency still has its figure.
    expect(spend.spendByMonth[0]).toMatchObject({
      month: "2026-07",
      spend: 12000,
    });
    expect(spend.spendByMonth[1]).toMatchObject({
      month: "2026-08",
      spend: null,
    });
  });

  it("the chart's bucket in two currencies is null with each part", async () => {
    const points: any[] = await service.getSalesChart("r1", "year");
    const july = points.find((p) => p.date === "2026-07");
    const august = points.find((p) => p.date === "2026-08");

    expect(july?.procurementSpend).toBe(12000);
    expect(july?.procurementSpendNote).toBeNull();
    expect(august?.procurementSpend).toBeNull();
    expect(august?.procurementSpendByCurrency).toEqual([
      { currency: "TRY", amount: 5000 },
      { currency: "EUR", amount: 400 },
    ]);
    expect(august?.procurementSpendNote).toMatch(/^Paid in EUR and TRY/);
  });
});

// F-1052: an order naming no currency is the house's (`restaurants.currency`),
// so old no-code lira orders beside a euro one are two currencies, not one
// figure; and a single currency that is not the house's carries its code, so
// the page never prints euros as lira.
describe("DashboardService — spend in the house's currency (F-1052, F-1055)", () => {
  const order = (
    total_cost: number,
    currency: string | null,
    delivered_at: string,
  ) => ({
    status: ProcurementOrderStatus.DELIVERED,
    total_cost,
    final_price: null,
    currency,
    bottles_total: 6,
    quantity: 6,
    delivered_at,
    created_at: delivered_at,
  });

  it("counts an order naming no currency as the house's, so lira beside euros is not one sum", () => {
    const paid = spendByCurrency(
      [order(12000, null, "x"), order(400, "EUR", "x")],
      "TRY",
    );
    expect(paid.total).toBeNull();
    expect(paid.currency).toBeNull();
    expect(paid.byCurrency).toEqual([
      { currency: "TRY", amount: 12000 },
      { currency: "EUR", amount: 400 },
    ]);
    expect(mixedSpendNote(paid.byCurrency)).toContain("Paid in EUR and TRY");
  });

  it("gives one other currency WITH its code, and old orders the house's", () => {
    expect(spendByCurrency([order(1200, "eur", "x")], "try")).toMatchObject({
      total: 1200,
      currency: "EUR",
    });
    expect(spendByCurrency([order(500, null, "x")], "TRY")).toMatchObject({
      total: 500,
      currency: "TRY",
      byCurrency: [{ currency: "TRY", amount: 500 }],
    });
  });

  let service: DashboardService;
  beforeEach(async () => {
    // 15:00 in Istanbul on 2026-08-15.
    jest.useFakeTimers().setSystemTime(new Date("2026-08-15T12:00:00Z"));
    const db = {
      getClient: jest.fn().mockReturnValue(
        makeClient({
          procurement_orders: [
            // A legacy lira order earlier this month, naming no currency.
            order(12000, null, "2026-08-03T09:00:00Z"),
            // Today's one delivery, from an importer, in euros.
            order(1200, "EUR", "2026-08-15T08:00:00Z"),
          ],
          restaurants: [{ timezone: "Europe/Istanbul", currency: "TRY" }],
        }),
      ),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [DashboardService, { provide: DatabaseService, useValue: db }],
    }).compile();
    service = module.get<DashboardService>(DashboardService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("the stat cards say today's euros are euros, and give the month's parts and why", async () => {
    const stats: any = await service.getStats("r1");

    expect(stats.todayProcurementSpend).toBe(1200);
    expect(stats.procurementSpendParts.today.currency).toBe("EUR");
    expect(stats.monthProcurementSpend).toBeNull();
    expect(stats.procurementSpendParts.month).toEqual({
      currency: null,
      byCurrency: [
        { currency: "TRY", amount: 12000 },
        { currency: "EUR", amount: 1200 },
      ],
      note: expect.stringContaining("Paid in EUR and TRY"),
    });
  });

  it("a role without money gets no parts either (DASH-W22)", async () => {
    const stats: any = statsForRole(await service.getStats("r1"), "staff");
    expect(stats).not.toHaveProperty("procurementSpendParts");
    expect(stats.todayProcurementSpend).toBeNull();
  });

  it("the calendar gives the day's code and the month's parts", async () => {
    const month: any = await service.getCalendarRevenue("r1", 2026, 8);
    const day = month.daily.find((d: any) => d.date === "2026-08-15");
    expect(day.procurement_spend).toBe(1200);
    expect(day.procurement_spend_currency).toBe("EUR");
    expect(month.monthly_procurement_spend).toBeNull();
    expect(month.monthly_procurement_spend_by_currency).toEqual([
      { currency: "TRY", amount: 12000 },
      { currency: "EUR", amount: 1200 },
    ]);
  });
});

// F-1056: GET /dashboard/summary answered 0 spent when the orders could not be
// read, so `allServicesHealthy` said true, and it took "this month" from the
// server's UTC clock rather than the house's.
describe("DashboardService — the spend summary's failed read and month (F-1056)", () => {
  const order = (total_cost: number, delivered_at: string) => ({
    status: ProcurementOrderStatus.DELIVERED,
    total_cost,
    final_price: null,
    bottles_total: 6,
    quantity: 6,
    delivered_at,
    created_at: delivered_at,
  });

  const serviceOver = async (
    rows: Record<string, any[]>,
    errors: Record<string, { message: string }> = {},
  ) => {
    const db = {
      getClient: jest.fn().mockReturnValue(makeClient(rows, errors)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [DashboardService, { provide: DatabaseService, useValue: db }],
    }).compile();
    return module.get<DashboardService>(DashboardService);
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  it("files a failed orders read under errors, never as 0 spent", async () => {
    const service = await serviceOver(
      { restaurants: [{ timezone: "UTC" }] },
      { procurement_orders: { message: "boom" } },
    );
    const result: any = await service.getDashboardSummary("r1");

    expect(result.procurementSpend).toBeNull();
    expect(result.errors.map((e: any) => e.service)).toContain(
      "procurementSpend",
    );
    expect(result.allServicesHealthy).toBe(false);
  });

  it("takes this month on the house's clock, not the server's UTC month", async () => {
    // 01:30 on 1 September in Istanbul; still 31 August in UTC.
    jest.useFakeTimers().setSystemTime(new Date("2026-08-31T22:30:00Z"));
    const service = await serviceOver({
      procurement_orders: [
        order(500, "2026-08-31T20:00:00Z"), // 23:00 on 31 August, house time
        order(300, "2026-08-31T22:00:00Z"), // 01:00 on 1 September, house time
      ],
      restaurants: [{ timezone: "Europe/Istanbul" }],
    });
    const spend: any = (await service.getDashboardSummary("r1"))
      .procurementSpend;

    expect(spend.monthlyProcurementSpend).toBe(300);
    expect(spend.spendByMonth.map((m: any) => [m.month, m.spend])).toEqual([
      ["2026-08", 500],
      ["2026-09", 300],
    ]);
  });

  it("has no month to give a house with no time zone", async () => {
    const service = await serviceOver({
      procurement_orders: [order(500, "2026-08-31T20:00:00Z")],
      restaurants: [{ timezone: null }],
    });
    const spend: any = (await service.getDashboardSummary("r1"))
      .procurementSpend;

    expect(spend.totalProcurementSpend).toBe(500);
    expect(spend.monthlyProcurementSpend).toBeNull();
    expect(spend.spendByMonth).toBeNull();
  });
});
