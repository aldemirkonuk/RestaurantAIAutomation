import { ForbiddenException } from "@nestjs/common";
import { ItemDetailController } from "./item-detail.controller";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * Inventory r28, gap 6. The page hid "Carry a food or supply" from staff, but
 * POST /inventory/:restaurantId/house-items took anyone in the house. Adding a
 * good to the books is an owner's or a manager's. The real OrganizationsService
 * decides; only its access-row read is stubbed.
 */
function controller(role: string | null) {
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
  const carry = jest.fn(async () => ({ id: "inv-9" }));
  const c = new ItemDetailController({} as any, {} as any, { carry } as any, organizations);
  return { c, carry };
}

const dto = { kind: "food", uom: "g", displayName: "Flour" } as any;

describe("POST house-items: adding a good is an owner's or a manager's", () => {
  it.each(["owner", "manager"])("a %s may add a good", async (role) => {
    const { c, carry } = controller(role);
    await expect(c.carry("rest-1", dto, { userId: "u-1" })).resolves.toEqual({ id: "inv-9" });
    expect(carry).toHaveBeenCalledWith("rest-1", dto);
  });

  it.each(["staff", null])("%s is refused, and nothing is added", async (role) => {
    const { c, carry } = controller(role as string | null);
    await expect(c.carry("rest-1", dto, { userId: "u-1" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(carry).not.toHaveBeenCalled();
  });

  it("a session naming nobody is refused before the role is read", async () => {
    const { c, carry } = controller("owner");
    await expect(c.carry("rest-1", dto, {})).rejects.toMatchObject({ status: 403 });
    await expect(c.carry("rest-1", dto)).rejects.toMatchObject({ status: 403 });
    expect(carry).not.toHaveBeenCalled();
  });
});
