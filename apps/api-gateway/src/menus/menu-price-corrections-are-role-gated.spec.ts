import { ForbiddenException } from "@nestjs/common";
import { METHOD_METADATA } from "@nestjs/common/constants";
import {
  MenuSectionsController,
  MenuVersionsController,
  MenusController,
} from "./menus.controller";
import { OrganizationsService } from "../organizations/organizations.service";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ReviewMenuItemDto } from "./dto/review-menu-item.dto";

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

  // F-1530: a dish's one price (ADR 0340 rule 7) is a field of the route, and
  // a price like the others: an owner's or a manager's.
  it("a dish's price is a field the route accepts", async () => {
    const dto = plainToInstance(ReviewMenuItemDto, {
      fieldName: "price",
      newValue: "14",
    });
    expect(await validate(dto)).toEqual([]);
  });

  it.each(["staff", null])(
    "%s is refused a dish price correction before anything is written (F-1530)",
    async (role) => {
      const { c, review } = controller(role as string | null);
      await expect(
        c.reviewMenuItem(
          "mi-1",
          { fieldName: "price", newValue: "14" } as any,
          USER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(review).not.toHaveBeenCalled();
    },
  );

  it.each(["owner", "manager"])(
    "a %s may correct a dish's price",
    async (role) => {
      const { c, review } = controller(role);
      await c.reviewMenuItem(
        "mi-1",
        { fieldName: "price", newValue: "14" } as any,
        USER,
      );
      expect(review).toHaveBeenCalledTimes(1);
    },
  );

  it("a session naming no house cannot correct a price", async () => {
    const { c, review } = controller("owner");
    await expect(
      c.reviewMenuItem("mi-1", { fieldName: "bottle_price", newValue: "70" } as any, { userId: "u-1" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(review).not.toHaveBeenCalled();
  });

  // F-920: a rename also renames the house's own wine in stock, so it is held
  // to the price rule. Other fields stay open to the house.
  it.each(["owner", "manager"])("a %s may rename a line", async (role) => {
    const { c, review } = controller(role);
    await c.reviewMenuItem("mi-1", { fieldName: "name", newValue: "Opus" } as any, USER);
    expect(review).toHaveBeenCalledTimes(1);
  });

  it.each(["staff", null])(
    "%s is refused a rename before anything is written (F-920)",
    async (role) => {
      const { c, review } = controller(role as string | null);
      await expect(
        c.reviewMenuItem(
          "mi-1",
          { fieldName: "name", newValue: "Opus" } as any,
          USER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(review).not.toHaveBeenCalled();
    },
  );

  it("a session naming no house cannot rename a line", async () => {
    const { c, review } = controller("owner");
    await expect(
      c.reviewMenuItem("mi-1", { fieldName: "name", newValue: "Opus" } as any, {
        userId: "u-1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(review).not.toHaveBeenCalled();
  });

  it("a SECTION correction by staff is unchanged by this gate", async () => {
    const { c, review } = controller("staff");
    await c.reviewMenuItem(
      "mi-1",
      { fieldName: "category", newValue: "Red" } as any,
      USER,
    );
    expect(review).toHaveBeenCalledTimes(1);
  });
});

describe("POST /menus/items — whether the caller is an owner or a manager is resolved and passed on (F-698)", () => {
  it.each([
    ["owner", true],
    ["manager", true],
    ["staff", false],
    [null, false],
  ])("%s -> manages: %s", async (role, mayPrice) => {
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
      // F-1292: a menu read only in part goes current only when the person said so.
      await c.makeCurrent("rest-1", "u-1", MENU, {
        fingerprint: "fp-1",
        partReadAccepted: true,
      });
      expect(make).toHaveBeenLastCalledWith(
        "rest-1",
        MENU,
        "u-1",
        "fp-1",
        true,
      );
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

  it("ADR 0340 rule 20: a batch is planned and chosen with its other menus, picks and part-read kinds", async () => {
    const OTHER = "00000000-0000-4000-8000-000000000002";
    const { c, plan, make } = controller("manager");
    await c.plan("rest-1", MENU, OTHER);
    expect(plan).toHaveBeenLastCalledWith("rest-1", MENU, [OTHER]);
    await expect(c.plan("rest-1", MENU, "not-an-id")).rejects.toMatchObject({
      status: 400,
    });
    const picks = [
      { wineLibraryId: "mw-a", kind: "bottle" as const, price: 45 },
    ];
    await c.makeCurrent("rest-1", "u-1", MENU, {
      fingerprint: "fp-1",
      menuIds: [OTHER],
      picks,
      partReadAcceptedKinds: ["food"],
    });
    expect(make).toHaveBeenLastCalledWith(
      "rest-1",
      MENU,
      "u-1",
      "fp-1",
      false,
      {
        menuIds: [OTHER],
        picks,
        partReadAcceptedKinds: ["food"],
      },
    );
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

describe("PATCH /menus/:rid/items/:id/discard — owner or manager only (F-268)", () => {
  function controller(role: string | null) {
    const discard = jest.fn(async () => ({
      menuItemId: "mi-1",
      status: "discarded",
    }));
    const c = new MenusController(
      { discardMenuItem: discard } as any,
      orgs(role),
    );
    return { c, discard };
  }

  it.each(["owner", "manager"])(
    "a %s may take a line off the menu",
    async (role) => {
      const { c, discard } = controller(role);
      await c.discardMenuItem("rest-1", "mi-1", { userId: "u-1" });
      // The person rides along for the audit row (F-484, fix/sim-logs-trace).
      expect(discard).toHaveBeenCalledWith("rest-1", "mi-1", "u-1");
    },
  );

  it.each(["staff", null])(
    "%s is refused, and nothing is discarded",
    async (role) => {
      const { c, discard } = controller(role as string | null);
      await expect(
        c.discardMenuItem("rest-1", "mi-1", { userId: "u-1" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(discard).not.toHaveBeenCalled();
    },
  );

  it("a session naming no one is refused", async () => {
    const { c, discard } = controller("owner");
    await expect(
      c.discardMenuItem("rest-1", "mi-1", {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(discard).not.toHaveBeenCalled();
  });
});

describe("PATCH /menus/:rid/items/:id/restore — owner or manager only (F-268)", () => {
  function controller(role: string | null) {
    const restore = jest.fn(async () => ({
      menuItemId: "mi-1",
      status: "approved",
    }));
    const c = new MenusController(
      { restoreMenuItem: restore } as any,
      orgs(role),
    );
    return { c, restore };
  }

  it.each(["owner", "manager"])("a %s may put a line back", async (role) => {
    const { c, restore } = controller(role);
    await c.restoreMenuItem("rest-1", "mi-1", { userId: "u-1" });
    expect(restore).toHaveBeenCalledWith("rest-1", "mi-1", "u-1");
  });

  it.each(["staff", null])(
    "%s is refused, and nothing is put back",
    async (role) => {
      const { c, restore } = controller(role as string | null);
      await expect(
        c.restoreMenuItem("rest-1", "mi-1", { userId: "u-1" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(restore).not.toHaveBeenCalled();
    },
  );

  it("a session naming no one is refused", async () => {
    const { c, restore } = controller("owner");
    await expect(
      c.restoreMenuItem("rest-1", "mi-1", {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(restore).not.toHaveBeenCalled();
  });
});

describe("/menu-versions/:menuId/sections and /lines — every route is an owner's or a manager's (ADR 0340, lane 3b)", () => {
  const MENU = "00000000-0000-4000-8000-000000000001";
  const SEC = "00000000-0000-4000-8000-000000000002";
  const LINE = "00000000-0000-4000-8000-000000000003";
  // Every route handler, called as Nest would: house and actor from the token.
  const ROUTES: Record<
    string,
    (c: MenuSectionsController, house: string | undefined) => Promise<unknown>
  > = {
    list: (c, h) => c.list(h as string, "u-1", MENU),
    create: (c, h) => c.create(h as string, "u-1", MENU, { title: "Reds" }),
    reorder: (c, h) => c.reorder(h as string, "u-1", MENU, { ids: [SEC] }),
    rename: (c, h) =>
      c.rename(h as string, "u-1", MENU, SEC, { title: "Reds" }),
    reparent: (c, h) =>
      c.reparent(h as string, "u-1", MENU, SEC, { parentId: null }),
    remove: (c, h) => c.remove(h as string, "u-1", MENU, SEC),
    move: (c, h) => c.move(h as string, "u-1", MENU, SEC, { kind: "food" }),
    setCategory: (c, h) =>
      c.setCategory(h as string, "u-1", MENU, SEC, { drinkCategory: "red" }),
    confirmSection: (c, h) =>
      c.confirmSection(h as string, "u-1", MENU, SEC, { lineKind: "drink" }),
    assignLines: (c, h) =>
      c.assignLines(h as string, "u-1", MENU, {
        sectionId: SEC,
        lineIds: [LINE],
      }),
    confirmLine: (c, h) =>
      c.confirmLine(h as string, "u-1", MENU, LINE, { lineKind: "dish" }),
    keepGoneLine: (c, h) => c.keepGoneLine(h as string, "u-1", MENU, LINE),
  };
  function controller(role: string | null) {
    const calls: string[] = [];
    const sections = new Proxy(
      {},
      {
        get: (_t, name) => async () => {
          calls.push(String(name));
          return { ok: true };
        },
      },
    );
    const c = new MenuSectionsController(sections as any, orgs(role));
    return { c, calls };
  }

  it("the table above names every route the controller has, so a new route cannot skip this gate", () => {
    const proto = MenuSectionsController.prototype as any;
    const handlers = Object.getOwnPropertyNames(proto).filter(
      (name) =>
        name !== "constructor" &&
        Reflect.getMetadata(METHOD_METADATA, proto[name]) !== undefined,
    );
    expect(handlers.sort()).toEqual(Object.keys(ROUTES).sort());
  });

  it.each(Object.keys(ROUTES))(
    "an owner and a manager may call %s, for the token's house",
    async (name) => {
      for (const role of ["owner", "manager"]) {
        const { c, calls } = controller(role);
        await ROUTES[name](c, "rest-1");
        expect(calls).toHaveLength(1);
      }
    },
  );

  it.each(Object.keys(ROUTES))(
    "staff and a person with no role are refused %s before anything is read or written",
    async (name) => {
      for (const role of ["staff", null]) {
        const { c, calls } = controller(role);
        await expect(ROUTES[name](c, "rest-1")).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(calls).toEqual([]);
      }
    },
  );

  it.each(Object.keys(ROUTES))(
    "a session naming no house is refused %s",
    async (name) => {
      const { c, calls } = controller("owner");
      await expect(ROUTES[name](c, undefined)).rejects.toMatchObject({
        status: 400,
      });
      expect(calls).toEqual([]);
    },
  );
});
