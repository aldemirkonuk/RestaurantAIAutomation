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

type RpcCall = [string, Row];

function makeFakeSupabase(
  tables: Record<string, Row[]>,
  rpcImpl?: (fn: string, args: Row) => { data: unknown; error: unknown },
  rpcCalls: RpcCall[] = [],
) {
  let seq = 0;
  function from(table: string) {
    const filters: Array<[string, any, boolean]> = [];
    let updatePatch: Row | null = null;
    // ADR 0193's tests drive the whole add-a-line pipeline, which INSERTs and
    // reads the inserted rows back; the fake appends them to the table so a
    // later read sees them, same as the real write.
    let inserted: Row[] | null = null;
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
      insert(rows: Row | Row[]) {
        const list = Array.isArray(rows) ? rows : [rows];
        inserted = list.map((r) => ({
          id: `${table}-${++seq}`,
          created_at: "2026-09-21T10:00:00.000Z",
          ...r,
        }));
        (tables[table] = tables[table] || []).push(...inserted);
        return api;
      },
      single: async () => {
        const rows = inserted ?? matching();
        return { data: rows[0] ?? null, error: null };
      },
      order() {
        return api;
      },
      maybeSingle: async () => {
        const rows = matching();
        return { data: rows[0] ?? null, error: null };
      },
      then(resolve: any) {
        if (inserted) return resolve({ data: inserted, error: null });
        const rows = matching();
        if (updatePatch) for (const row of rows) Object.assign(row, updatePatch);
        resolve({ data: rows, error: null });
      },
    };
    return api;
  }
  const rpc = async (fn: string, args: Row) => {
    rpcCalls.push([fn, args]);
    return rpcImpl ? rpcImpl(fn, args) : { data: null, error: { message: `no rpc ${fn} in this fake` } };
  };
  return { from, rpc } as any;
}

