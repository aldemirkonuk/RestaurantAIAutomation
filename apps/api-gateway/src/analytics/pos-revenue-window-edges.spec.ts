/**
 * DD-r106-2 (approved, money): the till window loses no check at its edges.
 *
 * r106 returned this as "stale" on the strength of a 24 h lookback (ADR 0296,
 * `houseDayBounds().readFromIso`, `fileByHouseDay`) and added no pin. The cases
 * in pos-revenue.spec.ts hand the fold rows an UNFILTERED stub, so they never
 * test the read's own bounds. Here `pos_checks` honours `eq`, `gte`, `lte`,
 * `gt`, `order` and `limit` the way PostgREST does, so a check that the read
 * would not return is a check the fold never sees.
 *
 * Tests marked [REVERT-FAILS] fail against a read whose lower edge is the
 * window's first midnight (the lookback removed).
 */
import { GoalsService } from "./goals.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { DatabaseService } from "../database/database.service";

const LA = "America/Los_Angeles";
let nextId = 0;

interface Check {
  id: string;
  restaurant_id: string;
  total: number;
  opened_at: string;
  closed_at: string | null;
  voided: boolean;
  items: [];
}

const check = (
  total: number,
  opened_at: string,
  closed_at: string | null,
  voided = false,
): Check => ({
  id: `c${String(++nextId).padStart(6, "0")}`,
  restaurant_id: "r1",
  total,
  opened_at,
  closed_at,
  voided,
  items: [],
});

function makeService(checks: Check[], zone = LA) {
  const client = {
    from: (table: string) => {
      const filters: Array<(r: any) => boolean> = [];
      let limit = Infinity;
      const b: any = {};
      const add = (f: (r: any) => boolean) => (b._f = [...(b._f ?? []), f]);
      b.select = () => b;
      b.eq = (c: string, v: unknown) => (add((r) => r[c] === v), b);
      b.gte = (c: string, v: string) => (add((r) => r[c] >= v), b);
      b.lte = (c: string, v: string) => (add((r) => r[c] <= v), b);
      b.gt = (c: string, v: string) => (add((r) => r[c] > v), b);
      b.order = () => b;
      b.limit = (n: number) => ((limit = n), b);
      const rows = () => {
        if (table === "restaurants") return [{ timezone: zone, country: "US" }];
        const kept = checks
          .filter((r) => (b._f ?? filters).every((f: any) => f(r)))
          .sort((a, c) => (a.id < c.id ? -1 : 1));
        return kept.slice(0, limit);
      };
      const all = () =>
        table === "restaurants"
          ? 1
          : checks.filter((r) => (b._f ?? []).every((f: any) => f(r))).length;
      b.single = b.maybeSingle = () =>
        Promise.resolve({ data: rows()[0] ?? null, error: null });
      b.then = (res: any, rej: any) =>
        Promise.resolve({ data: rows(), error: null, count: all() }).then(res, rej);
      return b;
    },
  };
  const db = { getClient: () => client } as unknown as DatabaseService;
  return new GoalsService(
    db,
    { getStored: async () => [] } as unknown as InsightGeneratorService,
    { get: () => undefined } as never,
    {} as never,
    { record: () => {}, recordForEvent: () => {} } as any,
    { getFinancialSummary: async () => ({}) } as any,
  );
}

const seriesOf = (r: { dailySeries: Array<{ date: string; revenue: number }> }) =>
  Object.fromEntries(r.dailySeries.map((d) => [d.date, d.revenue]));

const at = (iso: string) => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(iso));
};

