import { Test, TestingModule } from "@nestjs/testing";
import { DashboardService, eventSentence } from "./dashboard.service";
import { DatabaseService } from "../database/database.service";
import { ProcurementOrderStatus } from "../procurement/dto/procurement.dto";
import { calendarForRole } from "./amounts-for-role";

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
      // A row that carries a `restaurant_id` comes back only when the read
      // asked for that house, as Postgres would; one asked for no house comes
      // back whatever its house. A fixture row from another house is how a
      // test sees a read that lost its tenant filter (PR #579 audit note 4).
      const inHouse = (row: any) =>
        !row ||
        typeof row !== "object" ||
        !("restaurant_id" in row) ||
        asked
          .filter((a) => a[0] === "eq" && a[1] === "restaurant_id")
          .every((a) => a[2] === row.restaurant_id);
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve(
          errorsByTable[table]
            ? { data: null, error: { message: errorsByTable[table] } }
            : { data: (rowsByTable[table] ?? []).filter(inHouse), error: null },
        ).then(resolve, reject);
      return builder;
    }),
  };
  return client;
}

/**
 * A PostgREST stand-in that pages as the server does: `max_rows` 1,000 caps
 * every answer, `order("id")` sorts, `gt("id")` moves the cursor, `limit`
 * cuts, and `{ count: "exact" }` reports the rows past the cursor. `lie`
 * makes a table's count claim rows it never serves. Filters other than the
 * cursor pass through.
 */
function pagedClient(
  rowsByTable: Record<string, any[]>,
  lie: Record<string, number> = {},
) {
  return {
    from: jest.fn((table: string) => {
      const builder: any = {};
      let counted = false;
      let after: string | null = null;
      let cap = 1000;
      let ordered = false;
      for (const m of [
        "eq",
        "neq",
        "gte",
        "lt",
        "lte",
        "is",
        "in",
        "or",
        "not",
      ])
        builder[m] = () => builder;
      builder.select = (_cols: string, opts?: { count?: string }) => {
        counted = opts?.count === "exact";
        return builder;
      };
      builder.order = (col: string) => {
        ordered = col === "id";
        return builder;
      };
      builder.gt = (col: string, v: string) => {
        if (col === "id") after = v;
        return builder;
      };
      builder.limit = (n: number) => {
        cap = Math.min(cap, n);
        return builder;
      };
      builder.then = (resolve: any, reject: any) => {
        let rows = [...(rowsByTable[table] ?? [])];
        if (ordered)
          rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        if (after !== null) rows = rows.filter((r) => r.id > after!);
        const count = counted
          ? rows.length + (after === null ? (lie[table] ?? 0) : 0)
          : null;
        return Promise.resolve({
          data: rows.slice(0, cap),
          error: null,
          count,
        }).then(resolve, reject);
      };
      return builder;
    }),
  };
}

