import { ForbiddenException, HttpException } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * Inventory r36, gap 4. Staff are never shown what the house paid (#1355), but
 * "Start an auction lot", "A delivery without an order" and "Add a bottle" let
 * them type it: POST /inventory/:rid/items and /items/bulk gated only a menu
 * price, then booked an `initial` lot at the typed cost. The same routes also
 * brought back a good a manager had taken off the list, which PATCH refuses
 * staff (#1363). Both are now an owner's or a manager's. The real
 * OrganizationsService decides; only its access-row read is stubbed.
 */
function orgs(role: string | null) {
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
  return organizations;
}

function controller(role: string | null) {
  const service = {
    createInventoryItem: jest.fn(async (..._a: unknown[]) => ({ id: "inv-1" })),
    bulkCreateInventoryItems: jest.fn(async (..._a: unknown[]) => ({ created: 1 })),
  };
  const c = new InventoryController(service as any, orgs(role), {} as any);
  return { c, service };
}

const me = { userId: "u-1" };

describe("a cost typed on a create is an owner's or a manager's", () => {
  it.each([
    ["a cost", { costPerBottle: 42 }],
    ["a cost of 0", { costPerBottle: 0 }],
    ["a sample (cost 0, marked sample)", { costProvenance: "sample" }],
    ["a provenance alone", { costProvenance: "invoice" }],
  ])("staff are refused %s, and nothing is created", async (_l, cost) => {
    const { c, service } = controller("staff");
    await expect(c.createInventoryItem("rest-1", { wineId: "w-1", stockLive: 6, ...cost } as any, me)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(service.createInventoryItem).not.toHaveBeenCalled();
  });

  it.each(["owner", "manager"])("a %s may write a cost", async (role) => {
    const { c, service } = controller(role);
    await c.createInventoryItem("rest-1", { wineId: "w-1", stockLive: 6, costPerBottle: 42 } as any, me);
    expect(service.createInventoryItem).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no cost at all", {}],
    ["a cost left empty (null)", { costPerBottle: null }],
  ])("staff still add a good with %s", async (_l, cost) => {
    const { c, service } = controller("staff");
    await c.createInventoryItem("rest-1", { wineId: "w-1", stockLive: 6, ...cost } as any, me);
    expect(service.createInventoryItem).toHaveBeenCalledTimes(1);
  });

  it("a session naming nobody cannot write a cost", async () => {
    const { c, service } = controller("owner");
    await expect(c.createInventoryItem("rest-1", { wineId: "w-1", costPerBottle: 42 } as any, {})).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(service.createInventoryItem).not.toHaveBeenCalled();
  });

  it("one costed line refuses a staff batch whole; a batch with no cost goes through", async () => {
    const { c, service } = controller("staff");
    const items = [{ wineId: "w-1", stockLive: 2 }, { wineId: "w-2", stockLive: 3, costPerBottle: 30 }];
    await expect(c.bulkCreateInventoryItems("rest-1", { items } as any, me)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.bulkCreateInventoryItems).not.toHaveBeenCalled();
    await c.bulkCreateInventoryItems("rest-1", { items: [items[0]] } as any, me);
    expect(service.bulkCreateInventoryItems).toHaveBeenCalledTimes(1);
  });

  it("a manager's costed batch goes through", async () => {
    const { c, service } = controller("manager");
    await c.bulkCreateInventoryItems("rest-1", { items: [{ wineId: "w-1", stockLive: 2, costProvenance: "sample" }] } as any, me);
    expect(service.bulkCreateInventoryItems).toHaveBeenCalledTimes(1);
  });

  it("both routes hand the service a reactivation check that refuses staff and passes a manager", async () => {
    for (const [role, ok] of [["staff", false], ["manager", true]] as const) {
      const { c, service } = controller(role);
      await c.createInventoryItem("rest-1", { wineId: "w-1" } as any, me);
      await c.bulkCreateInventoryItems("rest-1", { items: [{ wineId: "w-1" }] } as any, me);
      const one = (service.createInventoryItem.mock.calls[0][3] as any).assertMayReactivate;
      const many = (service.bulkCreateInventoryItems.mock.calls[0][3] as any).assertMayReactivate;
      for (const check of [one, many]) {
        if (ok) await expect(check()).resolves.toBeUndefined();
        else await expect(check()).rejects.toBeInstanceOf(ForbiddenException);
      }
    }
  });
});

/**
 * A fake client that answers by table: the inventory row a create finds, the
 * library row a bulk line resolves, and a log of every write.
 */
function fakeDb(existing: { id: string; is_active: boolean } | null) {
  const writes: Array<{ table: string; op: string; row: unknown }> = [];
  const builder = (table: string) => {
    const b: any = {
      select: () => b,
      eq: () => b,
      update: (row: unknown) => {
        writes.push({ table, op: "update", row });
        return b;
      },
      insert: (row: unknown) => {
        writes.push({ table, op: "insert", row });
        return b;
      },
      single: async () =>
        table === "restaurant_inventory"
          ? { data: writes.length ? { id: existing?.id ?? "new", ...(existing ?? {}) } : existing, error: null }
          : { data: { name: "Wine" }, error: null },
      maybeSingle: async () =>
        table === "master_wine_library"
          ? { data: { id: "w-1", name: "Wine", library_tier: 1 }, error: null }
          : { data: existing, error: null },
      then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
    };
    return b;
  };
  const client: any = { from: (t: string) => builder(t), rpc: jest.fn(async () => ({ data: null, error: null })) };
  return { db: { getClient: () => client } as any, writes, client };
}

const refuse = async () => {
  throw new ForbiddenException("Only an owner or a manager can bring back a good taken off the list.");
};

describe("bringing back a good taken off the list", () => {
  it("one good: a refused check stops it before any write", async () => {
    const { db, writes, client } = fakeDb({ id: "inv-9", is_active: false });
    const svc = new InventoryService(db);
    await expect(
      svc.createInventoryItem("rest-1", { wineId: "w-1", stockLive: 4 } as any, "u-1", { assertMayReactivate: refuse }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toEqual([]);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("one good: the check runs only for an inactive good", async () => {
    const check = jest.fn(async () => undefined);
    const active = new InventoryService(fakeDb({ id: "inv-9", is_active: true }).db);
    await expect(
      active.createInventoryItem("rest-1", { wineId: "w-1" } as any, "u-1", { assertMayReactivate: check }),
    ).rejects.toMatchObject({ status: 409 });
    const fresh = new InventoryService(fakeDb(null).db);
    await fresh.createInventoryItem("rest-1", { wineId: "w-1" } as any, "u-1", { assertMayReactivate: check });
    expect(check).not.toHaveBeenCalled();
    const back = fakeDb({ id: "inv-9", is_active: false });
    await new InventoryService(back.db).createInventoryItem("rest-1", { wineId: "w-1" } as any, "u-1", {
      assertMayReactivate: check,
    });
    expect(check).toHaveBeenCalledTimes(1);
    expect(back.writes[0]).toMatchObject({ table: "restaurant_inventory", op: "update", row: { is_active: true } });
  });

  it("a batch: the line that would bring a good back fails alone, says why, and writes nothing", async () => {
    const { db, writes } = fakeDb({ id: "inv-9", is_active: false });
    const svc = new InventoryService(db);
    const out: any = await svc.bulkCreateInventoryItems("rest-1", { items: [{ wineId: "w-1", stockLive: 2 }] } as any, "u-1", {
      assertMayReactivate: refuse,
    });
    expect(out.failed).toBe(1);
    expect(out.reactivated).toBe(0);
    expect(out.results[0]).toMatchObject({ status: "failed", error: expect.stringContaining("bring back a good") });
    expect(writes).toEqual([]);
  });

  it("a batch: an active good is topped up without asking", async () => {
    const check = jest.fn(async () => undefined);
    const svc = new InventoryService(fakeDb({ id: "inv-9", is_active: true }).db);
    const out: any = await svc.bulkCreateInventoryItems("rest-1", { items: [{ wineId: "w-1", stockLive: 2 }] } as any, "u-1", {
      assertMayReactivate: check,
    });
    expect(out.results[0].status).toBe("stock_added");
    expect(check).not.toHaveBeenCalled();
  });
});