describe("the till window at its edges (DD-r106-2)", () => {
  beforeEach(() => {
    nextId = 0;
  });
  afterEach(() => jest.useRealTimers());

  describe("first day", () => {
    // 03:00 UTC Sep 2 is 20:00 Sep 1 in Los Angeles; 7 days open on Aug 26.
    beforeEach(() => at("2026-09-02T03:00:00.000Z"));

    it("[REVERT-FAILS] an overnight check opened the night before is filed on the first day", async () => {
      // Opened 23:50 PDT Aug 25, closed 00:20 PDT Aug 26.
      const overnight = check(80, "2026-08-26T06:50:00Z", "2026-08-26T07:20:00Z");
      // Opened and closed on Aug 25: not the window's.
      const before = check(900, "2026-08-26T06:40:00Z", "2026-08-26T06:59:00Z");
      const w = await makeService([overnight, before]).getPosRevenueWindow("r1", 7);
      expect(w.from).toBe("2026-08-26");
      expect(seriesOf(w)).toEqual({ "2026-08-26": 80 });
      expect(w.checkCount).toBe(1);
    });

    it("[REVERT-FAILS] a check opened exactly at the lookback edge is read", async () => {
      // localMidnight(Aug 26, LA) = 07:00Z; the read opens 24 h earlier.
      const onEdge = check(10, "2026-08-25T07:00:00.000Z", "2026-08-26T07:10:00Z");
      const w = await makeService([onEdge]).getPosRevenueWindow("r1", 7);
      expect(seriesOf(w)).toEqual({ "2026-08-26": 10 });
    });

    it("an open check (no close yet) is filed on its opening day", async () => {
      const open = check(40, "2026-08-27T01:00:00Z", null);
      const w = await makeService([open]).getPosRevenueWindow("r1", 7);
      expect(seriesOf(w)).toEqual({ "2026-08-26": 40 });
    });
  });

  describe("last day and the window beside it", () => {
    beforeEach(() => at("2026-09-02T03:00:00.000Z"));

    it("[REVERT-FAILS] a check opened on the prior window's last day that closes after it is the window's, once", async () => {
      // 3 days = Aug 30..Sep 1, prior = Aug 27..29. Opened 23:50 PDT Aug 29,
      // closed 00:20 PDT Aug 30: it is read by the prior window's own opened_at
      // bound, filed by its close on Aug 30.
      const crossing = check(60, "2026-08-30T06:50:00Z", "2026-08-30T07:20:00Z");
      const inPrior = check(30, "2026-08-29T01:00:00Z", "2026-08-29T02:00:00Z");
      const inMain = check(20, "2026-08-31T20:00:00Z", "2026-08-31T21:00:00Z");
      const w = await makeService([crossing, inPrior, inMain]).getPosRevenueWindow(
        "r1",
        3,
        "prior",
      );
      expect(seriesOf(w)).toEqual({ "2026-08-30": 60, "2026-08-31": 20 });
      expect(w.checkCount).toBe(2);
      expect(w.prior?.to).toBe("2026-08-29");
      expect(seriesOf(w.prior as never)).toEqual({ "2026-08-28": 30 });
      expect(w.prior?.checkCount).toBe(1);
      // No check is lost or counted twice across the two windows.
      expect((w.checkCount ?? 0) + (w.prior?.checkCount ?? 0)).toBe(3);
    });

    it("a check that closes after the window's last day is dropped by the fold", async () => {
      // Opened 23:50 PDT Sep 1 (still to come on the pinned clock's day),
      // closed 00:20 Sep 2: filed on Sep 2, outside a window that ends Sep 1.
      const late = check(70, "2026-09-02T06:50:00Z", "2026-09-02T07:20:00Z");
      const w = await makeService([late]).getPosRevenueWindow("r1", 7);
      expect(w.checkCount).toBe(0);
      expect(w.dailySeries).toEqual([]);
    });
  });

  describe("voided checks", () => {
    beforeEach(() => at("2026-09-02T03:00:00.000Z"));

    it("[REVERT-FAILS] a voided check is no revenue, overnight or not", async () => {
      const kept = check(50, "2026-08-27T18:00:00Z", "2026-08-27T19:00:00Z");
      const voided = check(500, "2026-08-27T20:00:00Z", "2026-08-27T21:00:00Z", true);
      const voidedOvernight = check(700, "2026-08-26T06:50:00Z", "2026-08-26T07:20:00Z", true);
      const w = await makeService([kept, voided, voidedOvernight]).getPosRevenueWindow("r1", 7);
      expect(w.revenue).toBe(50);
      expect(w.checkCount).toBe(1);
    });
  });

  describe("a DST day (Los Angeles)", () => {
    it("[REVERT-FAILS] the 25-hour fall-back day holds its checks, and the overnight into the day after it", async () => {
      at("2026-11-03T04:00:00.000Z"); // 20:00 PST Nov 2
      const fromPriorNight = check(10, "2026-11-01T06:50:00Z", "2026-11-01T07:20:00Z"); // 23:50 PDT Oct 31 -> 00:20 PDT Nov 1
      const firstHour = check(20, "2026-11-01T07:30:00Z", "2026-11-01T09:30:00Z"); // 00:30 PDT -> 01:30 PST (second 1 a.m.)
      const lateNov1 = check(30, "2026-11-01T20:00:00Z", "2026-11-01T21:00:00Z");
      const intoNov2 = check(40, "2026-11-02T07:50:00Z", "2026-11-02T08:20:00Z"); // 23:50 PST Nov 1 -> 00:20 PST Nov 2
      const svc = makeService([fromPriorNight, firstHour, lateNov1, intoNov2]);
      const two = await svc.getPosRevenueWindow("r1", 2);
      expect(two.from).toBe("2026-11-01");
      expect(seriesOf(two)).toEqual({ "2026-11-01": 60, "2026-11-02": 40 });
      expect(two.checkCount).toBe(4);
      // The day after the long day, alone: its overnight opener is still read.
      const one = await svc.getPosRevenueWindow("r1", 1);
      expect(seriesOf(one)).toEqual({ "2026-11-02": 40 });
    });

    it("[REVERT-FAILS] the 23-hour spring-forward day files its overnight on the day it closed", async () => {
      at("2026-03-10T04:00:00.000Z"); // 21:00 PDT Mar 9
      const intoMar8 = check(11, "2026-03-08T07:50:00Z", "2026-03-08T08:20:00Z"); // 23:50 PST Mar 7 -> 00:20 PST Mar 8
      const intoMar9 = check(22, "2026-03-09T06:50:00Z", "2026-03-09T07:20:00Z"); // 23:50 PDT Mar 8 -> 00:20 PDT Mar 9
      const svc = makeService([intoMar8, intoMar9]);
      const two = await svc.getPosRevenueWindow("r1", 2);
      expect(seriesOf(two)).toEqual({ "2026-03-08": 11, "2026-03-09": 22 });
      const one = await svc.getPosRevenueWindow("r1", 1);
      expect(seriesOf(one)).toEqual({ "2026-03-09": 22 });
    });
  });
});
