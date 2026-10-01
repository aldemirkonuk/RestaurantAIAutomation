import { Test, TestingModule } from "@nestjs/testing";
import { DashboardService, eventSentence } from "./dashboard.service";
import { DatabaseService } from "../database/database.service";
import { ProcurementOrderStatus } from "../procurement/dto/procurement.dto";

/**
 * The founder's dashboard walk-through, 2026-10-01 (dashboard.md §14):
 *
 *  - DASH-W2  the paid-to-vendors cards and the calendar count the same money
 *             by the same rule: delivery date, on the house's wall clock, and
 *             "month" is the calendar month;
 *  - DASH-W3  a failed read fails the call instead of rendering as zero;
 *  - DASH-W4  Lately speaks in sentences, never in event codes;
 *  - DASH-W6  the calendar's order read names only columns that exist;
 *  - DASH-W7  alerts name the wine and count bottles in the right number;
 *  - DASH-W8  the stats call reads nothing it does not use;
 *  - DASH-W10 the cellar is the active, undeleted wines, on every read;
 *  - DASH-W11 a failed alert read fails the call.
 */

/**
 * Chainable Supabase stub. Every builder method returns the builder; awaiting
 * it resolves the rows (or the error) registered for its table, and each
 * `select()` argument is recorded so a test can read what was asked for.
 */
