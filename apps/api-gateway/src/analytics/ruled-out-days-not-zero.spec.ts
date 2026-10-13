import { AnalyticsService } from "./analytics.service";
import * as E from "./engine";

/**
 * F-1575 (sim 49, owner-first-quarter-analytics): a day an owner ruled out
 * of the baselines (`analytics_day_exclusions`, ADR 0317) — here a till
 * outage on 2026-10-07 — was still zero-filled by the forecast, the reorder
 * demand and the risk series, so the outage was fitted as a day that sold
 * nothing. The seasonality lens and the dashboard already left it out.
 *
 * The clock is 2026-10-10 12:00 in Istanbul. One bottle a night, every night
 * from 2026-06-01 to 2026-10-09, except the ruled-out 2026-10-07.
 */

const NOW = new Date("2026-10-10T09:00:00.000Z");
const OUTAGE = "2026-10-07";

function pours() {
  const out: any[] = [];
  for (
    let t = Date.parse("2026-06-01T17:00:00Z"), n = 0;
    t <= Date.parse("2026-10-09T17:00:00Z");
    t += 86400000, n++
  ) {
    const at = new Date(t).toISOString();
    if (at.startsWith(OUTAGE)) continue;
    out.push({
      id: `c${n}`,
      inventory_id: "inv-1",
      consumption_type: "bottle",
      quantity: 1,
      volume_ml: 750,
      created_at: at,
      restaurant_inventory: { master_wine_id: "m-1", bottle_size_ml: 750 },
    });
  }
  return out;
}

function client(exclusions: { data: any; error: any }) {
  const rows = pours();
  return {
    from: (table: string) => {
      const b: any = new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === "maybeSingle")
              return async () => ({
                data:
                  table === "restaurants"
                    ? {
                        timezone: "Europe/Istanbul",
                        country: "TR",
                        created_at: "2025-01-01T09:00:00Z",
                      }
                    : null,
                error: null,
              });
            if (prop === "then")
              return (resolve: any, reject: any) =>
                Promise.resolve(
                  table === "analytics_day_exclusions"
                    ? exclusions
                    : {
                        data: table === "wine_consumption_log" ? rows : [],
                        error: null,
                      },
                ).then(resolve, reject);
            return () => b;
          },
        },
      );
      return b;
    },
  };
}

function analytics(
  exclusions: { data: unknown; error: unknown } = {
    data: [{ business_date: OUTAGE }],
    error: null,
  },
) {
  const db = client(exclusions);
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
  return service;
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

describe("a day ruled out of the baselines is not fitted as zero (F-1575)", () => {
  it("the forecast leaves it out of its history and says so", async () => {
    const out: any = await analytics().getDemandForecast("r1", { horizon: 3 });
    const { dates, values } = out.history;
    expect(dates).not.toContain(OUTAGE);
    expect(values.every((v: number) => v === 1)).toBe(true);
    expect(out.basis.demand).toMatch(
      /1 day ruled out of the figures left out \(2026-10-07\)/,
    );
  });

  it("the reorder demand is over the days that traded, not the outage as a 0", async () => {
    const out: any = await analytics().getInventoryScience("r1");
    const sku = out.skus.find((s: any) => s.id === "inv-1");
    // 90 days through today (today is 0 so far, as before): 88 bottles over
    // the 89 days left once the outage is out, never over 90.
    expect(sku.avgDailyDemand).toBeCloseTo(88 / 89, 9);
    expect(sku.demandDays).toBe(89);
    expect(out.basis.demand).toMatch(/ruled out of the figures left out/);
  });

  it("the risk series leaves it out too, so it is no -100% day", async () => {
    const service = analytics();
    const series = jest.spyOn(service as any, "toDailySeries");
    const vol = jest.spyOn(E.risk, "volatility");
    const out: any = await service.getRiskProfile("r1");
    // F-1579: 89 days give 88 day-to-day changes, less the one that would
    // run across the outage from 2026-10-06 to 2026-10-08.
    expect(vol.mock.calls[0][0]).toHaveLength(87);
    expect(out.basis.demand).toMatch(/no day-to-day change is taken across it/);
    const { dates, values } = series.mock.results[0].value as any;
    expect(dates).not.toContain(OUTAGE);
    expect(dates).toHaveLength(89);
    // Every day through yesterday sold its bottle; only today is 0 so far.
    expect(values.slice(0, -1).every((v: number) => v === 1)).toBe(true);
    expect(out.basis.demand).toMatch(/ruled out of the figures left out/);
  });

  it("an unread list is said, never passed off as no day ruled out", async () => {
    const out: any = await analytics({
      data: null,
      error: { message: "boom" },
    }).getDemandForecast("r1", { horizon: 3 });
    expect(out.basis.demand).toMatch(
      /days ruled out of the figures could not be read/,
    );
  });
});
