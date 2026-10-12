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
      case "pos_checks":
        // Net 900 on gross 1,000; a voided check; a check with no net figure;
        // one opened on 1 Aug house time (UTC+3), outside July.
        return {
          data: [
            {
              id: "k1",
              external_check_id: "T-1",
              subtotal: 900,
              total: 1000,
              voided: false,
              opened_at: "2026-07-03T18:00:00Z",
              closed_at: "2026-07-03T20:00:00Z",
            },
            {
              id: "k2",
              external_check_id: "T-2",
              subtotal: 50,
              total: 60,
              voided: true,
              opened_at: "2026-07-03T18:00:00Z",
              closed_at: "2026-07-03T20:00:00Z",
            },
            {
              id: "k3",
              external_check_id: "T-3",
              subtotal: null,
              total: 30,
              voided: false,
              opened_at: "2026-07-04T18:00:00Z",
              closed_at: "2026-07-04T20:00:00Z",
            },
            {
              id: "k4",
              external_check_id: "T-4",
              subtotal: 70,
              total: 80,
              voided: false,
              opened_at: "2026-07-31T22:30:00Z",
              closed_at: "2026-07-31T23:00:00Z",
            },
          ],
          error: null,
          count: 4,
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
    // F-1494: net (ADR 0287 AW17), the subtotal, never the gross total; the
    // checks it came from are counted, and each counted check is kept.
    expect(f.till).toEqual({
      posConnected: true,
      netSales: 900,
      netSalesCheckCount: 1,
      checkCount: 2,
      days: [{ date: "2026-07-03", netSales: 900 }],
      kept: { k1: 900, k3: null },
    });
    expect(f.purchases.kept).toEqual({
      o1: { total: 300, currency: "TRY" },
      o2: { total: 50, currency: "EUR" },
      o3: { total: null, currency: "TRY" },
    });
    // The snapshot is the record's; the page gets the figures only.
    expect(dto.figures.till).not.toHaveProperty("kept");
    expect(dto.figures.purchases).not.toHaveProperty("kept");
    // An order with no currency is the house's money; one per currency, never added together.
    expect(f.purchases).toEqual({
      orders: 3,
      unpriced: 1,
      totals: [
        { currency: "EUR", total: 50 },
        { currency: "TRY", total: 300 },
      ],
      kept: expect.any(Object),
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
      // F-1513: the /logs line names the month it closed.
      changes: {
        subject: "July 2026 (version 3)",
        month: "2026-07",
        version: 3,
      },
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

  // F-1514 (sim 49, integ20-new-house-30-days.md): opening stock loaded
  // after the first menu counts each menu-seeded wine from 0. ADR 0335 §2:
  // that is the opening count variance is measured from, not a variance, so
  // the first close must not read the whole cellar as "bottles over".
  it("leaves opening counts out of the month's count variance", async () => {
    const rows = [
      {
        id: "c1",
        expected_qty: 12,
        counted_qty: 10,
        variance_qty: -2,
        source: "mobile_count",
      },
      {
        id: "o1",
        expected_qty: 0,
        counted_qty: 40,
        variance_qty: 40,
        source: "import",
      },
    ];
    const { svc, calls } = service(
      houseHandler({
        stock_counts: (ops) => {
          const left = ops
            .filter((o) => o.m === "neq")
            .reduce(
              (acc, o) =>
                acc.filter((r: any) => r[o.a[0] as string] !== o.a[1]),
              rows,
            );
          return { data: left, error: null, count: left.length };
        },
      }),
    );
    await svc.closeMonth(HOUSE, ACTOR, "2026-07");
    const insert = calls.find(
      (c) => c.table === "month_closes" && has(c.ops, "insert"),
    )!;
    const f = (arg(insert.ops, "insert")![0] as any).figures as MonthFigures;
    expect(f.variance).toEqual({
      counts: 1,
      netBottles: -2,
      shortBottles: 2,
      overBottles: 0,
    });
  });

  // F-1517: a house opened on 1 August (house time) cannot close July, which
  // would keep today's cellar as July's. Midnight is the house's, not UTC's.
  it("refuses a month that ended before the house opened, on the house's clock", async () => {
    const opened = (created_at: string) =>
      houseHandler({
        restaurants: () => ({
          data: {
            name: "SYNTHETIC House",
            currency: "try",
            timezone: ZONE,
            country: "TR",
            created_at,
          },
          error: null,
        }),
      });
    const late = service(opened("2026-07-31T22:00:00Z"));
    await expect(late.svc.closeMonth(HOUSE, ACTOR, "2026-07")).rejects.toThrow(
      "This house opened in August 2026, so there is nothing of July 2026 to close. Its first month to close is August 2026.",
    );
    expect(late.calls.some((c) => c.table === "month_closes")).toBe(false);
    // Control: opened during July, July closes.
    const early = service(opened("2026-07-15T09:00:00Z"));
    await expect(
      early.svc.closeMonth(HOUSE, ACTOR, "2026-07"),
    ).resolves.toMatchObject({ month: "2026-07" });
  });

  it("names the house's first month beside its closes", async () => {
    const { svc } = service(
      houseHandler({
        restaurants: () => ({
          data: {
            timezone: ZONE,
            country: "TR",
            created_at: "2026-07-31T22:00:00Z",
          },
          error: null,
        }),
        month_closes: () => ({ data: [], error: null }),
      }),
    );
    await expect(svc.listCloses(HOUSE)).resolves.toEqual({
      closes: [],
      openedMonth: "2026-08",
    });
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
  const STAFF = "33333333-3333-4333-8333-333333333333";
  const ACCOUNTANT = "44444444-4444-4444-8444-444444444444";
  const GONE = "55555555-5555-4555-8555-555555555555";
  const kept: MonthFigures = {
    currency: "TRY",
    till: {
      posConnected: true,
      netSales: 1000,
      netSalesCheckCount: 2,
      checkCount: 2,
      days: [],
      kept: { k1: 120, k5: 880 },
    },
    valuation: {
      inventoryValue: null,
      pricedInventoryValue: 4200,
      unpricedWines: 3,
      valuedAt: "2026-08-02T09:00:00Z",
    },
    purchases: {
      orders: 2,
      unpriced: 0,
      totals: [{ currency: "TRY", total: 500 }],
      kept: {
        o1: { total: 300, currency: "TRY" },
        o2: { total: 200, currency: "TRY" },
      },
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
  const july = {
    opened_at: "2026-07-20T18:00:00Z",
    closed_at: "2026-07-20T20:00:00Z",
  };

  function detailHandler(
    over: Partial<Record<string, (ops: Op[]) => Answer>> = {},
  ) {
    return houseHandler({
      month_closes: () => ({ data: closeRow, error: null }),
      pos_checks: () => ({
        data: [
          {
            // F-1467: voided by a file import after the close. The re-send
            // kept July's imported_at and carried no till time, so no
            // timestamp says it changed.
            id: "k1",
            external_check_id: "T-17",
            subtotal: 120,
            total: 130,
            voided: true,
            ...july,
            imported_at: "2026-07-20T20:01:00Z",
            source_modified_at: null,
          },
          {
            id: "k5",
            external_check_id: "T-20",
            subtotal: 880,
            total: 950,
            voided: false,
            ...july,
            imported_at: "2026-07-20T20:01:00Z",
            source_modified_at: null,
          },
          {
            // Arrived after the close.
            id: "k6",
            external_check_id: "T-21",
            subtotal: 40,
            total: 45,
            voided: false,
            ...july,
            imported_at: "2026-08-03T11:00:00Z",
            source_modified_at: null,
          },
          {
            // Opened on 1 Aug house time (UTC+3): outside July, not listed.
            id: "k2",
            external_check_id: "T-18",
            subtotal: 80,
            total: 90,
            voided: false,
            opened_at: "2026-07-31T22:30:00Z",
            closed_at: "2026-07-31T23:00:00Z",
            imported_at: "2026-08-03T11:00:00Z",
            source_modified_at: null,
          },
        ],
        error: null,
        count: 4,
      }),
      inventory_transactions: () => ({
        data: [
          {
            id: "t1",
            inventory_id: "w1",
            transaction_type: "waste",
            source: "manual",
            quantity_change: -1,
            performed_by: STAFF,
            transaction_date: "2026-07-15T12:00:00Z",
            created_at: "2026-08-04T08:00:00Z",
          },
          {
            // F-1468: the till writes its sales with no person on them.
            id: "t2",
            inventory_id: "w1",
            transaction_type: "sale",
            source: "pos",
            quantity_change: -1,
            performed_by: null,
            transaction_date: "2026-07-28T12:00:00Z",
            created_at: "2026-08-04T07:00:00Z",
          },
          {
            id: "t3",
            inventory_id: "w1",
            transaction_type: "adjustment",
            source: "manual",
            quantity_change: 1,
            performed_by: null,
            transaction_date: "2026-07-27T12:00:00Z",
            created_at: "2026-08-04T06:00:00Z",
          },
          {
            id: "t4",
            inventory_id: "w1",
            transaction_type: "waste",
            source: "manual",
            quantity_change: -1,
            performed_by: GONE,
            transaction_date: "2026-07-26T12:00:00Z",
            created_at: "2026-08-04T05:00:00Z",
          },
        ],
        error: null,
        count: 4,
      }),
      restaurant_inventory: () => ({
        data: [{ id: "w1", display_name: "Barolo 2019", wine_name: null }],
        error: null,
      }),
      procurement_orders: (ops) =>
        arg(ops, "in")?.[0] === "id"
          ? {
              data: [
                {
                  // The late invoice moved the total; verified by the accountant.
                  id: "o1",
                  order_number: "PO-9",
                  delivered_at: "2026-07-04T10:00:00Z",
                  updated_at: "2026-08-05T08:00:00Z",
                  received_by: STAFF,
                  match_verified_by: ACCOUNTANT,
                  match_verified_at: "2026-08-05T08:00:00Z",
                },
              ],
              error: null,
            }
          : {
              data: [
                {
                  id: "o1",
                  total_cost: 340,
                  currency: null,
                  delivered_at: "2026-07-04T10:00:00Z",
                },
                {
                  // F-1466: edited after the close (a verified price that
                  // left the total where it was): not a change to the month.
                  id: "o2",
                  total_cost: 200,
                  currency: null,
                  delivered_at: "2026-07-05T10:00:00Z",
                },
              ],
              error: null,
              count: 2,
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
          { user_id: ACCOUNTANT, name: "Selin" },
        ],
        error: null,
      }),
      ...over,
    });
  }

  it("lists each change that moved a figure, by whom, and the list adds up to the figure", async () => {
    const { svc, calls } = service(detailHandler());
    const detail = await svc.getClose(HOUSE, "close-1");

    const rows = detail.changes.map((c) => [
      c.kind,
      c.who,
      c.what,
      c.delta,
      c.day,
    ]);
    // F-1466: the order is listed by what moved (+40), by who verified the
    // invoice; the order whose total did not move is not listed at all.
    expect(rows).toContainEqual([
      "purchase",
      "Selin",
      "Order PO-9 cost changed",
      40,
      "2026-07-04",
    ]);
    expect(rows.filter((r) => r[0] === "purchase")).toHaveLength(1);
    // F-1467: the void with no timestamp after the close is listed.
    expect(rows).toContainEqual([
      "till",
      "The till",
      "Check T-17 voided at the till",
      -120,
      "2026-07-20",
    ]);
    expect(rows).toContainEqual([
      "till",
      "The till",
      "Check T-21 arrived from the till",
      40,
      "2026-07-20",
    ]);
    expect(rows.filter((r) => r[0] === "till")).toHaveLength(2);
    // F-1468: the till, not a departed person; a null actor elsewhere is not recorded.
    expect(rows).toContainEqual([
      "stock",
      "Deniz",
      "Written off: Barolo 2019",
      -1,
      "2026-07-15",
    ]);
    expect(rows).toContainEqual([
      "stock",
      "The till",
      "Sale: Barolo 2019",
      -1,
      "2026-07-28",
    ]);
    expect(rows).toContainEqual([
      "stock",
      "not recorded",
      "Stock adjusted: Barolo 2019",
      1,
      "2026-07-27",
    ]);
    expect(rows).toContainEqual([
      "stock",
      "someone no longer on the team",
      "Written off: Barolo 2019",
      -1,
      "2026-07-26",
    ]);
    expect(detail.changesNotListed).toBe(0);

    const by = Object.fromEntries(
      detail.againstNow.map((a) => [`${a.figure}:${a.currency}`, a]),
    );
    // F-1494: the till figure is net, and labelled so.
    expect(by["till_net_sales:TRY"]).toMatchObject({
      label: "Net sales through the till",
      atClose: 1000,
      now: 920,
      delta: -80,
    });
    expect(by["purchases:TRY"]).toMatchObject({
      atClose: 500,
      now: 540,
      delta: 40,
    });
    // The listed changes add up to each figure's move.
    const sum = (kind: string) =>
      detail.changes
        .filter((c) => c.kind === kind)
        .reduce((n, c) => n + (c.delta ?? 0), 0);
    expect(sum("till")).toBe(by["till_net_sales:TRY"].delta);
    expect(sum("purchase")).toBe(by["purchases:TRY"].delta);

    // The record is returned as kept, without its snapshot.
    expect(detail.figures.till).not.toHaveProperty("kept");
    expect(detail.figures.till.netSales).toBe(1000);
    expect(detail.closedBy).toEqual({ id: ACTOR, name: "Ayla" });
    // The till is read whole, the voided checks too.
    const tillRead = calls.find((c) => c.table === "pos_checks")!;
    expect(
      has(tillRead.ops, "eq") &&
        !tillRead.ops.some((o) => o.m === "eq" && o.a[0] === "voided"),
    ).toBe(true);
  });

  it("names nobody for a price change verified before the close, and lists an order that left the month", async () => {
    const { svc } = service(
      detailHandler({
        procurement_orders: (ops) =>
          arg(ops, "in")?.[0] === "id"
            ? {
                data: [
                  {
                    id: "o1",
                    order_number: "PO-9",
                    delivered_at: "2026-07-04T10:00:00Z",
                    updated_at: "2026-08-05T08:00:00Z",
                    received_by: STAFF,
                    match_verified_by: ACCOUNTANT,
                    match_verified_at: "2026-07-30T08:00:00Z",
                  },
                  {
                    id: "o2",
                    order_number: "PO-10",
                    delivered_at: "2026-07-05T10:00:00Z",
                    updated_at: "2026-08-05T09:00:00Z",
                    received_by: STAFF,
                  },
                ],
                error: null,
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
      }),
    );
    const detail = await svc.getClose(HOUSE, "close-1");
    const rows = detail.changes
      .filter((c) => c.kind === "purchase")
      .map((c) => [c.who, c.what, c.delta]);
    expect(rows).toEqual(
      expect.arrayContaining([
        ["not recorded", "Order PO-9 cost changed", 40],
        [
          "not recorded",
          "Order PO-10 is no longer counted as delivered in this month",
          -200,
        ],
      ]),
    );
    expect(rows).toHaveLength(2);
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
    till: {
      posConnected: true,
      netSales: null,
      netSalesCheckCount: 0,
      checkCount: 4,
      days: [],
    },
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
      till: { ...base.till, netSales: 50, checkCount: 5 },
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
    expect(rows.find((r) => r.figure === "till_net_sales")).toMatchObject({
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
