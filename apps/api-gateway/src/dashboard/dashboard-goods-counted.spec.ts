import { Test, TestingModule } from "@nestjs/testing";
import { DashboardService } from "./dashboard.service";
import { DatabaseService } from "../database/database.service";

/**
 * r36 onboarding gap 1 (desk half). Invariant: GET /dashboard/stats says how
 * much of the house's list has been counted, so the desk never reads a list
 * of goods nobody has counted as a known cellar.
 *
 * - countedGoods: active goods with `last_counted_at` set (OD-161).
 * - goodsNotCounted: active goods with no count, cocktails left out (a
 *   cocktail is mixed, not shelved, and can never be counted).
 */

function makeClient(rowsByTable: Record<string, any[]>) {
  const selects: Record<string, string[]> = {};
  const passthrough = [
    "eq", "neq", "gt", "gte", "lt", "lte", "is", "or", "not", "order", "limit", "in", "range",
  ];
  return {
    selects,
    from: jest.fn((table: string) => {
      const builder: any = {};
      for (const method of passthrough) builder[method] = jest.fn(() => builder);
      builder.select = jest.fn((cols: string) => {
        (selects[table] ??= []).push(cols);
        return builder;
      });
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(
          resolve,
          reject,
        );
      return builder;
    }),
  };
}

const COUNTED = "2026-11-10T09:00:00Z";
const good = (over: Record<string, any>) => ({
  id: "g",
  stock_live: 0,
  bottle_size_ml: 750,
  last_counted_at: null,
  kind: "wine",
  ...over,
});

describe("DashboardService.getStats — how much of the list is counted", () => {
  let service: DashboardService;
  const db = { getClient: jest.fn() };

  const load = (goods: any[]) => {
    const client = makeClient({
      restaurant_inventory: goods,
      restaurants: [{ timezone: "UTC" }],
    });
    db.getClient.mockReturnValue(client);
    return client;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [DashboardService, { provide: DatabaseService, useValue: db }],
    }).compile();
    service = module.get(DashboardService);
  });

  it("reads the count date and the kind of every good", async () => {
    const client = load([]);
    await service.getStats("r1");
    const cols = client.selects["restaurant_inventory"][0];
    expect(cols).toContain("last_counted_at");
    expect(cols).toContain("kind");
  });

  it("says none is counted for a list a menu filled at stock 0", async () => {
    load([
      good({ id: "a", kind: "wine" }),
      good({ id: "b", kind: "beer" }),
      good({ id: "c", kind: "spirit" }),
    ]);
    const s: any = await service.getStats("r1");
    expect(s.totalWines).toBe(3);
    expect(s.countedGoods).toBe(0);
    expect(s.goodsNotCounted).toBe(3);
  });

  it("counts a good as counted only when it carries a count date, whatever its stock", async () => {
    load([
      good({ id: "a", last_counted_at: COUNTED, stock_live: 0 }),
      good({ id: "b", last_counted_at: null, stock_live: 12 }),
      good({ id: "c", last_counted_at: COUNTED, stock_live: 4 }),
    ]);
    const s: any = await service.getStats("r1");
    expect(s.countedGoods).toBe(2);
    expect(s.goodsNotCounted).toBe(1);
  });

  it("never names a cocktail as a good waiting for a count", async () => {
    load([
      good({ id: "n", kind: "cocktail" }),
      good({ id: "m", kind: "cocktail" }),
      good({ id: "w", kind: "wine" }),
    ]);
    const s: any = await service.getStats("r1");
    expect(s.totalWines).toBe(3);
    expect(s.countedGoods).toBe(0);
    expect(s.goodsNotCounted).toBe(1);
  });

  it("gives a house with no goods zero of each", async () => {
    load([]);
    const s: any = await service.getStats("r1");
    expect(s.countedGoods).toBe(0);
    expect(s.goodsNotCounted).toBe(0);
  });
});
