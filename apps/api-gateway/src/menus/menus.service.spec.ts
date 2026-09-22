import { MenusService } from "./menus.service";
import { DatabaseService } from "../database/database.service";

/**
 * getMenu — SimPOS testbed plan decision 39. The menus module had no read
 * path at all, which is why no menu page could exist; this locks in that a
 * restaurant with no active menu returns an empty shape rather than
 * throwing, and that items come back ordered and scoped to the active menu.
 */

type Row = Record<string, any>;

/**
 * `errors[table]` forces every read AND write against that table to resolve
 * as a Supabase-shaped `{ data: null, error: { message } }` — the fake's way
 * of simulating a dropped connection or a schema error, for the "a failed
 * read is an error, never an empty success" specs.
 */
function makeFakeSupabase(
  tables: Record<string, Row[]>,
  errors: Record<string, string> = {},
) {
  function from(table: string) {
    const filters: Array<[string, any]> = [];
    const forcedError = errors[table];
    const api: any = {
      select() {
        return api;
      },
      eq(col: string, val: any) {
        filters.push([col, val]);
        return api;
      },
      order() {
        return api;
      },
      maybeSingle: async () => {
        if (forcedError) return { data: null, error: { message: forcedError } };
        const rows = (tables[table] || []).filter((r) =>
          filters.every(([c, v]) => r[c] === v),
        );
        return { data: rows[0] ?? null, error: null };
      },
      update(patch: Record<string, any>) {
        const updateFilters: Array<[string, any]> = [];
        const updateApi: any = {
          eq(col: string, val: any) {
            updateFilters.push([col, val]);
            return updateApi;
          },
          then(resolve: any) {
            if (forcedError) {
              resolve({ data: null, error: { message: forcedError } });
              return;
            }
            for (const row of tables[table] || []) {
              if (updateFilters.every(([c, v]) => row[c] === v)) {
                Object.assign(row, patch);
              }
            }
            resolve({ data: null, error: null });
          },
        };
        return updateApi;
      },
      then(resolve: any) {
        if (forcedError) {
          resolve({ data: null, error: { message: forcedError } });
          return;
        }
        const rows = (tables[table] || []).filter((r) =>
          filters.every(([c, v]) => r[c] === v),
        );
        resolve({ data: rows, error: null });
      },
    };
    return api;
  }
  return { from } as any;
}

function makeService(
  tables: Record<string, Row[]>,
  errors: Record<string, string> = {},
) {
  const supabase = makeFakeSupabase(tables, errors);
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
});

/**
 * `PATCH /menus/items/:id` and `POST /menus/items` — house-scope fix,
 * fix/menu-item-house-scope (2026-09-21). Both used to load their target
 * row by an id from the request alone, so a caller authenticated for ANY
 * restaurant could edit or add to a DIFFERENT restaurant's menu. Neither
 * route names a restaurant in its path, and `PATCH /menus/items/:id` names
 * none in its body either, so `assertTenantMatch` (the mechanism that
 * closes this hole for every OTHER route) has nothing to compare here — the
 * fix has to be in the service itself.
 */
