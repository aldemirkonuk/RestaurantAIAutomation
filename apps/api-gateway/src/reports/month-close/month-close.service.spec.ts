import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  MonthCloseService,
  againstNow,
  type MonthFigures,
} from "./month-close.service";

/**
 * F-1013, the founder's ruling of 2026-10-11 (sim ledger S195): option C, the
 * snapshot close. Before this lane there was no way to close a month at all;
 * every case below failed on a build without `month-close.service.ts`.
 */

type Op = { m: string; a: unknown[] };
type Answer = { data: unknown; error: unknown; count?: number | null };
type Handler = (table: string, ops: Op[]) => Answer;

/** A supabase-js stand-in: records each chain and answers it from `handle`. */
function fakeDb(handle: Handler) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const answer = () => Promise.resolve(handle(table, ops));
    const chain: any = new Proxy(
      {},
      {
        get(_t, m: string) {
          if (m === "then")
            return (res: any, rej: any) => answer().then(res, rej);
          if (m === "single" || m === "maybeSingle")
            return () => {
              ops.push({ m, a: [] });
              return answer();
            };
          return (...a: unknown[]) => {
            ops.push({ m, a });
            return chain;
          };
        },
      },
    );
    return chain;
  };
  return { db: { from }, calls };
}

const has = (ops: Op[], m: string) => ops.some((o) => o.m === m);
const arg = (ops: Op[], m: string) => ops.find((o) => o.m === m)?.a;

const HOUSE = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const ZONE = "Europe/Istanbul";

const till = {
  posConnected: true,
  revenue: 1000,
  checkCount: 10,
  dailySeries: [{ date: "2026-07-03", revenue: 1000 }],
  wineSales: [],
};

function service(handle: Handler, tillWindow = till) {
  const { db, calls } = fakeDb(handle);
  const goals = { getPosRevenueWindow: jest.fn(async () => tillWindow) };
  const analytics = {
    getFinancialSummary: jest.fn(async () => ({
      inventoryValue: null,
      pricedInventoryValue: 4200,
      costCoverage: { unpriced: 3 },
    })),
  };
  const svc = new MonthCloseService(
    { supabase: db } as any,
    goals as any,
    analytics as any,
  );
  return { svc, calls, goals, analytics };
}

/** The house, its earlier closes, its orders and counts for July 2026. */
function houseHandler(
  over: Partial<Record<string, (ops: Op[]) => Answer>> = {},
): Handler {
  return (table, ops) => {
    const custom = over[table];
    if (custom) return custom(ops);
    switch (table) {
      case "restaurants":
        return {
          data: {
            name: "SYNTHETIC House",
            currency: "try",
            timezone: ZONE,
            country: "TR",
          },
          error: null,
        };
      case "procurement_orders":
        return {
          data: [
            {
              id: "o1",
              total_cost: 300,
              currency: null,
              delivered_at: "2026-07-04T10:00:00Z",
            },
            {
              id: "o2",
              total_cost: 50,
              currency: "eur",
              delivered_at: "2026-07-05T10:00:00Z",
            },
            {
              id: "o3",
              total_cost: null,
              currency: null,
              delivered_at: "2026-07-06T10:00:00Z",
            },
          ],
          error: null,
          count: 3,
        };
      case "stock_counts":
        return {
          data: [
            { id: "c1", expected_qty: 12, counted_qty: 10, variance_qty: null },
            { id: "c2", expected_qty: 5, counted_qty: 6, variance_qty: 1 },
          ],
          error: null,
          count: 2,
        };
      case "month_closes":
        if (has(ops, "insert")) {
          const row = arg(ops, "insert")![0] as Record<string, unknown>;
          return {
            data: { id: "close-1", closed_at: "2026-08-02T09:00:00Z", ...row },
            error: null,
          };
        }
        return { data: [{ version: 2 }], error: null };
      case "system_audit_log":
        return { data: null, error: null };
      case "users":
        return { data: [{ user_id: ACTOR, name: "Ayla" }], error: null };
      default:
        throw new Error(`unexpected table ${table}`);
    }
  };
}

