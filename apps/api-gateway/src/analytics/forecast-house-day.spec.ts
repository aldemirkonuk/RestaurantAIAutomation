import { AnalyticsService } from "./analytics.service";

/**
 * F-324: the /reports "What's coming" forecast is built on the house's days.
 * On UTC's, an LA evening's pours sat on tomorrow's bar and the projection
 * started the day after tomorrow. The instants are chosen so a server on UTC
 * and one on US Eastern both read a different date from the house.
 */

function makeClient(house: Record<string, unknown>, lines: any[]) {
  const passthrough = [
    "select",
    "eq",
    "is",
    "gte",
    "lt",
    "lte",
    "order",
    "range",
    "limit",
  ];
  return {
    from: jest.fn((table: string) => {
      const builder: any = {};
      for (const m of passthrough) builder[m] = jest.fn(() => builder);
      builder.maybeSingle = jest.fn(() =>
        Promise.resolve({
          data: table === "restaurants" ? house : null,
          error: null,
        }),
      );
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({
          data: table === "wine_consumption_log" ? lines : [],
          error: null,
          count: table === "wine_consumption_log" ? lines.length : 0,
        }).then(resolve, reject);
      return builder;
    }),
  };
}

const line = (created_at: string) => ({
  id: `line-${created_at}`,
  inventory_id: "inv-1",
  consumption_type: "bottle",
  quantity: 2,
  volume_ml: null,
  created_at,
  restaurant_inventory: { master_wine_id: "mw-1" },
});

const forecastFor = (house: Record<string, unknown>, lines: any[]) =>
  new AnalyticsService({
    getClient: () => makeClient(house, lines),
  } as any).getDemandForecast("rest-1", { horizon: 3 });

describe("the demand forecast runs on the house's days", () => {
  afterEach(() => jest.useRealTimers());

  it("an LA house at 23:30 Thursday files tonight's pours on Thursday and projects from Friday", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-09T06:30:00Z"));
    const out: any = await forecastFor(
      { timezone: "America/Los_Angeles", country: "US" },
      [line("2026-10-09T03:00:00Z")],
    );
    const { dates, values } = out.history;
    expect(dates[dates.length - 1]).toBe("2026-10-08");
    expect(values[values.length - 1]).toBe(2);
    expect(out.forecast.map((f: any) => f.date)).toEqual([
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
  });

  it("an Istanbul house at 01:30 Friday reads Friday as today", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-08T22:30:00Z"));
    const out: any = await forecastFor(
      { timezone: "Europe/Istanbul", country: "TR" },
      [line("2026-10-08T22:00:00Z")],
    );
    const { dates, values } = out.history;
    expect(dates[dates.length - 1]).toBe("2026-10-09");
    expect(values[values.length - 1]).toBe(2);
  });
});