describe("MenusService.reviewMenuItem — house scope", () => {
  const line = {
    id: "mi-1",
    menu_id: "menu-1",
    restaurant_id: "rest-1",
    name: "Opus One",
    vintage: "2015",
    submission_id: null,
    inventory_item_id: null,
  };

  it("edits a line that belongs to the caller's own house", async () => {
    const row = { ...line };
    const service = makeService({ menu_items: [row] });

    const result = await service.reviewMenuItem("mi-1", "user-1", "rest-1", {
      fieldName: "vintage",
      newValue: "2016",
    } as any);

    expect(result).toEqual({
      menuItemId: "mi-1",
      fieldName: "vintage",
      newValue: "2016",
    });
    // The write reached the row, not just the response.
    expect(row.vintage).toBe("2016");
  });

  it("404s a line that belongs to a different house, never revealing it exists", async () => {
    const row = { ...line };
    const service = makeService({ menu_items: [row] });

    await expect(
      service.reviewMenuItem("mi-1", "user-1", "rest-2", {
        fieldName: "vintage",
        newValue: "2016",
      } as any),
    ).rejects.toMatchObject({ status: 404 });
    // Nothing was written to the other house's line.
    expect(row.vintage).toBe("2015");
  });

  it("404s a line id that does not exist at all", async () => {
    const service = makeService({ menu_items: [] });

    await expect(
      service.reviewMenuItem("mi-missing", "user-1", "rest-1", {
        fieldName: "vintage",
        newValue: "2016",
      } as any),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("404s when the caller's token names no house at all", async () => {
    // A real menu_items.restaurant_id is NOT NULL, so a row this shape can't
    // occur in production — the fixture exists only so an `.eq(col, null)`
    // that accidentally matched it could never pass silently, which is
    // exactly what removing the explicit null check would risk.
    const service = makeService({
      menu_items: [{ ...line, restaurant_id: null }],
    });

    await expect(
      service.reviewMenuItem("mi-1", "user-1", null, {
        fieldName: "vintage",
        newValue: "2016",
      } as any),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("surfaces a failed read as an error, never as an empty 404", async () => {
    const service = makeService(
      { menu_items: [{ ...line }] },
      { menu_items: "connection reset" },
    );

    await expect(
      service.reviewMenuItem("mi-1", "user-1", "rest-1", {
        fieldName: "vintage",
        newValue: "2016",
      } as any),
    ).rejects.toThrow(/connection reset/);
  });
});

describe("MenusService.addMenuItem — house scope", () => {
  const menu = { id: "menu-1", restaurant_id: "rest-1" };

  it("lets a menu of the caller's own house through to the wine-library step", async () => {
    // The persistence pipeline after the house check needs inserts this fake
    // does not model, so the library resolver (a dependency, not the unit
    // under test) stops the run with a marker once the check has passed.
    // Reaching it, with the caller's house, is what this spec proves.
    const resolveLibraryWinesBatch = jest.fn(async () => {
      throw new Error("reached library resolution");
    });
    const service = new MenusService(
      {
        supabase: makeFakeSupabase({ restaurant_menus: [{ ...menu }] }),
      } as unknown as DatabaseService,
      undefined as any,
      undefined as any,
      { resolveLibraryWinesBatch } as any,
    );

    await expect(
      service.addMenuItem(
        { menuId: "menu-1", name: "House Red" } as any,
        "user-1",
        "rest-1",
      ),
    ).rejects.toThrow(/reached library resolution/);
    expect(resolveLibraryWinesBatch).toHaveBeenCalledTimes(1);
    expect(resolveLibraryWinesBatch).toHaveBeenCalledWith(
      expect.any(Array),
      "rest-1",
    );
  });

  it("404s a menu that belongs to a different house, never revealing it exists", async () => {
    const service = makeService({ restaurant_menus: [{ ...menu }] });

    await expect(
      service.addMenuItem(
        { menuId: "menu-1", name: "House Red" } as any,
        "user-1",
        "rest-2",
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("404s a menu id that does not exist at all", async () => {
    const service = makeService({ restaurant_menus: [] });

    await expect(
      service.addMenuItem(
        { menuId: "menu-missing", name: "House Red" } as any,
        "user-1",
        "rest-1",
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("404s when the caller's token names no house at all", async () => {
    // A real restaurant_menus.restaurant_id is NOT NULL, so a row this shape
    // can't occur in production — the fixture exists only so an
    // `.eq(col, null)` that accidentally matched it could never pass
    // silently, which is exactly what removing the explicit null check
    // would risk.
    const service = makeService({
      restaurant_menus: [{ ...menu, restaurant_id: null }],
    });

    await expect(
      service.addMenuItem(
        { menuId: "menu-1", name: "House Red" } as any,
        "user-1",
        null,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("surfaces a failed read as an error, never as an empty 404", async () => {
    const service = makeService(
      { restaurant_menus: [{ ...menu }] },
      { restaurant_menus: "connection reset" },
    );

    await expect(
      service.addMenuItem(
        { menuId: "menu-1", name: "House Red" } as any,
        "user-1",
        "rest-1",
      ),
    ).rejects.toThrow(/connection reset/);
  });
});
