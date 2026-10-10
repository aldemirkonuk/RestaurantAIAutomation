import { HttpException } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import {
  OrganizationsService,
  RestaurantRoleUnreadableError,
} from "../organizations/organizations.service";

/**
 * F-596: "Export all locations" read `GET /inventory/<house>` for every house
 * with a token that names one, so the first other house was a 403 and nothing
 * was exported. `GET /inventory/across-houses` names no house in its path and
 * checks the caller's role in EACH house from its access rows.
 */
function controller(roles: Record<string, string | null | Error>) {
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "getBranchesForUser").mockResolvedValue([
    {
      id: "h-1",
      name: "Meyhane",
      city: null,
      chain_id: null,
      chain_name: null,
    },
    { id: "h-2", name: "Bistro", city: null, chain_id: null, chain_name: null },
  ] as any);
  jest
    .spyOn(organizations, "readRestaurantRole")
    .mockImplementation(async (_u: string, id: string) => {
      const r = roles[id];
      if (r instanceof Error) throw r;
      return r ?? null;
    });
  const read = jest.fn(async (id: string) => [{ id: `inv-${id}` }]);
  const currency = jest.fn(async (id: string) => ({
    code: id === "h-1" ? "TRY" : "USD",
    readable: true,
  }));
  const c = new InventoryController(
    { getRestaurantInventory: read, readHouseCurrency: currency } as any,
    organizations,
    {} as any,
  );
  return { c, read };
}

describe("GET /inventory/across-houses", () => {
  it("reads every house the caller owns or manages, each with its own currency", async () => {
    const { c, read } = controller({ "h-1": "owner", "h-2": "manager" });
    const out = await c.getInventoryAcrossHouses({ userId: "u-1" });
    expect(read).toHaveBeenCalledWith("h-1");
    expect(read).toHaveBeenCalledWith("h-2");
    expect(out.houses.map((h) => [h.name, h.currency.code, h.items])).toEqual([
      ["Meyhane", "TRY", [{ id: "inv-h-1" }]],
      ["Bistro", "USD", [{ id: "inv-h-2" }]],
    ]);
    expect(out.notIncluded).toEqual([]);
  });

  it("never reads a house where the caller is staff or has no role, and names it", async () => {
    const { c, read } = controller({ "h-1": "owner", "h-2": "staff" });
    const out = await c.getInventoryAcrossHouses({ userId: "u-1" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalledWith("h-2");
    expect(out.notIncluded).toEqual([{ restaurantId: "h-2", name: "Bistro" }]);

    const none = controller({ "h-1": null, "h-2": null });
    const empty = await none.c.getInventoryAcrossHouses({ userId: "u-1" });
    expect(none.read).not.toHaveBeenCalled();
    expect(empty.houses).toEqual([]);
  });

  it("a role that cannot be read stops the export instead of dropping the house", async () => {
    const { c } = controller({
      "h-1": "owner",
      "h-2": new RestaurantRoleUnreadableError("down"),
    });
    await expect(
      c.getInventoryAcrossHouses({ userId: "u-1" }),
    ).rejects.toMatchObject({
      status: 503,
    });
  });

  it("a session naming nobody reads nothing", async () => {
    const { c, read } = controller({ "h-1": "owner" });
    await expect(c.getInventoryAcrossHouses({})).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(read).not.toHaveBeenCalled();
  });
});

describe("InventoryService.readHouseCurrency", () => {
  function service(result: {
    data: unknown;
    error: { message: string } | null;
  }) {
    const chain: any = {
      from: () => chain,
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => result,
    };
    return new InventoryService({ getClient: () => chain } as any);
  }

  it("names the recorded code, a missing one as null, and a failed read as unreadable", async () => {
    await expect(
      service({ data: { currency: "TRY" }, error: null }).readHouseCurrency(
        "h-1",
      ),
    ).resolves.toEqual({ code: "TRY", readable: true });
    await expect(
      service({ data: { currency: null }, error: null }).readHouseCurrency(
        "h-1",
      ),
    ).resolves.toEqual({ code: null, readable: true });
    await expect(
      service({ data: null, error: { message: "down" } }).readHouseCurrency(
        "h-1",
      ),
    ).resolves.toEqual({ code: null, readable: false });
  });
});
