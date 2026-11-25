import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import {
  CONSUMPTION_MEMO_MS,
  readConsumptionRows,
} from "./consumption-read-shared";

/**
 * /reports used to read the same wine_consumption_log window up to five times
 * per load (a whole-window paged read, an exact count and an inventory join,
 * once per register). These pin that one house + window is read ONCE across
 * the lenses, that houses never share, and that a refusal is never kept.
 */

const R1 = "33333333-3333-3333-3333-333333333333";
const R2 = "44444444-4444-4444-4444-444444444444";

const line = (i: number) => ({
  id: `c-${String(i).padStart(3, "0")}`,
  inventory_id: "inv-1",
  consumption_type: "bottle",
  quantity: 1,
  volume_ml: null,
  created_at: new Date(Date.now() - i * 86400000).toISOString(),
  restaurant_inventory: { master_wine_id: "mw-1" },
});

function makeClient(opts: { failConsumption?: () => boolean } = {}) {
  const reads: Array<{ house: string | null; days: number | null }> = [];
  const passthrough = ["select", "neq", "gt", "lt", "lte", "is", "or", "not", "order", "limit", "in"];
  const client = {
    reads,
    from: jest.fn((table: string) => {
      const builder: any = {};
      let house: string | null = null;
      let days: number | null = null;
      for (const m of passthrough) builder[m] = jest.fn(() => builder);
      builder.eq = jest.fn((col: string, v: string) => {
        if (col === "restaurant_id") house = v;
        return builder;
      });
      builder.gte = jest.fn((col: string, v: string) => {
        if (col === "created_at")
          days = Math.round((Date.now() - Date.parse(v)) / 86400000);
        return builder;
      });
      builder.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
      builder.then = (resolve: any, reject: any) => {
        if (table === "wine_consumption_log") {
          reads.push({ house, days });
          if (opts.failConsumption?.())
            return Promise.resolve({
              data: null,
              error: { code: "57014", message: "statement timeout" },
            }).then(resolve, reject);
          return Promise.resolve({
            data: Array.from({ length: 20 }, (_, i) => line(i)),
            error: null,
          }).then(resolve, reject);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      };
      return builder;
    }),
  };
  return client;
}

const analyticsOver = (client: any) =>
  new AnalyticsService({ getClient: () => client } as any);
const advancedOver = (client: any) =>
  new AdvancedAnalyticsService(
    { getClient: () => client } as any,
    { getDemandForecast: async () => ({}) } as any,
    {} as any,
    {} as any,
  );

describe("one consumption read per house and window across the analytics lenses", () => {
  it("reads wine_consumption_log once per window for menu engineering, seasonality, financial, science, risk and forecast", async () => {
    const client = makeClient();
    const analytics = analyticsOver(client);
    const advanced = advancedOver(client);

    await Promise.allSettled([
      advanced.getMenuEngineering(R1),
      advanced.getSeasonality(R1),
      analytics.getFinancialSummary(R1),
      analytics.getInventoryScience(R1),
      analytics.getRiskProfile(R1),
      analytics.getDemandForecast(R1),
    ]);

    // Two windows are asked for (the 90-day lenses and the forecast's own 120),
    // and each is read once, not once per lens.
    expect(client.reads.map((r) => r.days).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([90, 120]);
    expect(client.reads.every((r) => r.house === R1)).toBe(true);
  });

  it("never reuses one house's rows for another", async () => {
    const client = makeClient();
    const advanced = advancedOver(client);
    await Promise.allSettled([
      advanced.getMenuEngineering(R1),
      advanced.getMenuEngineering(R2),
      advanced.getSeasonality(R1),
      advanced.getSeasonality(R2),
    ]);
    expect(client.reads.map((r) => r.house).sort()).toEqual([R1, R2]);
  });

  it("a refused read reaches the caller and is not kept: the next call reads again", async () => {
    let failing = true;
    const client = makeClient({ failConsumption: () => failing });
    const advanced = advancedOver(client);

    await expect(advanced.getMenuEngineering(R1)).rejects.toThrow();
    const afterFailure = client.reads.length;
    failing = false;
    const ok: any = await advanced.getMenuEngineering(R1);
    expect(client.reads.length).toBeGreaterThan(afterFailure);
    expect(ok).toBeDefined();
  });
});

describe("readConsumptionRows — the memo", () => {
  it("answers from the memo inside the window and reads again after it", async () => {
    const client = makeClient();
    let t = 1_000_000;
    const now = () => t;
    await readConsumptionRows(client, R1, 90, now);
    t += CONSUMPTION_MEMO_MS - 1;
    await readConsumptionRows(client, R1, 90, now);
    expect(client.reads).toHaveLength(1);
    t += 2;
    await readConsumptionRows(client, R1, 90, now);
    expect(client.reads).toHaveLength(2);
  });

  it("keeps different windows of one house apart", async () => {
    const client = makeClient();
    await readConsumptionRows(client, R1, 90);
    await readConsumptionRows(client, R1, 30);
    expect(client.reads).toHaveLength(2);
  });

  it("does not share across database clients", async () => {
    const a = makeClient();
    const b = makeClient();
    await readConsumptionRows(a, R1, 90);
    await readConsumptionRows(b, R1, 90);
    expect(a.reads).toHaveLength(1);
    expect(b.reads).toHaveLength(1);
  });
});
