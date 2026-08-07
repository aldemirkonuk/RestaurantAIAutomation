import { MenusService } from "./menus.service";
import { DatabaseService } from "../database/database.service";

/**
 * getMenu — SimPOS testbed plan decision 39. The menus module had no read
 * path at all, which is why no menu page could exist; this locks in that a
 * restaurant with no active menu returns an empty shape rather than
 * throwing, and that items come back ordered and scoped to the active menu.
 */

type Row = Record<string, any>;

function makeFakeSupabase(tables: Record<string, Row[]>) {
  function from(table: string) {
    const filters: Array<[string, any]> = [];
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
        const rows = (tables[table] || []).filter((r) =>
          filters.every(([c, v]) => r[c] === v),
        );
        return { data: rows[0] ?? null, error: null };
      },
      then(resolve: any) {
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
});
