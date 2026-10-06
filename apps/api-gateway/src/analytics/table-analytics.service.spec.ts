import { ServiceUnavailableException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TableAnalyticsService } from "./table-analytics.service";

/**
 * A-040 (analytics walk on Tuzlu Rüzgar, 2026-10-03) — what an empty POS
 * window is, said as what it is.
 *
 * Before: every POS register keyed `dataStatus` on the WINDOW's check count and
 * said "awaiting POS check feed (pos_checks is empty)" when it was zero. The
 * /reports page fixes the window at 90 days, so a house whose feed stopped on
 * Aug 30 would read, from about Nov 28, that it had no checks at all — and the
 * server register would blame "an absent field on the POS feed". And a FAILED
 * read returned `[]`, so a broken query printed the same sentence (ADR 0067).
 *
 * After: three facts, three answers — checks in the window ("live"), none in
 * the window but older ones (the window, and the latest day), none ever — and
 * a failed read throws.
 */

type Result = { data: unknown; error: { message: string } | null };

/**
 * Chainable Supabase stub. Each `.from(table)` takes the next queued result
 * for that table; the builder resolves it whether awaited directly or through
 * `.maybeSingle()`. Every builder call is recorded so a test can assert the
 * probe's filters (`voided = false`, newest first, one row).
 */
function makeService(queue: Record<string, Result[]>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const from = jest.fn((table: string) => {
    const next = queue[table]?.shift();
    if (!next) throw new Error(`unexpected read of ${table}`);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gte", "order", "limit"])
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    builder.maybeSingle = () => {
      calls.push({ table, method: "maybeSingle", args: [] });
      return Promise.resolve(next);
    };
    builder.then = (
      resolve: (r: Result) => unknown,
      reject: (e: unknown) => unknown,
    ) => Promise.resolve(next).then(resolve, reject);
    return builder;
  });
  const db = { getClient: () => ({ from }) } as unknown as DatabaseService;
  return { service: new TableAnalyticsService(db), from, calls };
}

const ok = (data: unknown): Result => ({ data, error: null });
const fail = (message: string): Result => ({ data: null, error: { message } });

const check = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  table_id: "t1",
  server_name: "Maya",
  server_external_id: null,
  opened_at: "2026-08-20T19:00:00+00:00",
  closed_at: "2026-08-20T20:30:00+00:00",
  covers: 2,
  subtotal: 160,
  total: 180,
  tip: 20,
  items: [],
  ...over,
});