function makeService(
  tables: Record<string, Row[]>,
  opts: {
    rpc?: (fn: string, args: Row) => { data: unknown; error: unknown };
    rpcCalls?: RpcCall[];
    wineSubmissions?: unknown;
  } = {},
) {
  const supabase = makeFakeSupabase(tables, opts.rpc, opts.rpcCalls);
  const dbService = { supabase } as unknown as DatabaseService;
  return new MenusService(
    dbService,
    undefined as any,
    undefined as any,
    (opts.wineSubmissions ?? undefined) as any,
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

  it("excludes a discarded line from the read (migration 20260921112100)", async () => {
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

/**
 * ADR 0193 -- PATCH /menus/items/:id had NO tenant check: the route names no
 * restaurant, and the service loaded the menu line by id alone. From this
 * build a price correction also re-prices the house's wine, so the hole is
 * closed first: the line is read scoped to the caller's own house (from the
 * JWT) and a foreign id is the same 404 as a missing one.
 */
describe("MenusService.reviewMenuItem — tenant isolation and the house price (ADR 0193)", () => {
  const line = () => ({
    id: "mi-1",
    menu_id: "menu-1",
    restaurant_id: "rest-1",
    name: "Opus One",
    bottle_price: 60,
    by_glass_price: null,
    inventory_item_id: "inv-1",
    submission_id: null,
    status: "approved",
  });
  const changed = () => ({
    data: { outcome: "changed", bottle_price: 70, glass_price: null, previous_bottle: 60 },
    error: null,
  });

  it("404s for a menu line of ANOTHER house, and neither the line nor any price is touched", async () => {
    const calls: RpcCall[] = [];
    const tables = { menu_items: [line()] };
    const service = makeService(tables, { rpc: changed, rpcCalls: calls });

    await expect(
      service.reviewMenuItem("mi-1", "user-2", "rest-2", {
        fieldName: "bottle_price",
        newValue: "1",
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tables.menu_items[0].bottle_price).toBe(60);
    expect(tables.menu_items[0].status).toBe("approved");
    expect(calls).toHaveLength(0);
  });

  it("refuses a session with no house on its token", async () => {
    const service = makeService({ menu_items: [line()] }, { rpc: changed });
    await expect(
      service.reviewMenuItem("mi-1", "user-1", null, {
        fieldName: "name",
        newValue: "x",
      } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("a price correction on the caller's own line writes the house's bottle price as 'import', by the person on the token", async () => {
    const calls: RpcCall[] = [];
    const tables = { menu_items: [line()] };
    const service = makeService(tables, { rpc: changed, rpcCalls: calls });

    const result = await service.reviewMenuItem("mi-1", "user-1", "rest-1", {
      fieldName: "bottle_price",
      newValue: "$70",
    } as any);

    expect(tables.menu_items[0].bottle_price).toBe(70);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("set_house_menu_price");
    expect(calls[0][1]).toMatchObject({
      p_restaurant_id: "rest-1",
      p_inventory_id: "inv-1",
      p_set_bottle: true,
      p_bottle_price: 70,
      p_set_glass: false,
      p_change_source: "import",
      p_changed_by: "user-1",
    });
    expect(result.priceSync).toBe("changed");
  });

  it("a glass correction writes the glass price and leaves the bottle alone", async () => {
    const calls: RpcCall[] = [];
    const service = makeService({ menu_items: [line()] }, { rpc: changed, rpcCalls: calls });
    await service.reviewMenuItem("mi-1", "user-1", "rest-1", {
      fieldName: "by_glass_price",
      newValue: "14",
    } as any);
    expect(calls[0][1]).toMatchObject({ p_set_glass: true, p_glass_price: 14, p_set_bottle: false });
  });

  it("a line with no inventory row says so ('not_linked') and writes no price", async () => {
    const calls: RpcCall[] = [];
    const service = makeService(
      { menu_items: [{ ...line(), inventory_item_id: null }] },
      { rpc: changed, rpcCalls: calls },
    );
    const result = await service.reviewMenuItem("mi-1", "user-1", "rest-1", {
      fieldName: "bottle_price",
      newValue: "70",
    } as any);
    expect(result.priceSync).toBe("not_linked");
    expect(calls).toHaveLength(0);
  });

  it("a refused price write is reported as 'failed' with the reason, never as success", async () => {
    const service = makeService(
      { menu_items: [line()] },
      { rpc: () => ({ data: null, error: { code: "P0002", message: "no inventory item" } }) },
    );
    const result = await service.reviewMenuItem("mi-1", "user-1", "rest-1", {
      fieldName: "bottle_price",
      newValue: "70",
    } as any);
    expect(result.priceSync).toBe("failed");
    expect(result.priceSyncError).toMatch(/No wine of this house/);
  });

  it("a name correction writes no price", async () => {
    const calls: RpcCall[] = [];
    const service = makeService({ menu_items: [line()] }, { rpc: changed, rpcCalls: calls });
    const result = await service.reviewMenuItem("mi-1", "user-1", "rest-1", {
      fieldName: "name",
      newValue: "Opus One 2019",
    } as any);
    expect(calls).toHaveLength(0);
    expect(result.priceSync).toBeUndefined();
  });
});

/**
 * ADR 0193 -- "it could be changed every time a menu is updated". Adding a
 * line (the same pipeline a scan or CSV import runs) used to insert the
 * inventory row with NO price, dropping the line's by_glass_price /
 * bottle_price. Now the line's prices reach the house, dated by the line.
 */
describe("MenusService.addMenuItem — the line's prices reach the house (ADR 0193)", () => {
  const wineSubmissions = {
    resolveLibraryWinesBatch: async (items: unknown[]) =>
      items.map(() => ({ masterWineId: "mw-1", matched: true, libraryTier: 1, confidence: 99 })),
    normalizeText: (t: string | null | undefined) => (t ? t.toLowerCase() : null),
  };

  it("an existing house wine gets the line's prices as 'import', effective from the line's own created_at", async () => {
    const calls: RpcCall[] = [];
    const tables: Record<string, Row[]> = {
      restaurant_menus: [{ id: "menu-1", restaurant_id: "rest-1" }],
      restaurants: [{ id: "rest-1", default_threshold_min: 3 }],
      restaurant_inventory: [{ id: "inv-1", restaurant_id: "rest-1", master_wine_id: "mw-1" }],
      menu_items: [],
    };
    const service = makeService(tables, {
      wineSubmissions,
      rpcCalls: calls,
      rpc: () => ({ data: { outcome: "changed", bottle_price: 62, glass_price: 14 }, error: null }),
    });

    const item = await service.addMenuItem(
      { menuId: "menu-1", name: "Opus One", bottle_price: 62, by_glass_price: 14 } as any,
      "user-1",
      "rest-1",
    );

    const priceCalls = calls.filter(([fn]) => fn === "set_house_menu_price");
    expect(priceCalls).toHaveLength(1);
    expect(priceCalls[0][1]).toMatchObject({
      p_restaurant_id: "rest-1",
      p_inventory_id: "inv-1",
      p_set_bottle: true,
      p_bottle_price: 62,
      p_set_glass: true,
      p_glass_price: 14,
      p_change_source: "import",
      p_changed_by: "user-1",
      p_effective_from: "2026-09-21T10:00:00.000Z",
    });
    expect(item.priceSync).toBe("changed");
  });

  it("a new house wine is inserted WITHOUT a price, then priced through the writer (so its history names the person)", async () => {
    const calls: RpcCall[] = [];
    const tables: Record<string, Row[]> = {
      restaurant_menus: [{ id: "menu-1", restaurant_id: "rest-1" }],
      restaurants: [{ id: "rest-1", default_threshold_min: 3 }],
      restaurant_inventory: [],
      menu_items: [],
    };
    const service = makeService(tables, {
      wineSubmissions,
      rpcCalls: calls,
      rpc: () => ({ data: { outcome: "changed", bottle_price: 62, glass_price: null }, error: null }),
    });

    await service.addMenuItem(
      { menuId: "menu-1", name: "Opus One", bottle_price: 62 } as any,
      "user-1",
      "rest-1",
    );

    expect(tables.restaurant_inventory).toHaveLength(1);
    const insertedRow = tables.restaurant_inventory[0];
    expect(insertedRow).not.toHaveProperty("menu_price_current");
    expect(insertedRow).not.toHaveProperty("menu_price_glass");
    const priceCalls = calls.filter(([fn]) => fn === "set_house_menu_price");
    expect(priceCalls).toHaveLength(1);
    expect(priceCalls[0][1]).toMatchObject({
      p_inventory_id: insertedRow.id,
      p_set_bottle: true,
      p_bottle_price: 62,
      p_set_glass: false,
      p_change_source: "import",
    });
  });

  it("a line older than the price in effect is reported 'stale' and changes nothing", async () => {
    const tables: Record<string, Row[]> = {
      restaurant_menus: [{ id: "menu-1", restaurant_id: "rest-1" }],
      restaurants: [{ id: "rest-1", default_threshold_min: 3 }],
      restaurant_inventory: [{ id: "inv-1", restaurant_id: "rest-1", master_wine_id: "mw-1" }],
      menu_items: [],
    };
    const service = makeService(tables, {
      wineSubmissions,
      rpc: () => ({
        data: { outcome: "stale", bottle_price: 70, current_since: "2026-09-21T11:00:00Z", current_source: "manual" },
        error: null,
      }),
    });
    const item = await service.addMenuItem(
      { menuId: "menu-1", name: "Opus One", bottle_price: 62 } as any,
      "user-1",
      "rest-1",
    );
    expect(item.priceSync).toBe("stale");
  });

  it("a line with no price writes none -- a scan that missed a column is not a decision to clear it", async () => {
    const calls: RpcCall[] = [];
    const tables: Record<string, Row[]> = {
      restaurant_menus: [{ id: "menu-1", restaurant_id: "rest-1" }],
      restaurants: [{ id: "rest-1", default_threshold_min: 3 }],
      restaurant_inventory: [{ id: "inv-1", restaurant_id: "rest-1", master_wine_id: "mw-1" }],
      menu_items: [],
    };
    const service = makeService(tables, { wineSubmissions, rpcCalls: calls, rpc: () => ({ data: null, error: null }) });
    const item = await service.addMenuItem(
      { menuId: "menu-1", name: "Opus One" } as any,
      "user-1",
      "rest-1",
    );
    expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(0);
    expect(item.priceSync).toBe("no_price");
  });
});
