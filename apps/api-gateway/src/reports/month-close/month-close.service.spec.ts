import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  MonthCloseService,
  againstNow,
  writeOffFigures,
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
      costCoverage: { unpriced: 3, partial: 1, uncostedBottles: 24 },
      notInvoicedWines: 2,
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
              tip: 90,
              server_name: "Deniz",
              server_external_id: "emp-3",
              voided: false,
              opened_at: "2026-07-03T18:00:00Z",
              closed_at: "2026-07-03T20:00:00Z",
            },
            {
              id: "k2",
              external_check_id: "T-2",
              subtotal: 50,
              total: 60,
              tip: 10,
              server_name: "Deniz",
              voided: true,
              opened_at: "2026-07-03T18:00:00Z",
              closed_at: "2026-07-03T20:00:00Z",
            },
            {
              id: "k3",
              external_check_id: "T-3",
              subtotal: null,
              total: 30,
              tip: 15.5,
              server_name: null,
              server_external_id: "emp-7",
              voided: false,
              opened_at: "2026-07-04T18:00:00Z",
              closed_at: "2026-07-04T20:00:00Z",
            },
            {
              id: "k4",
              external_check_id: "T-4",
              subtotal: 70,
              total: 80,
              tip: 20,
              server_name: "Deniz",
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
      case "inventory_transactions":
        // F-1609: July's take-offs. A lot's cost is the bottle's; a sample's
        // or a missing one leaves it uncosted; a return to the vendor and a
        // correction are not write-offs.
        return {
          data: [
            {
              id: "x1",
              transaction_type: "waste",
              reason: "Removed from inventory — Breakage",
              quantity_change: -2,
              metadata: {
                lots_taken: [
                  { qty: 1, unit_cost: 40, cost_provenance: "invoice" },
                  { qty: 1, unit_cost: 44, cost_provenance: "invoice" },
                ],
              },
            },
            {
              id: "x2",
              transaction_type: "comp",
              reason: "Comp / gift",
              quantity_change: -1,
              metadata: {
                lots_taken: [
                  { qty: 1, unit_cost: 30, cost_provenance: "invoice" },
                ],
              },
            },
            {
              id: "x3",
              transaction_type: "adjustment",
              reason: "Staff pour",
              quantity_change: -1,
              metadata: {
                lots_taken: [
                  { qty: 1, unit_cost: null, cost_provenance: null },
                ],
              },
            },
            {
              id: "x4",
              transaction_type: "adjustment",
              reason: "Removed from inventory — Return to vendor",
              quantity_change: -3,
              metadata: {},
            },
            {
              id: "x5",
              transaction_type: "waste",
              reason: "Spoiled",
              quantity_change: -1,
              unit_cost: 25,
              metadata: {},
            },
            {
              id: "x6",
              transaction_type: "adjustment",
              reason: "Breakage",
              quantity_change: -1,
              metadata: {
                lots_taken: [
                  { qty: 1, unit_cost: 12.5, cost_provenance: "sample" },
                ],
              },
            },
          ],
          error: null,
          count: 6,
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
      // F-1624: no answer kept; the house row's answer stands alone.
      case "house_tax_basis_answers":
        return { data: [], error: null };
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

  it("[REVERT-FAILS] says a delivery still open beside Bought (delivered), not in it (F-1632)", async () => {
    const { svc, calls } = service(
      houseHandler({
        procurement_orders: () => ({
          data: [
            {
              id: "o1",
              status: "COMPLETED",
              total_cost: 300,
              currency: null,
              delivered_at: "2026-07-04T10:00:00Z",
            },
            {
              // 10 of 12 accepted, 2 backordered: delivered, still open.
              id: "o2",
              status: "PARTIALLY_RECEIVED",
              total_cost: 28800,
              currency: "TRY",
              delivered_at: "2026-07-05T10:00:00Z",
            },
          ],
          error: null,
          count: 2,
        }),
      }),
    );
    const dto = await svc.closeMonth(HOUSE, ACTOR, "2026-07");
    const p = dto.figures.purchases;
    expect(p.orders).toBe(1);
    expect(p.totals).toEqual([{ currency: "TRY", total: 300 }]);
    expect(p.awaiting).toEqual({
      orders: 1,
      totals: [{ currency: "TRY", total: 28800 }],
    });
    const read = calls.find((c) => c.table === "procurement_orders")!.ops;
    expect(read).toContainEqual({
      m: "in",
      a: ["status", ["DELIVERED", "PARTIALLY_RECEIVED", "COMPLETED"]],
    });
  });

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
      // F-1606: no check here was made pre-tax, so no tax figure.
      taxInside: null,
      taxInsideCheckCount: 0,
      // F-1691: the month's tips, voided and out-of-month checks left out.
      tips: 105.5,
      tipsCheckCount: 2,
      tipsByServer: [
        { server: "Deniz", tips: 90, checks: 1 },
        { server: "emp-7", tips: 15.5, checks: 1 },
      ],
      kept: { k1: 900, k3: null },
      // w111-tips-owed: each counted check's tip, so a later change is listed.
      keptTips: { k1: 90, k3: 15.5 },
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
      awaiting: { orders: 0, totals: [] },
      kept: expect.any(Object),
    });
    expect(f.variance).toEqual({
      counts: 2,
      netBottles: -1,
      shortBottles: 2,
      overBottles: 1,
      // F-1544 lane 5: no count here named its open bottles.
      openMl: { counts: 0, netMl: 0, shortMl: 0, overMl: 0 },
    });
    // F-1609: the month's write-offs, a figure with its cost and count, by
    // reason, read from the typed take-offs dated on the month's house days.
    expect(f.writeOffs).toEqual({
      movements: 5,
      bottles: 6,
      cost: 139,
      uncostedBottles: 2,
      // F-1653: x5's cost has no lot behind it, so it is not an invoice's.
      otherMoneyBottles: 0,
      notInvoicedBottles: 1,
      byReason: [
        {
          reason: "breakage",
          label: "Breakage",
          movements: 2,
          bottles: 3,
          cost: 84,
          uncostedBottles: 1,
          otherMoneyBottles: 0,
          notInvoicedBottles: 0,
        },
        {
          reason: "comp",
          label: "Comps",
          movements: 1,
          bottles: 1,
          cost: 30,
          uncostedBottles: 0,
          otherMoneyBottles: 0,
          notInvoicedBottles: 0,
        },
        {
          reason: "staff_pour",
          label: "Staff pours",
          movements: 1,
          bottles: 1,
          cost: null,
          uncostedBottles: 1,
          otherMoneyBottles: 0,
          notInvoicedBottles: 0,
        },
        {
          reason: "other",
          label: "Other write-offs",
          movements: 1,
          bottles: 1,
          cost: 25,
          uncostedBottles: 0,
          otherMoneyBottles: 0,
          notInvoicedBottles: 1,
        },
      ],
    });
    expect(dto.figures.writeOffs?.cost).toBe(139);
    const offs = calls.find((c) => c.table === "inventory_transactions")!;
    expect(arg(offs.ops, "in")).toEqual([
      "transaction_type",
      ["waste", "comp", "adjustment"],
    ]);
    expect(arg(offs.ops, "lt")).toEqual(["quantity_change", 0]);
    expect(offs.ops.find((o) => o.m === "gte")?.a[0]).toBe("transaction_date");
    // A value the engine could not compute stays null, never 0.
    expect(f.valuation.inventoryValue).toBeNull();
    expect(f.valuation.pricedInventoryValue).toBe(4200);
    expect(f.valuation.unpricedWines).toBe(3);
    // F-1652 / F-1654: what the priced total leaves out is kept with it.
    expect(f.valuation.partlyCostedWines).toBe(1);
    expect(f.valuation.uncostedBottles).toBe(24);
    expect(f.valuation.notInvoicedWines).toBe(2);

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

  it("keeps the house's tax basis, its switch day and the tax inside the till's prices (F-1606)", async () => {
    const checks = [
      // Before the switch: as the till sent it, no stamp.
      {
        id: "k1",
        external_check_id: "T-1",
        subtotal: 1200,
        gross_subtotal: null,
        tax_basis: null,
        voided: false,
        opened_at: "2026-07-03T18:00:00Z",
        closed_at: "2026-07-03T20:00:00Z",
      },
      // After it: 600 with 20% KDV inside, net 500.
      {
        id: "k5",
        external_check_id: "T-5",
        subtotal: 500,
        gross_subtotal: 600,
        tax_basis: "prices_include_tax",
        voided: false,
        opened_at: "2026-07-20T18:00:00Z",
        closed_at: "2026-07-20T20:00:00Z",
      },
      // A till that had already taken the tax off: the same figure twice.
      {
        id: "k6",
        external_check_id: "T-6",
        subtotal: 100,
        gross_subtotal: 100,
        tax_basis: "prices_include_tax",
        voided: false,
        opened_at: "2026-07-21T18:00:00Z",
        closed_at: "2026-07-21T20:00:00Z",
      },
    ];
    const { svc, calls } = service(
      houseHandler({
        restaurants: () => ({
          data: {
            name: "SYNTHETIC House",
            currency: "try",
            timezone: ZONE,
            country: "TR",
            tax_basis: "prices_include_tax",
            // 01:30 on 15 July in Istanbul is still 14 July in UTC.
            tax_basis_confirmed_at: "2026-07-14T22:30:00Z",
          },
          error: null,
        }),
        pos_checks: () => ({ data: checks, error: null, count: 3 }),
      }),
    );
    const dto = await svc.closeMonth(HOUSE, ACTOR, "2026-07");
    const insert = calls.find(
      (c) => c.table === "month_closes" && has(c.ops, "insert"),
    )!;
    const row = arg(insert.ops, "insert")![0] as Record<string, any>;
    expect(row.tax_basis).toBe("prices_include_tax");
    const f = row.figures as MonthFigures;
    expect(f.taxBasisSince).toBe("2026-07-15");
    expect(f.taxWord).toBe("KDV");
    expect(f.till.netSales).toBe(1800);
    expect(f.till.taxInside).toBe(100);
    expect(f.till.taxInsideCheckCount).toBe(1);
    expect(dto.taxBasis).toBe("prices_include_tax");
    expect(row.till_csv).toContain("KDV inside till prices");
    expect(row.till_csv).toContain("from 1 of 3 checks");
  });

  it("[REVERT-FAILS] keeps the month's tips as money, in total and by server, in the record and its till file (F-1691)", async () => {
    const { svc, calls } = service(houseHandler());
    const dto = await svc.closeMonth(HOUSE, ACTOR, "2026-07");
    const insert = calls.find(
      (c) => c.table === "month_closes" && has(c.ops, "insert"),
    )!;
    const row = arg(insert.ops, "insert")![0] as Record<string, any>;
    const read = calls.find((c) => c.table === "pos_checks")!.ops;
    expect(String(arg(read, "select")![0])).toContain(
      "tip, server_name, server_external_id",
    );
    // The page gets them too: owners and managers only, as every close route.
    expect(dto.figures.till.tips).toBe(105.5);
    expect(dto.figures.till.tipsCheckCount).toBe(2);
    const csv = row.till_csv as string;
    expect(csv).toContain("Tips by server");
    // A TR house's file: ";" between cells, "," before the decimals.
    expect(csv).toContain("Tips;105,5;TRY");
    expect(csv).toContain("Deniz;1;90");
    expect(csv).toContain("emp-7;1;15,5");
    expect(csv).toContain("voided checks left out");
  });

  it("says a month's tips are not recorded, never 0, when no check carried one (F-1691)", async () => {
    const { svc, calls } = service(
      houseHandler({
        pos_checks: () => ({
          data: [
            {
              id: "k1",
              external_check_id: "T-1",
              subtotal: 900,
              total: 1000,
              tip: null,
              voided: false,
              opened_at: "2026-07-03T18:00:00Z",
              closed_at: "2026-07-03T20:00:00Z",
            },
          ],
          error: null,
          count: 1,
        }),
      }),
    );
    await svc.closeMonth(HOUSE, ACTOR, "2026-07");
    const insert = calls.find(
      (c) => c.table === "month_closes" && has(c.ops, "insert"),
    )!;
    const row = arg(insert.ops, "insert")![0] as Record<string, any>;
    expect(row.figures.till.tips).toBeNull();
    expect(row.figures.till.tipsCheckCount).toBe(0);
    expect(row.figures.till.tipsByServer).toEqual([]);
    expect(row.till_csv).not.toContain("Tips by server");
  });

  it("keeps no basis when the house row names none, and no tax figure", async () => {
    const { svc, calls } = service(houseHandler());
    await svc.closeMonth(HOUSE, ACTOR, "2026-07");
    const insert = calls.find(
      (c) => c.table === "month_closes" && has(c.ops, "insert"),
    )!;
    const row = arg(insert.ops, "insert")![0] as Record<string, any>;
    // The fixture's house row names no basis: kept as not read, never guessed.
    expect(row.tax_basis).toBeNull();
    expect(row.figures.taxBasisSince).toBeNull();
    expect(row.figures.till.taxInside).toBeNull();
    // F-1625: a US or unset house's till file carries no tax line at all.
    expect(typeof row.till_csv).toBe("string");
    expect(row.till_csv).not.toContain("inside till prices");
  });

  // F-1624 remainder / F-1588: include on 3 July, "added on top" on 10 July,
  // include again on 20 July. The close kept 20 July as the only switch, so
  // the accountant read 3-19 July as the till's figures with KDV inside.
  it("names each stretch when the house changed its tax answer inside the month", async () => {
    const answer = (basis: string, at: string) => ({
      basis,
      answered_at: at,
      answered_by: ACTOR,
    });
    const { svc, calls } = service(
      houseHandler({
        restaurants: () => ({
          data: {
            name: "SYNTHETIC House",
            currency: "try",
            timezone: ZONE,
            country: "TR",
            tax_basis: "prices_include_tax",
            tax_basis_confirmed_at: "2026-07-20T09:00:00Z",
          },
          error: null,
        }),
        house_tax_basis_answers: () => ({
          data: [
            answer("prices_include_tax", "2026-07-03T09:00:00Z"),
            answer("prices_exclude_tax", "2026-07-10T09:00:00Z"),
            answer("prices_include_tax", "2026-07-20T09:00:00Z"),
          ],
          error: null,
        }),
      }),
    );
    await svc.closeMonth(HOUSE, ACTOR, "2026-07");
    const insert = calls.find(
      (c) => c.table === "month_closes" && has(c.ops, "insert"),
    )!;
    const f = (arg(insert.ops, "insert")![0] as Record<string, any>)
      .figures as MonthFigures;
    // The day the answer in force took effect, which the basis line pairs it with.
    expect(f.taxBasisSince).toBe("2026-07-20");
    expect(f.taxChangeNote).toContain(
      "From 10 July 2026, KDV is added on top of till prices, so net is as the till sent it.",
    );
    expect(f.taxChangeNote).toContain(
      "From 20 July 2026, till prices include KDV, and net is without it.",
    );
    expect(f.taxChangeNote).toContain(
      "Until 2 July 2026, nobody had said whether till prices include KDV",
    );
  });

  // F-1624 audit: "added on top" on 1 July, corrected to include on 20 July.
  // The first answer's day (1 July) was kept as the include day, so the basis
  // line read all of July as net without KDV; 1-19 July were as sent.
  const closeJuly = async (
    answers: Array<[string, string]>,
    now: [string, string],
  ) => {
    const { svc, calls } = service(
      houseHandler({
        restaurants: () => ({
          data: {
            name: "SYNTHETIC House",
            currency: "try",
            timezone: ZONE,
            country: "TR",
            tax_basis: now[0],
            tax_basis_confirmed_at: now[1],
          },
          error: null,
        }),
        house_tax_basis_answers: () => ({
          data: answers.map(([basis, at]) => ({
            basis,
            answered_at: at,
            answered_by: ACTOR,
          })),
          error: null,
        }),
      }),
    );
    await svc.closeMonth(HOUSE, ACTOR, "2026-07");
    const insert = calls.find(
      (c) => c.table === "month_closes" && has(c.ops, "insert"),
    )!;
    return (arg(insert.ops, "insert")![0] as Record<string, any>)
      .figures as MonthFigures;
  };

  it("keeps the include day, not an earlier 'added on top' answer's, as the switch day", async () => {
    const f = await closeJuly(
      [
        ["prices_exclude_tax", "2026-07-01T09:00:00Z"],
        ["prices_include_tax", "2026-07-20T09:00:00Z"],
      ],
      ["prices_include_tax", "2026-07-20T09:00:00Z"],
    );
    expect(f.taxBasisSince).toBe("2026-07-20");
    expect(f.taxChangeNote).toContain(
      "Until 19 July 2026, KDV is added on top of till prices, so net is as the till sent it.",
    );
  });

  it("says a month that was wholly on an answer the house replaced after it", async () => {
    const f = await closeJuly(
      [
        ["prices_include_tax", "2026-05-02T09:00:00Z"],
        ["prices_exclude_tax", "2026-06-10T09:00:00Z"],
        ["prices_include_tax", "2026-08-05T09:00:00Z"],
      ],
      ["prices_include_tax", "2026-08-05T09:00:00Z"],
    );
    expect(f.taxBasisSince).toBe("2026-08-05");
    expect(f.taxChangeNote).toBe(
      "All of this month, KDV is added on top of till prices, so net is as the till sent it. The house changed its answer about KDV after the month; checks already recorded keep the answer they were recorded under.",
    );
  });

  it("refuses the close when the house's earlier tax answers cannot be read", async () => {
    const { svc, calls } = service(
      houseHandler({
        house_tax_basis_answers: () => ({
          data: null,
          error: { message: "permission denied" },
        }),
      }),
    );
    await expect(svc.closeMonth(HOUSE, ACTOR, "2026-07")).rejects.toThrow(
      /earlier tax answers could not be read/,
    );
    expect(
      calls.some((c) => c.table === "month_closes" && has(c.ops, "insert")),
    ).toBe(false);
  });

  it("says an inclusive house's month with no tax taken out as such (F-1625)", async () => {
    const { svc, calls } = service(
      houseHandler({
        restaurants: () => ({
          data: {
            name: "SYNTHETIC House",
            currency: "try",
            timezone: ZONE,
            country: "TR",
            tax_basis: "prices_include_tax",
            tax_basis_confirmed_at: "2026-07-14T22:30:00Z",
          },
          error: null,
        }),
      }),
    );
    await svc.closeMonth(HOUSE, ACTOR, "2026-07");
    const insert = calls.find(
      (c) => c.table === "month_closes" && has(c.ops, "insert"),
    )!;
    const row = arg(insert.ops, "insert")![0] as Record<string, any>;
    expect(row.figures.till.taxInside).toBeNull();
    expect(row.till_csv).toContain(
      "No check this month had KDV taken out of its price",
    );
    expect(row.till_csv).not.toContain("recorded only after");
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
      // F-1544 lane 5: no count here named its open bottles.
      openMl: { counts: 0, netMl: 0, shortMl: 0, overMl: 0 },
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

  it("sets the kept write-offs against now, and a close kept before them as unknown (F-1609)", async () => {
    const takeOffs = (ops: Op[]) =>
      has(ops, "gt")
        ? { data: [], error: null, count: 0 }
        : {
            data: [
              {
                id: "x1",
                transaction_type: "waste",
                reason: "Breakage",
                quantity_change: -3,
                metadata: {
                  lots_taken: [
                    { qty: 3, unit_cost: 20, cost_provenance: "invoice" },
                  ],
                },
              },
            ],
            error: null,
            count: 1,
          };
    const withOffs = {
      ...closeRow,
      figures: {
        ...kept,
        writeOffs: writeOffFigures([
          {
            transaction_type: "waste",
            reason: "Breakage",
            quantity_change: -2,
            metadata: {
              lots_taken: [
                { qty: 2, unit_cost: 20, cost_provenance: "invoice" },
              ],
            },
          },
        ]),
      },
    };
    const { svc } = service(
      detailHandler({
        month_closes: () => ({ data: withOffs, error: null }),
        inventory_transactions: takeOffs,
      }),
    );
    const detail = await svc.getClose(HOUSE, "close-1");
    const by = Object.fromEntries(detail.againstNow.map((a) => [a.figure, a]));
    expect(by.writeoffs_bottles).toMatchObject({
      label: "Written off, bottles",
      atClose: 2,
      now: 3,
      delta: 1,
    });
    expect(by.writeoffs_cost).toMatchObject({
      atClose: 40,
      now: 60,
      delta: 20,
      currency: "TRY",
    });
    expect(detail.figures.writeOffs?.bottles).toBe(2);

    // Kept before F-1609: unknown, never 0.
    const { svc: old } = service(
      detailHandler({ inventory_transactions: takeOffs }),
    );
    const before = await old.getClose(HOUSE, "close-1");
    expect(
      before.againstNow.find((a) => a.figure === "writeoffs_bottles"),
    ).toMatchObject({ atClose: null, now: 3, delta: null });
  });

  it("[REVERT-FAILS] a tip changed after the close is listed on its own line and set against the kept Tips, never a silent move (w111-tips-owed)", async () => {
    const tipped = {
      ...closeRow,
      figures: {
        ...kept,
        till: {
          ...kept.till,
          tips: 30,
          tipsCheckCount: 2,
          keptTips: { k1: 10, k5: 20 },
        },
      },
    };
    const check = (
      id: string,
      ref: string,
      subtotal: number,
      tip: number | null,
      voided: boolean,
      imported_at: string,
    ) => ({
      id,
      external_check_id: ref,
      subtotal,
      total: subtotal + 10,
      tip,
      voided,
      ...july,
      imported_at,
      source_modified_at: null,
    });
    const { svc } = service(
      detailHandler({
        month_closes: () => ({ data: tipped, error: null }),
        pos_checks: () => ({
          data: [
            check("k1", "T-17", 120, 10, true, "2026-07-20T20:01:00Z"),
            // The net stayed; only the tip was raised at the till.
            check("k5", "T-20", 880, 25, false, "2026-07-20T20:01:00Z"),
            check("k6", "T-21", 40, 4, false, "2026-08-03T11:00:00Z"),
          ],
          error: null,
          count: 3,
        }),
      }),
    );
    const detail = await svc.getClose(HOUSE, "close-1");
    const tips = detail.changes
      .filter((c) => c.kind === "tips")
      .map((c) => [c.what, c.delta]);
    expect(tips).toEqual(
      expect.arrayContaining([
        ["Check T-17: tip taken off at the till", -10],
        ["Check T-20: tip changed at the till", 5],
        ["Check T-21: tip added at the till", 4],
      ]),
    );
    expect(tips).toHaveLength(3);
    const tipsNow = detail.againstNow.find((a) => a.figure === "till_tips");
    // The closed figure is the one kept; the move is said beside it.
    expect(tipsNow).toMatchObject({
      label: "Tips through the till",
      atClose: 30,
      now: 29,
      delta: -1,
      currency: "TRY",
    });
    expect(tips.reduce((n, [, d]) => n + (d as number), 0)).toBe(
      tipsNow!.delta,
    );
    expect(detail.figures.till.tips).toBe(30);
    expect(detail.figures.till).not.toHaveProperty("keptTips");
    // The net figure's lines still add up to the net figure alone.
    const net = detail.changes
      .filter((c) => c.kind === "till")
      .reduce((n, c) => n + (c.delta ?? 0), 0);
    expect(net).toBe(
      detail.againstNow.find((a) => a.figure === "till_net_sales")!.delta,
    );

    // A close kept before tips were kept per check lists no tip line, and its
    // Tips is unknown, never 0.
    const { svc: old } = service(detailHandler());
    const before = await old.getClose(HOUSE, "close-1");
    expect(before.changes.filter((c) => c.kind === "tips")).toEqual([]);
  });

  it("writes the kept write-offs as a file, and refuses for a close kept before them (F-1609)", async () => {
    const withOffs = {
      ...closeRow,
      figures: {
        ...kept,
        writeOffs: writeOffFigures([
          {
            transaction_type: "comp",
            reason: "Comp / gift",
            quantity_change: -2,
            metadata: {
              lots_taken: [
                { qty: 2, unit_cost: 35.5, cost_provenance: "invoice" },
              ],
            },
          },
          {
            transaction_type: "adjustment",
            reason: "Staff pour",
            quantity_change: -1,
            metadata: {},
          },
        ]),
      },
    };
    const { svc } = service(
      houseHandler({ month_closes: () => ({ data: withOffs, error: null }) }),
    );
    const file = await svc.writeOffsCsv(HOUSE, "close-1");
    // Named for its house (F-1631).
    expect(file.filename).toBe(
      "mudavym-synthetic-house-writeoffs-2026-07-closed-v1.csv",
    );
    // A Turkish house's file is in its own marks: ";" between cells.
    const lines = file.body.split("\r\n");
    expect(lines).toContain("Cutting;Write-offs");
    expect(lines).toContain("Bottles written off;3;bottles;");
    expect(lines).toContain("Written off, at cost;71;TRY;");
    expect(lines).toContain("Comps;1;2;71;0");
    // A cost no bottle carried is withheld, never 0.
    expect(lines.some((l) => l.startsWith("Staff pours;1;1;withheld;1"))).toBe(
      true,
    );

    const { svc: old } = service(
      houseHandler({ month_closes: () => ({ data: closeRow, error: null }) }),
    );
    await expect(old.writeOffsCsv(HOUSE, "close-1")).rejects.toThrow(
      /closed before write-offs were kept/,
    );
  });

  it("names the kept till file for its house, and still hands it over when the name cannot be read (F-1631)", async () => {
    const { svc } = service(
      houseHandler({ month_closes: () => ({ data: closeRow, error: null }) }),
    );
    const file = await svc.tillCsv(HOUSE, "close-1");
    expect(file.filename).toBe(
      "mudavym-synthetic-house-till-2026-07-closed-v1.csv",
    );
    expect(file.body).toBe("Day,Taken");

    const { svc: blind } = service(
      houseHandler({
        month_closes: () => ({ data: closeRow, error: null }),
        restaurants: () => ({ data: null, error: { message: "down" } }),
      }),
    );
    expect((await blind.tillCsv(HOUSE, "close-1")).filename).toBe(
      "mudavym-house-till-2026-07-closed-v1.csv",
    );
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

describe("writeOffFigures (F-1609)", () => {
  it("is a measured zero when nothing was written off, and unknown when no bottle carried a cost", () => {
    expect(writeOffFigures([])).toEqual({
      movements: 0,
      bottles: 0,
      cost: 0,
      uncostedBottles: 0,
      otherMoneyBottles: 0,
      notInvoicedBottles: 0,
      byReason: [],
    });
    const none = writeOffFigures([
      { transaction_type: "waste", reason: "Breakage", quantity_change: -2 },
      // A count correction and a bottle coming back are not write-offs.
      { transaction_type: "correction", reason: "x", quantity_change: -4 },
      {
        transaction_type: "adjustment",
        reason: "Count correction",
        quantity_change: -1,
      },
    ]);
    expect(none).toMatchObject({
      movements: 1,
      bottles: 2,
      cost: null,
      uncostedBottles: 2,
    });
  });

  it("never adds a cost in another money into the house's total, and counts the bottles not at an invoice's cost (F-1653)", () => {
    const w = writeOffFigures(
      [
        {
          transaction_type: "waste",
          reason: "Breakage",
          quantity_change: -4,
          metadata: {
            lots_taken: [
              // Invoiced in lira: in the total.
              {
                qty: 1,
                unit_cost: 600,
                cost_provenance: "invoice",
                unit_cost_currency: "TRY",
              },
              // From a EUR order at a TRY house: left out, and counted.
              {
                qty: 1,
                unit_cost: 20,
                cost_provenance: "invoice",
                unit_cost_currency: "EUR",
              },
              // An order's price, and a cost the house typed in: in, and said.
              {
                qty: 1,
                unit_cost: 500,
                cost_provenance: "estimated",
                unit_cost_currency: "TRY",
              },
              { qty: 1, unit_cost: 450, cost_provenance: "manual" },
            ],
          },
        },
      ],
      "TRY",
    );
    expect(w).toMatchObject({
      bottles: 4,
      cost: 1550,
      uncostedBottles: 1,
      otherMoneyBottles: 1,
      notInvoicedBottles: 2,
    });
    // Every bottle in another money: no house-money cost at all, never 0.
    const eur = writeOffFigures(
      [
        {
          transaction_type: "comp",
          reason: "Comp / gift",
          quantity_change: -2,
          metadata: {
            lots_taken: [
              {
                qty: 2,
                unit_cost: 20,
                cost_provenance: "invoice",
                unit_cost_currency: "EUR",
              },
            ],
          },
        },
      ],
      "TRY",
    );
    expect(eur).toMatchObject({
      cost: null,
      uncostedBottles: 2,
      otherMoneyBottles: 2,
    });
    // A house with no money on record reads every lot as before.
    expect(
      writeOffFigures([
        {
          transaction_type: "comp",
          reason: "Comp / gift",
          quantity_change: -2,
          metadata: {
            lots_taken: [
              {
                qty: 2,
                unit_cost: 20,
                cost_provenance: "invoice",
                unit_cost_currency: "EUR",
              },
            ],
          },
        },
      ]).cost,
    ).toBe(40);
  });

  it("files a staff pour from /inventory under Staff pours, not Comps (F-1614)", () => {
    // The rows exactly as RowExpansion.tsx writes them: ADJUST_MOVEMENT sends
    // 'Staff pour' and 'Comp / gift' both as transactionType 'comp'.
    const w = writeOffFigures([
      { transaction_type: "comp", reason: "Staff pour", quantity_change: -1 },
      { transaction_type: "comp", reason: "Comp / gift", quantity_change: -2 },
    ]);
    expect(w.byReason.map((l) => [l.reason, l.bottles])).toEqual([
      ["comp", 2],
      ["staff_pour", 1],
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

/**
 * F-1544 lane 5, the founder's F1 (b), 2026-10-12 (sim-ledger S224): a
 * stock-take's count made within 6 hours after its session's month ended is
 * filed in that month; its counted moment is not moved. A count with no
 * session is filed by its moment exactly as before. July 2026 in Istanbul
 * (UTC+3): it starts 2026-06-30T21:00Z and ends 2026-07-31T21:00Z, and its
 * 6 hours run to 2026-08-01T03:00Z.
 */
describe("MonthCloseService — a stock-take's count files in its session's month", () => {
  const S_JUNE = "sess-june";
  const S_JULY = "sess-july";
  const S_OLD = "sess-before-lane-5";
  const sessions = [
    { id: S_JUNE, attributed_period: "2026-06" },
    { id: S_JULY, attributed_period: "2026-07" },
    { id: S_OLD, attributed_period: null },
  ];
  const sessionsAnswer = (ops: Op[]): Answer => {
    const ids = (arg(ops, "in")?.[1] ?? []) as string[];
    return {
      data: sessions.filter((s) => ids.includes(s.id)),
      error: null,
    };
  };

  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date("2026-08-02T09:00:00Z"),
      doNotFake: ["nextTick", "setImmediate"],
    });
  });
  afterEach(() => jest.useRealTimers());

  it("files the count made at 01:30 on 1 August in July, and the June walk's 01:00 count in June", async () => {
    const month = [
      // A spot count: filed by its moment, as before.
      {
        id: "m1",
        expected_qty: 6,
        counted_qty: 4,
        variance_qty: -2,
        counted_at: "2026-07-15T10:00:00Z",
        session_id: null,
        variance_open_ml: null,
      },
      // 01:00 on 1 July of a June walk: June's, not July's.
      {
        id: "m2",
        expected_qty: 9,
        counted_qty: 4,
        variance_qty: -5,
        counted_at: "2026-06-30T22:00:00Z",
        session_id: S_JUNE,
        variance_open_ml: null,
      },
      // 01:00 on 1 July of a walk opened before lane 5: by its moment, July.
      {
        id: "m3",
        expected_qty: 2,
        counted_qty: 1,
        variance_qty: -1,
        counted_at: "2026-06-30T22:00:00Z",
        session_id: S_OLD,
        variance_open_ml: null,
      },
      {
        id: "m4",
        expected_qty: 3,
        counted_qty: 4,
        variance_qty: 1,
        counted_at: "2026-07-10T10:00:00Z",
        session_id: S_JULY,
        variance_open_ml: -300,
      },
    ];
    const tail = [
      // 01:30 on 1 August of the July walk: July's.
      {
        id: "t1",
        expected_qty: 8,
        counted_qty: 5,
        variance_qty: -3,
        counted_at: "2026-07-31T22:30:00Z",
        session_id: S_JULY,
        variance_open_ml: 100,
      },
      // Not a session's count, and one of a walk with no month: never July's.
      {
        id: "t2",
        expected_qty: 8,
        counted_qty: 1,
        variance_qty: -7,
        counted_at: "2026-07-31T22:00:00Z",
        session_id: null,
        variance_open_ml: null,
      },
      {
        id: "t3",
        expected_qty: 8,
        counted_qty: 2,
        variance_qty: -6,
        counted_at: "2026-07-31T22:00:00Z",
        session_id: S_OLD,
        variance_open_ml: null,
      },
    ];
    const { svc, calls } = service(
      houseHandler({
        stock_counts: (ops) => {
          const rows = has(ops, "not") ? tail : month;
          return { data: rows, error: null, count: rows.length };
        },
        stock_count_sessions: sessionsAnswer,
      }),
    );
    await svc.closeMonth(HOUSE, ACTOR, "2026-07");
    const insert = calls.find(
      (c) => c.table === "month_closes" && has(c.ops, "insert"),
    )!;
    const f = (arg(insert.ops, "insert")![0] as any).figures as MonthFigures;
    // m1, m3, m4 and t1.
    expect(f.variance).toEqual({
      counts: 4,
      netBottles: -5,
      shortBottles: 6,
      overBottles: 1,
      openMl: { counts: 2, netMl: -200, shortMl: 300, overMl: 100 },
    });
    // The tail read asks only for a session's counts, in the 6 hours.
    const tailRead = calls.find(
      (c) => c.table === "stock_counts" && has(c.ops, "not"),
    )!;
    expect(arg(tailRead.ops, "not")).toEqual(["session_id", "is", null]);
    expect(arg(tailRead.ops, "gte")).toEqual([
      "counted_at",
      "2026-07-31T21:00:00.000Z",
    ]);
    expect(arg(tailRead.ops, "lt")).toEqual([
      "counted_at",
      "2026-08-01T03:00:00.000Z",
    ]);
    // The months are read from this house's sessions only.
    const read = calls.find((c) => c.table === "stock_count_sessions")!;
    expect(arg(read.ops, "eq")).toEqual(["restaurant_id", HOUSE]);
  });

  it("files a month of spot counts exactly as before, reading no session", async () => {
    const spot = [
      {
        id: "c1",
        expected_qty: 12,
        counted_qty: 10,
        variance_qty: null,
        counted_at: "2026-07-03T10:00:00Z",
        session_id: null,
      },
      {
        id: "c2",
        expected_qty: 5,
        counted_qty: 6,
        variance_qty: 1,
        counted_at: "2026-07-31T20:59:00Z",
        session_id: null,
      },
    ];
    const { svc, calls } = service(
      houseHandler({
        stock_counts: (ops) =>
          has(ops, "not")
            ? { data: [], error: null, count: 0 }
            : { data: spot, error: null, count: spot.length },
      }),
    );
    await svc.closeMonth(HOUSE, ACTOR, "2026-07");
    const insert = calls.find(
      (c) => c.table === "month_closes" && has(c.ops, "insert"),
    )!;
    const f = (arg(insert.ops, "insert")![0] as any).figures as MonthFigures;
    expect(f.variance).toEqual({
      counts: 2,
      netBottles: -1,
      shortBottles: 2,
      overBottles: 1,
      openMl: { counts: 0, netMl: 0, shortMl: 0, overMl: 0 },
    });
    expect(calls.some((c) => c.table === "stock_count_sessions")).toBe(false);
    // The month's own read is the one it always was.
    const monthRead = calls.find(
      (c) => c.table === "stock_counts" && !has(c.ops, "not"),
    )!;
    expect(arg(monthRead.ops, "gte")).toEqual([
      "counted_at",
      "2026-06-30T21:00:00.000Z",
    ]);
    expect(arg(monthRead.ops, "lt")).toEqual([
      "counted_at",
      "2026-07-31T21:00:00.000Z",
    ]);
  });

  it("refuses the close when the stock-takes cannot be read", async () => {
    const { svc, calls } = service(
      houseHandler({
        stock_counts: () => ({
          data: [
            {
              id: "m4",
              expected_qty: 3,
              counted_qty: 4,
              variance_qty: 1,
              counted_at: "2026-07-10T10:00:00Z",
              session_id: S_JULY,
            },
          ],
          error: null,
          count: 1,
        }),
        stock_count_sessions: () => ({
          data: null,
          error: { message: "down" },
        }),
      }),
    );
    await expect(svc.closeMonth(HOUSE, ACTOR, "2026-07")).rejects.toThrow();
    expect(
      calls.some((c) => c.table === "month_closes" && has(c.ops, "insert")),
    ).toBe(false);
  });

  it("lists a July walk's count that arrived after the close, and leaves out the June walk's", async () => {
    const closeRow = {
      id: "close-1",
      restaurant_id: HOUSE,
      month: "2026-07",
      version: 1,
      closed_by: ACTOR,
      // Closed at 00:45 on 1 August, before the walk's last shelf synced.
      closed_at: "2026-07-31T21:45:00+00:00",
      zone: ZONE,
      figures: {
        currency: "TRY",
        till: {
          posConnected: false,
          netSales: null,
          netSalesCheckCount: null,
          checkCount: null,
          days: [],
          kept: {},
        },
        valuation: {
          inventoryValue: null,
          pricedInventoryValue: null,
          unpricedWines: null,
          valuedAt: "2026-07-31T21:45:00Z",
        },
        purchases: { orders: 0, unpriced: 0, totals: [], kept: {} },
        variance: {
          counts: 0,
          netBottles: 0,
          shortBottles: 0,
          overBottles: 0,
          openMl: { counts: 0, netMl: 0, shortMl: 0, overMl: 0 },
        },
      } as MonthFigures,
      till_csv: null,
    };
    const lateMove = {
      id: "tx-late",
      inventory_id: "w1",
      transaction_type: "reconciliation",
      source: "mobile_count",
      quantity_change: -3,
      performed_by: ACTOR,
      transaction_date: "2026-07-31T22:30:00Z",
      created_at: "2026-07-31T23:10:00Z",
    };
    const { svc, calls } = service(
      houseHandler({
        month_closes: () => ({ data: closeRow, error: null }),
        pos_checks: () => ({ data: [], error: null, count: 0 }),
        procurement_orders: () => ({ data: [], error: null, count: 0 }),
        stock_counts: (ops) => {
          const cols = String(arg(ops, "select")?.[0] ?? "");
          if (cols.includes("transaction_id")) {
            const from = String(arg(ops, "gte")?.[1]);
            const rows =
              from === "2026-06-30T21:00:00.000Z"
                ? [
                    {
                      id: "h1",
                      counted_at: "2026-06-30T22:00:00Z",
                      session_id: S_JUNE,
                      transaction_id: "tx-head",
                    },
                  ]
                : from === "2026-07-31T21:00:00.000Z"
                  ? [
                      {
                        id: "l1",
                        counted_at: "2026-07-31T22:30:00Z",
                        session_id: S_JULY,
                        transaction_id: "tx-late",
                      },
                    ]
                  : [];
            return { data: rows, error: null };
          }
          return { data: [], error: null, count: 0 };
        },
        stock_count_sessions: sessionsAnswer,
        inventory_transactions: (ops) =>
          has(ops, "in")
            ? { data: [lateMove], error: null }
            : { data: [], error: null, count: 0 },
        restaurant_inventory: () => ({
          data: [{ id: "w1", display_name: "Barolo 2019", wine_name: null }],
          error: null,
        }),
      }),
      { ...till, posConnected: false },
    );
    const detail = await svc.getClose(HOUSE, "close-1");
    expect(detail.changes).toEqual([
      expect.objectContaining({
        kind: "stock",
        who: "Ayla",
        what: "Shelf count: Barolo 2019 (counted just after the month ended; the count was for this month)",
        delta: -3,
        // The day it was counted, honestly.
        day: "2026-08-01",
      }),
    ]);
    // The June walk's movement made on 1 July is June's change, not July's.
    const inMonth = calls.find(
      (c) => c.table === "inventory_transactions" && !has(c.ops, "in"),
    )!;
    expect(arg(inMonth.ops, "not")).toEqual(["id", "in", "(tx-head)"]);
    // Only a movement made after the close is listed. The late read is the
    // one keyed on the walk's movement ids; the month's write-off read
    // (F-1609) also has an `in`, on transaction_type.
    const lateRead = calls.find(
      (c) =>
        c.table === "inventory_transactions" &&
        (arg(c.ops, "in") as unknown[] | undefined)?.[0] === "id",
    )!;
    expect(arg(lateRead.ops, "gt")).toEqual([
      "created_at",
      "2026-07-31T21:45:00+00:00",
    ]);
  });

  it("lists each count's open bottles that reached the books after the close, by who and in ml (S227 owed)", async () => {
    const closeRow = {
      id: "close-1",
      restaurant_id: HOUSE,
      month: "2026-07",
      version: 1,
      closed_by: ACTOR,
      closed_at: "2026-08-01T09:00:00+00:00",
      zone: ZONE,
      figures: {
        currency: "TRY",
        till: {
          posConnected: false,
          netSales: null,
          netSalesCheckCount: null,
          checkCount: null,
          days: [],
          kept: {},
        },
        valuation: {
          inventoryValue: null,
          pricedInventoryValue: null,
          unpricedWines: null,
          valuedAt: "2026-08-01T09:00:00Z",
        },
        purchases: { orders: 0, unpriced: 0, totals: [], kept: {} },
        variance: {
          counts: 1,
          netBottles: 0,
          shortBottles: 0,
          overBottles: 0,
          openMl: { counts: 1, netMl: -100, shortMl: 100, overMl: 0 },
        },
      } as MonthFigures,
      till_csv: null,
    };
    const month = [
      // Counted and on the books before the close: in the kept figure.
      {
        id: "m-kept",
        inventory_id: "w1",
        expected_qty: 3,
        counted_qty: 3,
        variance_qty: 0,
        variance_open_ml: -100,
        counted_by: ACTOR,
        counted_at: "2026-07-20T10:00:00Z",
        arrived_at: "2026-07-20T10:00:05Z",
        session_id: S_JULY,
      },
      // A paper sheet counted on 30 July, loaded after the close. The whole
      // bottles agreed, so no stock moved; the open bottle was 250 ml short.
      {
        id: "m-late",
        inventory_id: "w1",
        expected_qty: 2,
        counted_qty: 2,
        variance_qty: 0,
        variance_open_ml: -250,
        counted_by: ACTOR,
        counted_at: "2026-07-30T18:00:00Z",
        arrived_at: "2026-08-01T12:00:00Z",
        session_id: S_JULY,
      },
      // Arrived after the close but named no open bottle: not an ml change.
      {
        id: "m-whole",
        inventory_id: "w1",
        expected_qty: 2,
        counted_qty: 2,
        variance_qty: 0,
        variance_open_ml: null,
        counted_by: ACTOR,
        counted_at: "2026-07-30T18:00:00Z",
        arrived_at: "2026-08-01T12:00:00Z",
        session_id: S_JULY,
      },
    ];
    const { svc } = service(
      houseHandler({
        month_closes: () => ({ data: closeRow, error: null }),
        pos_checks: () => ({ data: [], error: null, count: 0 }),
        procurement_orders: () => ({ data: [], error: null, count: 0 }),
        stock_counts: (ops) => {
          const cols = String(arg(ops, "select")?.[0] ?? "");
          if (cols.includes("transaction_id")) return { data: [], error: null };
          const rows = has(ops, "not") ? [] : month;
          return { data: rows, error: null, count: rows.length };
        },
        stock_count_sessions: sessionsAnswer,
        inventory_transactions: () => ({ data: [], error: null, count: 0 }),
        restaurant_inventory: () => ({
          data: [{ id: "w1", display_name: "Barolo 2019", wine_name: null }],
          error: null,
        }),
      }),
      { ...till, posConnected: false },
    );
    const detail = await svc.getClose(HOUSE, "close-1");
    expect(detail.changes).toEqual([
      {
        kind: "stock",
        at: "2026-08-01T12:00:00Z",
        day: "2026-07-30",
        who: "Ayla",
        what: "Open bottles counted: Barolo 2019",
        delta: -250,
        unit: "ml",
        currency: null,
      },
    ]);
    // The listed ml add up to the open-bottle figure's move.
    expect(
      detail.againstNow.find((a) => a.figure === "variance_open_ml"),
    ).toMatchObject({ atClose: -100, now: -350, delta: -250 });
  });
});

describe("againstNow — open bottles (F-1544 lane 5)", () => {
  const base = (openMl?: { counts: number; netMl: number }): MonthFigures => ({
    currency: "TRY",
    till: {
      posConnected: false,
      netSales: null,
      netSalesCheckCount: null,
      checkCount: null,
      days: [],
    },
    valuation: {
      inventoryValue: null,
      pricedInventoryValue: null,
      unpricedWines: null,
      valuedAt: "2026-08-02T09:00:00Z",
    },
    purchases: { orders: 0, unpriced: 0, totals: [] },
    variance: {
      counts: 0,
      netBottles: 0,
      shortBottles: 0,
      overBottles: 0,
      ...(openMl
        ? {
            openMl: {
              ...openMl,
              shortMl: Math.max(0, -openMl.netMl),
              overMl: Math.max(0, openMl.netMl),
            },
          }
        : {}),
    },
  });

  it("sets the open bottles kept against now once a count named them, unknown for an older close", () => {
    const rows = againstNow(
      base({ counts: 1, netMl: -150 }),
      base({ counts: 2, netMl: -400 }),
    );
    expect(rows.find((r) => r.figure === "variance_open_ml")).toEqual({
      figure: "variance_open_ml",
      label: "Count variance, open bottles, ml",
      atClose: -150,
      now: -400,
      delta: -250,
      currency: null,
    });
    const older = againstNow(base(), base({ counts: 1, netMl: -100 }));
    expect(older.find((r) => r.figure === "variance_open_ml")).toMatchObject({
      atClose: null,
      delta: null,
    });
    expect(
      againstNow(
        base({ counts: 0, netMl: 0 }),
        base({ counts: 0, netMl: 0 }),
      ).some((r) => r.figure === "variance_open_ml"),
    ).toBe(false);
  });
});
