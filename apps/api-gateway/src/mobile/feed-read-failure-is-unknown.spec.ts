/**
 * F-542: each feed collector did `.catch(() => [])`, so a failed read built a
 * feed with `counts.total = 0`, `getTodayPulse` sent `pendingDecisions: 0`, and
 * the phone's Today strip said "All clear" with orders waiting. A failed
 * collector now fails the feed, and the pulse says the count is unknown (null).
 */
import { MobileService } from "./mobile.service";

function build(opts: { ordersFail?: boolean }) {
  const procurement = {
    listPendingOrders: jest.fn(() =>
      opts.ordersFail
        ? Promise.reject(new Error("orders read failed"))
        : Promise.resolve([]),
    ),
  };
  const conversations = {
    getPendingConversations: jest.fn().mockResolvedValue([]),
  };
  const notifications = {
    getUnreadNotifications: jest.fn().mockResolvedValue([]),
  };
  const db = {
    supabase: {
      from: () => ({
        select: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    },
  };
  return new MobileService(
    db as never,
    procurement as never,
    conversations as never,
    notifications as never,
  );
}

describe("mobile feed read failures (F-542)", () => {
  it("fails the feed instead of returning an empty one when a collector fails", async () => {
    await expect(
      build({ ordersFail: true }).getFeed("u-1", "r-1"),
    ).rejects.toThrow(/could not be read in full \(orders\)/);
  });

  it("sends an unknown decision count, not 0, to the Today strip", async () => {
    const pulse = await build({ ordersFail: true }).getTodayPulse("u-1", "r-1");

    expect(pulse.pendingDecisions).toBeNull();
    expect(pulse.criticalCount).toBeNull();
  });

  it("still sends a genuine zero when every collector answered", async () => {
    const pulse = await build({}).getTodayPulse("u-1", "r-1");

    expect(pulse.pendingDecisions).toBe(0);
    expect(pulse.criticalCount).toBe(0);
  });
});

/**
 * F-674: the phone's "Tonight $X · N checks" came from the orchestrator's
 * Toast route — one env-wide Toast location, wine lines only, the line count
 * printed as "checks", the phone's own midnight — and any failure became
 * "Connect Toast" even for a house whose register feeds `pos_checks`. The
 * pulse now reads `pos_checks` the way the web dashboard does: not voided,
 * net `subtotal`, filed on the house's day in its zone, and it says WHY a
 * figure is missing.
 */
type Row = Record<string, unknown>;

/** A chainable Supabase stand-in that applies eq/gte/lt/gt/limit. */
function fakeDb(tables: Record<string, Row[] | { error: string }>) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let cap = Infinity;
      const b: any = {
        select: () => b,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        gte: (c: string, v: string) => (
          filters.push((r) => String(r[c]) >= v),
          b
        ),
        lt: (c: string, v: string) => (
          filters.push((r) => String(r[c]) < v),
          b
        ),
        gt: (c: string, v: string) => (
          filters.push((r) => String(r[c]) > v),
          b
        ),
        in: () => b,
        order: () => b,
        limit: (n: number) => ((cap = n), b),
        then(resolve: (v: unknown) => void) {
          const t = tables[table] ?? [];
          if (!Array.isArray(t))
            return resolve({ data: null, error: { message: t.error } });
          const data = t
            .filter((r) => filters.every((f) => f(r)))
            .slice(0, cap);
          resolve({ data, error: null });
        },
      };
      return b;
    },
  };
}

function buildWithDb(tables: Record<string, Row[] | { error: string }>) {
  const empty = { getPendingConversations: jest.fn().mockResolvedValue([]) };
  return new MobileService(
    { supabase: fakeDb(tables) } as never,
    { listPendingOrders: jest.fn().mockResolvedValue([]) } as never,
    empty as never,
    { getUnreadNotifications: jest.fn().mockResolvedValue([]) } as never,
  );
}

const HOUSE = { id: "r-1", timezone: "America/New_York", country: "US" };
// 19:00 on 2026-10-09 in New York.
const NOW = new Date("2026-10-09T23:00:00Z");

