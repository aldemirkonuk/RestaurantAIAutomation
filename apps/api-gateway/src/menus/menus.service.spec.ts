import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { MenusService } from "./menus.service";
import { DatabaseService } from "../database/database.service";
import { CsvParserService } from "./parsers/csv-parser.service";
import { MenuReadWaitingException } from "./parsers/scan-parser.service";

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
    const extra: Array<(r: Row) => boolean> = [];
    // `tables.__readFails = [{ <table>: "<message>" }]` makes every READ of
    // that table fail with the message (writes still land), so a test can
    // prove a failed read is said, never taken for "no row".
    const readFails = (): string | undefined =>
      ((tables as any).__readFails?.[0] ?? {})[table];
    const matching = () =>
      (tables[table] || []).filter(
        (r) =>
          filters.every(([c, v, eq]) => (eq ? r[c] === v : r[c] !== v)) &&
          extra.every((f) => f(r)),
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
      // Keyset paging (readLines / listVersions): `gt` narrows, `limit` is a
      // page size the fake never reaches, `in` is a set filter.
      gt(col: string, val: any) {
        extra.push((r) => String(r[col]) > String(val));
        return api;
      },
      in(col: string, vals: any[]) {
        extra.push((r) => vals.includes(r[col]));
        return api;
      },
      limit() {
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
        if (readFails()) return { data: null, error: { message: readFails() } };
        const rows = matching();
        return { data: rows[0] ?? null, error: null };
      },
      then(resolve: any) {
        if (inserted) return resolve({ data: inserted, error: null });
        if (!updatePatch && readFails()) return resolve({ data: null, error: { message: readFails() } });
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
  // The private bucket the menu read keeps its source in. Uploads land in
  // `tables.__storage` so a test can see what was kept; `storageFails` makes
  // every upload fail with that message.
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Buffer, o: Row) => {
        if (tables.__storageFails) return { data: null, error: { message: String(tables.__storageFails[0]) } };
        (tables.__storage = tables.__storage || []).push({ bucket, path, bytes: bytes.length, ...o });
        return { data: { path }, error: null };
      },
      createSignedUrl: async (path: string, seconds: number) => ({
        data: { signedUrl: `https://signed.test/${bucket}/${path}?e=${seconds}` },
        error: null,
      }),
    }),
  };
  return { from, rpc, storage } as any;
}

