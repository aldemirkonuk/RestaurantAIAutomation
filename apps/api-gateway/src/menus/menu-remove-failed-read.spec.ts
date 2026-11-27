import { ForbiddenException } from "@nestjs/common";
import { MenuVersionsController } from "./menus.controller";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * r105 menu-6 (F3): a failed read had no way off the kept list. Taking it off
 * is an owner's or a manager's, like choosing a menu; staff are refused before
 * anything is read or written. The real OrganizationsService decides.
 */
function controller(role: string | null) {
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
  const removeFailedRead = jest.fn(async () => ({ menuId: "m-1", removed: true }));
  return { c: new MenuVersionsController({ removeFailedRead } as any, organizations), removeFailedRead };
}

describe("POST /menu-versions/:menuId/remove -- owner or manager only", () => {
  it.each(["owner", "manager"])("a %s may take a failed read off the list", async (role) => {
    const { c, removeFailedRead } = controller(role);
    await expect(c.removeFailedRead("rest-1", "u-1", "m-1")).resolves.toEqual({ menuId: "m-1", removed: true });
    expect(removeFailedRead).toHaveBeenCalledWith("rest-1", "m-1", "u-1");
  });

  it.each(["staff", null])("%s is refused with 403 and nothing is touched", async (role) => {
    const { c, removeFailedRead } = controller(role);
    await expect(c.removeFailedRead("rest-1", "u-1", "m-1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(removeFailedRead).not.toHaveBeenCalled();
  });
});