function makeClient(
  rowsByTable: Record<string, any[]>,
  errorsByTable: Record<string, string> = {},
) {
  const selects: Record<string, string[]> = {};
  const filters: Record<string, unknown[][]> = {};
  const passthrough = [
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
  const client = {
    selects,
    filters,
    from: jest.fn((table: string) => {
      const builder: any = {};
      const asked: unknown[][] = [];
      (filters[table] ??= []).push(asked);
      for (const method of passthrough)
        builder[method] = jest.fn((...args: unknown[]) => {
          asked.push([method, ...args]);
          return builder;
        });
      builder.select = jest.fn((cols: string) => {
        (selects[table] ??= []).push(cols);
        return builder;
      });
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve(
          errorsByTable[table]
            ? { data: null, error: { message: errorsByTable[table] } }
            : { data: rowsByTable[table] ?? [], error: null },
        ).then(resolve, reject);
      return builder;
    }),
  };
  return client;
}

const CHICAGO = [{ timezone: "America/Chicago" }];

// 8pm in Chicago on Oct 1 is 01:00 UTC on Oct 2.
const EVENING_DELIVERY = {
  id: "o-evening",
  status: ProcurementOrderStatus.DELIVERED,
  total_cost: 384,
  final_price: null,
  bottles_total: 12,
  quantity: 12,
  delivered_at: "2026-10-02T01:00:00Z",
  created_at: "2026-09-28T15:00:00Z",
};
// Inside the last 30 days, but in September.
const SEPTEMBER_DELIVERY = {
  id: "o-sept",
  status: ProcurementOrderStatus.DELIVERED,
  total_cost: 100,
  final_price: null,
  bottles_total: 6,
  quantity: 6,
  delivered_at: "2026-09-15T17:00:00Z",
  created_at: "2026-09-10T15:00:00Z",
};

describe("DashboardService — the founder walk-through, 2026-10-01", () => {
  let service: DashboardService;
  const db = { getClient: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    // 20:30 on Oct 1 in Chicago; already Oct 2 in UTC.
    jest.useFakeTimers().setSystemTime(new Date("2026-10-02T01:30:00Z"));
    const module: TestingModule = await Test.createTestingModule({
      providers: [DashboardService, { provide: DatabaseService, useValue: db }],
    }).compile();
    service = module.get<DashboardService>(DashboardService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("DASH-W2 — one rule for vendor money", () => {
    beforeEach(() => {
      db.getClient.mockReturnValue(
        makeClient({
          restaurants: CHICAGO,
          procurement_orders: [EVENING_DELIVERY, SEPTEMBER_DELIVERY],
        }),
      );
    });

    it("counts an evening delivery on the house's own day, not the UTC day", async () => {
      const stats: any = await service.getStats("r1");
      expect(stats.todayProcurementSpend).toBe(384);
    });

    it("makes 'month' the calendar month, not the last 30 days", async () => {
      const stats: any = await service.getStats("r1");
      expect(stats.monthProcurementSpend).toBe(384);
    });

    it("puts the same delivery in the same day cell on the calendar", async () => {
      const cal: any = await service.getCalendarRevenue("r1", 2026, 10);
      const day = (d: string) => cal.daily.find((x: any) => x.date === d);
      expect(day("2026-10-01").procurement_spend).toBe(384);
      expect(day("2026-10-02").procurement_spend).toBe(0);
      expect(cal.monthly_procurement_spend).toBe(384);
    });

    it("falls back to UTC when the house has no zone recorded", async () => {
      db.getClient.mockReturnValue(
        makeClient({ restaurants: [], procurement_orders: [EVENING_DELIVERY] }),
      );
      const stats: any = await service.getStats("r1");
      expect(stats.todayProcurementSpend).toBe(384); // Oct 2 in UTC is "today"
    });
  });

  describe("DASH-W3 — a failed read is not an empty cellar", () => {
    it.each([
      "restaurant_inventory",
      "v_low_stock_items",
      "procurement_orders",
      "restaurants",
    ])("fails the stats call when %s cannot be read", async (table) => {
      db.getClient.mockReturnValue(
        makeClient({ restaurants: CHICAGO }, { [table]: "permission denied" }),
      );
      await expect(service.getStats("r1")).rejects.toThrow();
    });

    it.each(["procurement_orders", "events", "restaurant_inventory"])(
      "fails the activity call when %s cannot be read",
      async (table) => {
        db.getClient.mockReturnValue(makeClient({}, { [table]: "timeout" }));
        await expect(service.getActivity("r1")).rejects.toThrow();
      },
    );
  });

  describe("DASH-W6 — the calendar asks only for columns that exist", () => {
    it("does not select wine_name from procurement_orders", async () => {
      const client = makeClient({
        restaurants: CHICAGO,
        procurement_orders: [],
      });
      db.getClient.mockReturnValue(client);
      await service.getCalendarRevenue("r1", 2026, 10);
      expect(client.selects.procurement_orders.join(" ")).not.toMatch(
        /wine_name/,
      );
    });

    it("fails instead of reporting a month of $0 when the order read is refused", async () => {
      db.getClient.mockReturnValue(
        makeClient(
          { restaurants: CHICAGO },
          {
            procurement_orders:
              "column procurement_orders.wine_name does not exist",
          },
        ),
      );
      await expect(service.getCalendarRevenue("r1", 2026, 10)).rejects.toThrow(
        /procurement_orders read failed/,
      );
    });
  });

  describe("DASH-W4 — Lately in the house's words", () => {
    const WINE = {
      display_name: "1er Cru Montmains",
      wine_name: "1er Cru Montmains",
      master_wine_library: { name: "1er Cru Montmains", vintage: 2023 },
    };

    it("names the wine, the count and the vendor, and shows each order once", async () => {
      db.getClient.mockReturnValue(
        makeClient({
          procurement_orders: [
            {
              id: "o1",
              order_number: "ORD-1",
              status: "DELIVERED",
              bottles_total: 1,
              quantity: 1,
              updated_at: "2026-10-01T17:00:00Z",
              restaurant_inventory: WINE,
              providers: { name: "Aldemir Distribution" },
            },
          ],
          events: [
            {
              id: "e1",
              event_type: "order_change",
              payload: {
                type: "created",
                orderId: "o1",
                orderNumber: "ORD-1",
                quantity: 1,
              },
              created_at: "2026-09-30T17:00:00Z",
            },
            {
              id: "e2",
              event_type: "provider_change",
              payload: { type: "added", providerName: "Aldemir Distribution" },
              created_at: "2026-08-11T17:30:00Z",
            },
            {
              id: "e3",
              event_type: "something_new",
              payload: { type: "x" },
              created_at: "2026-08-12T00:00:00Z",
            },
          ],
          restaurant_inventory: [
            {
              id: "i1",
              ...WINE,
              stock_live: 1,
              updated_at: "2026-09-12T00:00:00Z",
            },
          ],
        }),
      );

      const items = await service.getActivity("r1");
      const lines = items.map((a) => `${a.title} — ${a.description}`);

      expect(lines).toEqual([
        "Order ORD-1 delivered — 1er Cru Montmains 2023, 1 bottle from Aldemir Distribution",
        "1er Cru Montmains 2023 — 1 bottle on hand",
        "Vendor added — Aldemir Distribution",
      ]);
      expect(lines.join("\n")).not.toMatch(
        /_change|something_new|bottles on hand/,
      );
    });

    it("gives every production event kind a sentence, and leaves unknown kinds out", () => {
      expect(
        eventSentence("provider_change", {
          type: "updated",
          providerName: "V",
        }),
      ).toEqual({
        title: "Vendor details changed",
        description: "V",
      });
      expect(
        eventSentence("order_change", {
          type: "cancelled",
          orderNumber: "ORD-9",
          quantity: 6,
        }),
      ).toEqual({
        title: "Order ORD-9 cancelled",
        description: "6 bottles",
      });
      expect(
        eventSentence("inventory_change", {
          type: "stock_change",
          wineName: "Chablis",
          previousQuantity: 3,
          quantity: 1,
        }),
      ).toEqual({ title: "Chablis", description: "3 → 1 bottle" });
      expect(eventSentence("calendar_event", { title: "Tasting" })).toEqual({
        title: "Tasting",
        description: "",
      });
      expect(eventSentence("report_event", { type: "generated" })).toEqual({
        title: "Report ready",
        description: "",
      });
      expect(eventSentence("provider_change", { type: "merged" })).toBeNull();
      expect(eventSentence("mystery", {})).toBeNull();
    });
  });

  describe("DASH-W7 — alerts in the house's words", () => {
    it("names the wine with its vintage and counts one bottle as one", async () => {
      db.getClient.mockReturnValue(
        makeClient({
          v_low_stock_items: [
            {
              id: "inv-1",
              stock_live: 1,
              threshold_min: 6,
              wine_name: "1er Cru Montmains",
              vintage: 2023,
            },
          ],
          restaurant_inventory: [
            {
              id: "inv-2",
              display_name: null,
              wine_name: null,
              stock_live: 0,
              updated_at: "2026-09-30T10:00:00Z",
              master_wine_library: { name: "Sancerre", vintage: 2022 },
            },
            {
              id: "inv-3",
              display_name: null,
              wine_name: null,
              stock_live: 0,
              updated_at: "2026-09-30T10:00:00Z",
              master_wine_library: null,
            },
          ],
        }),
      );

      const alerts = await service.getAlerts("r1");
      const messages = alerts.map((a) => a.message).sort();

      expect(messages).toEqual(
        [
          "1er Cru Montmains 2023 — 1 bottle left, you keep at least 6",
          "Sancerre 2022 — out of stock",
          "A wine with no name — out of stock",
        ].sort(),
      );
      expect(messages.join(" ")).not.toMatch(/inv-|bottles \(min/);
    });
  });

  describe("DASH-W8 — the stats call reads only what it uses", () => {
    it("does not read wine_consumption_log", async () => {
      const client = makeClient({ restaurants: CHICAGO });
      db.getClient.mockReturnValue(client);

      await service.getStats("r1");

      expect(client.from).not.toHaveBeenCalledWith("wine_consumption_log");
    });
  });

  describe("DASH-W10 — the cellar is the active, undeleted wines", () => {
    const CELLAR_RULE = [
      ["is", "deleted_at", null],
      ["eq", "is_active", true],
    ];

    it.each([
      ["getStats", (svc: DashboardService) => svc.getStats("r1")],
      ["getAlerts", (svc: DashboardService) => svc.getAlerts("r1")],
      ["getActivity", (svc: DashboardService) => svc.getActivity("r1", 12)],
    ])("%s reads only active, undeleted wines", async (_name, call) => {
      const client = makeClient({ restaurants: CHICAGO });
      db.getClient.mockReturnValue(client);

      await call(service);

      const reads = client.filters["restaurant_inventory"] ?? [];
      expect(reads.length).toBeGreaterThan(0);
      for (const asked of reads)
        expect(asked).toEqual(expect.arrayContaining(CELLAR_RULE));
    });
  });

  describe("DASH-W11 — a failed alert read is not an all-clear", () => {
    it.each([
      "v_low_stock_items",
      "procurement_orders",
      "restaurant_inventory",
    ])("getAlerts fails when the %s read is refused", async (table) => {
      db.getClient.mockReturnValue(makeClient({}, { [table]: "refused" }));
      await expect(service.getAlerts("r1")).rejects.toThrow(
        /read failed: refused/,
      );
    });
  });
});
