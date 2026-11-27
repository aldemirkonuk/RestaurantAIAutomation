import { ForbiddenException } from "@nestjs/common";
import { MenuVersionsController } from "./menus.controller";
import { OrganizationsService } from "../organizations/organizations.service";

/** r109 menu-g5: who may copy the current menu into a new draft (owner or manager). */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const CURRENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("POST /menu-versions/:menuId/draft -- owner or manager only", () => {
  function controller(role: string | null) {
    const organizations = new OrganizationsService({} as never);
    jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
    const copyMenuIntoDraft = jest.fn(async () => ({ menuId: "d-1", name: "x", lines: 1, copiedAt: "t" }));
    return { c: new MenuVersionsController({ copyMenuIntoDraft } as any, organizations), copyMenuIntoDraft };
  }
  it.each(["owner", "manager"])("a %s may copy the current menu into a draft", async (role) => {
    const { c, copyMenuIntoDraft } = controller(role);
    await c.copyIntoDraft(HOUSE, "u-1", CURRENT);
    expect(copyMenuIntoDraft).toHaveBeenCalledWith(HOUSE, CURRENT, "u-1");
  });
  it.each(["staff", null])("%s is refused with 403 in words, and nothing is asked", async (role) => {
    const { c, copyMenuIntoDraft } = controller(role);
    const err = await c.copyIntoDraft(HOUSE, "u-1", CURRENT).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(String(err.message)).toMatch(/copy the menu into a new draft/);
    expect(copyMenuIntoDraft).not.toHaveBeenCalled();
  });
});
