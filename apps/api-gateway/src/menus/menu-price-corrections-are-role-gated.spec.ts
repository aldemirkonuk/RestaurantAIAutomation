import { ForbiddenException } from "@nestjs/common";
import { MenuVersionsController, MenusController } from "./menus.controller";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * The founder, 2026-09-21 (answer 1, relayed): price edits, the target margin,
 * accepting advice AND menu price corrections are owner/manager only, audited.
 * And (answer 7) choosing the current menu is the person's act -- an owner's
 * or a manager's, since it carries the menu's prices to the house.
 *
 * The real OrganizationsService decides; only its access-row read is stubbed.
 */
function orgs(role: string | null) {
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
  return organizations;
}

describe("PATCH /menus/items/:id — a PRICE correction is an owner's or a manager's", () => {
  function controller(role: string | null) {
    const review = jest.fn(async () => ({ menuItemId: "mi-1" }));
    const c = new MenusController({ reviewMenuItem: review } as any, orgs(role));
    return { c, review };
  }
  const USER = { userId: "u-1", restaurantId: "rest-1" };

  it.each(["owner", "manager"])("a %s may correct the bottle and the glass price", async (role) => {
    const { c, review } = controller(role);
    await c.reviewMenuItem("mi-1", { fieldName: "bottle_price", newValue: "70" } as any, USER);
    await c.reviewMenuItem("mi-1", { fieldName: "by_glass_price", newValue: "14" } as any, USER);
    expect(review).toHaveBeenCalledTimes(2);
  });

  it.each(["staff", null])("%s is refused a price correction before anything is written", async (role) => {
    const { c, review } = controller(role as string | null);
    await expect(
      c.reviewMenuItem("mi-1", { fieldName: "bottle_price", newValue: "70" } as any, USER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      c.reviewMenuItem("mi-1", { fieldName: "by_glass_price", newValue: "14" } as any, USER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(review).not.toHaveBeenCalled();
  });

  it("a session naming no house cannot correct a price", async () => {
    const { c, review } = controller("owner");
    await expect(
      c.reviewMenuItem("mi-1", { fieldName: "bottle_price", newValue: "70" } as any, { userId: "u-1" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(review).not.toHaveBeenCalled();
  });

  it("a NAME correction by staff is unchanged by this gate", async () => {
    const { c, review } = controller("staff");
    await c.reviewMenuItem("mi-1", { fieldName: "name", newValue: "Opus" } as any, USER);
    expect(review).toHaveBeenCalledTimes(1);
  });
});

describe("POST /menus/items — the caller's pricing right is resolved and passed on", () => {
  it.each([
    ["owner", true],
    ["manager", true],
    ["staff", false],
    [null, false],
  ])("%s -> may price: %s", async (role, mayPrice) => {
    const add = jest.fn(async () => ({}));
    const c = new MenusController({ addMenuItem: add } as any, orgs(role as string | null));
    await c.addMenuItem({ menuId: "m-1", name: "x" } as any, { userId: "u-1", restaurantId: "rest-1" });
    expect(add).toHaveBeenCalledWith({ menuId: "m-1", name: "x" }, "u-1", "rest-1", mayPrice);
  });
});

describe("POST /menu-versions/:menuId/make-current — owner or manager only", () => {
  const MENU = "00000000-0000-4000-8000-000000000001";
  function controller(role: string | null) {
    const make = jest.fn(async () => ({ outcome: "made_current" }));
    const list = jest.fn(async () => ({ versions: [] }));
    const plan = jest.fn(async () => ({ fingerprint: "fp-1" }));
    const c = new MenuVersionsController({ makeCurrent: make, listVersions: list, planFor: plan } as any, orgs(role));
    return { c, make, list, plan };
  }

  it.each(["owner", "manager"])("a %s may choose the current menu, naming the plan it was shown (L13)", async (role) => {
    const { c, make } = controller(role);
    await c.makeCurrent("rest-1", "u-1", MENU, { fingerprint: "fp-1" });
    expect(make).toHaveBeenCalledWith("rest-1", MENU, "u-1", "fp-1");
  });

  it.each(["staff", null])("%s is refused, and nothing is switched", async (role) => {
    const { c, make } = controller(role as string | null);
    await expect(c.makeCurrent("rest-1", "u-1", MENU, { fingerprint: "fp-1" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(make).not.toHaveBeenCalled();
  });

  it("anyone of the house may READ the plan (ADR 0193 round 3); only choosing is gated", async () => {
    const { c, plan } = controller("staff");
    await c.plan("rest-1", MENU);
    expect(plan).toHaveBeenCalledWith("rest-1", MENU);
  });

  it("any member of the house may read the menus; the house comes from the token", async () => {
    const { c, list } = controller("staff");
    await c.list("rest-1");
    expect(list).toHaveBeenCalledWith("rest-1");
  });

  it("a session with no house is refused before anything is read", async () => {
    const { c, list } = controller("owner");
    await expect(c.list(undefined as any)).rejects.toMatchObject({ status: 400 });
    expect(list).not.toHaveBeenCalled();
  });
});
