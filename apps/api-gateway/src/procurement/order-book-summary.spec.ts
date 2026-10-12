import { ServiceUnavailableException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { ProcurementController } from "./procurement.controller";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";

/**
 * `GET /procurement/orders?summary=true` — /orders' stage counts and its month
 * figure, over the house's whole book on the server, sent with the newest page
 * (sim F-1368).
 *
 * The page used to read all 5,000 orders of a large house in 50 serial pages,
 * every minute, only to count and sum them. This suite pins: the counts come
 * from every row (paging past PostgREST's 1,000-row cap), a repeating order
 * sits in `recurring` and not in its stage, the month sums committed orders
 * per currency on the house's clock, staff get no money column read or sent,
 * and a failed read is a 503. It also pins the list's `ids` filter, which
 * /calendar uses to read only the orders its entries link to.
 */

type Row = Record<string, unknown>;

function makeDb(
  pages: Array<{ data: Row[] | null; error?: { message: string } | null }>,
  house: { timezone: string | null; country?: string | null } = {
    timezone: "America/Los_Angeles",
  },
) {
  const calls = {
    selects: [] as string[],
    eqs: [] as [string, unknown][],
    ins: [] as [string, unknown][],
    ranges: [] as [number, number][],
  };
  let served = 0;
  const orders: any = {
    select(cols: string) {
      calls.selects.push(cols);
      return orders;
    },
    eq(col: string, val: unknown) {
      calls.eqs.push([col, val]);
      return orders;
    },
    in(col: string, val: unknown) {
      calls.ins.push([col, val]);
      return orders;
    },
    gte: () => orders,
    lte: () => orders,
    lt: () => orders,
    order: () => orders,
    range(from: number, to: number) {
      calls.ranges.push([from, to]);
      const page = pages[served++] ?? { data: [] };
      return Promise.resolve({
        data: page.data,
        error: page.error ?? null,
        count: page.data?.length ?? 0,
      });
    },
  };
  const restaurants: any = {
    select: () => restaurants,
    eq: () => restaurants,
    maybeSingle: () => Promise.resolve({ data: house, error: null }),
  };
  const db = {
    supabase: {
      from: (table: string) => (table === "restaurants" ? restaurants : orders),
    },
  } as unknown as DatabaseService;
  return { db, calls };
}

function service(db: DatabaseService) {
  return new ProcurementService(
    db,
    { emit: jest.fn() } as unknown as EventsService,
    {} as unknown as InventoryLedgerService,
  );
}

const row = (status: string, extra: Row = {}): Row => ({
  status,
  recurrence_frequency: null,
  total_cost: null,
  currency: "USD",
  requested_at: null,
  ...extra,
});

// 2026-10-01 05:00 UTC is still 30 September in Los Angeles.
const NOW = new Date("2026-10-15T18:00:00Z");

describe("summarizeOrderBook (F-1368)", () => {
  it("counts every order in the book by stage, paging past the 1,000-row cap", async () => {
    const { db, calls } = makeDb([
      { data: Array.from({ length: 1000 }, () => row("DELIVERED")) },
      {
        data: [
          row("PENDING"),
          row("APPROVAL_NEEDED"),
          row("APPROVED"),
          row("CONFIRMED"),
          row("IN_TRANSIT"),
          row("CANCELLED"),
          row("REJECTED"),
          row("FAILED"),
          row("APPROVED", { recurrence_frequency: "weekly" }),
          row("CANCELLED", { recurrence_frequency: "monthly" }),
        ],
      },
    ]);
    const s = await service(db).summarizeOrderBook("rest-1", {
      withAmounts: true,
      now: NOW,
    });
    expect(s.total).toBe(1010);
    expect(s.counts).toEqual({
      pending: 2,
      approved: 1,
      ordered: 2,
      delivered: 1000,
    });
    expect(s.recurring).toBe(2);
    expect(s.cancelled).toBe(3);
    // A truck refused at the door is counted apart, never as cancelled (F-669).
    expect(s.refused).toBe(1);
    expect(calls.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(calls.eqs).toContainEqual(["restaurant_id", "rest-1"]);
  });

  it("sums the committed orders of this month and last on the house's clock, per currency", async () => {
    const { db } = makeDb([
      {
        data: [
          row("APPROVED", {
            total_cost: 2100,
            requested_at: "2026-10-03T12:00:00Z",
          }),
          row("DELIVERED", {
            total_cost: "400.50",
            requested_at: "2026-10-10T12:00:00Z",
          }),
          row("CONFIRMED", {
            total_cost: 90,
            currency: "EUR",
            requested_at: "2026-10-11T12:00:00Z",
          }),
          // Pending and cancelled orders are not money the house agreed to spend.
          row("PENDING", {
            total_cost: 999,
            requested_at: "2026-10-04T12:00:00Z",
          }),
          row("CANCELLED", {
            total_cost: 999,
            requested_at: "2026-10-04T12:00:00Z",
          }),
          row("APPROVED", {
            total_cost: null,
            requested_at: "2026-10-05T12:00:00Z",
          }),
          // Evening of 30 September in Los Angeles: last month, not this one.
          row("DELIVERED", {
            total_cost: 300,
            requested_at: "2026-10-01T05:00:00Z",
          }),
          row("DELIVERED", {
            total_cost: 7,
            requested_at: "2026-08-20T12:00:00Z",
          }),
        ],
      },
    ]);
    const s = await service(db).summarizeOrderBook("rest-1", {
      withAmounts: true,
      now: NOW,
    });
    expect(s.zone).toBe("America/Los_Angeles");
    expect(s.thisMonth).toEqual({
      month: "2026-10",
      byCurrency: [
        { currency: "USD", amount: 2500.5 },
        { currency: "EUR", amount: 90 },
      ],
      unpriced: 1,
    });
    expect(s.lastMonth).toEqual({
      month: "2026-09",
      byCurrency: [{ currency: "USD", amount: 300 }],
      unpriced: 0,
    });
  });

  it("files by the reader's clock when the house states no zone", async () => {
    const { db } = makeDb(
      [
        {
          data: [
            row("APPROVED", {
              total_cost: 10,
              requested_at: "2026-10-01T05:00:00Z",
            }),
          ],
        },
      ],
      { timezone: null, country: null },
    );
    const s = await service(db).summarizeOrderBook("rest-1", {
      withAmounts: true,
      callerZone: "Europe/Istanbul",
      now: NOW,
    });
    expect(s.zone).toBe("Europe/Istanbul");
    expect(s.thisMonth?.byCurrency).toEqual([{ currency: "USD", amount: 10 }]);
  });

  it("reads and sends no money for a reader who does not hold it", async () => {
    const { db, calls } = makeDb([{ data: [row("APPROVED")] }]);
    const s = await service(db).summarizeOrderBook("rest-1", {
      withAmounts: false,
      now: NOW,
    });
    expect(s.counts.approved).toBe(1);
    expect(s.thisMonth).toBeUndefined();
    expect(s.lastMonth).toBeUndefined();
    expect(calls.selects[0]).not.toMatch(/total_cost|currency/);
  });

  it("refuses with a 503 when the book cannot be read, never zeroes", async () => {
    const { db } = makeDb([{ data: null, error: { message: "boom" } }]);
    await expect(
      service(db).summarizeOrderBook("rest-1", { withAmounts: true, now: NOW }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe("listOrders ids filter (F-1368)", () => {
  it("reads only the named orders", async () => {
    const { db, calls } = makeDb([{ data: [] }]);
    await service(db).listOrders("rest-1", { ids: "a,b" } as any);
    expect(calls.ins).toContainEqual(["id", ["a", "b"]]);
  });
});

describe("GET /procurement/orders?summary=true (F-1368)", () => {
  const list = { orders: [], total: 0, page: 1, limit: 100, hasMore: false };
  const summary = {
    total: 3,
    counts: { pending: 1, approved: 1, ordered: 1, delivered: 0 },
    recurring: 0,
    cancelled: 0,
    refused: 0,
    zone: "UTC",
  };
  const svc = () =>
    ({
      listOrders: jest.fn().mockResolvedValue(list),
      summarizeOrderBook: jest.fn().mockResolvedValue(summary),
    }) as unknown as ProcurementService;

  it("sends the whole book's figures with the page when asked", async () => {
    const s = svc();
    const out = await new ProcurementController(s).listOrders(
      { summary: "true", zone: "Europe/Istanbul" } as any,
      { userId: "u", restaurantId: "rest-1", role: "owner" },
    );
    expect(out.summary).toEqual(summary);
    expect((s as any).summarizeOrderBook).toHaveBeenCalledWith("rest-1", {
      withAmounts: true,
      callerZone: "Europe/Istanbul",
    });
  });

  it("asks for no money for staff", async () => {
    const s = svc();
    const out = await new ProcurementController(s).listOrders(
      { summary: "true" } as any,
      { userId: "u", restaurantId: "rest-1", role: "staff" },
    );
    expect(out.amountsWithheld).toBe(true);
    expect((s as any).summarizeOrderBook).toHaveBeenCalledWith("rest-1", {
      withAmounts: false,
      callerZone: null,
    });
  });

  it("reads no summary when it is not asked for", async () => {
    const s = svc();
    const out = await new ProcurementController(s).listOrders({} as any, {
      userId: "u",
      restaurantId: "rest-1",
      role: "owner",
    });
    expect(out).not.toHaveProperty("summary");
    expect((s as any).summarizeOrderBook).not.toHaveBeenCalled();
  });

  it("keeps the summary's 503 rather than re-wrapping it", async () => {
    const s = svc();
    (s as any).summarizeOrderBook.mockRejectedValue(
      new ServiceUnavailableException("Could not read the orders"),
    );
    await expect(
      new ProcurementController(s).listOrders({ summary: "true" } as any, {
        userId: "u",
        restaurantId: "rest-1",
        role: "owner",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
