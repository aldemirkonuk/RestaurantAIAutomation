import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { MenusService } from "./menus.service";
import { DatabaseService } from "../database/database.service";

/**
 * getMenu — SimPOS testbed plan decision 39. The menus module had no read
 * path at all, which is why no menu page could exist; this locks in that a
 * restaurant with no active menu returns an empty shape rather than
 * throwing, and that items come back ordered and scoped to the active menu.
 *
 * addMenuItem / discardMenuItem — ADR 0160 sec110 item 7's `/menu` build.
 * `applyUpdate` below lets the fake also answer `.update(...).eq(...)`, which
 * `discardMenuItem` needs; it mutates the table in place, same as the real
 * write would, so a discarded row is genuinely gone from a later `getMenu`
 * read in the same test — the mutation is exercised, not just the call.
 */

type Row = Record<string, any>;

function makeFakeSupabase(tables: Record<string, Row[]>) {
  function from(table: string) {
    const filters: Array<[string, any, boolean]> = [];
    let updatePatch: Row | null = null;
    const matching = () =>
      (tables[table] || []).filter((r) =>
        filters.every(([c, v, eq]) => (eq ? r[c] === v : r[c] !== v)),
      );
    const api: any = {
      select() {
        return api;
      },
      eq(col: string, val: any) {
        filters.push([col, val, true]);
        return api;
      },
      neq(col: string, val: any) {
        filters.push([col, val, false]);
        return api;
      },
      // Applied lazily in `then`, so `.update(...).eq(...)` can carry more
      // than one filter before the write actually lands — same shape as the
      // real query builder, which is also a thenable rather than a promise.
      update(patch: Row) {
        updatePatch = patch;
        return api;
      },
      order() {
        return api;
      },
      maybeSingle: async () => {
        const rows = matching();
        return { data: rows[0] ?? null, error: null };
      },
      then(resolve: any) {
        const rows = matching();
        if (updatePatch) for (const row of rows) Object.assign(row, updatePatch);
        resolve({ data: rows, error: null });
      },
    };
    return api;
  }
  return { from } as any;
}

function makeService(tables: Record<string, Row[]>) {
  const supabase = makeFakeSupabase(tables);
  const dbService = { supabase } as unknown as DatabaseService;
  return new MenusService(
    dbService,
    undefined as any,
    undefined as any,
    undefined as any,
  );
}

describe("MenusService.getMenu", () => {
  it("returns an empty shape when the restaurant has no active menu", async () => {
    const service = makeService({ restaurant_menus: [], menu_items: [] });
    const result = await service.getMenu("rest-1");
    expect(result).toEqual({
      menuId: null,
      name: null,
      status: null,
      items: [],
    });
  });

  it("returns the active menu's items scoped to that menu only", async () => {
    const service = makeService({
      restaurant_menus: [
        {
          id: "menu-1",
          restaurant_id: "rest-1",
          name: "Wine List",
          status: "active",
        },
        {
          id: "menu-2",
          restaurant_id: "rest-2",
          name: "Other",
          status: "active",
        },
      ],
      menu_items: [
        { id: "mi-1", menu_id: "menu-1", name: "Opus One", category: "Red" },
        { id: "mi-2", menu_id: "menu-1", name: "Sancerre", category: "White" },
        {
          id: "mi-3",
          menu_id: "menu-2",
          name: "Should not appear",
          category: "Red",
        },
      ],
    });

    const result = await service.getMenu("rest-1");

    expect(result.menuId).toBe("menu-1");
    expect(result.items).toHaveLength(2);
    expect(result.items.map((i: any) => i.id).sort()).toEqual(["mi-1", "mi-2"]);
  });

  it("excludes a discarded line from the read (migration 20260917153000)", async () => {
    const service = makeService({
      restaurant_menus: [
        { id: "menu-1", restaurant_id: "rest-1", name: "Wine List", status: "active" },
      ],
      menu_items: [
        { id: "mi-1", menu_id: "menu-1", name: "Opus One", category: "Red", status: "approved" },
        { id: "mi-2", menu_id: "menu-1", name: "Gone", category: "Red", status: "discarded" },
      ],
    });

    const result = await service.getMenu("rest-1");
    expect(result.items.map((i: any) => i.id)).toEqual(["mi-1"]);
  });
});

/**
 * TENANT ISOLATION REGRESSION (found and fixed 2026-09-17, ADR 0160 sec110
 * item 7 build). Before this fix, `addMenuItem` trusted `dto.menuId` alone: a
 * caller authenticated for ANY restaurant could add a line to a DIFFERENT
 * restaurant's menu, because nothing compared `menu.restaurant_id` against
 * the caller's own. These tests fail on the pre-fix code (no
 * `callerRestaurantId` parameter, no comparison) and must keep failing if
 * that comparison is ever weakened or removed — see project memory
 * "checks-cannot-see-their-own-removal": a fix with no test for the exact
 * defect it closes is not verified, it is merely present.
 */
describe("MenusService.addMenuItem — tenant isolation", () => {
  it("refuses a caller whose own restaurant does not own the menu", async () => {
    const service = makeService({
      restaurant_menus: [{ id: "menu-1", restaurant_id: "rest-1" }],
    });

    await expect(
      service.addMenuItem(
        { menuId: "menu-1", name: "Should not land" } as any,
        "user-1",
        "rest-2",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses a caller who carries no restaurant at all", async () => {
    const service = makeService({
      restaurant_menus: [{ id: "menu-1", restaurant_id: "rest-1" }],
    });

    await expect(
      service.addMenuItem(
        { menuId: "menu-1", name: "Should not land" } as any,
        "user-1",
        null,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("still 404s for a menu id that does not exist, before the tenant check runs", async () => {
    const service = makeService({ restaurant_menus: [] });

    await expect(
      service.addMenuItem(
        { menuId: "missing", name: "Should not land" } as any,
        "user-1",
        "rest-1",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("MenusService.discardMenuItem (ADR 0160 sec110 item 7)", () => {
  it("soft-removes the line — status becomes 'discarded', the row stays, and getMenu stops serving it", async () => {
    const tables = {
      menu_items: [
        {
          id: "mi-1",
          menu_id: "menu-1",
          restaurant_id: "rest-1",
          name: "Opus One",
          category: "Red",
          status: "approved",
        },
      ],
      restaurant_menus: [
        { id: "menu-1", restaurant_id: "rest-1", name: "Wine List", status: "active" },
      ],
    };
    const service = makeService(tables);

    const result = await service.discardMenuItem("rest-1", "mi-1");
    expect(result).toEqual({ menuItemId: "mi-1", status: "discarded" });

    // The row stays — a soft remove, never a DELETE.
    expect(tables.menu_items).toHaveLength(1);
    expect(tables.menu_items[0].status).toBe("discarded");

    const menu = await service.getMenu("rest-1");
    expect(menu.items).toHaveLength(0);
  });

  it("404s rather than discarding a menu item that belongs to a different restaurant", async () => {
    const service = makeService({
      menu_items: [
        { id: "mi-1", menu_id: "menu-1", restaurant_id: "rest-1", status: "approved" },
      ],
    });

    await expect(service.discardMenuItem("rest-2", "mi-1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("404s for a menu item id that does not exist", async () => {
    const service = makeService({ menu_items: [] });

    await expect(service.discardMenuItem("rest-1", "missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
