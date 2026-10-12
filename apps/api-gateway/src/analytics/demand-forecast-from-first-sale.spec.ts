import { AnalyticsService } from "./analytics.service";

/**
 * F-1533: "What's coming" was fitted on 120 zero-filled days ending today. A
 * house open 40 days handed Holt-Winters 80 days it never traded, and today's
 * count so far (0 before service) was the last day of history, where the
 * chart puts "projected from here". The series now starts at the house's
 * first recorded sale (F-1516's rule) and ends yesterday.
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

const line = (n: number, created_at: string, quantity = 2) => ({
  id: `line-${n}`,
  inventory_id: "inv-1",
  consumption_type: "bottle",
  quantity,
  volume_ml: null,
  created_at,
  restaurant_inventory: { master_wine_id: "mw-1" },
});

const NOW = new Date("2026-10-12T15:00:00Z"); // 18:00 in Istanbul
const TR = { timezone: "Europe/Istanbul", country: "TR" };

/** A pour at 20:00 Istanbul on each day from `from` through `to`. */
function nights(from: string, to: string) {
  const out: any[] = [];
  for (
    let t = Date.parse(`${from}T17:00:00Z`), n = 0;
    t <= Date.parse(`${to}T17:00:00Z`);
    t += 86400000, n++
  )
    out.push(line(n, new Date(t).toISOString()));
  return out;
}

const forecastFor = (house: Record<string, unknown>, lines: any[]) =>
  new AnalyticsService({
    getClient: () => makeClient(house, lines),
  } as any).getDemandForecast("rest-1", { horizon: 3 });

describe("F-1533 — the forecast is fitted on the days the house traded", () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it("a house open 40 days is fitted from its first recorded sale, not on 120 days of zeros", async () => {
    const out: any = await forecastFor(
      { ...TR, created_at: "2026-09-02T09:00:00Z" },
      // Its till began 2026-09-05; one pour today, before service is over.
      [...nights("2026-09-05", "2026-10-11"), line(999, "2026-10-12T10:00:00Z", 1)],
    );
    const { dates, values } = out.history;
    expect(dates[0]).toBe("2026-09-05");
    expect(dates).toHaveLength(37);
    expect(values.every((v: number) => v === 2)).toBe(true);
    expect(out.basis.demand).toMatch(/first recorded sale on 2026-09-05/);
  });

  it("ends the history yesterday and projects from today", async () => {
    const out: any = await forecastFor(
      { ...TR, created_at: "2025-01-01T09:00:00Z" },
      [...nights("2026-06-01", "2026-10-11"), line(999, "2026-10-12T10:00:00Z", 1)],
    );
    const { dates, values } = out.history;
    // A house older than the window keeps the whole window.
    expect(dates).toHaveLength(120);
    expect(dates[dates.length - 1]).toBe("2026-10-11");
    expect(values[values.length - 1]).toBe(2);
    expect(dates).not.toContain("2026-10-12");
    expect(out.forecast.map((f: any) => f.date)).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
    ]);
    expect(out.basis.demand).toMatch(/120 days through yesterday/);
    expect(out.basis.demand).not.toMatch(/first recorded sale/);
  });
});
