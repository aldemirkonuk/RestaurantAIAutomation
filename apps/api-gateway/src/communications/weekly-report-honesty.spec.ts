import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ScheduledTasksService } from "./scheduled-tasks.service";

/**
 * OD-85 / ADR 0020 — the weekly manager email must not invent numbers.
 *
 * `getWeeklyReportData()` shipped with a literal top-sellers table
 * ("Chateau Margaux 2015 — 15 sold — $4,500") and an inventory valuation of
 * `totalBottles * 50`. Both went out over email, to real managers, under the
 * restaurant's own name. That is not a feature gap that the UI can caveat: the
 * recipient has no way to tell the invented rows from the real ones.
 *
 * The rule these tests pin: when we do not have the data, the section is
 * ABSENT. `weekly-report.template.ts` already omits Top Sellers on an empty
 * array, so `[]` is the honest output, not a placeholder row.
 */

const SOURCE = readFileSync(
  join(__dirname, "scheduled-tasks.service.ts"),
  "utf8",
);

/** Builds the service with stubbed collaborators and a configured restaurant. */
async function makeService(opts: {
  inventory?: any[];
  lowStock?: any[];
  consumption?: any[] | Error;
  inventoryThrows?: boolean;
}) {
  const config = {
    get: (key: string) =>
      key === "DEFAULT_RESTAURANT_ID" ? "rest-1" : undefined,
  };

  const client = {
    from: jest.fn((table: string) => {
      const builder: any = {};
      for (const m of ["select", "eq", "gte", "lte", "order", "limit", "in"]) {
        builder[m] = jest.fn(() => builder);
      }
      builder.then = (resolve: any, reject: any) => {
        if (
          table === "wine_consumption_log" &&
          opts.consumption instanceof Error
        ) {
          return Promise.reject(opts.consumption).then(resolve, reject);
        }
        const data =
          table === "wine_consumption_log"
            ? ((opts.consumption as any[]) ?? [])
            : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      };
      return builder;
    }),
  };

  const databaseService = {
    getClient: () => client,
    getRestaurantInventory: jest.fn(async () => {
      if (opts.inventoryThrows) throw new Error("db down");
      return opts.inventory ?? [];
    }),
    getLowStockItems: jest.fn(async () => opts.lowStock ?? []),
    supabase: client,
  };

  const service = new ScheduledTasksService(
    config as any,
    {} as any,
    databaseService as any,
    {} as any,
    {} as any,
    // OD-87 / ADR 0022 — the tenant enumerator. `getWeeklyReportData` is called
    // directly below with an explicit restaurant id, so it is never consulted
    // here; it exists to satisfy the constructor.
    {} as any,
  );
  await service.onModuleInit();
  return service;
}

/**
 * OD-87 / ADR 0022 — the report is now built per restaurant, so the id is an
 * argument rather than a field read off the service.
 */
const weekly = (s: ScheduledTasksService) =>
  (s as any).getWeeklyReportData("rest-1") as Promise<any>;

describe("weekly manager email — no fabricated figures", () => {
  it("carries no demo wine names or demo totals anywhere in the source", () => {
    // These literals were the fabrication. Their presence in a file that feeds
    // an outbound email is the bug, regardless of which branch they sit on.
    for (const literal of [
      "Chateau Margaux",
      "Opus One",
      "Dom Perignon",
      "Caymus",
    ]) {
      expect(SOURCE).not.toContain(literal);
    }
    // `totalBottles * 50` — an invented $50/bottle valuation.
    expect(SOURCE).not.toMatch(/totalBottles\s*\*\s*50/);
  });

  it("omits the Top Sellers section entirely when the POS recorded no sales", async () => {
    const service = await makeService({
      inventory: [{ stock_live: 10, last_purchase_price: 20 }],
      consumption: [],
    });

    const data = await weekly(service);

    // [] makes weekly-report.template.ts drop the whole block.
    expect(data.topSellers).toEqual([]);
  });

  it("reports real top sellers from the consumption log, ranked by revenue", async () => {
    const service = await makeService({
      inventory: [],
      consumption: [
        { wine_name: "Malbec", quantity: 2, total_revenue: 90 },
        { wine_name: "Malbec", quantity: 1, total_revenue: 45 },
        { wine_name: "Riesling", quantity: 9, total_revenue: 200 },
      ],
    });

    const data = await weekly(service);

    expect(data.topSellers).toEqual([
      { name: "Riesling", sold: 9, revenue: 200 },
      { name: "Malbec", sold: 3, revenue: 135 },
    ]);
  });

  it("excludes unpriced sales so `sold` and `revenue` describe the same lines", async () => {
    const service = await makeService({
      inventory: [],
      consumption: [
        { wine_name: "Malbec", quantity: 2, total_revenue: 90 },
        // No price recorded: counting it in `sold` would put 5 bottles next to
        // $90 and imply three of them were given away.
        { wine_name: "Malbec", quantity: 3, total_revenue: null },
        // Nothing priced at all — the wine cannot appear in a revenue table.
        { wine_name: "Gamay", quantity: 4, total_revenue: null },
      ],
    });

    const data = await weekly(service);

    expect(data.topSellers).toEqual([{ name: "Malbec", sold: 2, revenue: 90 }]);
  });

  it("caps the table at five wines", async () => {
    const service = await makeService({
      inventory: [],
      consumption: Array.from({ length: 9 }, (_, i) => ({
        wine_name: `Wine ${i}`,
        quantity: 1,
        total_revenue: i + 1,
      })),
    });

    const data = await weekly(service);
    expect(data.topSellers).toHaveLength(5);
    expect(data.topSellers[0].name).toBe("Wine 8");
  });

  it("values inventory from recorded purchase prices, not a flat per-bottle guess", async () => {
    const service = await makeService({
      inventory: [
        { stock_live: 10, last_purchase_price: 12 },
        { stock_live: 4, last_purchase_price: null, custom_price: 25 },
        // No price on record anywhere — contributes bottles but no value.
        { stock_live: 6, last_purchase_price: null },
      ],
      consumption: [],
    });

    const data = await weekly(service);

    expect(data.totalBottles).toBe(20);
    expect(data.totalValue).toBe(10 * 12 + 4 * 25);
    // 20 * 50 = 1000 was the old invented figure.
    expect(data.totalValue).not.toBe(1000);
  });

  it("reports nothing rather than mock data when the database is unreachable", async () => {
    const service = await makeService({ inventoryThrows: true });

    const data = await weekly(service);

    expect(data.totalBottles).toBe(0);
    expect(data.totalValue).toBe(0);
    expect(data.lowStockCount).toBe(0);
    expect(data.topSellers).toEqual([]);
    expect(data.lowStockItems).toEqual([]);
  });

  it("still returns a usable report when only the consumption query fails", async () => {
    const service = await makeService({
      inventory: [{ stock_live: 3, last_purchase_price: 10 }],
      lowStock: [{ wine_name: "Malbec", stock_live: 1, threshold_min: 5 }],
      consumption: new Error("consumption query exploded"),
    });

    const data = await weekly(service);

    expect(data.totalBottles).toBe(3);
    expect(data.lowStockCount).toBe(1);
    // The part we could not read is absent, not guessed.
    expect(data.topSellers).toEqual([]);
  });
});