function makeService(
  tables: Record<string, Row[]>,
  opts: {
    rpc?: (fn: string, args: Row) => { data: unknown; error: unknown };
    rpcCalls?: RpcCall[];
    wineSubmissions?: unknown;
    csvParser?: unknown;
    scanParser?: unknown;
  } = {},
) {
  const supabase = makeFakeSupabase(tables, opts.rpc, opts.rpcCalls);
  const dbService = { supabase } as unknown as DatabaseService;
  return new MenusService(
    dbService,
    (opts.csvParser ?? undefined) as any,
    (opts.scanParser ?? undefined) as any,
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
        { id: "mi-1", menu_id: "menu-1", restaurant_id: "rest-1", name: "Opus One", category: "Red" },
        { id: "mi-2", menu_id: "menu-1", restaurant_id: "rest-1", name: "Sancerre", category: "White" },
        {
          id: "mi-3",
          menu_id: "menu-2",
          restaurant_id: "rest-2",
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
        { id: "mi-1", menu_id: "menu-1", restaurant_id: "rest-1", name: "Opus One", category: "Red", status: "approved" },
        { id: "mi-2", menu_id: "menu-1", restaurant_id: "rest-1", name: "Gone", category: "Red", status: "discarded" },
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
  // The line's menu is the house's CURRENT one: only a current menu's price
  // correction reaches the house's own price (menu versions, ADR 0193).
  const CURRENT = () => ({ id: "menu-1", restaurant_id: "rest-1", status: "active" });
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
    const tables = { menu_items: [line()], restaurant_menus: [CURRENT()] };
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
    const service = makeService({ menu_items: [line()], restaurant_menus: [CURRENT()] }, { rpc: changed });
    await expect(
      service.reviewMenuItem("mi-1", "user-1", null, {
        fieldName: "name",
        newValue: "x",
      } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("a price correction on the caller's own line writes the house's bottle price as 'import', by the person on the token", async () => {
    const calls: RpcCall[] = [];
    const tables = { menu_items: [line()], restaurant_menus: [CURRENT()] };
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
    const service = makeService({ menu_items: [line()], restaurant_menus: [CURRENT()] }, { rpc: changed, rpcCalls: calls });
    await service.reviewMenuItem("mi-1", "user-1", "rest-1", {
      fieldName: "by_glass_price",
      newValue: "14",
    } as any);
    expect(calls[0][1]).toMatchObject({ p_set_glass: true, p_glass_price: 14, p_set_bottle: false });
  });

  it("a line with no inventory row says so ('not_linked') and writes no price", async () => {
    const calls: RpcCall[] = [];
    const service = makeService(
      { menu_items: [{ ...line(), inventory_item_id: null }], restaurant_menus: [CURRENT()] },
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
      { menu_items: [line()], restaurant_menus: [CURRENT()] },
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
    const service = makeService({ menu_items: [line()], restaurant_menus: [CURRENT()] }, { rpc: changed, rpcCalls: calls });
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
      restaurant_menus: [{ id: "menu-1", restaurant_id: "rest-1", status: "active" }],
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
      true,
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
      restaurant_menus: [{ id: "menu-1", restaurant_id: "rest-1", status: "active" }],
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
      true,
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
      restaurant_menus: [{ id: "menu-1", restaurant_id: "rest-1", status: "active" }],
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
      true,
    );
    expect(item.priceSync).toBe("stale");
  });

  it("a line with no price writes none -- a scan that missed a column is not a decision to clear it", async () => {
    const calls: RpcCall[] = [];
    const tables: Record<string, Row[]> = {
      restaurant_menus: [{ id: "menu-1", restaurant_id: "rest-1", status: "active" }],
      restaurants: [{ id: "rest-1", default_threshold_min: 3 }],
      restaurant_inventory: [{ id: "inv-1", restaurant_id: "rest-1", master_wine_id: "mw-1" }],
      menu_items: [],
    };
    const service = makeService(tables, { wineSubmissions, rpcCalls: calls, rpc: () => ({ data: null, error: null }) });
    const item = await service.addMenuItem(
      { menuId: "menu-1", name: "Opus One" } as any,
      "user-1",
      "rest-1",
      true,
    );
    expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(0);
    expect(item.priceSync).toBe("no_price");
  });
});

/**
 * MENU VERSIONS (ADR 0193; the founder, 2026-09-21, answer 7): newest scan
 * wins; an optional cadence tag and date; keep ALL menu extractions (the
 * source and the extracted lines); a current menu and the last one used; after
 * a read the person chooses whether it becomes current; either way it is kept.
 */
describe("MenusService — every menu read is kept as its own version", () => {
  const wineSubmissions = {
    resolveLibraryWinesBatch: async (items: unknown[]) =>
      items.map(() => ({ masterWineId: "mw-1", matched: true, libraryTier: 1, confidence: 99 })),
    normalizeText: (t: string | null | undefined) => (t ? t.toLowerCase() : null),
  };
  const csv = "name,producer,bottle_price,by_glass_price\nOpus One,Opus,62,14\n";
  const base = () => ({
    restaurant_menus: [{ id: "menu-old", restaurant_id: "rest-1", status: "active" }] as Row[],
    restaurants: [{ id: "rest-1", default_threshold_min: 3 }] as Row[],
    restaurant_inventory: [{ id: "inv-1", restaurant_id: "rest-1", master_wine_id: "mw-1", menu_price_current: 60 }] as Row[],
    menu_items: [] as Row[],
    user_onboarding_progress: [] as Row[],
    master_wine_library_submissions: [] as Row[],
  });

  it("a CSV read becomes a NEW draft version with its source, its lines as read, and who read it -- and touches no price", async () => {
    const calls: RpcCall[] = [];
    const tables: Record<string, Row[]> = base();
    const service = makeService(tables, { wineSubmissions, rpcCalls: calls, csvParser: new CsvParserService() });

    const r = await service.importMenu(
      { method: "csv", data: { csvContent: csv }, restaurantId: "rest-1", cadence: "monthly", menuDate: "2026-10" } as any,
      "user-1",
    );

    expect(r.current).toBe(false);
    expect(r.source).toEqual({ kept: true, failure: null });
    const version = tables.restaurant_menus.find((m) => m.id === r.menuId)!;
    expect(version).toMatchObject({
      restaurant_id: "rest-1",
      status: "draft",
      cadence: "monthly",
      menu_date: "2026-10-01",
      menu_date_precision: "month",
      source_method: "csv",
      source_mime: "text/csv",
      lines_extracted: 1,
      extracted_by: "user-1",
    });
    expect(version.extraction).toEqual([expect.objectContaining({ name: "Opus One" })]);
    expect(version.source_path).toMatch(/^rest-1\/menus\/[0-9a-f]{64}\.csv$/);
    expect(tables.__storage[0]).toMatchObject({ bucket: "vendor-attachments", path: version.source_path });
    // The house's current menu is untouched, and no price moved.
    expect(tables.restaurant_menus.find((m) => m.id === "menu-old")!.status).toBe("active");
    expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(0);
    expect(r.items[0].priceSync).toBe("not_current");
    // Lines are stored against the new version, not appended to the old menu.
    expect(tables.menu_items.every((l) => l.menu_id === r.menuId)).toBe(true);
  });

  it("a source that could not be stored is SAID on the version, and the read is still kept", async () => {
    const tables: Record<string, Row[]> = { ...base(), __storageFails: ["bucket unavailable"] as any };
    const service = makeService(tables, { wineSubmissions, csvParser: new CsvParserService() });
    const r = await service.importMenu({ method: "csv", data: { csvContent: csv }, restaurantId: "rest-1" } as any, "user-1");
    expect(r.source).toEqual({ kept: false, failure: "the source file was not kept: bucket unavailable" });
    const version = tables.restaurant_menus.find((m) => m.id === r.menuId)!;
    expect(version.source_path).toBeNull();
    expect(version.source_failure).toMatch(/bucket unavailable/);
    expect(version.cadence).toBeNull(); // not tagged is NULL, never a default
    expect(version.menu_date).toBeNull();
  });

  it("a date that is not on the calendar is refused BEFORE the billed read", async () => {
    const parse = jest.fn();
    const service = makeService(base(), { wineSubmissions, scanParser: { parse } });
    await expect(
      service.importMenu(
        { method: "scan", data: { imageBase64: "JVBERi0=" }, restaurantId: "rest-1", menuDate: "2026-02-30" } as any,
        "user-1",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(parse).not.toHaveBeenCalled();
  });

  it("a scan that WAITS (spend record unreadable) writes no version, and says why", async () => {
    const tables = base();
    const service = makeService(tables, {
      wineSubmissions,
      scanParser: {
        parse: async () => {
          throw new MenuReadWaitingException("This restaurant's AI spend record could not be read, so the menu read is waiting");
        },
      },
    });
    await expect(
      service.importMenu({ method: "scan", data: { imageBase64: "JVBERi0=" }, restaurantId: "rest-1" } as any, "user-1"),
    ).rejects.toThrow(/menu read is waiting/);
    expect(tables.restaurant_menus).toHaveLength(1);
    expect(tables.menu_items).toHaveLength(0);
  });

  it("a scan keeps its photo/PDF under the house, content-addressed, with the sniffed type", async () => {
    const tables: Record<string, Row[]> = base();
    const service = makeService(tables, {
      wineSubmissions,
      scanParser: { parse: async () => [{ name: "Opus One", bottle_price: 62 }] },
    });
    const pdf = Buffer.from("%PDF-1.7 fake").toString("base64");
    const r = await service.importMenu({ method: "scan", data: { imageBase64: pdf }, restaurantId: "rest-1" } as any, "user-1");
    const version = tables.restaurant_menus.find((m) => m.id === r.menuId)!;
    expect(version).toMatchObject({ source_method: "scan", source_mime: "application/pdf" });
    expect(version.source_path).toMatch(/^rest-1\/menus\/[0-9a-f]{64}\.pdf$/);
  });

  describe("makeCurrent — the person's choice, then the menu's prices reach the house", () => {
    const makeCurrentRpc = (tables: Record<string, Row[]>) => (fn: string, args: Row) => {
      if (fn === "make_menu_current") {
        const menu = tables.restaurant_menus.find((m) => m.id === args.p_menu_id && m.restaurant_id === args.p_restaurant_id);
        if (!menu) return { data: null, error: { code: "P0002", message: "no menu" } };
        if (menu.status === "active") return { data: { outcome: "already_current", previous_menu_ids: [] }, error: null };
        const prev = tables.restaurant_menus.filter((m) => m.restaurant_id === args.p_restaurant_id && m.status === "active");
        for (const m of prev) Object.assign(m, { status: "archived", retired_by: args.p_actor, retired_at: "2026-09-21T12:00:00Z" });
        Object.assign(menu, { status: "active", made_current_by: args.p_actor, made_current_at: "2026-09-21T12:00:00Z" });
        return { data: { outcome: "made_current", previous_menu_ids: prev.map((m) => m.id) }, error: null };
      }
      if (fn === "set_house_menu_price") return { data: { outcome: "changed" }, error: null };
      return { data: null, error: { message: `no rpc ${fn}` } };
    };

    async function readThenChoose(lines: Row[]) {
      const calls: RpcCall[] = [];
      const tables: Record<string, Row[]> = base();
      const service = makeService(tables, {
        wineSubmissions,
        rpcCalls: calls,
        rpc: makeCurrentRpc(tables),
        scanParser: { parse: async () => lines },
      });
      const read = await service.importMenu(
        { method: "scan", data: { imageBase64: Buffer.from("%PDF").toString("base64") }, restaurantId: "rest-1" } as any,
        "user-1",
      );
      return { calls, tables, service, read };
    }

    it("switches the current menu, archives the old one, and carries the lines' prices by the chooser", async () => {
      const { calls, tables, service, read } = await readThenChoose([{ name: "Opus One", bottle_price: 64, by_glass_price: 15 }]);
      const r = await service.makeCurrent("rest-1", read.menuId, "user-2");

      expect(r).toMatchObject({ outcome: "made_current", previousMenuIds: ["menu-old"], lines: 1, priceSync: { changed: 1 }, flagged: 0, failed: [] });
      expect(tables.restaurant_menus.find((m) => m.id === "menu-old")).toMatchObject({ status: "archived", retired_by: "user-2" });
      const price = calls.filter(([fn]) => fn === "set_house_menu_price");
      expect(price).toHaveLength(1);
      expect(price[0][1]).toMatchObject({
        p_inventory_id: "inv-1",
        p_bottle_price: 64,
        p_glass_price: 15,
        p_change_source: "import",
        p_changed_by: "user-2",
        // dated by the LINE (the newest scan wins), not by the choice
        p_effective_from: "2026-09-21T10:00:00.000Z",
      });
      expect(tables.menu_items[0].inventory_item_id).toBe("inv-1");
    });

    it("a blank bottle price keeps the house's last known 60.00 and FLAGS the line (founder answer 3)", async () => {
      const { calls, tables, service, read } = await readThenChoose([{ name: "Opus One", by_glass_price: 15 }]);
      const r = await service.makeCurrent("rest-1", read.menuId, "user-2");
      const price = calls.filter(([fn]) => fn === "set_house_menu_price");
      expect(price[0][1]).toMatchObject({ p_set_bottle: false, p_set_glass: true, p_glass_price: 15 });
      expect(r.flagged).toBe(1);
      expect(tables.menu_items[0].price_flag).toBe("blank_kept_last_known");
      // Past tense: the note must stay true after a manager changes the price.
      expect(tables.menu_items[0].price_flag_note).toMatch(/no bottle price, so the house kept the bottle price 60\.00 it already had/);
    });

    it("a blank kind the house never priced is not flagged: nothing is kept, nothing is unclear", async () => {
      const { tables, service, read } = await readThenChoose([{ name: "Opus One", bottle_price: 64 }]);
      const r = await service.makeCurrent("rest-1", read.menuId, "user-2");
      expect(r.flagged).toBe(0);
      expect(tables.menu_items[0].price_flag).toBeNull();
    });

    it("choosing the menu that is already current changes nothing and writes no price", async () => {
      const calls: RpcCall[] = [];
      const tables: Record<string, Row[]> = base();
      const service = makeService(tables, { rpcCalls: calls, rpc: makeCurrentRpc(tables) });
      const r = await service.makeCurrent("rest-1", "menu-old", "user-2");
      expect(r.outcome).toBe("already_current");
      expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(0);
    });

    it("another house's menu id is a 404", async () => {
      const tables: Record<string, Row[]> = base();
      const service = makeService(tables, { rpc: makeCurrentRpc(tables) });
      await expect(service.makeCurrent("rest-2", "menu-old", "user-2")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("a failed read of the menu's lines changes NOTHING: the switch is not made, so it can be tried again", async () => {
      const { calls, tables, service, read } = await readThenChoose([{ name: "Opus One", bottle_price: 64 }]);
      (tables as any).__readFails = [{ menu_items: "statement timeout" }];
      await expect(service.makeCurrent("rest-1", read.menuId, "user-2")).rejects.toThrow(/statement timeout/);
      expect(calls.filter(([fn]) => fn === "make_menu_current")).toHaveLength(0);
      expect(tables.restaurant_menus.find((m) => m.id === "menu-old")!.status).toBe("active");
      expect(tables.restaurant_menus.find((m) => m.id === read.menuId)!.status).toBe("draft");
    });

    it("a failed read of the house's own wine row is a FAILED line with the reason -- never 'not_linked', no price, no flag", async () => {
      const { calls, tables, service, read } = await readThenChoose([{ name: "Opus One", by_glass_price: 15 }]);
      (tables as any).__readFails = [{ restaurant_inventory: "connection reset" }];
      const r = await service.makeCurrent("rest-1", read.menuId, "user-2");
      expect(r.outcome).toBe("made_current");
      expect(r.priceSync).toEqual({ failed: 1 });
      expect(r.failed).toEqual([
        expect.objectContaining({ name: "Opus One", error: expect.stringMatching(/could not be read.*connection reset/) }),
      ]);
      expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(0);
      // No duplicate row was attempted, and no flag was decided from a price never seen.
      expect(tables.restaurant_inventory).toHaveLength(1);
      expect(tables.menu_items[0].price_flag ?? null).toBeNull();
    });

    it("a switch that returns no outcome is an error, never a success", async () => {
      const service = makeService(base(), { rpc: () => ({ data: {}, error: null }) });
      await expect(service.makeCurrent("rest-1", "menu-old", "user-2")).rejects.toThrow(/no outcome/);
    });
  });

  it("lists every menu: the current one, the last one used, and who did what", async () => {
    const tables: Record<string, Row[]> = {
      restaurant_menus: [
        { id: "m1", restaurant_id: "rest-1", status: "archived", extracted_at: "2026-08-01T00:00:00Z", extracted_by: "u1", retired_at: "2026-09-01T00:00:00Z", retired_by: "u2" },
        { id: "m2", restaurant_id: "rest-1", status: "archived", extracted_at: "2026-06-01T00:00:00Z", extracted_by: "u1", retired_at: "2026-08-01T00:00:00Z", retired_by: "u2" },
        { id: "m3", restaurant_id: "rest-1", status: "active", extracted_at: "2026-09-01T00:00:00Z", extracted_by: "u2", made_current_at: "2026-09-01T00:00:00Z", made_current_by: "u2", menu_date: "2026-09-01", menu_date_precision: "month", cadence: "monthly" },
        { id: "m4", restaurant_id: "rest-1", status: "draft", extracted_at: "2026-09-20T00:00:00Z", extracted_by: "u1", source_path: "rest-1/menus/x.pdf" },
        { id: "x9", restaurant_id: "rest-2", status: "active" },
      ],
      users: [
        { user_id: "u1", name: "Sommelier" },
        { user_id: "u2", name: "Manager" },
      ],
    };
    const r = await makeService(tables).listVersions("rest-1");
    expect(r.versions.map((v) => v.menuId)).toEqual(["m4", "m3", "m1", "m2"]);
    expect(r.current?.menuId).toBe("m3");
    expect(r.current).toMatchObject({ cadence: "monthly", menuDate: "2026-09", menuDatePrecision: "month", madeCurrentBy: { userId: "u2", name: "Manager" } });
    expect(r.lastUsed?.menuId).toBe("m1");
    expect(r.versions.find((v) => v.menuId === "m4")!.source.kept).toBe(true);
  });

  it("a kept source gets a short link; one never kept says why", async () => {
    const tables: Record<string, Row[]> = {
      restaurant_menus: [
        { id: "m4", restaurant_id: "rest-1", status: "draft", source_method: "scan", source_path: "rest-1/menus/x.pdf", source_mime: "application/pdf" },
        { id: "m5", restaurant_id: "rest-1", status: "draft", source_method: "scan", source_path: null, source_failure: "the source file was not kept: bucket unavailable" },
      ],
    };
    const service = makeService(tables);
    await expect(service.sourceUrl("rest-1", "m4")).resolves.toMatchObject({ expiresInSeconds: 300, mime: "application/pdf" });
    await expect(service.sourceUrl("rest-1", "m5")).rejects.toThrow(/not kept: bucket unavailable/);
    await expect(service.sourceUrl("rest-2", "m4")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("a line on a menu that is NOT current: a staff member may add it with a price, and it touches no house price", async () => {
    const calls: RpcCall[] = [];
    const tables: Record<string, Row[]> = { ...base(), restaurant_menus: [{ id: "draft-1", restaurant_id: "rest-1", status: "draft" }] };
    const service = makeService(tables, { wineSubmissions, rpcCalls: calls, rpc: () => ({ data: { outcome: "changed" }, error: null }) });
    const item = await service.addMenuItem({ menuId: "draft-1", name: "Opus One", bottle_price: 70 } as any, "staff-1", "rest-1", false);
    expect(item.priceSync).toBe("not_current");
    expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(0);
    expect(tables.restaurant_inventory).toHaveLength(1); // no seeding either
  });

  it("a PRICED line on the CURRENT menu from someone who may not price is refused, and nothing is added", async () => {
    const tables: Record<string, Row[]> = base();
    const service = makeService(tables, { wineSubmissions });
    await expect(
      service.addMenuItem({ menuId: "menu-old", name: "Opus One", bottle_price: 70 } as any, "staff-1", "rest-1", false),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tables.menu_items).toHaveLength(0);
  });

  it("a price correction on a kept (not current) menu's line says 'not_current' and writes no house price", async () => {
    const calls: RpcCall[] = [];
    const tables: Record<string, Row[]> = {
      restaurant_menus: [{ id: "draft-1", restaurant_id: "rest-1", status: "draft" }],
      menu_items: [
        { id: "mi-9", menu_id: "draft-1", restaurant_id: "rest-1", bottle_price: 60, inventory_item_id: "inv-1", status: "approved", price_flag: "blank_kept_last_known", price_flag_note: "x" },
      ],
    };
    const service = makeService(tables, { rpcCalls: calls, rpc: () => ({ data: { outcome: "changed" }, error: null }) });
    const r = await service.reviewMenuItem("mi-9", "user-1", "rest-1", { fieldName: "bottle_price", newValue: "72" } as any);
    expect(r.priceSync).toBe("not_current");
    expect(calls).toHaveLength(0);
    // The correction answers the blank-price flag.
    expect(tables.menu_items[0]).toMatchObject({ bottle_price: 72, price_flag: null, price_flag_note: null });
  });
});
