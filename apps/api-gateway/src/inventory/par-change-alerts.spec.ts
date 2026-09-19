import { InventoryService } from "./inventory.service";
import { DatabaseService } from "../database/database.service";
import { LowStockAlertsService } from "../notifications/low-stock-alerts.service";

/**
 * Raising a par level is a threshold crossing (POS lens defect 8).
 *
 * `evaluateInventoryItem` was wired to exactly two call sites — the pour path
 * and one other — both of which move STOCK. Nothing called it when the PAR
 * moved, and a crossing has two sides: stock falling to meet par, and par
 * rising to meet stock. Measured on the lens run: three pars raised above
 * current stock through the PATCH door produced 0 notifications, and the
 * two-minute sweep caught two of them about nine minutes later. The third was
 * never explained.
 *
 * Nine minutes is the good case. The sweep is a backstop, not the mechanism:
 * an owner who raises a par because they just decided they want more of
 * something on hand is telling the system a wine is now short, and the system
 * agreeing quarter of an hour later is not the same product.
 */

type Row = Record<string, any>;

function makeService(opts: { oldThreshold?: number | null } = {}) {
  const single = jest
    .fn()
    // 1. the informational old-values read
    .mockResolvedValueOnce({
      data: {
        stock_live: 2,
        shadow_stock: 0,
        threshold_min: opts.oldThreshold ?? 1,
        master_wine_id: "mw-1",
      },
      error: null,
    })
    // 2. the post-write re-fetch that mapInventoryItem dereferences
    .mockResolvedValue({
      data: {
        id: "inv-1",
        restaurant_id: "rest-1",
        stock_live: 2,
        threshold_min: opts.oldThreshold ?? 1,
        master_wine_library: { name: "Tsantali", bottle_size_ml: 750 },
        restaurants: { default_pour_ml: 150, measurement_unit: "ml" },
      },
      error: null,
    });

  const chain: Row = {};
  for (const m of [
    "from",
    "select",
    "insert",
    "update",
    "eq",
    "neq",
    "is",
    "in",
    "order",
  ]) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain.single = single;
  chain.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.then = (resolve: any) => resolve({ data: [], error: null });

  const client = {
    from: jest.fn().mockReturnValue(chain),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
  const dbService = {
    getClient: () => client,
    supabase: client,
    getRestaurantInventory: async () => [],
    getLowStockItems: async () => [],
  } as unknown as DatabaseService;

  const evaluateInventoryItem = jest.fn().mockResolvedValue(undefined);
  const alerts = { evaluateInventoryItem } as unknown as LowStockAlertsService;

  const service = new InventoryService(dbService, undefined, alerts);
  return { service, evaluateInventoryItem, client };
}

/** The hook is fire-and-forget, so let the microtask queue drain before asserting. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("updateInventoryItem — a par change is a threshold crossing", () => {
  it("evaluates low stock when the par level is raised", async () => {
    const { service, evaluateInventoryItem } = makeService({ oldThreshold: 1 });

    await service.updateInventoryItem("rest-1", "inv-1", {
      thresholdMin: 5,
    } as any);
    await settle();

    expect(evaluateInventoryItem).toHaveBeenCalledWith("rest-1", "inv-1");
  });

  it("evaluates when the par is lowered too — a wine can stop being low", async () => {
    // The ledger has to learn that a crossing was undone, or `last_alert_level`
    // stays advanced and the wine is never alerted about again when it really
    // does fall.
    const { service, evaluateInventoryItem } = makeService({ oldThreshold: 9 });

    await service.updateInventoryItem("rest-1", "inv-1", {
      thresholdMin: 2,
    } as any);
    await settle();

    expect(evaluateInventoryItem).toHaveBeenCalledWith("rest-1", "inv-1");
  });

  it("does not evaluate when the par is unchanged", async () => {
    const { service, evaluateInventoryItem } = makeService({ oldThreshold: 5 });

    await service.updateInventoryItem("rest-1", "inv-1", {
      thresholdMin: 5,
    } as any);
    await settle();

    expect(evaluateInventoryItem).not.toHaveBeenCalled();
  });

  it("does not evaluate when the write touched no threshold at all", async () => {
    const { service, evaluateInventoryItem } = makeService({ oldThreshold: 5 });

    await service.updateInventoryItem("rest-1", "inv-1", {
      toastItemGuid: "guid-1",
    } as any);
    await settle();

    expect(evaluateInventoryItem).not.toHaveBeenCalled();
  });

  it("still returns the updated item when the alert evaluation throws", async () => {
    // Fire-and-forget in both directions: a failing alert must not fail the
    // owner's edit, and must not be swallowed into looking like success either
    // — it is logged by the alert service itself.
    const { service, evaluateInventoryItem } = makeService({ oldThreshold: 1 });
    evaluateInventoryItem.mockRejectedValue(new Error("notifications down"));

    await expect(
      service.updateInventoryItem("rest-1", "inv-1", {
        thresholdMin: 5,
      } as any),
    ).resolves.toBeDefined();
    await settle();

    expect(evaluateInventoryItem).toHaveBeenCalled();
  });
});
