import { Test, TestingModule } from "@nestjs/testing";
import { DashboardService } from "./dashboard.service";
import { DatabaseService } from "../database/database.service";

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
function makeClient(rowsByTable: Record<string, any[]>) {
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
        Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(
          resolve,
          reject,
        );
      return builder;
    }),
  };
}

const DELIVERED_ORDERS = [
  {
    status: "delivered",
    total_cost: 1000,
    final_price: 900,
    bottles_total: 12,
    quantity: 12,
    delivered_at: "2026-07-04T00:00:00Z",
    created_at: "2026-07-01T00:00:00Z",
  },
  {
    status: "delivered",
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
      makeClient({ procurement_orders: DELIVERED_ORDERS }),
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
      monthlyProcurementSpend: 250,
      totalBottlesDelivered: 18,
      spendByMonth: [
        { month: "2026-07", spend: 1000, bottles: 12 },
        { month: "2026-08", spend: 250, bottles: 6 },
      ],
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