function check(
  id: string,
  closedAt: string,
  subtotal: number,
  voided = false,
): Row {
  const opened = new Date(
    new Date(closedAt).getTime() - 3_600_000,
  ).toISOString();
  return {
    id,
    restaurant_id: "r-1",
    voided,
    subtotal,
    opened_at: opened,
    closed_at: closedAt,
  };
}

describe("today pulse reads the house's register (F-674)", () => {
  it("sums tonight's checks on the house day and compares the same stretch last week", async () => {
    const pulse = await buildWithDb({
      restaurants: [HOUSE],
      pos_checks: [
        check("a", "2026-10-09T21:00:00.000Z", 100), // 17:00 tonight
        check("b", "2026-10-09T22:30:00.000Z", 50), // 18:30 tonight
        check("v", "2026-10-09T22:00:00.000Z", 999, true), // voided
        check("y", "2026-10-09T03:30:00.000Z", 70), // 23:30 last night
        check("w1", "2026-10-02T22:00:00.000Z", 120), // 18:00 a week ago
        check("w2", "2026-10-03T01:00:00.000Z", 80), // 21:00 a week ago, after now's hour
      ],
    }).getTodayPulse("u-1", "r-1", NOW);

    expect(pulse.salesState).toBe("known");
    expect(pulse.revenueToday).toBe(150);
    expect(pulse.checksToday).toBe(2);
    expect(pulse.revenueLastWeek).toBe(120);
    expect(pulse.deltaPct).toBe(25);
    expect(pulse.windowStart).toBe("2026-10-09T04:00:00.000Z");
  });

  it("says a connected register's quiet night is a real zero", async () => {
    const pulse = await buildWithDb({
      restaurants: [HOUSE],
      pos_checks: [check("old", "2026-09-01T22:00:00.000Z", 40)],
    }).getTodayPulse("u-1", "r-1", NOW);

    expect(pulse.salesState).toBe("known");
    expect(pulse.revenueToday).toBe(0);
    expect(pulse.checksToday).toBe(0);
  });

  it("says no register when the house has never sent a check", async () => {
    const pulse = await buildWithDb({
      restaurants: [HOUSE],
      pos_checks: [],
    }).getTodayPulse("u-1", "r-1", NOW);

    expect(pulse.salesState).toBe("no_register");
    expect(pulse.revenueToday).toBeNull();
  });

  it("says the read failed, not 'no register', when pos_checks cannot be read", async () => {
    const pulse = await buildWithDb({
      restaurants: [HOUSE],
      pos_checks: { error: "timeout" },
    }).getTodayPulse("u-1", "r-1", NOW);

    expect(pulse.salesState).toBe("unread");
    expect(pulse.revenueToday).toBeNull();
    expect(pulse.checksToday).toBeNull();
    // The decision count is a separate fact and still arrives.
    expect(pulse.pendingDecisions).toBe(0);
  });

  it("has no tonight for a house with no time zone", async () => {
    const pulse = await buildWithDb({
      restaurants: [{ id: "r-1", timezone: null, country: null }],
      pos_checks: [check("a", "2026-10-09T21:00:00.000Z", 100)],
    }).getTodayPulse("u-1", "r-1", NOW);

    expect(pulse.salesState).toBe("zone_unset");
    expect(pulse.revenueToday).toBeNull();
    expect(pulse.windowStart).toBeNull();
  });
});

/**
 * F-885: the phone printed "$" with en-US grouping on every money figure. The
 * pulse now carries the house's money and formats tag, which the phone's
 * strip, Insights, cellar and orders format through.
 */
describe("today pulse carries the house's money (F-885)", () => {
  it("sends a lira house's currency and its formats tag", async () => {
    const pulse = await buildWithDb({
      restaurants: [
        {
          id: "r-1",
          timezone: "Europe/Istanbul",
          country: "TR",
          currency: "TRY",
        },
      ],
      pos_checks: [],
    }).getTodayPulse("u-1", "r-1", NOW);

    expect(pulse.currency).toBe("TRY");
    expect(pulse.locale).toBe("tr-TR");
  });

  it("sends null, never USD, for a house with no recorded currency", async () => {
    const pulse = await buildWithDb({
      restaurants: [{ ...HOUSE, currency: null }],
      pos_checks: [],
    }).getTodayPulse("u-1", "r-1", NOW);

    expect(pulse.currency).toBeNull();
  });
});
