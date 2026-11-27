import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { TableAnalyticsService } from "./table-analytics.service";
import { LENS_MEMO_MS, sharedLensRead } from "./lens-shared-reads";

/**
 * A cold /reports repeated whole reads across lenses: pos_checks (table and
 * waiter lenses, same select), the inventory rows and lot rollup (every costed
 * lens), procurement_orders. These pin one read per house and window, no reuse
 * across houses or clients, no failure kept, and the 30 s expiry.
 */

const R1 = "33333333-3333-3333-3333-333333333333";
const R2 = "44444444-4444-4444-4444-444444444444";

function makeClient(opts: { failTable?: () => string | null } = {}) {
  const reads: Array<{ table: string; house: string | null }> = [];
  const passthrough = ["select", "neq", "gt", "gte", "lt", "lte", "is", "or", "not", "order", "limit", "in", "range"];
  return {
    reads,
    from: jest.fn((table: string) => {
      const builder: any = {};
      let house: string | null = null;
      for (const m of passthrough) builder[m] = jest.fn(() => builder);
      builder.eq = jest.fn((col: string, v: string) => {
        if (col === "restaurant_id") house = v;
        return builder;
      });
      builder.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
      builder.then = (resolve: any, reject: any) => {
        reads.push({ table, house });
        if (opts.failTable?.() === table)
          return Promise.resolve({ data: null, error: { code: "57014", message: "statement timeout" } }).then(resolve, reject);
        return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
      };
      return builder;
    }),
  };
}
const count = (c: ReturnType<typeof makeClient>, table: string, house?: string) =>
  c.reads.filter((r) => r.table === table && (!house || r.house === house)).length;

const tableOver = (client: any) => new TableAnalyticsService({ getClient: () => client } as any);
const analyticsOver = (client: any) => new AnalyticsService({ getClient: () => client } as any);
const advancedOver = (client: any) =>
  new AdvancedAnalyticsService({ getClient: () => client } as any, { getDemandForecast: async () => ({}) } as any, {} as any, {} as any);

describe("one read per house and window across the report lenses", () => {
  it("reads pos_checks once for table performance and waiters", async () => {
    const client = makeClient();
    const t = tableOver(client);
    await Promise.allSettled([t.getTablePerformance(R1), t.getWaiterPerformance(R1)]);
    expect(count(client, "pos_checks", R1)).toBe(1);
  });

  it("reads inventory and the lot rollup once across both services", async () => {
    const client = makeClient();
    await Promise.allSettled([
      advancedOver(client).getMenuEngineering(R1),
      analyticsOver(client).getInventoryScience(R1),
      analyticsOver(client).getRiskProfile(R1),
    ]);
    expect(count(client, "restaurant_inventory", R1)).toBe(1);
    expect(count(client, "inventory_lot_rollup", R1)).toBe(1);
  });

  it("never reuses one house's rows for another", async () => {
    const client = makeClient();
    const t = tableOver(client);
    await Promise.allSettled([t.getTablePerformance(R1), t.getTablePerformance(R2), t.getWaiterPerformance(R1), t.getWaiterPerformance(R2)]);
    expect(client.reads.filter((r) => r.table === "pos_checks").map((r) => r.house).sort()).toEqual([R1, R2]);
  });

  it("never reuses rows across clients", async () => {
    const a = makeClient();
    const b = makeClient();
    await Promise.allSettled([tableOver(a).getTablePerformance(R1), tableOver(b).getTablePerformance(R1)]);
    expect(count(a, "pos_checks")).toBe(1);
    expect(count(b, "pos_checks")).toBe(1);
  });

  it("does not keep a failed read: the next call reads again and can answer", async () => {
    let fail = true;
    const client = makeClient({ failTable: () => (fail ? "pos_checks" : null) });
    const t = tableOver(client);
    await expect(t.getTablePerformance(R1)).rejects.toBeDefined();
    fail = false;
    await Promise.allSettled([t.getTablePerformance(R1)]);
    expect(count(client, "pos_checks")).toBeGreaterThanOrEqual(2);
  });

  it("does not keep an { error } answer from the client", async () => {
    let fail = true;
    const client = makeClient({ failTable: () => (fail ? "restaurant_inventory" : null) });
    await Promise.allSettled([analyticsOver(client).getInventoryScience(R1)]);
    fail = false;
    await Promise.allSettled([analyticsOver(client).getInventoryScience(R1)]);
    expect(count(client, "restaurant_inventory", R1)).toBe(2);
  });
});

describe("sharedLensRead", () => {
  it("keeps an answer for LENS_MEMO_MS and no longer", async () => {
    let t = 1_000;
    const c = {};
    const load = jest.fn(async () => [1]);
    await sharedLensRead(c, "k", load, () => t);
    await sharedLensRead(c, "k", load, () => t + LENS_MEMO_MS - 1);
    expect(load).toHaveBeenCalledTimes(1);
    await sharedLensRead(c, "k", load, () => t + LENS_MEMO_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("lets concurrent callers wait on one read", async () => {
    const c = {};
    const load = jest.fn(async () => [1]);
    await Promise.all([sharedLensRead(c, "k", load), sharedLensRead(c, "k", load)]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
