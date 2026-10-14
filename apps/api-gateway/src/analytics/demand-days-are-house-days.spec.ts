import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";

/**
 * F-928 (wave-35 sim, a rehit of F-324): the forecast moved to house days,
 * but /reports' reorder register (`getInventoryScience`), the risk lens
 * (`getRiskProfile`) and Wine-360 still built demand on UTC days. In a Los
 * Angeles house, a 13:00 pour and a 19:00 pour on the same evening landed on
 * two different days, and "today" ran a day ahead of the house's.
 *
 * The clock is 2026-10-10 03:00 UTC = 2026-10-09 20:00 in Los Angeles. Two
 * bottles poured on the house's 2026-10-08: 13:00 and 19:00 local.
 */

const NOW = new Date("2026-10-10T03:00:00.000Z");
const POURS = ["2026-10-08T20:00:00.000Z", "2026-10-09T02:00:00.000Z"];

/** A client that answers the house row and the consumption read. */
function client(timezone: string | null) {
  const rows = POURS.map((at, i) => ({
    id: `c${i}`,
    inventory_id: "inv-1",
    consumption_type: "bottle",
    quantity: 1,
    volume_ml: 750,
    created_at: at,
    restaurant_inventory: { master_wine_id: "m-1", bottle_size_ml: 750 },
  }));
  return {
    from: (table: string) => {
      const b: any = new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === "maybeSingle")
              return async () => ({
                data:
                  table === "restaurants" ? { timezone, country: null } : null,
                error: null,
              });
            if (prop === "then")
              return (resolve: any, reject: any) =>
                Promise.resolve({
                  data: table === "wine_consumption_log" ? rows : [],
                  error: null,
                }).then(resolve, reject);
            return () => b;
          },
        },
      );
      return b;
    },
  };
}

function analytics(timezone: string | null) {
  const db = client(timezone);
  const service = new AnalyticsService({ getClient: () => db } as any);
  jest.spyOn(service as any, "loadInventory").mockResolvedValue([
    {
      id: "inv-1",
      name: "SYNTHETIC Öküzgözü",
      type: "red",
      qty: 6,
      unitCost: 10,
      costBasis: "invoiced_lot",
      unitPrice: 30,
      thresholdMin: 0,
      reorderPoint: 0,
      masterWineId: "m-1",
      listedAt: null,
      inventoryValue: 60,
    },
  ]);
  jest.spyOn(service as any, "loadDeliveredOrders").mockResolvedValue([]);
  return { service, db };
}

/** The last two days of the series a lens built, with their dates. */
function lastTwo(series: { dates: string[]; values: number[] }) {
  const n = series.values.length;
  return {
    dates: series.dates.slice(n - 2),
    values: series.values.slice(n - 2),
  };
}

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      "nextTick",
      "setImmediate",
      "setTimeout",
      "setInterval",
      "queueMicrotask",
    ],
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("demand is filed on the house's days (F-928)", () => {
  it("the reorder register puts one evening's two pours on one day, ending on the house's yesterday (F-1647)", async () => {
    const { service } = analytics("America/Los_Angeles");
    const series = jest.spyOn(service as any, "toDailySeries");
    await service.getInventoryScience("r1");
    expect(lastTwo(series.mock.results[0].value as any)).toEqual({
      dates: ["2026-10-07", "2026-10-08"],
      values: [0, 2],
    });
    const { values } = series.mock.results[0].value as any;
    expect(values.filter((v: number) => v > 0)).toEqual([2]);
  });

  it("the risk lens does too", async () => {
    const { service } = analytics("America/Los_Angeles");
    const series = jest.spyOn(service as any, "toDailySeries");
    await service.getRiskProfile("r1");
    const { dates, values } = series.mock.results[0].value as any;
    expect(dates[dates.length - 1]).toBe("2026-10-09");
    expect(values.filter((v: number) => v > 0)).toEqual([2]);
    expect(values[dates.indexOf("2026-10-08")]).toBe(2);
  });

  it("Wine-360 does too, ending on the house's yesterday", async () => {
    const { service: analyticsService, db } = analytics("America/Los_Angeles");
    jest
      .spyOn(analyticsService, "getDemandForecast")
      .mockResolvedValue({} as any);
    const advanced = new AdvancedAnalyticsService(
      { getClient: () => db, supabase: db } as any,
      analyticsService,
      {} as any,
      {} as any,
    );
    jest.spyOn(advanced as any, "loadInventoryWithCost").mockResolvedValue([]);
    const daily = jest.spyOn(advanced as any, "toDaily");
    await advanced.getWine360("r1", "m-1");
    const values = daily.mock.results[0].value as number[];
    expect(values.filter((v) => v > 0)).toEqual([2]);
    // The series ends at yesterday: the house's 2026-10-08, not UTC's 10-09.
    expect(values[values.length - 1]).toBe(2);
  });

  it("control: a house with no zone keeps UTC's days, as before", async () => {
    const { service } = analytics(null);
    const series = jest.spyOn(service as any, "toDailySeries");
    await service.getInventoryScience("r1");
    // Ending on UTC's yesterday (F-1647), as the house's does.
    expect(lastTwo(series.mock.results[0].value as any)).toEqual({
      dates: ["2026-10-08", "2026-10-09"],
      values: [1, 1],
    });
  });
});
