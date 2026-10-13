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
    // An unqueued `restaurants` read is a house with no zone, the rolling
    // window these cases were written against (F-575 reads the zone first).
    const next =
      queue[table]?.shift() ??
      (table === "restaurants" ? { data: null, error: null } : undefined);
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
    expect(from.mock.calls.filter(([t]) => t === "pos_checks")).toHaveLength(1);
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
 * F-575: "the last 90 days" on the room and the servers is the till's 90 days.
 *
 * The till files each check on the house day it closed, else opened, over the
 * last N house days (ADR 0296). These registers kept checks OPENED in the last
 * N × 24h, so their parts could not add up to the till's "Taken".
 */
describe("TableAnalyticsService — the window is the till's house days (F-575)", () => {
  const LA = { timezone: "America/Los_Angeles", country: "US" };
  beforeEach(() => {
    // 11:00 on 9 October in Los Angeles; the 90-day window opens 12 July.
    jest.useFakeTimers({
      now: new Date("2026-10-09T18:00:00Z"),
      doNotFake: ["nextTick", "setImmediate", "setTimeout", "queueMicrotask"],
    });
  });
  afterEach(() => jest.useRealTimers());

  it("files each check by the house day it closed, and reads from the till's lookback", async () => {
    const { service, calls } = makeService({
      restaurants: [ok(LA)],
      pos_checks: [
        ok([
          // Opened 11 July 10:00, closed 12 July 01:00 house time: 12 July, in.
          check({
            id: "late",
            opened_at: "2026-07-11T17:00:00Z",
            closed_at: "2026-07-12T08:00:00Z",
          }),
          // Opened and closed on 11 July house time: before the window, out,
          // though it opened inside the last 90 × 24h.
          check({
            id: "early",
            opened_at: "2026-07-11T19:00:00Z",
            closed_at: "2026-07-11T21:00:00Z",
          }),
          check({
            id: "today",
            opened_at: "2026-10-09T02:00:00Z",
            closed_at: "2026-10-09T04:00:00Z",
          }),
        ]),
      ],
    });
    const out = await service.getWaiterPerformance("r1", 90);
    expect(out.checksInWindow).toBe(2);
    const gte = calls.find(
      (c) => c.table === "pos_checks" && c.method === "gte",
    );
    // A day before the midnight that opens 12 July in Los Angeles.
    expect(gte?.args).toEqual(["opened_at", "2026-07-11T07:00:00.000Z"]);
  });

  it("an unreadable zone refuses rather than guessing the days", async () => {
    const { service } = makeService({
      restaurants: [fail("connection reset")],
      pos_checks: [ok([check()])],
    });
    await expect(service.getWaiterPerformance("r1", 90)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

// F-1532 / F-1534 (sim 50, analytics-real-house): a US check of $100 food,
// $6 tax and a $20 tip reaches the till as total 126, subtotal 100, tip 20.
// The server Tip read 20/126 = 15.9% because the tip sat in its own
// denominator; it is now over net sales, 20%. A comp rung at 0 pulled the
// average check down as if it were a sale; it is now counted apart.
describe("TableAnalyticsService — the tip rate is over net sales, and a check rung at 0 is not an average (F-1532, F-1534)", () => {
  const usCheck = (over: Record<string, unknown> = {}) =>
    check({ subtotal: 100, total: 126, tip: 20, ...over });
  const comp = (id: string) => check({ id, subtotal: 0, total: 0, tip: null });

  it("the server register takes Tip over the subtotal and leaves a comp out of Avg check", async () => {
    const { service } = makeService({
      pos_checks: [ok([usCheck({ id: "a" }), usCheck({ id: "b" }), comp("z")])],
    });
    const out: any = await service.getWaiterPerformance("r1", 90);
    const maya = out.waiters.find((w: any) => w.name === "Maya");
    expect(maya.tipPct).toBeCloseTo(0.2, 6);
    expect(maya.checks).toBe(3);
    expect(maya.avgCheck).toBeCloseTo(126, 6);
    expect(maya.checksTakingNoMoney).toBe(1);
    expect(out.checksTakingNoMoney).toBe(1);
    expect(out.tipBasis).toBe("net");
  });

  it("the table register does the same per table", async () => {
    const { service } = makeService({
      restaurant_tables: [ok([{ id: "t1", label: "T1", seats: 4 }])],
      pos_checks: [ok([usCheck({ id: "a" }), comp("z")])],
    });
    const out: any = await service.getTablePerformance("r1", 90);
    const t1 = out.tables.find((t: any) => t.tableId === "t1");
    expect(t1.tipPct).toBeCloseTo(0.2, 6);
    expect(t1.avgCheck).toBeCloseTo(126, 6);
    expect(t1.checks).toBe(2);
    expect(out.checksTakingNoMoney).toBe(1);
  });

  it("a check with no subtotal adds nothing to the tip rate rather than a tip over nothing", async () => {
    const { service } = makeService({
      pos_checks: [
        ok([usCheck({ id: "a" }), usCheck({ id: "b", subtotal: null })]),
      ],
    });
    const out: any = await service.getWaiterPerformance("r1", 90);
    expect(out.waiters[0].tipPct).toBeCloseTo(0.2, 6);
  });

  // F-1558 / F-1573: Clover and CSV tills send a tip and no subtotal. Tip
  // went blank for every server with the basis still "over net sales", the
  // export said "no tip recorded", and tips per seat read a measured 0.
  it("a till that never sends a subtotal: no 'net' basis, a reason, and no tip per seat", async () => {
    const clover = (id: string) => usCheck({ id, subtotal: null });
    let { service } = makeService({
      pos_checks: [ok([clover("a"), clover("b")])],
    });
    const out: any = await service.getWaiterPerformance("r1", 90);
    expect(out.waiters[0].tipPct).toBeNull();
    expect(out.waiters[0].tipPctWhy).toMatch(/no amount before tax/);
    expect(out.tipBasis).toBeNull();
    expect(out.tipBasisWhy).toMatch(/no amount before tax/);

    ({ service } = makeService({
      restaurant_tables: [ok([{ id: "t1", label: "T1", seats: 4 }])],
      pos_checks: [ok([clover("a")])],
    }));
    const room: any = await service.getTablePerformance("r1", 90);
    expect(room.tables[0].tipPct).toBeNull();
    expect(room.tables[0].tipPerSeat).toBeNull();
    expect(room.tipBasis).toBeNull();
  });

  it("some checks with a subtotal and some without: 'net', and says the rest are left out", async () => {
    const { service } = makeService({
      pos_checks: [
        ok([
          usCheck({ id: "a" }),
          usCheck({ id: "b", server_name: "Ali", subtotal: null }),
        ]),
      ],
    });
    const out: any = await service.getWaiterPerformance("r1", 90);
    expect(out.tipBasis).toBe("net");
    expect(out.tipBasisWhy).toMatch(/left out of Tip/);
    const ali = out.waiters.find((w: any) => w.name === "Ali");
    expect(ali.tipPctWhy).toMatch(/no amount before tax/);
    const maya = out.waiters.find((w: any) => w.name === "Maya");
    expect(maya.tipPctWhy).toBeNull();
  });

  // F-1581: a house whose prices include tax, with no rate in force for a
  // check, has the till's subtotal kept in gross_subtotal and its net left
  // unrecorded. Tip blamed the till ("sends no amount before tax").
  it("a check the house's tax settings left without net names the house's cause, not the till", async () => {
    const unrated = (id: string, over: Record<string, unknown> = {}) =>
      usCheck({
        id,
        subtotal: null,
        gross_subtotal: 330,
        tax_basis: "prices_include_tax",
        ...over,
      });
    let { service } = makeService({
      pos_checks: [ok([unrated("a"), unrated("b")])],
    });
    const out: any = await service.getWaiterPerformance("r1", 90);
    expect(out.tipBasis).toBeNull();
    expect(out.tipBasisWhy).toMatch(/no tax rate of this house was in force/);
    expect(out.tipBasisWhy).not.toMatch(/till sends/);
    expect(out.tipsNetNotRecorded).toBe(2);
    expect(out.waiters[0].tipPctWhy).toMatch(/tax settings gave no tax rate/);

    ({ service } = makeService({
      pos_checks: [
        ok([usCheck({ id: "a" }), unrated("b", { server_name: "Ali" })]),
      ],
    }));
    const some: any = await service.getWaiterPerformance("r1", 90);
    expect(some.tipBasis).toBe("net");
    expect(some.tipBasisWhy).toMatch(/no tax rate of this house was in force/);
    expect(some.tipsNetNotRecorded).toBe(1);

    // A till that sent no subtotal at all is still the till's cause.
    ({ service } = makeService({
      pos_checks: [ok([usCheck({ id: "a", subtotal: null })])],
    }));
    const till: any = await service.getWaiterPerformance("r1", 90);
    expect(till.tipBasisWhy).toMatch(/no amount before tax/);
    expect(till.tipsNetNotRecorded).toBe(0);
  });

  it("no tip at all is still said as no tip, not as a missing subtotal", async () => {
    const { service } = makeService({
      pos_checks: [ok([usCheck({ id: "a", subtotal: null, tip: null })])],
    });
    const out: any = await service.getWaiterPerformance("r1", 90);
    expect(out.waiters[0].tipPctWhy).toBeNull();
    expect(out.tipBasisWhy).toBeNull();
  });

  it("reads the subtotal with the check", async () => {
    const { service, calls } = makeService({ pos_checks: [ok([usCheck()])] });
    await service.getWaiterPerformance("r1", 90);
    const select = calls.find(
      (c) => c.table === "pos_checks" && c.method === "select",
    );
    expect(String(select?.args[0])).toMatch(/\bsubtotal\b/);
    expect(String(select?.args[0])).toMatch(/\bgross_subtotal\b/);
    expect(String(select?.args[0])).toMatch(/\btax_basis\b/);
  });
});