describe("MonthCloseService.closeMonth (F-1013, snapshot close)", () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date("2026-08-02T09:00:00Z"),
      doNotFake: ["nextTick", "setImmediate"],
    });
  });
  afterEach(() => jest.useRealTimers());

  it("keeps the month's figures as a new version, with the till's file and who closed it", async () => {
    const { svc, calls, goals } = service(houseHandler());
    const dto = await svc.closeMonth(HOUSE, ACTOR, "2026-07");

    expect(goals.getPosRevenueWindow).toHaveBeenCalledWith(
      HOUSE,
      30,
      "2026-07",
    );
    const insert = calls.find(
      (c) => c.table === "month_closes" && has(c.ops, "insert"),
    )!;
    const row = arg(insert.ops, "insert")![0] as Record<string, any>;
    // Closed twice before: this is the third version, never an edit.
    expect(row.version).toBe(3);
    expect(row.month).toBe("2026-07");
    expect(row.zone).toBe(ZONE);
    expect(row.closed_by).toBe(ACTOR);
    expect(typeof row.till_csv).toBe("string");
    expect(row.till_csv.length).toBeGreaterThan(0);
    // Nothing on the table is ever updated or deleted by the gateway.
    expect(
      calls.some(
        (c) =>
          c.table === "month_closes" &&
          (has(c.ops, "update") || has(c.ops, "delete")),
      ),
    ).toBe(false);

    const f = row.figures as MonthFigures;
    expect(f.currency).toBe("TRY");
    expect(f.till).toEqual({
      posConnected: true,
      revenue: 1000,
      checkCount: 10,
      days: [{ date: "2026-07-03", revenue: 1000 }],
    });
    // An order with no currency is the house's money; one per currency, never added together.
    expect(f.purchases).toEqual({
      orders: 3,
      unpriced: 1,
      totals: [
        { currency: "EUR", total: 50 },
        { currency: "TRY", total: 300 },
      ],
    });
    expect(f.variance).toEqual({
      counts: 2,
      netBottles: -1,
      shortBottles: 2,
      overBottles: 1,
    });
    // A value the engine could not compute stays null, never 0.
    expect(f.valuation.inventoryValue).toBeNull();
    expect(f.valuation.pricedInventoryValue).toBe(4200);
    expect(f.valuation.unpricedWines).toBe(3);

    const audit = calls.find((c) => c.table === "system_audit_log")!;
    expect(arg(audit.ops, "insert")![0]).toMatchObject({
      action: "month_closed",
      restaurant_id: HOUSE,
    });
    expect(dto.closedBy).toEqual({ id: ACTOR, name: "Ayla" });
    expect(dto.hasTillFile).toBe(true);
  });

  it("refuses a month that has not ended on the house's clock", async () => {
    const { svc, calls } = service(houseHandler());
    await expect(svc.closeMonth(HOUSE, ACTOR, "2026-08")).rejects.toThrow(
      /not over yet/,
    );
    await expect(
      svc.closeMonth(HOUSE, ACTOR, "2026-09"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(calls.some((c) => c.table === "month_closes")).toBe(false);
  });

  it("refuses something that is not a month", async () => {
    const { svc } = service(houseHandler());
    await expect(svc.closeMonth(HOUSE, ACTOR, "2026-13")).rejects.toThrow(
      /like 2026-07/,
    );
    await expect(
      svc.closeMonth(HOUSE, ACTOR, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses a house with no time zone, and says where to set it", async () => {
    const { svc } = service(
      houseHandler({
        restaurants: () => ({
          data: { timezone: null, country: null },
          error: null,
        }),
      }),
    );
    await expect(svc.closeMonth(HOUSE, ACTOR, "2026-07")).rejects.toThrow(
      /Time zone/,
    );
  });

  it("tells the second of two closes pressed at once to read again", async () => {
    const { svc } = service(
      houseHandler({
        month_closes: (ops) =>
          has(ops, "insert")
            ? { data: null, error: { code: "23505", message: "duplicate key" } }
            : { data: [], error: null },
      }),
    );
    await expect(
      svc.closeMonth(HOUSE, ACTOR, "2026-07"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("refuses rather than keep a short record when a read fails", async () => {
    const { svc, calls } = service(
      houseHandler({
        stock_counts: () => ({
          data: null,
          error: { code: "57014", message: "timeout" },
        }),
      }),
    );
    await expect(svc.closeMonth(HOUSE, ACTOR, "2026-07")).rejects.toThrow(
      /could not be read whole/,
    );
    expect(
      calls.some((c) => c.table === "month_closes" && has(c.ops, "insert")),
    ).toBe(false);
  });
});

describe("MonthCloseService.getClose — changed after close", () => {
  const kept: MonthFigures = {
    currency: "TRY",
    till: { posConnected: true, revenue: 1000, checkCount: 10, days: [] },
    valuation: {
      inventoryValue: null,
      pricedInventoryValue: 4200,
      unpricedWines: 3,
      valuedAt: "2026-08-02T09:00:00Z",
    },
    purchases: {
      orders: 1,
      unpriced: 0,
      totals: [{ currency: "TRY", total: 300 }],
    },
    variance: { counts: 1, netBottles: -2, shortBottles: 2, overBottles: 0 },
  };
  const closeRow = {
    id: "close-1",
    restaurant_id: HOUSE,
    month: "2026-07",
    version: 1,
    closed_by: ACTOR,
    closed_at: "2026-08-02T09:00:00+00:00",
    zone: ZONE,
    figures: kept,
    till_csv: "Day,Taken",
  };

  it("lists a check voided after the close, a late stock movement and a changed order, against the record", async () => {
    const STAFF = "33333333-3333-4333-8333-333333333333";
    const { svc, calls } = service(
      houseHandler({
        month_closes: () => ({ data: closeRow, error: null }),
        pos_checks: () => ({
          data: [
            {
              // Arrived in July; voided at the till after the close. The row was
              // updated, so imported_at still says July.
              id: "k1",
              external_check_id: "T-17",
              total: 120,
              voided: true,
              opened_at: "2026-07-20T18:00:00Z",
              closed_at: "2026-07-20T20:00:00Z",
              imported_at: "2026-07-20T20:01:00Z",
              source_modified_at: "2026-08-03T10:00:00Z",
            },
            {
              // Opened on 1 Aug house time (UTC+3): outside July, not listed.
              id: "k2",
              external_check_id: "T-18",
              total: 80,
              voided: false,
              opened_at: "2026-07-31T22:30:00Z",
              closed_at: "2026-07-31T23:00:00Z",
              imported_at: "2026-08-03T11:00:00Z",
              source_modified_at: null,
            },
          ],
          error: null,
          count: 2,
        }),
        inventory_transactions: () => ({
          data: [
            {
              id: "t1",
              inventory_id: "w1",
              transaction_type: "waste",
              quantity_change: -1,
              performed_by: STAFF,
              transaction_date: "2026-07-15T12:00:00Z",
              created_at: "2026-08-04T08:00:00Z",
            },
          ],
          error: null,
          count: 1,
        }),
        restaurant_inventory: () => ({
          data: [{ id: "w1", display_name: "Barolo 2019", wine_name: null }],
          error: null,
        }),
        procurement_orders: (ops) =>
          has(ops, "gt")
            ? {
                data: [
                  {
                    id: "o1",
                    order_number: "PO-9",
                    total_cost: 340,
                    currency: null,
                    status: "DELIVERED",
                    delivered_at: "2026-07-04T10:00:00Z",
                    updated_at: "2026-08-05T08:00:00Z",
                    received_by: STAFF,
                    created_by: ACTOR,
                  },
                ],
                error: null,
                count: 1,
              }
            : {
                data: [
                  {
                    id: "o1",
                    total_cost: 340,
                    currency: null,
                    delivered_at: "2026-07-04T10:00:00Z",
                  },
                ],
                error: null,
                count: 1,
              },
        stock_counts: () => ({
          data: [
            { id: "c1", expected_qty: 12, counted_qty: 10, variance_qty: -2 },
          ],
          error: null,
          count: 1,
        }),
        users: () => ({
          data: [
            { user_id: ACTOR, name: "Ayla" },
            { user_id: STAFF, name: "Deniz" },
          ],
          error: null,
        }),
      }),
      { ...till, revenue: 880, checkCount: 10 },
    );

    const detail = await svc.getClose(HOUSE, "close-1");

    // The till read catches a check changed after the close, not only one that first arrived after it.
    const tillRead = calls.find((c) => c.table === "pos_checks")!;
    expect(String(arg(tillRead.ops, "or")![0])).toContain(
      "source_modified_at.gt.",
    );

    expect(
      detail.changes.map((c) => [c.kind, c.who, c.what, c.delta, c.day]),
    ).toEqual([
      [
        "purchase",
        "Deniz",
        "Order PO-9 changed; it now stands at",
        340,
        "2026-07-04",
      ],
      ["stock", "Deniz", "Written off: Barolo 2019", -1, "2026-07-15"],
      ["till", "The till", "Check T-17 voided at the till", -120, "2026-07-20"],
    ]);
    expect(detail.changes.find((c) => c.kind === "till")!.at).toBe(
      "2026-08-03T10:00:00Z",
    );
    expect(detail.changesNotListed).toBe(0);

    const by = Object.fromEntries(
      detail.againstNow.map((a) => [`${a.figure}:${a.currency}`, a]),
    );
    expect(by["till_revenue:TRY"]).toMatchObject({
      atClose: 1000,
      now: 880,
      delta: -120,
    });
    expect(by["purchases:TRY"]).toMatchObject({
      atClose: 300,
      now: 340,
      delta: 40,
    });
    expect(by["variance_net:null"]).toMatchObject({
      atClose: -2,
      now: -2,
      delta: 0,
    });
    // The record itself is returned as kept.
    expect(detail.figures).toEqual(kept);
    expect(detail.closedBy).toEqual({ id: ACTOR, name: "Ayla" });
  });

  it("reads one house's closes only", async () => {
    const { svc, calls } = service(
      houseHandler({ month_closes: () => ({ data: null, error: null }) }),
    );
    await expect(svc.getClose(HOUSE, "close-x")).rejects.toThrow(
      /No such closed month/,
    );
    const read = calls.find((c) => c.table === "month_closes")!;
    expect(read.ops.filter((o) => o.m === "eq").map((o) => o.a)).toEqual([
      ["id", "close-x"],
      ["restaurant_id", HOUSE],
    ]);
  });
});

describe("againstNow", () => {
  const base: MonthFigures = {
    currency: "TRY",
    till: { posConnected: true, revenue: null, checkCount: 4, days: [] },
    valuation: {
      inventoryValue: null,
      pricedInventoryValue: null,
      unpricedWines: null,
      valuedAt: "x",
    },
    purchases: {
      orders: 1,
      unpriced: 0,
      totals: [{ currency: "TRY", total: 10 }],
    },
    variance: { counts: 0, netBottles: 0, shortBottles: 0, overBottles: 0 },
  };

  it("says nothing of a delta when either side is unknown, and keeps each currency apart", () => {
    const now: MonthFigures = {
      ...base,
      till: { ...base.till, revenue: 50, checkCount: 5 },
      purchases: {
        orders: 2,
        unpriced: 0,
        totals: [
          { currency: "TRY", total: 10 },
          { currency: "EUR", total: 7 },
        ],
      },
    };
    const rows = againstNow(base, now);
    expect(rows.find((r) => r.figure === "till_revenue")).toMatchObject({
      atClose: null,
      now: 50,
      delta: null,
    });
    expect(rows.find((r) => r.figure === "till_checks")).toMatchObject({
      delta: 1,
    });
    expect(
      rows
        .filter((r) => r.figure === "purchases")
        .map((r) => [r.currency, r.delta]),
    ).toEqual([
      ["TRY", 0],
      ["EUR", 7],
    ]);
  });
});
