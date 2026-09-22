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

function client(tables: Record<string, Row[]>) {
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
        maybeSingle: () =>
          Promise.resolve({
            data:
              (tables[table] ?? []).filter((r) =>
                filters.every((f) => f(r)),
              )[0] ?? null,
            error: null,
          }),
        then: (res: any, rej: any) =>
          Promise.resolve({
            data: (tables[table] ?? []).filter((r) =>
              filters.every((f) => f(r)),
            ),
            error: null,
          }).then(res, rej),
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

function service(restaurants: Row[], orders: Row[]) {
  const db = client({ restaurants, procurement_orders: orders });
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

  it("counts an Istanbul house's late landing and its order still out as late", async () => {
    const svc = service(
      [
        { id: OTHER, timezone: "America/Los_Angeles", country: "US" },
        { id: HOUSE, timezone: "Europe/Istanbul", country: "Türkiye" },
      ],
      orders,
    );
    const out: any = await svc.getVendorScorecard(HOUSE);
    expect(out.onTimeDeadline).toEqual({
      zone: "Europe/Istanbul",
      zoneSource: "house",
      houseRecord: "read",
    });
    expect(out.vendors[0].onTimeCounts).toEqual({
      onTime: 1,
      late: 2,
      overdue: 1,
      undecided: 0,
    });
    expect(out.vendors[0].onTimeRate).toBeCloseTo(1 / 3);
  });

  it("with no zone for the house, counts only what holds in every zone — never a UTC default", async () => {
    const svc = service(
      [{ id: HOUSE, timezone: null, country: "United States" }],
      orders,
    );
    const out: any = await svc.getVendorScorecard(HOUSE);
    expect(out.onTimeDeadline.zone).toBeNull();
    // o1 landed 22:30Z on the 10th: before midnight in some zones, after it in
    // others — undecided. o2 at 09:00Z is before midnight everywhere.
    expect(out.vendors[0].onTimeCounts).toEqual({
      onTime: 1,
      late: 1,
      overdue: 1,
      undecided: 1,
    });
    expect(out.vendors[0].onTimeRate).toBeCloseTo(1 / 2);
  });
});
