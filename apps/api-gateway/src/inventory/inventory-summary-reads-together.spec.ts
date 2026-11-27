import { InventoryService } from "./inventory.service";

/**
 * Perf p8-s8. GET /inventory/:r/summary read the inventory and then the
 * low-stock view one after the other; neither needs the other's answer, so
 * both reads start before either answers.
 */
function build(opts: { inventory?: unknown; lowStock?: unknown } = {}) {
  const started: string[] = [];
  let releaseInventory: (v: unknown) => void = () => undefined;
  const db = {
    getRestaurantInventory: jest.fn(() => {
      started.push("inventory");
      return new Promise((r) => (releaseInventory = r));
    }),
    getLowStockItems: jest.fn(async () => {
      started.push("lowStock");
      if (opts.lowStock instanceof Error) throw opts.lowStock;
      return opts.lowStock ?? [];
    }),
  };
  const svc = new InventoryService(db as any);
  return { svc, db, started, releaseInventory: (v: unknown) => releaseInventory(v) };
}

describe("getInventorySummary — the two reads are asked together", () => {
  it("starts the low-stock read before the inventory read answers", async () => {
    const { svc, started, releaseInventory } = build();
    const pending = svc.getInventorySummary("r1");
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(started).toEqual(["inventory", "lowStock"]);
    releaseInventory([]);
    await expect(pending).resolves.toMatchObject({ totalItems: 0 });
  });

  it("still counts the same rows", async () => {
    const { svc, releaseInventory } = build({ lowStock: [] });
    const pending = svc.getInventorySummary("r1");
    releaseInventory([
      { stock_live: 10, threshold_min: 5, toast_item_guid: "g" },
      { stock_live: 2, threshold_min: 5, toast_item_guid: null },
    ]);
    await expect(pending).resolves.toMatchObject({
      totalItems: 2,
      totalBottles: 12,
      toastMappedCount: 1,
      toastUnmappedCount: 1,
    });
  });

  it("a failed low-stock read fails the summary, it is not read as none", async () => {
    const { svc, releaseInventory } = build({ lowStock: new Error("view down") });
    const pending = svc.getInventorySummary("r1");
    releaseInventory([]);
    await expect(pending).rejects.toThrow("view down");
  });
});
