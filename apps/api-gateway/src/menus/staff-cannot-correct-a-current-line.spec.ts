import { ForbiddenException, InternalServerErrorException } from "@nestjs/common";
import { MenusService } from "./menus.service";
import { MenusController } from "./menus.controller";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * r110 menu-r110-1: staff cannot correct the name or the section of a line on
 * the CURRENT menu (renaming it renames the linked Inventory good house-wide).
 * The controller guard (#2295, 8a6349ac1) trusts `lineIsOnCurrentMenu`; the
 * role spec stubs it, so this spec pins the service read itself: only an
 * `active` menu counts, both reads are scoped to the caller's house, and an
 * unreadable read refuses rather than letting the correction through.
 *
 * Then the whole path, with the real service and the real OrganizationsService.
 */

type Row = Record<string, unknown> | null;
interface Tables {
  menu_items: Record<string, { menu_id: string; restaurant_id: string }>;
  restaurant_menus: Record<string, { status: string; restaurant_id: string }>;
  failOn?: "menu_items" | "restaurant_menus";
}

function fakeDb(t: Tables) {
  const from = (table: keyof Omit<Tables, "failOn">) => {
    const eqs: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        eqs[col] = val;
        return chain;
      },
      maybeSingle: async (): Promise<{ data: Row; error: { message: string } | null }> => {
        if (t.failOn === table) return { data: null, error: { message: "connection reset" } };
        const row = (t[table] as Record<string, Record<string, unknown>>)[eqs.id as string];
        // A row of another house is invisible, exactly as the restaurant filter makes it.
        if (!row || eqs.restaurant_id === undefined || row.restaurant_id !== eqs.restaurant_id) {
          return { data: null, error: null };
        }
        return { data: row, error: null };
      },
    };
    return chain;
  };
  return { supabase: { from } } as any;
}

const TABLES: Tables = {
  menu_items: {
    "mi-current": { menu_id: "m-active", restaurant_id: "rest-1" },
    "mi-draft": { menu_id: "m-draft", restaurant_id: "rest-1" },
    "mi-archived": { menu_id: "m-archived", restaurant_id: "rest-1" },
    "mi-other-house": { menu_id: "m-other", restaurant_id: "rest-2" },
  },
  restaurant_menus: {
    "m-active": { status: "active", restaurant_id: "rest-1" },
    "m-draft": { status: "draft", restaurant_id: "rest-1" },
    "m-archived": { status: "archived", restaurant_id: "rest-1" },
    "m-other": { status: "active", restaurant_id: "rest-2" },
  },
};

const service = (t: Tables = TABLES) =>
  new MenusService(fakeDb(t), undefined as any, undefined as any, undefined as any);

describe("lineIsOnCurrentMenu -- what the staff guard trusts", () => {
  it("a line of the active menu is on the current menu", async () => {
    await expect(service().lineIsOnCurrentMenu("mi-current", "rest-1")).resolves.toBe(true);
  });

  it.each(["mi-draft", "mi-archived"])("a line of a %s menu is not (the onboarding review stays open)", async (id) => {
    await expect(service().lineIsOnCurrentMenu(id, "rest-1")).resolves.toBe(false);
  });

  it("an unknown line is not (reviewMenuItem answers its 404)", async () => {
    await expect(service().lineIsOnCurrentMenu("mi-none", "rest-1")).resolves.toBe(false);
  });

  it("another house's active line is never read as this house's", async () => {
    await expect(service().lineIsOnCurrentMenu("mi-other-house", "rest-1")).resolves.toBe(false);
  });

  it("the menu read is scoped to the house too: a line pointing at another house's active menu is not current", async () => {
    const t: Tables = {
      ...TABLES,
      menu_items: { "mi-cross": { menu_id: "m-other", restaurant_id: "rest-1" } },
    };
    await expect(service(t).lineIsOnCurrentMenu("mi-cross", "rest-1")).resolves.toBe(false);
  });

  it.each(["menu_items", "restaurant_menus"] as const)("an unreadable %s refuses with a sentence, never lets it through", async (failOn) => {
    const p = service({ ...TABLES, failOn }).lineIsOnCurrentMenu("mi-current", "rest-1");
    await expect(p).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(p).rejects.toThrow(/Nothing was changed/);
  });
});

describe("PATCH /menus/items/:id -- staff cannot correct name or section on the current menu (real service read)", () => {
  function wire(role: string) {
    const svc = service();
    const review = jest.spyOn(svc, "reviewMenuItem").mockResolvedValue({ menuItemId: "x" } as any);
    const organizations = new OrganizationsService({} as never);
    jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
    return { c: new MenusController(svc, organizations), review };
  }
  const USER = { userId: "u-1", restaurantId: "rest-1" };

  it.each(["name", "category"])("staff correcting %s on a current line get 403 with a sentence, nothing written", async (fieldName) => {
    const { c, review } = wire("staff");
    const p = c.reviewMenuItem("mi-current", { fieldName, newValue: "Mezes" } as any, USER);
    await expect(p).rejects.toBeInstanceOf(ForbiddenException);
    await expect(p).rejects.toThrow(/correct a line on the current menu/);
    expect(review).not.toHaveBeenCalled();
  });

  it("staff correcting a draft line's section are let through (onboarding review)", async () => {
    const { c, review } = wire("staff");
    await c.reviewMenuItem("mi-draft", { fieldName: "category", newValue: "Mezes" } as any, USER);
    expect(review).toHaveBeenCalledTimes(1);
  });

  it("a manager may correct a current line's name", async () => {
    const { c, review } = wire("manager");
    await c.reviewMenuItem("mi-current", { fieldName: "name", newValue: "Mezes" } as any, USER);
    expect(review).toHaveBeenCalledTimes(1);
  });
});
