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

  it("an edit that is neither price nor par by staff is unchanged by this gate", async () => {
    const { c, update } = controller("staff");
    await c.updateInventoryItem("rest-1", "inv-1", { isActive: true } as any, {
      userId: "u-1",
    });
    expect(update).toHaveBeenCalledTimes(1);
  });
});

/**
 * F-1064 / F-1060 (S160 call): a wine's par is the house's low-stock line, so
 * changing it is an owner's or a manager's act, like the house default.
 */
describe("PATCH inventory item — who may change a par", () => {
  it.each(["owner", "manager"])(
    "a %s may change a wine's par",
    async (role) => {
      const { c, update } = controller(role);
      await c.updateInventoryItem(
        "rest-1",
        "inv-1",
        { thresholdMin: 4 } as any,
        { userId: "u-1" },
      );
      expect(update).toHaveBeenCalledWith(
        "rest-1",
        "inv-1",
        { thresholdMin: 4 },
        "u-1",
      );
    },
  );

  it.each([{ thresholdMin: 4 }, { thresholdMax: 30 }])(
    "staff is refused a par change %p, and nothing is written",
    async (dto) => {
      const { c, update } = controller("staff");
      await expect(
        c.updateInventoryItem("rest-1", "inv-1", dto as any, { userId: "u-1" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(update).not.toHaveBeenCalled();
    },
  );
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

/**
 * F-1064 / F-1060 on the add doors: a par on a wine added one at a time, or on
 * any line of a batch (which overwrites a carried wine's par), is an owner's or
 * a manager's. Staff add with no par and the house default applies.
 */
describe("POST inventory items — a par on add is gated", () => {
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

  it("staff naming a par on one batch line is refused whole, before any line is received", async () => {
    const { c, bulk } = addController("staff");
    await expect(
      c.bulkCreateInventoryItems(
        "rest-1",
        {
          items: [
            { wineId: "a", stockLive: 2 },
            { wineId: "b", thresholdMin: 0 },
          ],
        } as any,
        { userId: "u-2" },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      c.bulkCreateInventoryItems(
        "rest-1",
        { items: [{ wineId: "a", thresholdMax: 40 }] } as any,
        { userId: "u-2" },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(bulk).not.toHaveBeenCalled();
  });

  it("staff adding with no par goes through on both doors", async () => {
    const { c, create, bulk } = addController("staff");
    await c.createInventoryItem(
      "rest-1",
      { wineId: "w", stockLive: 3 } as any,
      { userId: "u-2" },
    );
    await c.bulkCreateInventoryItems(
      "rest-1",
      { items: [{ wineId: "w", stockLive: 3 }] } as any,
      { userId: "u-2" },
    );
    expect(create).toHaveBeenCalledWith(
      "rest-1",
      { wineId: "w", stockLive: 3 },
      "u-2",
    );
    expect(bulk).toHaveBeenCalledWith(
      "rest-1",
      { items: [{ wineId: "w", stockLive: 3 }] },
      "u-2",
    );
  });

  it.each(["owner", "manager"])(
    "a %s may name a par on add, on both doors",
    async (role) => {
      const { c, create, bulk } = addController(role);
      await c.createInventoryItem(
        "rest-1",
        { wineId: "w", thresholdMin: 4 } as any,
        { userId: "u-1" },
      );
      await c.bulkCreateInventoryItems(
        "rest-1",
        { items: [{ wineId: "w", thresholdMin: 4 }] } as any,
        { userId: "u-1" },
      );
      expect(create).toHaveBeenCalled();
      expect(bulk).toHaveBeenCalled();
    },
  );
});