describe("TableAnalyticsService — an empty POS window is not an empty feed (A-040)", () => {
  it("a window with checks is 'live', counts them, and never runs the history probe", async () => {
    const { service, from } = makeService({
      pos_checks: [
        ok([
          check(),
          check({ id: "c2", opened_at: "2026-08-30T19:00:00+00:00" }),
          check({ id: "c3", opened_at: "2026-08-25T19:00:00+00:00" }),
        ]),
      ],
    });
    const out = await service.getWaiterPerformance("r1", 90);
    expect(out.dataStatus).toBe("live");
    expect(out.checksInWindow).toBe(3);
    expect(out.latestCheckAt).toBe("2026-08-30T19:00:00.000Z");
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("an empty window over an older feed names the window and the latest day, and says nothing is empty", async () => {
    const { service, calls } = makeService({
      pos_checks: [ok([]), ok({ opened_at: "2026-08-30T22:15:00+00:00" })],
    });
    const out = await service.getWaiterPerformance("r1", 90);
    expect(out.checksInWindow).toBe(0);
    expect(out.latestCheckAt).toBe("2026-08-30T22:15:00.000Z");
    expect(out.dataStatus).toBe(
      "no POS check opened in the last 90 days — the latest was opened 2026-08-30 (UTC)",
    );
    expect(out.dataStatus).not.toContain("empty");
    // The probe counts what the window counts: non-voided checks, newest first, one row.
    const probe = calls.filter((c) => c.table === "pos_checks").slice(-6);
    expect(probe.map((c) => c.method)).toEqual([
      "select",
      "eq",
      "eq",
      "order",
      "limit",
      "maybeSingle",
    ]);
    expect(probe[1].args).toEqual(["restaurant_id", "r1"]);
    expect(probe[2].args).toEqual(["voided", false]);
    expect(probe[3].args).toEqual(["opened_at", { ascending: false }]);
    expect(probe[4].args).toEqual([1]);
  });

  it("a house with no check ever is awaiting a feed, with no latest day", async () => {
    const { service } = makeService({
      restaurant_tables: [ok([{ id: "t1", label: "T1", seats: 4 }])],
      pos_checks: [ok([]), ok(null)],
    });
    const out = await service.getTablePerformance("r1", 90);
    expect(out.checksInWindow).toBe(0);
    expect(out.latestCheckAt).toBeNull();
    expect(out.dataStatus).toBe(
      "awaiting POS check feed — no POS check is recorded for this restaurant (voided checks are not counted)",
    );
  });

  it("the same three answers reach the table register and the hot-table watchlist", async () => {
    const tables = makeService({
      restaurant_tables: [ok([])],
      pos_checks: [ok([]), ok({ opened_at: "2026-08-30T19:00:00+00:00" })],
    });
    expect(
      (await tables.service.getTablePerformance("r1", 90)).dataStatus,
    ).toContain("no POS check opened in the last 90 days");
    const hot = makeService({
      pos_checks: [ok([]), ok(null)],
      restaurant_tables: [ok([])],
    });
    const out = await hot.service.getHotTables("r1");
    expect(out.dataStatus).toContain(
      "no POS check is recorded for this restaurant",
    );
    expect(out.checksInWindow).toBe(0);
  });

  it("the basket tells checks-with-no-pairs apart from no checks", async () => {
    const some = makeService({
      pos_checks: [ok([check(), check({ id: "c2" })])],
    });
    expect((await some.service.getBasketAffinity("r1")).dataStatus).toBe(
      "2 POS checks in the last 90 days, none listing two or more named items",
    );
    const none = makeService({
      pos_checks: [ok([]), ok({ opened_at: "2026-08-30T19:00:00+00:00" })],
    });
    expect((await none.service.getBasketAffinity("r1")).dataStatus).toContain(
      "no POS check opened in the last 90 days",
    );
  });

  it("a failed window read throws instead of reporting an empty feed (ADR 0067)", async () => {
    for (const call of [
      (s: TableAnalyticsService) => s.getWaiterPerformance("r1", 90),
      (s: TableAnalyticsService) => s.getTablePerformance("r1", 90),
      (s: TableAnalyticsService) => s.getBasketAffinity("r1"),
      (s: TableAnalyticsService) => s.getHotTables("r1"),
    ]) {
      const { service } = makeService({
        restaurant_tables: [ok([])],
        pos_checks: [fail("statement timeout")],
      });
      await expect(call(service)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    }
  });

  it("a failed history probe throws instead of reporting 'no check ever'", async () => {
    const { service } = makeService({
      pos_checks: [ok([]), fail("connection reset")],
    });
    await expect(service.getWaiterPerformance("r1", 90)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

/**
 * ADR 0295 (AW17, A-019, A-047): the table and server registers read net
 * sales — the subtotal, before tax, surcharge and tip — and the tip rate is
 * on net. `total` here is Tuzlu's gross: subtotal × 1.1263.
 */
describe("TableAnalyticsService — sales are net (ADR 0295)", () => {
  it("g7: a server's tip rate is on net, and their average check is net", async () => {
    const { service, calls } = makeService({
      pos_checks: [ok([check({ subtotal: 100, total: 112.63, tip: 20 })])],
    });
    const out = await service.getWaiterPerformance("r1", 90);
    expect(out.basis).toBe("net");
    const maya = out.waiters.find((w: any) => w.name === "Maya")!;
    expect(maya.tipPct).toBeCloseTo(0.2, 10); // not 20 / 112.63 = 0.1776
    expect(maya.avgCheck).toBeCloseTo(100, 10);
    expect(maya.revenue).toBeCloseTo(100, 10);
    expect(maya.netChecks).toBe(1);
    const select = calls.find(
      (c) => c.table === "pos_checks" && c.method === "select",
    );
    expect(String(select?.args[0])).toMatch(/\bsubtotal\b/);
    expect(String(select?.args[0])).not.toMatch(/\btotal\b/);
  });

  it("g8: a table's sales and sales per cover are net; a check with no subtotal is counted, not summed", async () => {
    const { service } = makeService({
      restaurant_tables: [
        ok([
          { id: "t1", label: "T1", seats: 4 },
          { id: "t2", label: "T2", seats: 2 },
        ]),
      ],
      pos_checks: [
        ok([
          check({ id: "a", subtotal: 100, total: 112.63, covers: 2, tip: 10 }),
          check({ id: "b", subtotal: null, total: 300, covers: 4, tip: 30 }),
          check({ id: "c", table_id: "t2", subtotal: null, total: 90 }),
        ]),
      ],
    });
    const out = await service.getTablePerformance("r1", 90);
    expect(out.basis).toBe("net");
    const t1 = out.tables.find((t: any) => t.tableId === "t1")!;
    expect(t1.checks).toBe(2);
    expect(t1.netChecks).toBe(1);
    expect(t1.revenue).toBeCloseTo(100, 10); // not 412.63, not 400
    expect(t1.avgCheck).toBeCloseTo(100, 10);
    expect(t1.revenuePerCover).toBeCloseTo(50, 10); // 100 over the 2 covers that carried it
    expect(t1.revenuePerSeat).toBeCloseTo(25, 10);
    expect(t1.tipPct).toBeCloseTo(0.1, 10); // the $30 tip has no net to sit on
    // A table whose checks carried no subtotal: not recorded, not $0.
    const t2 = out.tables.find((t: any) => t.tableId === "t2")!;
    expect(t2.checks).toBe(1);
    expect(t2.netChecks).toBe(0);
    expect(t2.revenue).toBeNull();
    expect(t2.avgCheck).toBeNull();
    expect(t2.revenuePerSeat).toBeNull();
  });

  it("g8b: a server whose checks carried no subtotal reads not recorded", async () => {
    const { service } = makeService({
      pos_checks: [ok([check({ subtotal: null, total: 112.63 })])],
    });
    const out = await service.getWaiterPerformance("r1", 90);
    const maya = out.waiters.find((w: any) => w.name === "Maya")!;
    expect(maya.checks).toBe(1);
    expect(maya.netChecks).toBe(0);
    expect(maya.revenue).toBeNull();
    expect(maya.avgCheck).toBeNull();
    expect(maya.tipPct).toBeNull();
  });

  it("g9: an open table's spend so far is net, and an open check with no subtotal has no pace", async () => {
    const opened = new Date(Date.now() - 30 * 60000).toISOString();
    const { service } = makeService({
      pos_checks: [
        ok([
          check({
            id: "o1",
            opened_at: opened,
            closed_at: null,
            subtotal: 60,
            total: 67.58,
          }),
          check({
            id: "o2",
            opened_at: opened,
            closed_at: null,
            subtotal: null,
            total: 50,
          }),
        ]),
      ],
      restaurant_tables: [ok([{ id: "t1", label: "T1", seats: 4 }])],
    });
    const out = await service.getHotTables("r1");
    expect(out.basis).toBe("net");
    const o1 = out.all.find((h: any) => h.checkId === "o1")!;
    expect(o1.spendSoFar).toBe(60);
    expect(o1.pacePerMin).toBeCloseTo(2, 1);
    const o2 = out.all.find((h: any) => h.checkId === "o2")!;
    expect(o2.spendSoFar).toBeNull();
    expect(o2.pacePerMin).toBeNull();
    expect(o2.surgeZ).toBeNull();
  });
});
