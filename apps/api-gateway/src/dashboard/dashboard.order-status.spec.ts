import { Test, TestingModule } from "@nestjs/testing";
import { DashboardService } from "./dashboard.service";
import { DatabaseService } from "../database/database.service";
import { ProcurementOrderStatus } from "../procurement/dto/procurement.dto";

/**
 * The test that would have caught the case defect (ADR 0058).
 *
 * `procurement_orders.status` is written from `ProcurementOrderStatus` —
 * UPPERCASE. Nine read sites compared it to the lowercase `"delivered"`, so no
 * row ever matched and every spend, scorecard and lead-time figure was a
 * structural zero rendered as a measurement.
 *
 * WHY THE EXISTING SPECS STAYED GREEN THROUGH ALL OF IT
 * ----------------------------------------------------
 * `dashboard.spend.spec.ts` and `order-schema-drift.spec.ts` both stub the
 * Supabase builder with PASSTHROUGH filters: `.eq()` and `.in()` return the
 * builder and are never consulted, so awaiting it yields every fixture row for
 * that table no matter what was filtered on. Their fixtures then spelled
 * `status: "delivered"` — the case the CODE expected rather than the case the
 * APP WRITES — so the two wrongs agreed and the suite went green. A fixture
 * that matches the reader instead of the writer cannot fail on a reader/writer
 * mismatch; that is the whole defect, reproduced inside the test harness.
 *
 * So this file's stub HONOURS the status filter. That single difference is what
 * turns the bug into a failure: feed rows written the way production writes
 * them, apply the filter the way PostgREST applies it, and a mis-cased
 * comparison returns nothing and the assertions below go to zero.
 */

/** Rows exactly as `procurement.service.ts` writes them: enum-valued status. */
const ORDERS = [
  {
    id: "o1",
    status: ProcurementOrderStatus.DELIVERED,
    total_cost: 1000,
    final_price: 900,
    bottles_total: 12,
    quantity: 12,
    delivered_at: "2026-07-04T00:00:00Z",
    created_at: "2026-07-01T00:00:00Z",
  },
  {
    id: "o2",
    status: ProcurementOrderStatus.COMPLETED,
    total_cost: 250,
    final_price: null,
    bottles_total: 6,
    quantity: 6,
    delivered_at: "2026-08-09T00:00:00Z",
    created_at: "2026-08-02T00:00:00Z",
  },
  {
    // Physically arrived but still open as a backorder: deliberately NOT part
    // of any spend total, because its money columns describe the PO rather
    // than the short delivery. See ORDER_SPEND_STATUSES in order-status.ts.
    id: "o3",
    status: ProcurementOrderStatus.PARTIALLY_RECEIVED,
    total_cost: 9999,
    final_price: 9999,
    bottles_total: 99,
    quantity: 99,
    delivered_at: "2026-08-10T00:00:00Z",
    created_at: "2026-08-03T00:00:00Z",
  },
  {
    // Never arrived. Must never reach a spend figure.
    id: "o4",
    status: ProcurementOrderStatus.CANCELLED,
    total_cost: 5000,
    final_price: 5000,
    bottles_total: 50,
    quantity: 50,
    delivered_at: null,
    created_at: "2026-08-01T00:00:00Z",
  },
];

/**
 * Chainable stub that actually APPLIES `.eq("status", …)` and
 * `.in("status", […])`, the way PostgREST does. Every other filter stays a
 * passthrough — this file is about the status vocabulary, nothing else.
 */
function makeFilteringClient(rowsByTable: Record<string, any[]>) {
  const passthrough = [
    "select",
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
  ];
  return {
    from: jest.fn((table: string) => {
      let rows = rowsByTable[table] ?? [];
      const builder: any = {};
      for (const method of passthrough) {
        builder[method] = jest.fn(() => builder);
      }
      builder.eq = jest.fn((column: string, value: any) => {
        if (column === "status") rows = rows.filter((r) => r.status === value);
        return builder;
      });
      builder.in = jest.fn((column: string, values: readonly any[]) => {
        if (column === "status")
          rows = rows.filter((r) => (values as any[]).includes(r.status));
        return builder;
      });
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      return builder;
    }),
  };
}

describe("dashboard reads procurement_orders.status as the enum, not a lowercase string", () => {
  let service: DashboardService;

  const db = {
    getRestaurantInventory: jest.fn(),
    getLowStockItems: jest.fn(),
    getProcurementOrders: jest.fn(),
    getClient: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-08-15T12:00:00Z"));
    db.getRestaurantInventory.mockResolvedValue([]);
    db.getLowStockItems.mockResolvedValue([]);
    db.getProcurementOrders.mockResolvedValue(ORDERS);
    db.getClient.mockReturnValue(makeFilteringClient({ procurement_orders: ORDERS }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [DashboardService, { provide: DatabaseService, useValue: db }],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * The load-bearing assertion. Against the pre-fix `.eq("status","delivered")`
   * this is 0, because no enum-valued row matches a lowercase literal.
   */
  it("totals procurement spend over enum-valued rows instead of reporting zero", async () => {
    const result: any = await service.getDashboardSummary("r1");

    expect(result.procurementSpend.totalProcurementSpend).toBeGreaterThan(0);
    // DELIVERED 1000 + COMPLETED 250. PARTIALLY_RECEIVED and CANCELLED excluded.
    expect(result.procurementSpend.totalProcurementSpend).toBe(1250);
    expect(result.procurementSpend.totalBottlesDelivered).toBe(18);
  });

  it("excludes cancelled and partially-received orders from the spend total", async () => {
    const result: any = await service.getDashboardSummary("r1");

    // 9999 (PARTIALLY_RECEIVED) and 5000 (CANCELLED) must not appear anywhere.
    const spend = result.procurementSpend;
    expect(spend.totalProcurementSpend).toBeLessThan(9999);
    for (const bucket of spend.spendByMonth) {
      expect(bucket.spend).toBeLessThan(9999);
    }
  });

  it("reports rolling spend stats over enum-valued rows instead of zero", async () => {
    const stats: any = await service.getStats("r1");

    expect(stats.monthProcurementSpend).toBeGreaterThan(0);
  });

  it("counts orders awaiting approval by enum member, not by 'awaiting_approval'", async () => {
    // `awaiting_approval` and `ordered` were never ProcurementOrderStatus
    // members under any casing — those filters could not match even after a
    // case fix, so they are asserted separately from the delivered family.
    db.getProcurementOrders.mockResolvedValue([
      { id: "p1", status: ProcurementOrderStatus.PENDING },
      { id: "p2", status: ProcurementOrderStatus.APPROVAL_NEEDED },
      { id: "p3", status: ProcurementOrderStatus.IN_TRANSIT },
      { id: "p4", status: ProcurementOrderStatus.CONFIRMED },
    ]);

    const summary: any = await service.getDashboardSummary("r1");

    expect(summary.orders.pending.length).toBe(2);
    expect(summary.orders.inTransit.length).toBe(2);
  });
});