const many = (n: number, row: (i: number) => Record<string, unknown>) =>
  Array.from({ length: n }, (_, i) => ({
    id: `x-${String(i).padStart(6, "0")}`,
    ...row(i),
  }));

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
      expect(stats.timezone).toBe("UTC");
    });

    // DASH-W20: the page's "today" reads the clock the figures were bucketed in.
    it("says which zone it bucketed the figures in", async () => {
      const stats: any = await service.getStats("r1");
      expect(stats.timezone).toBe("America/Chicago");
    });

    // DASH-W22: the counts staff read in place of the money cards, on the
    // same house days as the spend (Sept's delivery is not this month's).
    it("counts today's deliveries and this month's bottles on the house's days", async () => {
      const stats: any = await service.getStats("r1");
      expect(stats.todayDeliveries).toBe(1);
      expect(stats.monthBottlesIn).toBe(12);
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
        /The month's deliveries could not be read/,
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
      expect(
        eventSentence("inventory_change", {
          type: "add",
          wineName: "Barolo",
          quantity: 6,
        }),
      ).toEqual({ title: "Barolo", description: "added, 6 bottles" });
      // An add with no count (PR #579 review): "added", never "added, ".
      expect(
        eventSentence("inventory_change", { type: "add", wineName: "Barolo" }),
      ).toEqual({ title: "Barolo", description: "added" });
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
          "An item with no name — out of stock",
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
  // PR #579 audit note 2 (DASH-G2's size half): the stat cards read every
  // row or refuse; past PostgREST's 1,000 they printed a slice as the total.
  describe("the stat cards read whole or refuse (ADR 0292)", () => {
    const TODAY_DELIVERY = {
      status: ProcurementOrderStatus.DELIVERED,
      total_cost: 1,
      final_price: null,
      bottles_total: 1,
      quantity: 1,
      delivered_at: "2026-10-01T18:00:00Z",
    };

    it("counts past 1,000 rows on all three reads", async () => {
      db.getClient.mockReturnValue(
        pagedClient({
          restaurants: CHICAGO,
          restaurant_inventory: many(1500, () => ({
            stock_live: 1,
            bottle_size_ml: 750,
          })),
          v_low_stock_items: many(1200, () => ({})),
          procurement_orders: many(1100, () => TODAY_DELIVERY),
        }),
      );
      const stats: any = await service.getStats("r1");
      expect(stats.totalWines).toBe(1500);
      expect(stats.totalBottles).toBe(1500);
      expect(stats.lowStockItems).toBe(1200);
      expect(stats.todayDeliveries).toBe(1100);
      expect(stats.todayProcurementSpend).toBe(1100);
    });

    it.each([
      "restaurant_inventory",
      "v_low_stock_items",
      "procurement_orders",
    ])("refuses rather than counting part of %s", async (table) => {
      db.getClient.mockReturnValue(
        pagedClient(
          {
            restaurants: CHICAGO,
            restaurant_inventory: many(3, () => ({ stock_live: 1 })),
            v_low_stock_items: many(3, () => ({})),
            procurement_orders: many(3, () => TODAY_DELIVERY),
          },
          { [table]: 5 },
        ),
      );
      await expect(service.getStats("r1")).rejects.toThrow(
        /could not be read whole/,
      );
    });
  });

  // PR #579 audit note 4: a read that loses its house filter fails a test.
  describe("each read stays in the caller's house", () => {
    it("files only this house's calendar events and deliveries on the month", async () => {
      db.getClient.mockReturnValue(
        makeClient({
          restaurants: CHICAGO,
          calendar_events: [
            {
              id: "ev-mine",
              restaurant_id: "r1",
              title: "Ours",
              event_type: "tasting",
              event_date: "2026-09-05",
              event_time: null,
            },
            {
              id: "ev-theirs",
              restaurant_id: "r2",
              title: "Theirs",
              event_type: "tasting",
              event_date: "2026-09-06",
              event_time: null,
            },
          ],
          procurement_orders: [
            { ...SEPTEMBER_DELIVERY, restaurant_id: "r1" },
            {
              ...SEPTEMBER_DELIVERY,
              id: "o-theirs",
              restaurant_id: "r2",
              total_cost: 999,
            },
          ],
        }),
      );
      const month: any = await service.getCalendarRevenue("r1", 2026, 9);
      const day = (d: string) => month.daily.find((x: any) => x.date === d);
      expect(day("2026-09-05").events.map((e: any) => e.title)).toEqual([
        "Ours",
      ]);
      expect(day("2026-09-06").events).toEqual([]);
      expect(day("2026-09-15").procurement_spend).toBe(100);
      expect(day("2026-09-15").order_count).toBe(1);
      expect(month.monthly_procurement_spend).toBe(100);
    });

    it("tells Lately only this house's events", async () => {
      db.getClient.mockReturnValue(
        makeClient({
          events: [
            {
              id: "e-mine",
              restaurant_id: "r1",
              event_type: "provider_change",
              payload: { type: "added", providerName: "Our Vendor" },
              created_at: "2026-09-30T17:00:00Z",
            },
            {
              id: "e-theirs",
              restaurant_id: "r2",
              event_type: "provider_change",
              payload: { type: "added", providerName: "Their Vendor" },
              created_at: "2026-09-30T18:00:00Z",
            },
          ],
        }),
      );
      const items = await service.getActivity("r1");
      expect(items.map((a) => a.description)).toEqual(["Our Vendor"]);
    });
  });

  // PR #579 audit note 3: the summary's notices floor, tested at the service.
  // The controller refuses a caller with no role first, so this floor is not
  // reachable through the route today; it holds for any other caller.
  describe("the dashboard summary reads no notices without a user", () => {
    it.each([[undefined], [null], [""], ["   "]])(
      "reads none for user %p, never the house's",
      async (userId) => {
        const client = makeClient({
          notifications: [
            {
              id: "n-owner",
              user_id: "u-owner",
              restaurant_id: "r1",
              read_at: null,
            },
          ],
        });
        db.getClient.mockReturnValue(client);
        const summary: any = await service.getDashboardSummary(
          "r1",
          userId as any,
        );
        expect(summary.notifications).toEqual({ recent: [], unreadCount: 0 });
        expect(client.from).not.toHaveBeenCalledWith("notifications");
      },
    );
  });

  // PR #579 audit note 5: the month's sales have a second barrier. Even a
  // ledger that arrived WITH sales leaves the gateway without them for a role
  // that does not see sales.
  describe("calendarForRole withholds sales as well as amounts", () => {
    const withSales = () => ({
      daily: [
        {
          date: "2026-10-01",
          procurement_spend: 40,
          bottles_sold: 2,
          order_count: 1,
          net_sales: 900,
          checks: 12,
          net_checks: 11,
          events: [],
        },
      ],
      monthly_procurement_spend: 40,
      monthly_bottles: 2,
      monthly_net_sales: 900,
      monthly_checks: 12,
      monthly_net_checks: 11,
      monthly_days_counted: 1,
      monthly_days_begun: 1,
      pos_connected: true,
      sales_withheld: false,
    });

    it.each([["staff"], ["server"], [null], [undefined], ["__proto__"]])(
      "nulls every sales figure for %p",
      (role) => {
        const out: any = calendarForRole(withSales(), role as any);
        expect(out.daily[0]).toMatchObject({
          net_sales: null,
          checks: null,
          net_checks: null,
          bottles_sold: 2,
          order_count: 1,
        });
        expect(out).toMatchObject({
          monthly_net_sales: null,
          monthly_checks: null,
          monthly_net_checks: null,
          monthly_days_counted: null,
          monthly_days_begun: null,
          pos_connected: null,
          sales_withheld: true,
          amounts: "withheld",
        });
      },
    );

    it.each([["owner"], ["manager"], ["Admin"]])(
      "keeps the sales for %s",
      (role) => {
        const out: any = calendarForRole(withSales(), role);
        expect(out.daily[0]).toMatchObject({
          net_sales: 900,
          checks: 12,
          net_checks: 11,
        });
        expect(out).toMatchObject({
          monthly_net_sales: 900,
          monthly_checks: 12,
          pos_connected: true,
          sales_withheld: false,
          amounts: "shown",
        });
      },
    );
  });
});
