import { DatabaseService } from "../database/database.service";
import { InventoryController } from "./inventory.controller";

/**
 * F-429: a wine marked inactive left /inventory with no way back, because the
 * only list read was `is_active = true`. The same route now lists the inactive
 * wines on `?active=false`, so the page can show them and make one active
 * again; with no flag it still reads the active cellar.
 */
describe("inactive wines list (F-429)", () => {
  function dbWith(asked: unknown[][]) {
    const builder: any = {
      select: () => builder,
      eq: (...args: unknown[]) => {
        asked.push(args);
        return builder;
      },
      // The read is paged whole since F-293 (readWholeWindow).
      order: () => builder,
      gt: () => builder,
      range: () => builder,
      limit: () => builder,
      then: (resolve: any) => resolve({ data: [], error: null, count: 0 }),
    };
    const db = Object.create(DatabaseService.prototype) as DatabaseService;
    db.supabase = { from: () => builder } as any;
    return db;
  }

  it("reads is_active = false when asked for the inactive wines", async () => {
    const asked: unknown[][] = [];
    await dbWith(asked).getRestaurantInventory("r1", false);
    expect(asked).toContainEqual(["is_active", false]);
    expect(asked).not.toContainEqual(["is_active", true]);
  });

  it("still reads the active cellar by default", async () => {
    const asked: unknown[][] = [];
    await dbWith(asked).getRestaurantInventory("r1");
    expect(asked).toContainEqual(["is_active", true]);
  });

  it.each([
    [undefined, true],
    ["true", true],
    ["false", false],
  ])("the list route passes ?active=%s through as %s", async (q, expected) => {
    const inventoryService = {
      getRestaurantInventory: jest.fn().mockResolvedValue([]),
    };
    const controller = Object.create(
      InventoryController.prototype,
    ) as InventoryController;
    (controller as any).inventoryService = inventoryService;

    await controller.getRestaurantInventory("r1", q);

    expect(inventoryService.getRestaurantInventory).toHaveBeenCalledWith(
      "r1",
      expected,
    );
  });
});
