/**
 * The analytics vendor scorecard reads the same on-time rule as the operational
 * scorecard — ADR 0207 (founder, 2026-09-21: question 6 "House's local
 * midnight"; question 8 "count it as late, because that will help us feed to
 * the analytics for better results").
 *
 * The real `AdvancedAnalyticsService.getVendorScorecard` runs over an
 * in-memory client that honours the filters it is handed; only the database is
 * stood in for.
 */

import { AdvancedAnalyticsService } from "./advanced-analytics.service";

const HOUSE = "house-1";
const OTHER = "house-2";
const NOW = new Date("2026-09-17T12:00:00Z");

type Row = Record<string, any>;

function client(tables: Record<string, Row[]>, failing = new Set<string>()) {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        gte: (c: string, v: string) => (
          filters.push((r) => r[c] != null && r[c] >= v),
          q
        ),
        in: (c: string, vs: unknown[]) => (
          filters.push((r) => vs.includes(r[c])),
          q
        ),
        maybeSingle: () =>
          Promise.resolve({
            data:
              (tables[table] ?? []).filter((r) =>
                filters.every((f) => f(r)),
              )[0] ?? null,
            error: null,
          }),
        then: (res: any, rej: any) =>
          Promise.resolve(
            failing.has(table)
              ? { data: null, error: { code: "57014", message: "timeout" } }
              : {
                  data: (tables[table] ?? []).filter((r) =>
                    filters.every((f) => f(r)),
                  ),
                  error: null,
                },
          ).then(res, rej),
      };
      return q;
    },
  };
}

function order(over: Row): Row {
  return {
    restaurant_id: HOUSE,
    provider_id: "v1",
    providers: { name: "Skurnik" },
    total_cost: 100,
    final_price: 100,
    bottles_total: 10,
    quantity: 10,
    created_at: "2026-09-01T08:00:00Z",
    ...over,
  };
}

function service(
  restaurants: Row[],
  orders: Row[],
  answers: Row[] = [],
  failing = new Set<string>(),
) {
  const db = client(
    {
      restaurants,
      procurement_orders: orders,
      procurement_order_arrival_answers: answers,
    },
    failing,
  );
  return new AdvancedAnalyticsService(
    { getClient: () => db } as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

describe("getVendorScorecard reads the one on-time rule", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const orders = [
    // 01:30 on the 11th in Istanbul: late there, on time under the old UTC rule.
    order({
      id: "o1",
      status: "DELIVERED",
      expected_delivery_date: "2026-09-10",
      delivered_at: "2026-09-10T22:30:00Z",
    }),
    order({
      id: "o2",
      status: "DELIVERED",
      expected_delivery_date: "2026-09-10",
      delivered_at: "2026-09-10T09:00:00Z",
    }),
    // Out with the vendor, a week past its date: late (question 8).
    order({
      id: "o3",
      status: "CONFIRMED",
      expected_delivery_date: "2026-09-09",
      delivered_at: null,
    }),
    // Due tomorrow: not late yet.
    order({
      id: "o4",
      status: "IN_TRANSIT",
      expected_delivery_date: "2026-09-18",
      delivered_at: null,
    }),
  ];

  const istanbulHouses = [
    { id: OTHER, timezone: "America/Los_Angeles", country: "US" },
    { id: HOUSE, timezone: "Europe/Istanbul", country: "Türkiye" },
  ];
  const notYet = (house: string) => ({
    restaurant_id: house,
    order_id: "o3",
    answer: "not_yet",
    expected_date: "2026-09-09",
    answered_at: "2026-09-11T09:00:00Z",
  });

  it("counts an Istanbul house's late landing as late, and its order still out as unconfirmed until someone answers", async () => {
    // Another house's answer for this house's order is not this house's.
    const svc = service(istanbulHouses, orders, [notYet(OTHER)]);
    const out: any = await svc.getVendorScorecard(HOUSE);
    expect(out.onTimeDeadline).toEqual({
      zone: "Europe/Istanbul",
      zoneSource: "house",
      houseRecord: "read",
      arrivalAnswers: "read",
    });
    expect(out.vendors[0].onTimeCounts).toEqual({
      onTime: 1,
      late: 1,
      overdue: 0,
      unconfirmed: 1,
      incomplete: 0,
      unread: 0,
      undecided: 0,
    });
    expect(out.vendors[0].onTimeRate).toBeCloseTo(1 / 2);
  });

  it("counts the order still out as late once this house answered Not yet (question 8, confirmed)", async () => {
    const svc = service(istanbulHouses, orders, [notYet(HOUSE)]);
    const out: any = await svc.getVendorScorecard(HOUSE);
    expect(out.vendors[0].onTimeCounts).toMatchObject({
      onTime: 1,
      late: 2,
      overdue: 1,
      unconfirmed: 0,
    });
    expect(out.vendors[0].onTimeRate).toBeCloseTo(1 / 3);
  });

  it("keeps an order past its date outside the rate, as unread, when the answers cannot be read — never guessed late", async () => {
    const svc = service(
      istanbulHouses,
      orders,
      [notYet(HOUSE)],
      new Set(["procurement_order_arrival_answers"]),
    );
    const out: any = await svc.getVendorScorecard(HOUSE);
    expect(out.onTimeDeadline.arrivalAnswers).toBe("could_not_read");
    expect(out.vendors[0].onTimeCounts).toMatchObject({
      late: 1,
      unread: 1,
      overdue: 0,
    });
    expect(out.vendors[0].onTimeRate).toBeCloseTo(1 / 2);
  });

  it("with no zone for the house, counts only what holds in every zone — never a UTC default", async () => {
    const svc = service(
      [{ id: HOUSE, timezone: null, country: "United States" }],
      orders,
      [notYet(HOUSE)],
    );
    const out: any = await svc.getVendorScorecard(HOUSE);
    expect(out.onTimeDeadline.zone).toBeNull();
    // o1 landed 22:30Z on the 10th: before midnight in some zones, after it in
    // others — undecided. o2 at 09:00Z is before midnight everywhere.
    expect(out.vendors[0].onTimeCounts).toMatchObject({
      onTime: 1,
      late: 1,
      overdue: 1,
      undecided: 1,
    });
    expect(out.vendors[0].onTimeRate).toBeCloseTo(1 / 2);
  });
});
