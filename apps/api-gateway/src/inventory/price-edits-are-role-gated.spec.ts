import { ForbiddenException } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * ADR 0193 -- the founder, 2026-09-21: "it should be changed whenever the
 * manager wants". A wine's selling price is an owner/manager act. The real
 * OrganizationsService decides; only its access-row read is stubbed. The rest
 * of PATCH /inventory/:restaurantId/item/:itemId is unchanged: a par edit by
 * staff still goes through.
 */
function controller(role: string | null) {
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
  const update = jest.fn(async () => ({ id: "inv-1" }));
  const c = new InventoryController({ updateInventoryItem: update } as any, organizations, {} as any);
  return { c, update };
}

describe("PATCH inventory item — who may change a price", () => {
  it.each(["owner", "manager"])("a %s may change the bottle or glass price", async (role) => {
    const { c, update } = controller(role);
    await c.updateInventoryItem("rest-1", "inv-1", { menuPriceBottle: 70 } as any, { userId: "u-1" });
    await c.updateInventoryItem("rest-1", "inv-1", { menuPriceGlass: 14 } as any, { userId: "u-1" });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith("rest-1", "inv-1", { menuPriceBottle: 70 }, "u-1");
  });

  it.each(["staff", null])("%s is refused a price change, and nothing in the PATCH is written", async (role) => {
    const { c, update } = controller(role as string | null);
    await expect(
      c.updateInventoryItem("rest-1", "inv-1", { menuPriceBottle: 70, thresholdMin: 4 } as any, { userId: "u-1" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it("a price clear (null) is a price change too", async () => {
    const { c, update } = controller("staff");
    await expect(
      c.updateInventoryItem("rest-1", "inv-1", { menuPriceGlass: null } as any, { userId: "u-1" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it("a session naming nobody cannot change a price", async () => {
    const { c, update } = controller("owner");
    await expect(
      c.updateInventoryItem("rest-1", "inv-1", { menuPriceBottle: 70 } as any, {}),
    ).rejects.toMatchObject({ status: 403 });
    expect(update).not.toHaveBeenCalled();
  });

  it("a non-price edit by staff is unchanged by this gate", async () => {
    const { c, update } = controller("staff");
    await c.updateInventoryItem("rest-1", "inv-1", { thresholdMin: 4 } as any, { userId: "u-1" });
    expect(update).toHaveBeenCalledTimes(1);
  });
});

/**
 * Founder, 2026-09-21 (answers 1 and 5): a price named when a wine is ADDED is
 * a price edit too -- owner or manager only -- and the person is passed to the
 * service so every price version names who set it.
 */
describe("POST inventory items — a price on add is gated and names the person", () => {
  function addController(role: string | null) {
    const organizations = new OrganizationsService({} as never);
    jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
    const create = jest.fn(async () => ({ id: "inv-1" }));
    const bulk = jest.fn(async () => ({ results: [] }));
    const c = new InventoryController(
      { createInventoryItem: create, bulkCreateInventoryItems: bulk } as any,
      organizations,
      {} as any,
    );
    return { c, create, bulk };
  }

  it.each(["owner", "manager"])("a %s may add with a price, and the service is told who", async (role) => {
    const { c, create, bulk } = addController(role);
    await c.createInventoryItem("rest-1", { wineId: "w", menuPriceBottle: 60 } as any, { userId: "u-1" });
    await c.bulkCreateInventoryItems("rest-1", { items: [{ wineId: "w", menuPriceGlass: 12 }] } as any, { userId: "u-1" });
    expect(create).toHaveBeenCalledWith("rest-1", { wineId: "w", menuPriceBottle: 60 }, "u-1");
    expect(bulk).toHaveBeenCalledWith("rest-1", { items: [{ wineId: "w", menuPriceGlass: 12 }] }, "u-1");
  });

  it.each(["staff", null])("%s adding WITH a price is refused before anything is written", async (role) => {
    const { c, create, bulk } = addController(role as string | null);
    await expect(
      c.createInventoryItem("rest-1", { wineId: "w", menuPriceBottle: 60 } as any, { userId: "u-1" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      c.bulkCreateInventoryItems(
        "rest-1",
        { items: [{ wineId: "a" }, { wineId: "b", menuPriceBottle: 30 }] } as any,
        { userId: "u-1" },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
    expect(bulk).not.toHaveBeenCalled();
  });

  it("staff adding WITHOUT a price is unchanged, and still names the person", async () => {
    const { c, create, bulk } = addController("staff");
    await c.createInventoryItem("rest-1", { wineId: "w" } as any, { userId: "u-2" });
    await c.bulkCreateInventoryItems("rest-1", { items: [{ wineId: "w" }] } as any, { userId: "u-2" });
    expect(create).toHaveBeenCalledWith("rest-1", { wineId: "w" }, "u-2");
    expect(bulk).toHaveBeenCalledWith("rest-1", { items: [{ wineId: "w" }] }, "u-2");
  });
});
