import { ForbiddenException } from "@nestjs/common";
import { MenuVersionsController, MenusController } from "./menus.controller";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * r107 menu-4: putting a line, or a failed read, back is an owner's or a
 * manager's, like taking it off. Staff are refused before anything is read or
 * written. The real OrganizationsService decides; only its access-row read is stubbed.
 */
function orgs(role: string | null) {
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
  return organizations;
}

describe("PATCH /menus/:restaurantId/items/:id/restore -- owner or manager only", () => {
  const make = (role: string | null) => {
    const restoreMenuItem = jest.fn(async () => ({ menuItemId: "l-1", status: "approved" }));
    return { c: new MenusController({ restoreMenuItem } as any, orgs(role)), restoreMenuItem };
  };
  it.each(["owner", "manager"])("a %s may put a line back", async (role) => {
    const { c, restoreMenuItem } = make(role);
    await expect(c.restoreMenuItem("rest-1", "l-1", { userId: "u-1" })).resolves.toEqual({ menuItemId: "l-1", status: "approved" });
    expect(restoreMenuItem).toHaveBeenCalledWith("rest-1", "l-1");
  });
  it.each(["staff", null])("%s is refused with 403 and nothing is touched", async (role) => {
    const { c, restoreMenuItem } = make(role);
    await expect(c.restoreMenuItem("rest-1", "l-1", { userId: "u-1" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(restoreMenuItem).not.toHaveBeenCalled();
  });
  it("a session that names nobody is refused", async () => {
    const { c, restoreMenuItem } = make("owner");
    await expect(c.restoreMenuItem("rest-1", "l-1", {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(restoreMenuItem).not.toHaveBeenCalled();
  });
});

describe("POST /menu-versions/:menuId/restore -- owner or manager only", () => {
  const make = (role: string | null) => {
    const restoreFailedRead = jest.fn(async () => ({ menuId: "m-1", restored: true }));
    return { c: new MenuVersionsController({ restoreFailedRead } as any, orgs(role)), restoreFailedRead };
  };
  it.each(["owner", "manager"])("a %s may put a failed read back", async (role) => {
    const { c, restoreFailedRead } = make(role);
    await expect(c.restoreFailedRead("rest-1", "u-1", "m-1")).resolves.toEqual({ menuId: "m-1", restored: true });
    expect(restoreFailedRead).toHaveBeenCalledWith("rest-1", "m-1");
  });
  it.each(["staff", null])("%s is refused with 403 and nothing is touched", async (role) => {
    const { c, restoreFailedRead } = make(role);
    await expect(c.restoreFailedRead("rest-1", "u-1", "m-1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(restoreFailedRead).not.toHaveBeenCalled();
  });
});
