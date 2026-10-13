import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { LINE_SELECT, MenusService } from "./menus.service";
import { MEMBER_LINE_KEYS, seesRawLine } from "./menu-line-view";
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
    let deleting = false;
    const extra: Array<(r: Row) => boolean> = [];
    // `tables.__readFails = [{ <table>: "<message>" }]` makes every READ of
    // that table fail with the message (writes still land), so a test can
    // prove a failed read is said, never taken for "no row".
    const readFails = (): string | undefined =>
      ((tables as any).__readFails?.[0] ?? {})[table];
    // `tables.__updateFails = [{ <table>: "<message>" }]` makes every UPDATE
    // of that table fail with the message, and change nothing.
    const updateFails = (): string | undefined =>
      ((tables as any).__updateFails?.[0] ?? {})[table];
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
      // `.is(col, null)`: an absent column reads as null, as in Postgres.
      is(col: string, val: any) {
        extra.push((r) => (r[col] ?? null) === val);
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
      // `.delete().eq(...)`: removes the matching rows when awaited (F-1296).
      delete() {
        deleting = true;
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
        if (updatePatch && updateFails())
          return resolve({ data: null, error: { message: updateFails() } });
        const rows = matching();
        if (deleting) {
          tables[table] = (tables[table] || []).filter(
            (r) => !rows.includes(r),
          );
          return resolve({ data: null, error: null });
        }
        if (updatePatch) for (const row of rows) Object.assign(row, updatePatch);
        resolve({ data: rows, error: null });
      },
    };
    return api;
  }
  const rpc = async (fn: string, args: Row) => {
    // ADR 0340 rule 12: every upload makes its sections in one database
    // function. Answered here for every test, kept apart from rpcCalls so a
    // test's list of price writes stays what it was; `__materialised` shows
    // the calls, `__materialiseFails` makes it fail.
    if (fn === "materialise_menu_sections") {
      (tables.__materialised = tables.__materialised || []).push(args);
      if (tables.__materialiseFails)
        return {
          data: null,
          error: { message: String(tables.__materialiseFails[0]) },
        };
      return { data: { sections: 0, inherited: 0, lines: 0 }, error: null };
    }
    rpcCalls.push([fn, args]);
    // ADR 0340 rule 20: makeCurrent calls make_menus_current with every menu
    // of the batch. A test's single-menu `make_menu_current` answers each id
    // in turn (not recorded again), all or nothing, and the fake builds the
    // batch reply, reading `made_current_at` and `carried_at` off the row. A
    // row from before `carried_at` (no such key) that is already current
    // reads as carried, as every such test was written.
    if (fn === "make_menus_current" && rpcImpl) {
      const menus = (tables.restaurant_menus || []) as Row[];
      const before = menus.map((m) => ({ ...m }));
      const out: Row[] = [];
      for (const id of (args.p_menu_ids as string[]) ?? []) {
        const one = rpcImpl("make_menu_current", {
          p_restaurant_id: args.p_restaurant_id,
          p_menu_id: id,
          p_actor: args.p_actor,
        }) as { data: Row | null; error: unknown };
        if (one.error) {
          menus.forEach((m, i) => {
            for (const k of Object.keys(m)) delete m[k];
            Object.assign(m, before[i]);
          });
          return one;
        }
        const row = menus.find((m) => m.id === id) ?? {};
        const outcome = one.data?.outcome;
        out.push({
          ...(one.data ?? {}),
          menu_id: id,
          menu_type: row.menu_type ?? null,
          made_current_at:
            one.data?.made_current_at ?? row.made_current_at ?? null,
          carried_at:
            "carried_at" in row
              ? row.carried_at
              : outcome === "already_current"
                ? (row.made_current_at ?? "2026-09-21T12:00:00Z")
                : null,
        });
      }
      return {
        data: { made_current_at: out[0]?.made_current_at ?? null, menus: out },
        error: null,
      };
    }
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
      kinds: [],
      items: [],
      rawLineWithheld: true,
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

  it("excludes a discarded line from the read (migration 20260922230100)", async () => {
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

  // F-618: the line keeps its own price (ADR 0193 item 3); the house's price
  // is sent beside it, from this house only, so the page can mark a difference.
  const pricedMenu = () => ({
    restaurant_menus: [
      {
        id: "menu-1",
        restaurant_id: "rest-1",
        name: "Wine List",
        status: "active",
      },
    ],
    menu_items: [
      {
        id: "mi-1",
        menu_id: "menu-1",
        restaurant_id: "rest-1",
        name: "Yakut",
        bottle_price: 80,
        by_glass_price: 14,
        inventory_item_id: "inv-1",
      },
      {
        id: "mi-2",
        menu_id: "menu-1",
        restaurant_id: "rest-1",
        name: "Unlinked",
        bottle_price: 40,
        inventory_item_id: null,
      },
      {
        id: "mi-3",
        menu_id: "menu-1",
        restaurant_id: "rest-1",
        name: "Foreign",
        bottle_price: 50,
        inventory_item_id: "inv-9",
      },
    ],
    restaurant_inventory: [
      {
        id: "inv-1",
        restaurant_id: "rest-1",
        menu_price_current: 95,
        menu_price_glass: null,
      },
      {
        id: "inv-9",
        restaurant_id: "rest-2",
        menu_price_current: 999,
        menu_price_glass: 99,
      },
    ],
  });

  it("sends each linked line this house's own price beside the line's, and nothing for another house's row", async () => {
    const result: any = await makeService(pricedMenu()).getMenu("rest-1");
    const byId = Object.fromEntries(result.items.map((i: any) => [i.id, i]));
    expect(byId["mi-1"]).toMatchObject({
      bottle_price: 80,
      house_bottle_price: 95,
      house_glass_price: null,
    });
    expect(byId["mi-2"]).not.toHaveProperty("house_bottle_price");
    expect(byId["mi-3"]).not.toHaveProperty("house_bottle_price");
    expect(result.housePricesReadable).toBe(true);
  });

  it("says when the house's prices could not be read, and sends no house price", async () => {
    const tables: any = pricedMenu();
    tables.__readFails = [{ restaurant_inventory: "timeout" }];
    const result: any = await makeService(tables).getMenu("rest-1");
    expect(result.items).toHaveLength(3);
    expect(result.items.some((i: any) => "house_bottle_price" in i)).toBe(
      false,
    );
    expect(result.housePricesReadable).toBe(false);
    expect(result.housePricesReason).toContain("timeout");
  });

  // F-145 (S195): a drink 86'd shows on the house's menu as sold out.
  it("marks a line sold out while its wine has an open stock-out, in this house only", async () => {
    const tables: any = pricedMenu();
    tables.stock_outs = [
      {
        id: "so-1",
        restaurant_id: "rest-1",
        inventory_id: "inv-1",
        ended_at: null,
      },
      // Another house's open stock-out on a wine id this menu links.
      {
        id: "so-2",
        restaurant_id: "rest-2",
        inventory_id: "inv-9",
        ended_at: null,
      },
    ];
    const result: any = await makeService(tables).getMenu("rest-1");
    const byId = Object.fromEntries(result.items.map((i: any) => [i.id, i]));
    expect(byId["mi-1"].sold_out).toBe(true);
    expect(byId["mi-2"]).not.toHaveProperty("sold_out");
    expect(byId["mi-3"]).not.toHaveProperty("sold_out");
    expect(result.soldOutReadable).toBe(true);

    // Brought back: nothing is marked.
    tables.stock_outs[0].ended_at = "2026-09-03T12:00:00Z";
    const back: any = await makeService(tables).getMenu("rest-1");
    expect(back.items.some((i: any) => "sold_out" in i)).toBe(false);
  });

  it("says when which drinks are sold out could not be read, and marks none", async () => {
    const tables: any = pricedMenu();
    tables.stock_outs = [
      {
        id: "so-1",
        restaurant_id: "rest-1",
        inventory_id: "inv-1",
        ended_at: null,
      },
    ];
    tables.__readFails = [{ stock_outs: "timeout" }];
    const result: any = await makeService(tables).getMenu("rest-1");
    expect(result.items.some((i: any) => "sold_out" in i)).toBe(false);
    expect(result.soldOutReadable).toBe(false);
    expect(result.soldOutReason).toContain("timeout");
    expect(result.housePricesReadable).toBe(true);
  });

  // F-1474: an 86'd spirit reaches the cocktails whose recipe takes it.
  const cocktailMenu = () => {
    const tables: any = pricedMenu();
    tables.menu_items.push({
      id: "mi-4",
      menu_id: "menu-1",
      restaurant_id: "rest-1",
      name: "  NEGRONI ",
      by_glass_price: 400,
      inventory_item_id: null,
    });
    tables.cocktails = [
      { id: "c-1", restaurant_id: "rest-1", name: "Negroni", deleted_at: null },
      // Another house's cocktail of the same name names nothing here.
      { id: "c-9", restaurant_id: "rest-2", name: "Negroni", deleted_at: null },
    ];
    tables.cocktail_ingredients = [
      { cocktail_id: "c-1", inventory_id: "inv-gin", free_text: "gin" },
      { cocktail_id: "c-1", inventory_id: null, free_text: "orange peel" },
      { cocktail_id: "c-9", inventory_id: "inv-gin", free_text: "gin" },
    ];
    tables.stock_outs = [
      {
        id: "so-3",
        restaurant_id: "rest-1",
        inventory_id: "inv-gin",
        ended_at: null,
      },
    ];
    return tables;
  };

  it("marks a cocktail sold out while a spirit its recipe takes is 86'd, and says which", async () => {
    const tables = cocktailMenu();
    const result: any = await makeService(tables).getMenu("rest-1");
    const byId = Object.fromEntries(result.items.map((i: any) => [i.id, i]));
    expect(byId["mi-4"]).toMatchObject({
      sold_out: true,
      sold_out_because: ["gin"],
    });
    expect(byId["mi-2"]).not.toHaveProperty("sold_out");
    expect(result.soldOutReadable).toBe(true);

    // The gin brought back: the cocktail is available again.
    tables.stock_outs[0].ended_at = "2026-10-11T22:00:00Z";
    const back: any = await makeService(tables).getMenu("rest-1");
    expect(back.items.some((i: any) => "sold_out" in i)).toBe(false);
  });

  // F-1505: a cocktail line carried before F-1470 still holds its old
  // 0-stock row; its section says it is a cocktail, so the 86 reaches it.
  it("marks a cocktail carried before F-1470 sold out while its spirit is 86'd", async () => {
    const tables = cocktailMenu();
    const line = tables.menu_items.find((i: any) => i.id === "mi-4");
    line.inventory_item_id = "inv-negroni-legacy";
    line.category = "Signature Cocktails";
    const result: any = await makeService(tables).getMenu("rest-1");
    const byId = Object.fromEntries(result.items.map((i: any) => [i.id, i]));
    expect(byId["mi-4"]).toMatchObject({
      sold_out: true,
      sold_out_because: ["gin"],
    });
  });

  it("says when which cocktails an 86 stops could not be read, and still marks the wines", async () => {
    const tables = cocktailMenu();
    tables.stock_outs.push({
      id: "so-1",
      restaurant_id: "rest-1",
      inventory_id: "inv-1",
      ended_at: null,
    });
    tables.__readFails = [{ cocktail_ingredients: "timeout" }];
    const result: any = await makeService(tables).getMenu("rest-1");
    const byId = Object.fromEntries(result.items.map((i: any) => [i.id, i]));
    expect(byId["mi-1"].sold_out).toBe(true);
    expect(byId["mi-4"]).not.toHaveProperty("sold_out");
    expect(result.soldOutReadable).toBe(false);
    expect(result.soldOutReason).toMatch(
      /cocktails .* could not be read.*timeout/,
    );
  });
});

/**
 * ADR 0309 option 1c, amended after the audit of #655 at 220e3747d (BLOCK):
 * a CSV line's raw line is the whole row, every unmapped column included
 * (csv-parser.service.ts:55), so it goes only to a role whose ROLE_POLICY row
 * sees money and suppliers (ADR 0145). Every member gets kitchen_line.
 *
 * The rows are built with the REAL CSV reader, so the stored string is the one
 * production stores. The fake ignores the column list and hands back every
 * fixture column, so these cases test the stripping itself, not the select.
 */
describe("MenusService line reads — a line's raw line is a holder's (ADR 0145 staff row)", () => {
  const CSV =
    "Name,Producer,Vintage,Type,Bottle,Cost,Supplier,Margin,Section\n" +
    "Barolo,Vietti,2019,red,120,38.50,Vini Ltd,68%,Wines\n" +
    "Tiramisu,,,,12,3.10,Metro,74%,Dessert\n";
  const SECRETS = ["38.50", "3.10", "Vini Ltd", "Metro", "68%", "74%"];
  /** Every column LINE_SELECT names except the raw line: what any member may be sent. */
  const MEMBER_KEYS = [
    "id", "name", "producer", "category", "vintage", "region", "country", "grape_variety",
    "by_glass_price", "bottle_price", "wine_library_id", "inventory_item_id", "source", "status",
    "review_notes",
    "price_flag",
    "price_flag_note",
    "created_at",
    // ADR 0340 rule 25: the line's section, place, kind, drink category and dish price.
    "section_id",
    "position",
    "line_kind",
    "drink_category",
    "price",
  ];
  const ROOT_KEYS = ["menuId", "name", "status", "kinds", "items"];

  function house() {
    const [barolo, tiramisu] = new CsvParserService().parse(CSV);
    // Every LINE_SELECT column is present, so the exact key set of a line is
    // what the allowlist lets through, not what the fixture happened to hold.
    const line = (over: Row): Row => ({
      menu_id: "menu-1",
      restaurant_id: "rest-1",
      producer: null,
      category: null,
      vintage: null,
      region: null,
      country: null,
      grape_variety: null,
      by_glass_price: null,
      bottle_price: null,
      wine_library_id: null,
      inventory_item_id: null,
      source: "csv",
      status: "approved",
      review_notes: null,
      price_flag: null,
      price_flag_note: null,
      raw_extracted_text: null,
      created_at: "2026-10-07T10:00:00Z",
      section_id: null,
      position: null,
      line_kind: null,
      drink_category: null,
      price: null,
      ...over,
    });
    return {
      barolo,
      tiramisu,
      service: makeService({
        restaurant_menus: [
          { id: "menu-1", restaurant_id: "rest-1", name: "Wine List", status: "active" },
        ],
        menu_items: [
          line({ id: "mi-1", name: "Barolo", producer: "Vietti", category: "red", bottle_price: 120, raw_extracted_text: barolo.raw_text }),
          line({ id: "mi-2", name: "Tiramisu", bottle_price: 12, raw_extracted_text: tiramisu.raw_text }),
          // A line added by hand keeps no raw line: nothing to withhold.
          line({ id: "mi-3", name: "Soave", category: "white", bottle_price: 40, source: "manual" }),
        ],
      }),
    };
  }
  const byName = (items: Array<Record<string, unknown>>, name: string) => items.find((l) => l.name === name)!;

  it("the CSV reader keeps the unmapped cost, supplier and margin cells in the raw line", () => {
    const { barolo, tiramisu } = house();
    expect(barolo.raw_text).toBe("Barolo,Vietti,2019,red,120,38.50,Vini Ltd,68%,Wines");
    expect(tiramisu.raw_text).toBe("Tiramisu,,,,12,3.10,Metro,74%,Dessert");
  });

  it("LINE_SELECT asks for exactly the member keys plus the raw line, which only lineForViewer may let out", () => {
    expect(LINE_SELECT.split(",").map((c) => c.trim()).sort()).toEqual([...MEMBER_KEYS, "raw_extracted_text"].sort());
    expect([...MEMBER_LINE_KEYS].sort()).toEqual([...MEMBER_KEYS].sort());
  });

  it("staff: the exact member keys, kitchen_line, and raw_line_withheld where a raw line is kept; no cell of the row", async () => {
    const { service } = house();
    const r: any = await service.getVersion("rest-1", "menu-1", { rawLine: seesRawLine("staff") });
    expect(Object.keys(r).sort()).toEqual(["items", "namesReadable", "namesReason", "rawLineWithheld", "version"]);
    expect(r.rawLineWithheld).toBe(true);
    const barolo = byName(r.items, "Barolo");
    const tiramisu = byName(r.items, "Tiramisu");
    const soave = byName(r.items, "Soave");
    expect(Object.keys(barolo).sort()).toEqual([...MEMBER_KEYS, "kitchen_line", "raw_line_withheld"].sort());
    expect(Object.keys(tiramisu).sort()).toEqual([...MEMBER_KEYS, "kitchen_line", "raw_line_withheld"].sort());
    expect(Object.keys(soave).sort()).toEqual([...MEMBER_KEYS, "kitchen_line"].sort());
    expect(barolo.raw_line_withheld).toBe(true);
    // The kitchen split survives withholding: Tiramisu's only kitchen clue is
    // its unmapped "Dessert" cell.
    expect(barolo.kitchen_line).toBe(false);
    expect(tiramisu.kitchen_line).toBe(true);
    expect(soave.kitchen_line).toBe(false);
    // Sale prices still reach staff, as on main: withholding them is MENU-02.
    expect(barolo.bottle_price).toBe(120);
    // A second check on top of the key sets: no cell of the CSV row is anywhere.
    const text = JSON.stringify(r);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });

  it("owner: the raw line itself, the same kitchen split, and no withheld markers", async () => {
    const { service, barolo: row } = house();
    const staff: any = await service.getVersion("rest-1", "menu-1", { rawLine: seesRawLine("staff") });
    const r: any = await service.getVersion("rest-1", "menu-1", { rawLine: seesRawLine("owner") });
    expect(Object.keys(r).sort()).toEqual(["items", "namesReadable", "namesReason", "version"]);
    const barolo = byName(r.items, "Barolo");
    expect(Object.keys(barolo).sort()).toEqual([...MEMBER_KEYS, "kitchen_line", "raw_extracted_text"].sort());
    expect(barolo.raw_extracted_text).toBe(row.raw_text);
    expect(byName(r.items, "Soave").raw_extracted_text).toBeNull();
    for (const name of ["Barolo", "Tiramisu", "Soave"]) {
      expect(byName(r.items, name).kitchen_line).toBe(byName(staff.items, name).kitchen_line);
    }
  });

  it.each([null, undefined, "staff", "bartender", "STAFF", ""])("role %p: the raw line is withheld", async (role) => {
    const { service } = house();
    const r: any = await service.getVersion("rest-1", "menu-1", { rawLine: seesRawLine(role as any) });
    expect(r.rawLineWithheld).toBe(true);
    for (const line of r.items) expect(Object.keys(line)).not.toContain("raw_extracted_text");
  });

  it.each(["owner", "manager", "Manager", "admin"])("role %p: the raw line is sent", async (role) => {
    const { service, barolo: row } = house();
    const r: any = await service.getVersion("rest-1", "menu-1", { rawLine: seesRawLine(role) });
    expect(Object.keys(r)).not.toContain("rawLineWithheld");
    expect(byName(r.items, "Barolo").raw_extracted_text).toBe(row.raw_text);
  });

  it("getMenu: the exact root keys and the same withholding, and a call that names no view withholds", async () => {
    const { service } = house();
    for (const r of [await service.getMenu("rest-1"), await service.getMenu("rest-1", { rawLine: false })] as any[]) {
      // F-618: getMenu also says whether the house's own prices were read.
      expect(Object.keys(r).sort()).toEqual(
        [
          ...ROOT_KEYS,
          "rawLineWithheld",
          "housePricesReadable",
          "housePricesReason",
          "soldOutReadable",
          "soldOutReason",
        ].sort(),
      );
      expect(r.rawLineWithheld).toBe(true);
      // getMenu's union also says which live menu, and which kind, each line is on (ADR 0340).
      expect(Object.keys(byName(r.items, "Barolo")).sort()).toEqual(
        [
          ...MEMBER_KEYS,
          "kitchen_line",
          "raw_line_withheld",
          "menu_id",
          "menu_type",
        ].sort(),
      );
      expect(byName(r.items, "Tiramisu").kitchen_line).toBe(true);
      const text = JSON.stringify(r);
      for (const secret of SECRETS) expect(text).not.toContain(secret);
    }
    const holder: any = await service.getMenu("rest-1", { rawLine: true });
    expect(Object.keys(holder).sort()).toEqual(
      [
        ...ROOT_KEYS,
        "housePricesReadable",
        "housePricesReason",
        "soldOutReadable",
        "soldOutReason",
      ].sort(),
    );
  });

  it("a getVersion call that names no view withholds", async () => {
    const { service } = house();
    const r: any = await service.getVersion("rest-1", "menu-1");
    expect(r.rawLineWithheld).toBe(true);
    expect(JSON.stringify(r)).not.toContain("38.50");
  });

  it("the plan and the current-menu union never carry the raw line", async () => {
    const { service } = house();
    expect(JSON.stringify(await service.planFor("rest-1", "menu-1"))).not.toContain("38.50");
    const current = await service.readCurrentMenus("rest-1");
    for (const line of current.lines) expect(Object.keys(line)).not.toContain("raw_extracted_text");
    expect(JSON.stringify(current)).not.toContain("38.50");
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
  // PR #446 (2026-09-25, over #434's 403): another house's menu id is the SAME
  // 404 as a missing one (ADR 0147), so the route cannot confirm that a
  // foreign id is a real menu; and nothing is written to it.
  it("404s a menu of another house, exactly as a missing one, and writes no line", async () => {
    const tables: Record<string, Row[]> = {
      restaurant_menus: [{ id: "menu-1", restaurant_id: "rest-1" }],
      menu_items: [],
    };
    const service = makeService(tables);

    const foreign = service.addMenuItem(
      { menuId: "menu-1", name: "Should not land" } as any,
      "user-1",
      "rest-2",
    );
    await expect(foreign).rejects.toBeInstanceOf(NotFoundException);
    await expect(foreign).rejects.toThrow("Menu not found");
    await expect(
      service.addMenuItem(
        { menuId: "missing", name: "Should not land" } as any,
        "user-1",
        "rest-2",
      ),
    ).rejects.toThrow("Menu not found");
    expect(tables.menu_items).toHaveLength(0);
  });

  it("surfaces a failed menu read as an error, never as 'not found'", async () => {
    const tables: Record<string, Row[]> = {
      restaurant_menus: [{ id: "menu-1", restaurant_id: "rest-1" }],
    };
    (tables as any).__readFails = [{ restaurant_menus: "statement timeout" }];
    const service = makeService(tables);

    const read = service.addMenuItem(
      { menuId: "menu-1", name: "x" } as any,
      "user-1",
      "rest-1",
    );
    await expect(read).rejects.toThrow(/statement timeout/);
    await expect(read).rejects.not.toBeInstanceOf(NotFoundException);
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
    expect(result).toEqual({
      menuItemId: "mi-1",
      status: "discarded",
      audited: true,
    });

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

  it("keeps the status the line had, and a second discard does not overwrite it (F-268)", async () => {
    const tables: Record<string, Row[]> = {
      menu_items: [
        {
          id: "mi-1",
          menu_id: "menu-1",
          restaurant_id: "rest-1",
          status: "flagged",
        },
      ],
    };
    const service = makeService(tables);

    await service.discardMenuItem("rest-1", "mi-1");
    await service.discardMenuItem("rest-1", "mi-1");
    expect(tables.menu_items[0]).toMatchObject({
      status: "discarded",
      prior_status: "flagged",
    });
  });

  // F-484: a discard used to leave no who or when anywhere.
  it("files who discarded the line, which line, on which menu and at what price", async () => {
    const tables: Record<string, Row[]> = {
      menu_items: [
        {
          id: "mi-1",
          menu_id: "menu-1",
          restaurant_id: "rest-1",
          name: "Opus One",
          category: "Red",
          status: "approved",
          bottle_price: 120,
          by_glass_price: 18,
        },
      ],
      restaurant_menus: [
        {
          id: "menu-1",
          restaurant_id: "rest-1",
          name: "Wine List",
          status: "active",
        },
      ],
      system_audit_log: [],
    };
    const service = makeService(tables);

    await service.discardMenuItem("rest-1", "mi-1", "user-7");

    expect(tables.system_audit_log).toHaveLength(1);
    expect(tables.system_audit_log[0]).toMatchObject({
      actor_type: "user",
      actor_id: "user-7",
      action: "menu_line_discarded",
      entity_type: "menu_item",
      entity_id: "mi-1",
      restaurant_id: "rest-1",
      changes: {
        subject: "Opus One (bottle 120, glass 18) on Wine List",
        fields: { status: { from: "approved", to: "discarded" } },
        menu_id: "menu-1",
        menu_name: "Wine List",
        bottle_price: 120,
        by_glass_price: 18,
      },
    });
  });

  it("keeps the discard and says audited: false when the audit row cannot be written", async () => {
    const tables: Record<string, Row[]> = {
      menu_items: [
        {
          id: "mi-1",
          menu_id: "menu-1",
          restaurant_id: "rest-1",
          name: "Opus One",
          status: "approved",
        },
      ],
    };
    const supabase = makeFakeSupabase(tables);
    const realFrom = supabase.from;
    supabase.from = (table: string) =>
      table === "system_audit_log"
        ? { insert: async () => ({ error: { message: "audit down" } }) }
        : realFrom(table);
    const service = new MenusService(
      { supabase } as unknown as DatabaseService,
      undefined as any,
      undefined as any,
      undefined as any,
    );

    const result = await service.discardMenuItem("rest-1", "mi-1", "user-7");
    expect(result).toEqual({
      menuItemId: "mi-1",
      status: "discarded",
      audited: false,
    });
    expect(tables.menu_items[0].status).toBe("discarded");
  });
});

describe("MenusService.restoreMenuItem — a discarded line can be put back (F-268)", () => {
  const house = () => ({
    restaurant_menus: [
      {
        id: "menu-1",
        restaurant_id: "rest-1",
        name: "Wine List",
        status: "active",
      },
    ],
  });

  it("puts the line back at the status it had, and getMenu serves it again", async () => {
    const tables: Record<string, Row[]> = {
      ...house(),
      menu_items: [
        {
          id: "mi-1",
          menu_id: "menu-1",
          restaurant_id: "rest-1",
          name: "Raki",
          category: "Spirits",
          status: "flagged",
        },
      ],
    };
    const service = makeService(tables);
    await service.discardMenuItem("rest-1", "mi-1");
    expect(
      (await service.getDiscardedLines("rest-1")).items.map((r) => r.id),
    ).toEqual(["mi-1"]);

    const result = await service.restoreMenuItem("rest-1", "mi-1");
    expect(result).toEqual({
      menuItemId: "mi-1",
      status: "flagged",
      audited: true,
    });
    expect(tables.menu_items[0]).toMatchObject({
      status: "flagged",
      prior_status: null,
    });
    expect((await service.getMenu("rest-1")).items.map((r) => r.id)).toEqual([
      "mi-1",
    ]);
    expect((await service.getDiscardedLines("rest-1")).items).toEqual([]);
  });

  it("a line discarded before its status was kept comes back in review", async () => {
    const tables: Record<string, Row[]> = {
      ...house(),
      menu_items: [
        {
          id: "mi-1",
          menu_id: "menu-1",
          restaurant_id: "rest-1",
          status: "discarded",
        },
      ],
    };
    const service = makeService(tables);

    expect(await service.restoreMenuItem("rest-1", "mi-1")).toEqual({
      menuItemId: "mi-1",
      status: "in_review",
      audited: true,
    });
    expect(tables.menu_items[0].status).toBe("in_review");
  });

  it("leaves a line that is not discarded as it is", async () => {
    const tables: Record<string, Row[]> = {
      menu_items: [
        {
          id: "mi-1",
          menu_id: "menu-1",
          restaurant_id: "rest-1",
          status: "approved",
        },
      ],
    };
    const service = makeService(tables);

    expect(await service.restoreMenuItem("rest-1", "mi-1")).toEqual({
      menuItemId: "mi-1",
      status: "approved",
      audited: false,
    });
    expect(tables.menu_items[0].status).toBe("approved");
  });

  it("404s for another house's line, and writes nothing", async () => {
    const tables: Record<string, Row[]> = {
      menu_items: [
        {
          id: "mi-1",
          menu_id: "menu-1",
          restaurant_id: "rest-1",
          status: "discarded",
          prior_status: "approved",
        },
      ],
    };
    const service = makeService(tables);

    await expect(
      service.restoreMenuItem("rest-2", "mi-1"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tables.menu_items[0].status).toBe("discarded");
  });

  // F-1419: putting a line back used to leave no who or when anywhere.
  it("files who put the line back, which line, and the status it went back to", async () => {
    const tables: Record<string, Row[]> = {
      ...house(),
      menu_items: [
        {
          id: "mi-1",
          menu_id: "menu-1",
          restaurant_id: "rest-1",
          name: "Opus One",
          status: "discarded",
          prior_status: "approved",
          bottle_price: 120,
          by_glass_price: 18,
        },
      ],
      system_audit_log: [],
    };
    const service = makeService(tables);

    await service.restoreMenuItem("rest-1", "mi-1", "user-7");

    expect(tables.system_audit_log).toHaveLength(1);
    expect(tables.system_audit_log[0]).toMatchObject({
      actor_type: "user",
      actor_id: "user-7",
      action: "menu_line_restored",
      entity_type: "menu_item",
      entity_id: "mi-1",
      restaurant_id: "rest-1",
      changes: {
        subject: "Opus One (bottle 120, glass 18) on Wine List",
        fields: { status: { from: "discarded", to: "approved" } },
      },
    });
  });

  it("no current menu means no discarded lines", async () => {
    const service = makeService({ restaurant_menus: [], menu_items: [] });
    expect(await service.getDiscardedLines("rest-1")).toEqual({ items: [] });
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

  it("surfaces a failed read of the line as an error, never as 'not found' (PR #446)", async () => {
    const tables: Record<string, Row[]> = { menu_items: [line()], restaurant_menus: [CURRENT()] };
    (tables as any).__readFails = [{ menu_items: "statement timeout" }];
    const service = makeService(tables, { rpc: changed });
    const read = service.reviewMenuItem("mi-1", "user-1", "rest-1", {
      fieldName: "name",
      newValue: "x",
    } as any);
    await expect(read).rejects.toThrow(/statement timeout/);
    await expect(read).rejects.not.toBeInstanceOf(NotFoundException);
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

  it("a rename reaches the house's own wine too (F-920)", async () => {
    const tables: Record<string, Row[]> = {
      menu_items: [line()],
      restaurant_menus: [CURRENT()],
      restaurant_inventory: [
        { id: "inv-1", restaurant_id: "rest-1", wine_name: "Opus One" },
      ],
    };
    const service = makeService(tables, { rpc: changed });
    await service.reviewMenuItem("mi-1", "user-1", "rest-1", {
      fieldName: "name",
      newValue: "Opus One 2019",
    } as any);
    expect(tables.menu_items[0].name).toBe("Opus One 2019");
    expect(tables.restaurant_inventory[0].wine_name).toBe("Opus One 2019");
  });

  it("a failed rename of the house's own wine is said, and the menu line is not renamed either (F-920)", async () => {
    const tables: Record<string, Row[]> = {
      menu_items: [line()],
      restaurant_menus: [CURRENT()],
      restaurant_inventory: [
        { id: "inv-1", restaurant_id: "rest-1", wine_name: "Opus One" },
      ],
    };
    (tables as any).__updateFails = [
      { restaurant_inventory: "permission denied" },
    ];
    const service = makeService(tables, { rpc: changed });
    await expect(
      service.reviewMenuItem("mi-1", "user-1", "rest-1", {
        fieldName: "name",
        newValue: "Opus One 2019",
      } as any),
    ).rejects.toThrow(/could not be renamed in your stock.*permission denied/);
    expect(tables.menu_items[0].name).toBe("Opus One");
    expect(tables.menu_items[0].status).toBe("approved");
    expect(tables.restaurant_inventory[0].wine_name).toBe("Opus One");
  });

  it("a rename that fails on the menu line after the stock was renamed says so, in words the page shows (F-1002)", async () => {
    const tables: Record<string, Row[]> = {
      menu_items: [line()],
      restaurant_menus: [CURRENT()],
      restaurant_inventory: [
        { id: "inv-1", restaurant_id: "rest-1", wine_name: "Opus One" },
      ],
    };
    (tables as any).__updateFails = [{ menu_items: "timeout" }];
    const service = makeService(tables, { rpc: changed });
    const err = await service
      .reviewMenuItem("mi-1", "user-1", "rest-1", {
        fieldName: "name",
        newValue: "Opus One 2019",
      } as any)
      .catch((e) => e);
    // A plain Error reached the page as "Internal server error" alone.
    expect(err).toBeInstanceOf(InternalServerErrorException);
    expect((err as InternalServerErrorException).getResponse()).toMatchObject({
      message:
        "The wine was renamed in your stock, but the menu line was not: timeout",
    });
    expect(tables.restaurant_inventory[0].wine_name).toBe("Opus One 2019");
    expect(tables.menu_items[0].name).toBe("Opus One");
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

  it("an existing house wine gets the line's prices as 'import', dated NOW and naming the menu (never the line's created_at, L11)", async () => {
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
      p_effective_from: null,
      p_menu_id: "menu-1",
    });
    expect(item.priceSync).toBe("changed");
    // F-1561: a line added by hand has no printed place; it sorts after the read's lines.
    expect(tables.menu_items[0].position).toBeNull();
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
    // Round 6c answer 4, "Flag it": no price on the line, none at the house.
    expect(item.priceFlag).toBe("blank_no_house_price");
    expect(tables.menu_items[0].price_flag).toBe("blank_no_house_price");
    // Kind-neutral (F-066): a beer or a tea is not "this wine", and the price
    // is set on the line itself (F-065), not on Inventory.
    expect(tables.menu_items[0].price_flag_note).toBe(
      "The menu line shows no price, and the house had no price for it either, so it stands on the menu unpriced. An owner or a manager can set one here, with Edit on this line.",
    );
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
      // F-018: named for every drink it holds, not "Wine List".
      name: "Drinks list",
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

  it("F-1561: each line keeps its place as read, so the Full menu lists it where the house printed it, not A-Z", async () => {
    const tables: Record<string, Row[]> = base();
    const service = makeService(tables, {
      wineSubmissions,
      csvParser: new CsvParserService(),
    });
    const printed =
      "name,producer,bottle_price\nZinfandel,Ridge,70\nAmarone,Allegrini,90\nMerlot,Sea,40\n";
    await service.importMenu(
      {
        method: "csv",
        data: { csvContent: printed },
        restaurantId: "rest-1",
      } as any,
      "user-1",
    );
    expect(tables.menu_items.map((l) => [l.name, l.position])).toEqual([
      ["Zinfandel", 0],
      ["Amarone", 1],
      ["Merlot", 2],
    ]);
  });

  it("ADR 0340 rule 12: an upload makes its draft's sections in the same step, under the reader, and its drafts share one read id", async () => {
    const tables: Record<string, Row[]> = base();
    const service = makeService(tables, {
      wineSubmissions,
      csvParser: new CsvParserService(),
    });
    const r = await service.importMenu(
      {
        method: "csv",
        data: { csvContent: csv },
        restaurantId: "rest-1",
      } as any,
      "user-1",
    );
    expect(tables.__materialised).toEqual([
      { p_restaurant_id: "rest-1", p_menu_id: r.menuId, p_actor: "user-1" },
    ]);
    const version = tables.restaurant_menus.find((m) => m.id === r.menuId)!;
    expect(version.read_together_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("ADR 0340 rule 12: sections that could not be made take the version back out, as lines that could not be saved do (F-1296)", async () => {
    const tables: Record<string, Row[]> = base();
    tables.__materialiseFails = ["sections down"] as any;
    const service = makeService(tables, {
      wineSubmissions,
      csvParser: new CsvParserService(),
    });
    await expect(
      service.importMenu(
        {
          method: "csv",
          data: { csvContent: csv },
          restaurantId: "rest-1",
        } as any,
        "user-1",
      ),
    ).rejects.toThrow(/nothing was kept/);
    expect(tables.restaurant_menus.map((m) => m.id)).toEqual(["menu-old"]);
    expect(tables.menu_items).toEqual([]);
  });

  describe("resolveOnTap (ADR 0340 rule 9)", () => {
    const draft = () => ({
      restaurant_menus: [
        {
          id: "draft-1",
          restaurant_id: "rest-1",
          status: "draft",
          menu_type: "beverage",
        },
        {
          id: "draft-x",
          restaurant_id: "rest-2",
          status: "draft",
          menu_type: "beverage",
        },
      ] as Row[],
      menu_sections: [
        {
          id: "sec-1",
          restaurant_id: "rest-1",
          menu_id: "draft-1",
          parent_id: null,
          drink_category: "red",
          confirmed_at: "2026-10-12T10:00:00Z",
        },
      ] as Row[],
      menu_items: [
        // Unsure: a drink a tap just confirmed, in a red section, unlinked.
        {
          id: "l-unsure",
          restaurant_id: "rest-1",
          menu_id: "draft-1",
          name: "Barolo",
          producer: "Vietti",
          section_id: "sec-1",
          line_kind: "drink",
          category: "Mains",
          wine_library_id: null,
          status: "approved",
        },
        // A dish, and a line already linked: left alone.
        {
          id: "l-dish",
          restaurant_id: "rest-1",
          menu_id: "draft-1",
          name: "Steak",
          line_kind: "dish",
          wine_library_id: null,
          status: "approved",
        },
        {
          id: "l-linked",
          restaurant_id: "rest-1",
          menu_id: "draft-1",
          name: "Opus",
          line_kind: "drink",
          wine_library_id: "mw-9",
          status: "approved",
        },
        // Another house's line, named by id: never read.
        {
          id: "l-foreign",
          restaurant_id: "rest-2",
          menu_id: "draft-x",
          name: "Foreign",
          line_kind: "drink",
          wine_library_id: null,
          status: "approved",
        },
      ] as Row[],
      master_wine_library_submissions: [] as Row[],
    });

    it("links an Unsure line through the upload's resolver, with the section's category, and files its submission", async () => {
      const tables: Record<string, Row[]> = draft();
      const seen: Row[] = [];
      const service = makeService(tables, {
        wineSubmissions: {
          ...wineSubmissions,
          resolveLibraryWinesBatch: async (items: Row[]) => {
            seen.push(...items);
            return items.map(() => ({
              masterWineId: "mw-7",
              matched: true,
              libraryTier: 1,
              confidence: 97,
            }));
          },
        },
      });
      const r = await service.resolveOnTap(
        "rest-1",
        "draft-1",
        ["l-unsure", "l-dish", "l-linked", "l-foreign"],
        "user-1",
      );
      expect(r).toEqual({ linked: ["l-unsure"], unlinked: [], error: null });
      expect(seen).toEqual([
        expect.objectContaining({ name: "Barolo", menuCategory: "red" }),
      ]);
      const line = (id: string) => tables.menu_items.find((l) => l.id === id)!;
      expect(line("l-unsure").wine_library_id).toBe("mw-7");
      expect(line("l-dish").wine_library_id).toBeNull();
      expect(line("l-linked").wine_library_id).toBe("mw-9");
      expect(line("l-foreign").wine_library_id).toBeNull();
      expect(tables.master_wine_library_submissions).toHaveLength(1);
    });

    it("a resolver failure leaves the line Unsure and says why: the tap already committed", async () => {
      const tables: Record<string, Row[]> = draft();
      const service = makeService(tables, {
        wineSubmissions: {
          ...wineSubmissions,
          resolveLibraryWinesBatch: async () => {
            throw new Error("library down");
          },
        },
      });
      const r = await service.resolveOnTap(
        "rest-1",
        "draft-1",
        ["l-unsure"],
        "user-1",
      );
      expect(r.linked).toEqual([]);
      expect(r.unlinked).toEqual(["l-unsure"]);
      expect(r.error).toMatch(/library down/);
      expect(
        tables.menu_items.find((l) => l.id === "l-unsure")!.wine_library_id,
      ).toBeNull();
    });

    it("another house's menu links nothing", async () => {
      const tables: Record<string, Row[]> = draft();
      const service = makeService(tables, { wineSubmissions });
      const r = await service.resolveOnTap(
        "rest-1",
        "draft-x",
        ["l-foreign"],
        "user-1",
      );
      expect(r.linked).toEqual([]);
      expect(
        tables.menu_items.find((l) => l.id === "l-foreign")!.wine_library_id,
      ).toBeNull();
    });
  });

  it("names the CSV columns it did not read, as the file spells them (F-070)", async () => {
    const service = makeService(base(), {
      wineSubmissions,
      csvParser: new CsvParserService(),
    });
    const file =
      "Name,Producer,Cost,Bottle, Notes \nBarolo,Vietti,38,120,house pour\n";
    const r = await service.importMenu(
      {
        method: "csv",
        data: { csvContent: file },
        restaurantId: "rest-1",
      } as any,
      "user-1",
    );
    expect(r.unreadColumns).toEqual(["Cost", "Notes"]);
    // A file whose every column is read says none.
    const clean = await service.importMenu(
      {
        method: "csv",
        data: { csvContent: csv },
        restaurantId: "rest-1",
      } as any,
      "user-1",
    );
    expect(clean.unreadColumns).toEqual([]);
  });

  it("F-947: a CSV price like 1.250 is read by the house's mark it was sent with", async () => {
    const tables: Record<string, Row[]> = base();
    const service = makeService(tables, {
      wineSubmissions,
      csvParser: new CsvParserService(),
    });
    const file = "name,bottle_price\nOpus One,1.250\n";
    const r = await service.importMenu(
      {
        method: "csv",
        data: { csvContent: file },
        restaurantId: "rest-1",
        groupMark: ".",
      } as any,
      "user-1",
    );
    expect(
      tables.menu_items.find((l) => l.menu_id === r.menuId)!.bottle_price,
    ).toBe(1250);
    // Without the mark the same file is still refused, never guessed.
    await expect(
      service.importMenu(
        {
          method: "csv",
          data: { csvContent: file },
          restaurantId: "rest-1",
        } as any,
        "user-1",
      ),
    ).rejects.toThrow(/nothing was imported/);
  });

  it("a source that could not be stored is SAID on the version, and the read is still kept", async () => {
    const tables: Record<string, Row[]> = {
      ...base(),
      __storageFails: ["bucket unavailable"] as any,
    };
    const service = makeService(tables, {
      wineSubmissions,
      csvParser: new CsvParserService(),
    });
    const r = await service.importMenu(
      {
        method: "csv",
        data: { csvContent: csv },
        restaurantId: "rest-1",
      } as any,
      "user-1",
    );
    expect(r.source).toEqual({
      kept: false,
      failure: "the source file was not kept: bucket unavailable",
    });
    const version = tables.restaurant_menus.find((m) => m.id === r.menuId)!;
    expect(version.source_path).toBeNull();
    expect(version.source_failure).toMatch(/bucket unavailable/);
    expect(version.cadence).toBeNull(); // not tagged is NULL, never a default
    expect(version.menu_date).toBeNull();
  });

  it("F-680: a file that reads as no line is refused with its cause: no version, no 'menu uploaded'", async () => {
    const tables: Record<string, Row[]> = base();
    const service = makeService(tables, {
      wineSubmissions,
      csvParser: new CsvParserService(),
    });
    const run = () =>
      service.importMenu(
        {
          method: "csv",
          data: { csvContent: "Etiket;Bağ\nYakut;Kavaklıdere\n" },
          restaurantId: "rest-1",
        } as any,
        "user-1",
      );
    await expect(run()).rejects.toBeInstanceOf(BadRequestException);
    await expect(run()).rejects.toThrow(
      /could not find a column for the drink's name.*Etiket, Bağ/,
    );
    expect(tables.restaurant_menus).toHaveLength(1);
    expect(tables.user_onboarding_progress).toHaveLength(0);
    expect(tables.__storage ?? []).toHaveLength(0);
  });

  it("F-680: a scan that found no drink is refused, and no version is kept", async () => {
    const tables: Record<string, Row[]> = base();
    const service = makeService(tables, {
      wineSubmissions,
      scanParser: { parse: async () => [] },
    });
    await expect(
      service.importMenu(
        {
          method: "scan",
          data: { imageBase64: "JVBERi0=" },
          restaurantId: "rest-1",
        } as any,
        "user-1",
      ),
    ).rejects.toThrow(/could not find any drinks/);
    expect(tables.restaurant_menus).toHaveLength(1);
    expect(tables.user_onboarding_progress).toHaveLength(0);
  });

  it("F-017: the reply names the columns that were not read and the rows that were skipped", async () => {
    const service = makeService(base(), {
      wineSubmissions,
      csvParser: new CsvParserService(),
    });
    const r = await service.importMenu(
      {
        method: "csv",
        data: {
          csvContent:
            "Wine Name,Bottle,Price,Notes\nRED WINES,,,\nOpus One,62,62,lovely\n",
        },
        restaurantId: "rest-1",
      } as any,
      "user-1",
    );
    expect(r.itemsExtracted).toBe(1);
    // A bare Price names no serve, so it is not read (menu-import-a decision 2).
    expect(r.unreadColumns).toEqual(["Price", "Notes"]);
    expect(r.read).toEqual({
      ignoredColumns: ["Price", "Notes"],
      dropped: [
        { row: 2, reason: '"RED WINES" looks like a heading (no price)' },
      ],
      unreadable: [],
    });
  });

  it("a date that is not on the calendar is refused BEFORE the billed read", async () => {
    const parse = jest.fn();
    const service = makeService(base(), {
      wineSubmissions,
      scanParser: { parse },
    });
    await expect(
      service.importMenu(
        {
          method: "scan",
          data: { imageBase64: "JVBERi0=" },
          restaurantId: "rest-1",
          menuDate: "2026-02-30",
        } as any,
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

  it("ADR 0340 rule 12: an Arrival-sealed version (importParsedItems) makes its sections in the same step, under the reader", async () => {
    const tables: Record<string, Row[]> = base();
    const service = makeService(tables, { wineSubmissions });
    const r = await service.importParsedItems(
      [{ name: "Opus One", bottle_price: 62 } as any],
      "rest-1",
      "user-1",
      "manual",
    );
    expect(tables.__materialised).toEqual([
      { p_restaurant_id: "rest-1", p_menu_id: r.menuId, p_actor: "user-1" },
    ]);
    expect(tables.restaurant_menus.map((m) => m.id)).toContain(r.menuId);
  });

  it("ADR 0340 rule 12: an Arrival-sealed version whose sections could not be made is taken back out, lines and all (F-1296)", async () => {
    const tables: Record<string, Row[]> = base();
    tables.__materialiseFails = ["sections down"] as any;
    const service = makeService(tables, { wineSubmissions });
    const read = service.importParsedItems(
      [{ name: "Opus One", bottle_price: 62 } as any],
      "rest-1",
      "user-1",
      "manual",
    );
    await expect(read).rejects.toMatchObject({ status: 503 });
    await expect(read).rejects.toThrow(/nothing was kept/);
    expect(tables.restaurant_menus.map((m) => m.id)).toEqual(["menu-old"]);
    expect(tables.menu_items).toEqual([]);
  });

  it("a failed library match keeps nothing: no draft listing lines it does not hold, and a refusal that says so (F-1296)", async () => {
    const tables = base();
    const service = makeService(tables, {
      wineSubmissions: {
        ...wineSubmissions,
        resolveLibraryWinesBatch: async () => {
          throw new Error("statement timeout");
        },
      },
      scanParser: {
        parse: async () => [{ name: "Opus One", bottle_price: 62 }],
      },
    });
    const read = service.importMenu(
      {
        method: "scan",
        data: { imageBase64: Buffer.from("%PDF").toString("base64") },
        restaurantId: "rest-1",
      } as any,
      "user-1",
    );
    await expect(read).rejects.toMatchObject({ status: 503 });
    await expect(read).rejects.toThrow(/nothing was kept/);
    expect(tables.restaurant_menus.map((m) => m.id)).toEqual(["menu-old"]);
    expect(tables.menu_items).toHaveLength(0);
    expect(tables.user_onboarding_progress).toHaveLength(0);
  });

  it("a photo read only in part says why on the reply and on the kept menu (F-1292)", async () => {
    const tables = base();
    const service = makeService(tables, {
      wineSubmissions,
      scanParser: {
        parse: async (_b: string, _r: string, _a: boolean, gaps: string[]) => {
          gaps.push("the reading stopped before the end of the menu");
          return [{ name: "Opus One", bottle_price: 62 }];
        },
      },
    });
    const r = await service.importMenu(
      {
        method: "scan",
        data: { imageBase64: Buffer.from("%PDF").toString("base64") },
        restaurantId: "rest-1",
      } as any,
      "user-1",
    );
    expect(r.partRead).toBe("the reading stopped before the end of the menu");
    const listed = await service.listVersions("rest-1");
    expect(listed.versions.find((v) => v.menuId === r.menuId)!.partRead).toBe(
      "the reading stopped before the end of the menu",
    );
    expect(
      listed.versions.find((v) => v.menuId === "menu-old")!.partRead,
    ).toBeNull();
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
        return {
          data: { outcome: "made_current", previous_menu_ids: prev.map((m) => m.id), made_current_at: "2026-09-21T12:00:00Z" },
          error: null,
        };
      }
      if (fn === "set_house_menu_price") return { data: { outcome: "changed", held: [] }, error: null };
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

    /** The plan the page showed, then the choice naming it (L13). */
    const choose = async (service: MenusService, menuId: string, house = "rest-1", user = "user-2") =>
      service.makeCurrent(house, menuId, user, (await service.planFor(house, menuId)).fingerprint);

    it("a menu read only in part is made current only when the person says so (F-1292)", async () => {
      const tables: Record<string, Row[]> = base();
      const service = makeService(tables, {
        wineSubmissions,
        rpc: makeCurrentRpc(tables),
        scanParser: {
          parse: async (
            _b: string,
            _r: string,
            _a: boolean,
            gaps: string[],
          ) => {
            gaps.push("1 of the 2 parts of the file could not be read");
            return [{ name: "Opus One", bottle_price: 64 }];
          },
        },
      });
      const read = await service.importMenu(
        {
          method: "scan",
          data: { imageBase64: Buffer.from("%PDF").toString("base64") },
          restaurantId: "rest-1",
        } as any,
        "user-1",
      );
      const plan = await service.planFor("rest-1", read.menuId);
      expect(plan.partRead).toBe(
        "1 of the 2 parts of the file could not be read",
      );
      await expect(
        service.makeCurrent("rest-1", read.menuId, "user-2", plan.fingerprint),
      ).rejects.toThrow(
        /Only part of this menu was read \(1 of the 2 parts of the file could not be read\).*Nothing was changed/,
      );
      expect(
        tables.restaurant_menus.find((m) => m.id === "menu-old")!.status,
      ).toBe("active");
      const r = await service.makeCurrent(
        "rest-1",
        read.menuId,
        "user-2",
        plan.fingerprint,
        true,
      );
      expect(r.outcome).toBe("made_current");
    });

    it("switches the current menu, archives the old one, and carries the lines' prices by the chooser", async () => {
      const { calls, tables, service, read } = await readThenChoose([{ name: "Opus One", bottle_price: 64, by_glass_price: 15 }]);
      const r = await choose(service, read.menuId);

      expect(r).toMatchObject({ outcome: "made_current", previousMenuIds: ["menu-old"], lines: 1, priceSync: { changed: 1 }, flagged: 0, failed: [] });
      expect(tables.restaurant_menus.find((m) => m.id === "menu-old")).toMatchObject({ status: "archived", retired_by: "user-2" });
      const price = calls.filter(([fn]) => fn === "set_house_menu_price");
      expect(price).toHaveLength(1);
      expect(price[0][1]).toMatchObject({
        p_inventory_id: "inv-1",
        p_bottle_price: 64,
        p_glass_price: 15,
        // S202 (ADR 0193 amendment): a menu made current is its own dated
        // price change, 'menu_current'; a line added stays 'import'.
        p_change_source: "menu_current",
        p_changed_by: "user-2",
        // ADR 0193 round 3, L11 (this assertion was flipped): dated by the
        // CHOICE, never by the line's created_at, and naming the menu.
        p_effective_from: "2026-09-21T12:00:00Z",
        p_menu_id: read.menuId,
      });
      expect(r.madeCurrentAt).toBe("2026-09-21T12:00:00Z");
      expect(tables.menu_items[0].inventory_item_id).toBe("inv-1");
    });

    // F-1170: a kitchen line on a menu made current is set aside -- kept as a
    // menu line, and nothing else: no library row or submission, no stock
    // row, no price.
    it("sets a kitchen line aside: not resolved, not submitted, no stock row, no price", async () => {
      const resolved: unknown[][] = [];
      const calls: RpcCall[] = [];
      const tables: Record<string, Row[]> = base();
      const service = makeService(tables, {
        wineSubmissions: {
          ...wineSubmissions,
          resolveLibraryWinesBatch: async (items: unknown[]) => {
            resolved.push(items);
            return wineSubmissions.resolveLibraryWinesBatch(items);
          },
        },
        rpcCalls: calls,
        rpc: makeCurrentRpc(tables),
        scanParser: {
          parse: async () => [
            { name: "Grilled octopus", category: "Starters", bottle_price: 24 },
            { name: "Opus One", bottle_price: 64 },
          ],
        },
      });
      const read = await service.importMenu(
        {
          method: "scan",
          data: { imageBase64: Buffer.from("%PDF").toString("base64") },
          restaurantId: "rest-1",
        } as any,
        "user-1",
      );
      expect(resolved).toEqual([
        [expect.objectContaining({ name: "Opus One" })],
      ]);
      const r = await choose(service, read.menuId);

      expect(r).toMatchObject({
        outcome: "made_current",
        lines: 2,
        failed: [],
      });
      const octopus = tables.menu_items.find(
        (m) => m.name === "Grilled octopus",
      )!;
      expect(octopus).toMatchObject({ wine_library_id: null });
      expect(octopus.inventory_item_id ?? null).toBeNull();
      // F-1297: the kitchen line is set aside, not counted as an unmatched wine.
      expect(r.priceSync).toMatchObject({ kitchen: 1 });
      expect(r.priceSync).not.toHaveProperty("not_linked");
      expect(tables.master_wine_library_submissions).toHaveLength(1);
      expect(tables.restaurant_inventory).toHaveLength(1);
      const price = calls.filter(([fn]) => fn === "set_house_menu_price");
      expect(price).toHaveLength(1);
      expect(price[0][1]).toMatchObject({
        p_inventory_id: "inv-1",
        p_bottle_price: 64,
      });
    });

    // F-1297: the plan shown before the choice says the same.
    it("plans a kitchen line as set aside, not as a wine with no match", async () => {
      const tables: Record<string, Row[]> = base();
      const service = makeService(tables, {
        wineSubmissions,
        rpc: makeCurrentRpc(tables),
        scanParser: {
          parse: async () => [
            { name: "Grilled octopus", category: "Starters", bottle_price: 24 },
            { name: "Opus One", bottle_price: 64 },
          ],
        },
      });
      const read = await service.importMenu(
        {
          method: "scan",
          data: { imageBase64: Buffer.from("%PDF").toString("base64") },
          restaurantId: "rest-1",
        } as any,
        "user-1",
      );
      const plan = await service.planFor("rest-1", read.menuId);
      const octopus = plan.lines.find((l) => l.name === "Grilled octopus")!;
      expect(octopus.bottle.result).toBe("kitchen");
      expect(octopus.glass.result).toBe("kitchen");
      expect(plan.counts).toMatchObject({ kitchen: 2, not_linked: 0 });
    });

    // F-1293: a Turkish section reaches the library as the kind it names, so
    // the classifier files rakı as a spirit and bira as a beer, never as wine.
    it("hands the resolver the kind a Turkish drink section names", async () => {
      const resolved: Array<Array<{ name: string; menuCategory?: string }>> =
        [];
      const tables: Record<string, Row[]> = base();
      const service = makeService(tables, {
        wineSubmissions: {
          ...wineSubmissions,
          resolveLibraryWinesBatch: async (items: any[]) => {
            resolved.push(items);
            return wineSubmissions.resolveLibraryWinesBatch(items);
          },
        },
        scanParser: {
          parse: async () => [
            { name: "Yeni Rakı", category: "Rakı", bottle_price: 1400 },
            { name: "Efes", category: "Bira", bottle_price: 150 },
            { name: "Yakut", category: "Kırmızı şarap", bottle_price: 900 },
            { name: "Moscato", category: "Tatlı şarap", bottle_price: 800 },
            { name: "Mojito", category: "Kokteyller", bottle_price: 400 },
            { name: "Ayran", category: "Alkolsüz", bottle_price: 60 },
            { name: "Opus One", category: "red", bottle_price: 64 },
            { name: "House pour", category: "Şarap", bottle_price: 300 },
          ],
        },
      });
      await service.importMenu(
        {
          method: "scan",
          data: { imageBase64: Buffer.from("%PDF").toString("base64") },
          restaurantId: "rest-1",
        } as any,
        "user-1",
      );
      expect(
        Object.fromEntries(resolved[0].map((i) => [i.name, i.menuCategory])),
      ).toEqual({
        "Yeni Rakı": "spirit",
        Efes: "beer",
        Yakut: "red",
        Moscato: "dessert",
        Mojito: "cocktail",
        Ayran: "non-alcoholic",
        "Opus One": "red",
        // 'şarap' alone names no one kind. It used to go as written; ADR
        // 0340 rule 8 (ADR 0333): heading text never reaches the library,
        // so a line with no vocabulary token sends no category.
        "House pour": undefined,
      });
    });

    it("a kitchen line linked before the fix still seeds no stock row when its menu is made current", async () => {
      const { calls, tables, service, read } = await readThenChoose([
        { name: "Opus One", bottle_price: 64 },
      ]);
      // A stored line from before F-1170, still carrying a library wine.
      tables.menu_items.push({
        id: "mi-food",
        menu_id: read.menuId,
        restaurant_id: "rest-1",
        name: "Tiramisu",
        category: "Desserts",
        bottle_price: 9,
        wine_library_id: "mw-food",
        status: "approved",
      });
      const r = await choose(service, read.menuId);
      expect(r).toMatchObject({
        outcome: "made_current",
        lines: 2,
        failed: [],
      });
      expect(tables.restaurant_inventory.map((i) => i.master_wine_id)).toEqual([
        "mw-1",
      ]);
      expect(
        calls.filter(([fn]) => fn === "set_house_menu_price"),
      ).toHaveLength(1);
    });

    // F-1470: a cocktail is made from its recipe, never stocked. A stock row
    // of its own sat at 0 under its threshold: critical every morning.
    it("a cocktail line seeds no stock row and sets no price when its menu is made current, and the plan says why", async () => {
      const { calls, tables, service, read } = await readThenChoose([
        { name: "Opus One", bottle_price: 64 },
      ]);
      for (const [id, section] of [
        ["mi-negroni", "Signature Cocktails"],
        ["mi-mojito", "Kokteyller"],
      ]) {
        tables.menu_items.push({
          id,
          menu_id: read.menuId,
          restaurant_id: "rest-1",
          name: id,
          category: section,
          bottle_price: 16,
          wine_library_id: `mw-${id}`,
          status: "approved",
        });
      }
      const plan = await service.planFor("rest-1", read.menuId);
      const negroni = plan.lines.find((l) => l.name === "mi-negroni")!;
      expect(negroni.bottle.result).toBe("cocktail");
      expect(plan.counts).toMatchObject({ cocktail: 4, not_linked: 0 });

      const r = await choose(service, read.menuId);
      expect(r).toMatchObject({
        outcome: "made_current",
        lines: 3,
        failed: [],
      });
      expect(r.priceSync).toMatchObject({ cocktail: 2 });
      expect(tables.restaurant_inventory.map((i) => i.master_wine_id)).toEqual([
        "mw-1",
      ]);
      expect(
        calls.filter(([fn]) => fn === "set_house_menu_price"),
      ).toHaveLength(1);
    });

    // F-1503: "Cocktails & Spirits" is decided line by line: the bourbon
    // with a pour size keeps its stock row and price; the Negroni is made.
    it("a mixed cocktails-and-spirits section keeps its spirits as stock", async () => {
      const { tables, service, read } = await readThenChoose([
        { name: "Opus One", bottle_price: 64 },
      ]);
      for (const [id, name] of [
        ["mi-makers", "Maker's Mark 5cl"],
        ["mi-negroni", "Negroni"],
      ]) {
        tables.menu_items.push({
          id,
          menu_id: read.menuId,
          restaurant_id: "rest-1",
          name,
          category: "Cocktails & Spirits",
          bottle_price: 16,
          wine_library_id: `mw-${id}`,
          status: "approved",
        });
      }
      const plan = await service.planFor("rest-1", read.menuId);
      const kind = (name: string) =>
        plan.lines.find((l) => l.name === name)!.bottle.result;
      expect(kind("Negroni")).toBe("cocktail");
      expect(kind("Maker's Mark 5cl")).not.toBe("cocktail");

      const r = await choose(service, read.menuId);
      expect(r.priceSync).toMatchObject({ cocktail: 1 });
      expect(
        tables.restaurant_inventory.map((i) => i.master_wine_id).sort(),
      ).toEqual(["mw-1", "mw-mi-makers"]);
    });

    // F-1526: a beer by its brand alone, and a spirit a person filed as one,
    // in "Kokteyller ve Biralar" keep their stock rows; the Mojito is made.
    it("a brand beer and a line filed as a spirit in a mixed section are stocked, not cocktails", async () => {
      const { tables, service, read } = await readThenChoose([
        { name: "Opus One", bottle_price: 64 },
      ]);
      for (const [id, name, drink_category] of [
        ["mi-efes", "Efes Pilsen", null],
        ["mi-hendricks", "Hendrick's", "spirit"],
        ["mi-mojito", "Mojito", null],
      ]) {
        tables.menu_items.push({
          id,
          menu_id: read.menuId,
          restaurant_id: "rest-1",
          name,
          category: "Kokteyller ve Biralar",
          drink_category,
          bottle_price: 16,
          wine_library_id: `mw-${id}`,
          status: "approved",
        });
      }
      const plan = await service.planFor("rest-1", read.menuId);
      const kind = (name: string) =>
        plan.lines.find((l) => l.name === name)!.bottle.result;
      expect(kind("Mojito")).toBe("cocktail");
      expect(kind("Efes Pilsen")).not.toBe("cocktail");
      expect(kind("Hendrick's")).not.toBe("cocktail");

      const r = await choose(service, read.menuId);
      expect(r.priceSync).toMatchObject({ cocktail: 1 });
      expect(
        tables.restaurant_inventory.map((i) => i.master_wine_id).sort(),
      ).toEqual(["mw-1", "mw-mi-efes", "mw-mi-hendricks"]);
    });

    // F-946: the house removed the wine; a menu made current lists it again.
    it("brings back a wine the house removed when the chosen menu lists it", async () => {
      const { tables, service, read } = await readThenChoose([
        { name: "Opus One", bottle_price: 64 },
      ]);
      tables.restaurant_inventory[0].is_active = false;
      const r = await choose(service, read.menuId);

      expect(r).toMatchObject({
        outcome: "made_current",
        lines: 1,
        failed: [],
      });
      expect(tables.restaurant_inventory).toHaveLength(1);
      expect(tables.restaurant_inventory[0]).toMatchObject({
        id: "inv-1",
        is_active: true,
      });
      expect(tables.menu_items[0].inventory_item_id).toBe("inv-1");
    });

    it("a blank bottle price keeps the house's last known 60.00 and FLAGS the line (founder answer 3)", async () => {
      const { calls, tables, service, read } = await readThenChoose([
        { name: "Opus One", by_glass_price: 15 },
      ]);
      const r = await choose(service, read.menuId);
      const price = calls.filter(([fn]) => fn === "set_house_menu_price");
      expect(price[0][1]).toMatchObject({
        p_set_bottle: false,
        p_set_glass: true,
        p_glass_price: 15,
      });
      expect(r.flagged).toBe(1);
      expect(tables.menu_items[0].price_flag).toBe("blank_kept_last_known");
      // Past tense: the note must stay true after a manager changes the price.
      expect(tables.menu_items[0].price_flag_note).toMatch(
        /no bottle price, so the house kept the bottle price 60\.00 it already had/,
      );
    });

    it("the kept price in the flag note is in the house's money and marks (F-1174)", async () => {
      const { tables, service, read } = await readThenChoose([
        { name: "Opus One", by_glass_price: 15 },
      ]);
      Object.assign(tables.restaurants[0], { currency: "TRY", country: "TR" });
      tables.restaurant_inventory[0].menu_price_current = 1250;
      await choose(service, read.menuId);
      expect(tables.menu_items[0].price_flag_note).toMatch(
        /kept the bottle price ₺1\.250,00 it already had/,
      );
    });

    it("a blank kind the house never priced is not flagged: nothing is kept, nothing is unclear", async () => {
      const { tables, service, read } = await readThenChoose([
        { name: "Opus One", bottle_price: 64 },
      ]);
      const r = await choose(service, read.menuId);
      expect(r.flagged).toBe(0);
      expect(tables.menu_items[0].price_flag).toBeNull();
    });

    it("choosing the menu that is already current changes nothing and writes no price", async () => {
      const calls: RpcCall[] = [];
      const tables: Record<string, Row[]> = base();
      const service = makeService(tables, {
        rpcCalls: calls,
        rpc: makeCurrentRpc(tables),
      });
      const r = await choose(service, "menu-old");
      expect(r.outcome).toBe("already_current");
      expect(
        calls.filter(([fn]) => fn === "set_house_menu_price"),
      ).toHaveLength(0);
    });

    it("F-681: a menu with no lines is not made current; the house's menu stays", async () => {
      const calls: RpcCall[] = [];
      const tables: Record<string, Row[]> = base();
      tables.restaurant_menus.push({
        id: "menu-empty",
        restaurant_id: "rest-1",
        status: "draft",
      });
      const service = makeService(tables, {
        rpcCalls: calls,
        rpc: makeCurrentRpc(tables),
      });
      await expect(
        service.makeCurrent(
          "rest-1",
          "menu-empty",
          "user-2",
          "any-fingerprint",
        ),
      ).rejects.toThrow(
        /no lines, so making it current would empty the house's menu/,
      );
      expect(calls.filter(([fn]) => fn === "make_menus_current")).toHaveLength(
        0,
      );
      expect(
        tables.restaurant_menus.find((m) => m.id === "menu-old")!.status,
      ).toBe("active");
    });

    it("another house's menu id is a 404", async () => {
      const tables: Record<string, Row[]> = base();
      const service = makeService(tables, { rpc: makeCurrentRpc(tables) });
      await expect(
        service.makeCurrent("rest-2", "menu-old", "user-2", "any-fingerprint"),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.planFor("rest-2", "menu-old"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("a failed read of the menu's lines changes NOTHING: the switch is not made, so it can be tried again", async () => {
      const { calls, tables, service, read } = await readThenChoose([
        { name: "Opus One", bottle_price: 64 },
      ]);
      const fp = (await service.planFor("rest-1", read.menuId)).fingerprint;
      (tables as any).__readFails = [{ menu_items: "statement timeout" }];
      await expect(service.makeCurrent("rest-1", read.menuId, "user-2", fp)).rejects.toThrow(/statement timeout/);
      expect(calls.filter(([fn]) => fn === "make_menus_current")).toHaveLength(
        0,
      );
      expect(tables.restaurant_menus.find((m) => m.id === "menu-old")!.status).toBe("active");
      expect(tables.restaurant_menus.find((m) => m.id === read.menuId)!.status).toBe("draft");
    });

    it("a failed read of the house's own wine row is a FAILED line with the reason -- never 'not_linked', no price, no flag", async () => {
      const { calls, tables, service, read } = await readThenChoose([{ name: "Opus One", by_glass_price: 15 }]);
      const fp = (await service.planFor("rest-1", read.menuId)).fingerprint;
      // The read fails AFTER the plan and the switch, while the lines are carried.
      const rpc = makeCurrentRpc(tables);
      const failing = makeService(tables, {
        wineSubmissions,
        rpcCalls: calls,
        rpc: (fn, args) => {
          const out = rpc(fn, args);
          if (fn === "make_menu_current") (tables as any).__readFails = [{ restaurant_inventory: "connection reset" }];
          return out;
        },
      });
      const r = await failing.makeCurrent("rest-1", read.menuId, "user-2", fp);
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

    it("a large menu is carried in sets and side by side, never one line after another (F-448)", async () => {
      const N = 300;
      const lines = Array.from({ length: N }, (_, i) => ({
        name: `Wine ${i}`,
        bottle_price: 40 + (i % 7),
      }));
      const many = {
        resolveLibraryWinesBatch: async (items: unknown[]) =>
          items.map((_, i) => ({
            masterWineId: `mw-big-${i}`,
            matched: true,
            libraryTier: 1,
            confidence: 99,
          })),
        normalizeText: (t: string | null | undefined) =>
          t ? t.toLowerCase() : null,
      };
      const calls: RpcCall[] = [];
      const tables: Record<string, Row[]> = base();
      const rpc = makeCurrentRpc(tables);
      let inFlight = 0;
      let widest = 0;
      const service = makeService(tables, {
        wineSubmissions: many,
        rpcCalls: calls,
        scanParser: { parse: async () => lines },
        rpc: ((fn: string, args: Row) => {
          if (fn !== "set_house_menu_price") return rpc(fn, args);
          inFlight += 1;
          widest = Math.max(widest, inFlight);
          return new Promise((done) =>
            setTimeout(() => {
              inFlight -= 1;
              done(rpc(fn, args));
            }, 1),
          );
        }) as any,
      });
      const read = await service.importMenu(
        {
          method: "scan",
          data: { imageBase64: Buffer.from("%PDF").toString("base64") },
          restaurantId: "rest-1",
        } as any,
        "user-1",
      );
      const fp = (await service.planFor("rest-1", read.menuId)).fingerprint;

      const supabase = (service as any).dbService.supabase;
      const from = supabase.from;
      let houseRowReads = 0;
      supabase.from = (table: string) => {
        const q = from(table);
        if (table !== "restaurant_inventory") return q;
        const select = q.select;
        q.select = (...a: unknown[]) => {
          houseRowReads += 1;
          return select(...a);
        };
        return q;
      };

      const r = await service.makeCurrent("rest-1", read.menuId, "user-2", fp);
      expect(r).toMatchObject({
        outcome: "made_current",
        lines: N,
        priceSync: { changed: N },
        failed: [],
      });
      expect(
        calls.filter(([fn]) => fn === "set_house_menu_price"),
      ).toHaveLength(N);
      // The plan's read plus the carry's reads of 100 at a time, plus the
      // inserts' `.select("id")` for the new wines -- not one read per line.
      expect(houseRowReads - N).toBeLessThanOrEqual(10);
      expect(widest).toBeGreaterThan(1);
      expect(
        tables.menu_items
          .filter((l) => l.menu_id === read.menuId)
          .every((l) => l.inventory_item_id),
      ).toBe(true);
    });

    it("a switch that returns no outcome is an error, never a success", async () => {
      const service = makeService(base(), { rpc: () => ({ data: {}, error: null }) });
      await expect(choose(service, "menu-old")).rejects.toThrow(/no outcome/);
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

  it("F-699: the menus and the plan carry the house's zone, so the page prints the house's day; none set is null", async () => {
    const tables: Record<string, Row[]> = {
      restaurants: [{ id: "rest-1", timezone: "America/Los_Angeles" }],
      restaurant_menus: [
        { id: "m1", restaurant_id: "rest-1", status: "draft" },
      ],
      menu_items: [],
    };
    const service = makeService(tables);
    expect((await service.listVersions("rest-1")).timezone).toBe(
      "America/Los_Angeles",
    );
    expect((await service.planFor("rest-1", "m1")).timezone).toBe(
      "America/Los_Angeles",
    );
    tables.restaurants[0].timezone = null;
    expect((await service.listVersions("rest-1")).timezone).toBeNull();
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

  it("F-698: an UNPRICED line on the CURRENT menu from staff is refused too: no line, no stock row, no library submission", async () => {
    const tables: Record<string, Row[]> = base();
    const stockBefore = tables.restaurant_inventory.length;
    const resolve = jest.fn(wineSubmissions.resolveLibraryWinesBatch);
    const service = makeService(tables, {
      wineSubmissions: {
        ...wineSubmissions,
        resolveLibraryWinesBatch: resolve,
      },
    });
    await expect(
      service.addMenuItem(
        { menuId: "menu-old", name: "Opus One" } as any,
        "staff-1",
        "rest-1",
        false,
      ),
    ).rejects.toThrow(
      /Only an owner or a manager can add a line to the current menu/,
    );
    expect(tables.menu_items).toHaveLength(0);
    expect(tables.restaurant_inventory).toHaveLength(stockBefore);
    expect(resolve).not.toHaveBeenCalled();
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

/**
 * ADR 0193 ROUND 3 (the founder, 2026-09-21, verbatim: "add a section to that
 * where you can lock price, but wha f that menu item disappears? so think
 * verify validate your decision and build"). The plan shown before a menu is
 * chosen (L13), the choice that names it, the carry dated by the choice
 * (L11), what a lock holds (L4, L5, L15), a locked wine coming back (L18),
 * and the never-priced blank flag (round 6c answer 4, "Flag it").
 *
 * The fake answers `set_house_menu_price` the way the SQL does (PGlite probe
 * cellar-r3-locks.mjs proves the SQL itself): a kind with an open lock in
 * `house_price_locks` is held and named.
 */
describe("MenusService — the plan before a menu is chosen, and the locks it respects (ADR 0193 round 3)", () => {
  const T0 = "2026-09-21T12:00:00Z";
  /** A house with a current menu (menu-old) and a kept one (menu-new) to choose. */
  function house(): Record<string, Row[]> {
    return {
      restaurants: [{ id: "rest-1", default_threshold_min: 3 }],
      restaurant_menus: [
        { id: "menu-old", restaurant_id: "rest-1", status: "active" },
        { id: "menu-new", restaurant_id: "rest-1", status: "draft" },
      ],
      restaurant_inventory: [
        // mw-1: bottle LOCKED at 60, glass free at 14
        { id: "inv-1", restaurant_id: "rest-1", master_wine_id: "mw-1", wine_name: "Barolo", menu_price_current: 60, menu_price_glass: 14, is_active: true, master_wine_library: { vintage: 2019 } },
        // mw-2: priced 50 by the bottle only
        { id: "inv-2", restaurant_id: "rest-1", master_wine_id: "mw-2", wine_name: "Chianti", menu_price_current: 50, menu_price_glass: null, is_active: true },
        // mw-4: priced 30; its line will be blank
        { id: "inv-4", restaurant_id: "rest-1", master_wine_id: "mw-4", wine_name: "Soave", menu_price_current: 30, menu_price_glass: null, is_active: true },
        // mw-9: LOCKED, removed from inventory, on no menu
        { id: "inv-9", restaurant_id: "rest-1", master_wine_id: "mw-9", wine_name: "Old Rioja", menu_price_current: 80, menu_price_glass: null, is_active: false },
      ],
      house_price_locks: [
        { id: "lock-1", restaurant_id: "rest-1", inventory_id: "inv-1", kind: "bottle", locked_price: 60, locked_by: "user-1", locked_at: "2026-09-01T09:00:00Z", released_at: null },
        { id: "lock-9", restaurant_id: "rest-1", inventory_id: "inv-9", kind: "bottle", locked_price: 80, locked_by: "user-1", locked_at: "2026-08-01T09:00:00Z", released_at: null },
        { id: "lock-old", restaurant_id: "rest-1", inventory_id: "inv-2", kind: "bottle", locked_price: 45, locked_by: "user-1", locked_at: "2026-07-01T09:00:00Z", released_at: "2026-08-01T09:00:00Z" },
      ],
      menu_price_versions: [
        { id: "v-2", restaurant_id: "rest-1", inventory_id: "inv-2", changed_by: "user-3", effective_from: "2026-09-10T08:00:00Z", change_source: "manual", effective_to: null },
      ],
      users: [
        { user_id: "user-1", name: "Aylin" },
        { user_id: "user-3", name: "Deniz" },
      ],
      menu_items: [
        // The current menu lists only mw-2, so mw-1 is NOT on it (its lock is dormant now).
        { id: "old-1", menu_id: "menu-old", restaurant_id: "rest-1", name: "Chianti", wine_library_id: "mw-2", bottle_price: 50, status: "approved" },
        // The menu to choose:
        { id: "n-1", menu_id: "menu-new", restaurant_id: "rest-1", name: "Barolo", vintage: "2020", wine_library_id: "mw-1", bottle_price: 64, by_glass_price: 15, status: "approved" },
        { id: "n-2", menu_id: "menu-new", restaurant_id: "rest-1", name: "Chianti", wine_library_id: "mw-2", bottle_price: 55, status: "approved" },
        { id: "n-3", menu_id: "menu-new", restaurant_id: "rest-1", name: "Nebbiolo", wine_library_id: "mw-3", bottle_price: 40, status: "approved" },
        { id: "n-4", menu_id: "menu-new", restaurant_id: "rest-1", name: "Soave", wine_library_id: "mw-4", status: "approved" },
        { id: "n-5", menu_id: "menu-new", restaurant_id: "rest-1", name: "House red", wine_library_id: null, bottle_price: 20, status: "approved" },
        { id: "n-6", menu_id: "menu-new", restaurant_id: "rest-1", name: "Mystery", wine_library_id: "mw-6", status: "approved" },
      ],
      user_onboarding_progress: [],
    };
  }

  /** The SQL's answer: a locked kind is held and named, the rest is changed. */
  function rpcFor(tables: Record<string, Row[]>) {
    return (fn: string, args: Row) => {
      if (fn === "make_menu_current") {
        const menu = tables.restaurant_menus.find((m) => m.id === args.p_menu_id && m.restaurant_id === args.p_restaurant_id);
        if (!menu) return { data: null, error: { code: "P0002", message: "no menu" } };
        for (const m of tables.restaurant_menus.filter((x) => x.restaurant_id === args.p_restaurant_id && x.status === "active")) m.status = "archived";
        Object.assign(menu, { status: "active", made_current_at: T0 });
        return { data: { outcome: "made_current", previous_menu_ids: ["menu-old"], made_current_at: T0 }, error: null };
      }
      if (fn === "set_house_menu_price") {
        const open = (k: string) =>
          (tables.house_price_locks ?? []).find((l) => l.inventory_id === args.p_inventory_id && l.kind === k && l.released_at === null);
        const held = [
          args.p_set_bottle && open("bottle"),
          args.p_set_glass && open("glass"),
        ].filter(Boolean).map((l: any) => ({ kind: l.kind, lock_id: l.id, locked_price: l.locked_price, locked_by: l.locked_by, locked_at: l.locked_at }));
        const all = (!args.p_set_bottle || open("bottle")) && (!args.p_set_glass || open("glass"));
        return { data: { outcome: all ? "locked" : "changed", held }, error: null };
      }
      return { data: null, error: { message: `no rpc ${fn}` } };
    };
  }

  const setup = () => {
    const calls: RpcCall[] = [];
    const tables = house();
    const service = makeService(tables, { rpcCalls: calls, rpc: rpcFor(tables) });
    return { calls, tables, service };
  };

  it("L13: the plan says, per line and per kind, what choosing the menu would do -- and writes nothing", async () => {
    const { calls, tables, service } = setup();
    const plan = await service.planFor("rest-1", "menu-new");
    const by = Object.fromEntries(plan.lines.map((l) => [l.menuItemId, l]));
    expect(by["n-1"].bottle).toMatchObject({ result: "held_by_lock", menuPrice: 64, housePrice: 60, lock: { lockId: "lock-1", lockedPrice: 60, lockedBy: { userId: "user-1", name: "Aylin" } } });
    expect(by["n-1"].glass).toMatchObject({ result: "change", menuPrice: 15, housePrice: 14 });
    // A price that would be replaced says who set it and when.
    expect(by["n-2"].bottle).toMatchObject({ result: "change", lastSet: { by: { userId: "user-3", name: "Deniz" }, at: "2026-09-10T08:00:00Z", source: "manual" } });
    expect(by["n-2"].glass.result).toBe("blank_never_priced");
    expect(by["n-3"].bottle.result).toBe("new_wine");
    expect(by["n-4"].bottle.result).toBe("blank_kept");
    expect(by["n-4"].flag).toBe("blank_kept_last_known");
    expect(by["n-5"].bottle.result).toBe("not_linked");
    expect(by["n-6"].bottle.result).toBe("blank_never_priced");
    expect(by["n-6"].flag).toBe("blank_no_house_price");
    expect(plan.counts).toMatchObject({ held_by_lock: 1, change: 2, new_wine: 1, blank_kept: 1, not_linked: 2 });
    // Every open lock whose wine is not on this menu -- a removed wine included, a released lock not.
    expect(plan.dormantLocks).toEqual([
      expect.objectContaining({ lockId: "lock-9", wineName: "Old Rioja", active: false, lockedBy: { userId: "user-1", name: "Aylin" } }),
    ]);
    expect(plan.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.namesReadable).toBe(true);
    expect(calls).toHaveLength(0);
    expect(
      tables.restaurant_menus.find((m) => m.id === "menu-new")!.status,
    ).toBe("draft");
  });

  it("F-696: the plan names the current menu this choice takes off and counts the lines that leave with it; a different one current by the choice is a plan that moved", async () => {
    const { tables, service } = setup();
    tables.restaurant_menus.find((m) => m.id === "menu-old")!.name =
      "Wine list";
    // A discarded line is already off the menu; it does not leave with it.
    tables.menu_items.push({
      id: "old-2",
      menu_id: "menu-old",
      restaurant_id: "rest-1",
      name: "Gone",
      status: "discarded",
    });
    const plan = await service.planFor("rest-1", "menu-new");
    expect(plan.retiring).toEqual([
      { menuId: "menu-old", name: "Wine list", kind: null, lines: 1 },
    ]);
    // The menu already current takes nothing off.
    expect((await service.planFor("rest-1", "menu-old")).retiring).toEqual([]);
    // Another menu became current after the plan was shown: the choice is refused.
    tables.restaurant_menus.find((m) => m.id === "menu-old")!.status =
      "archived";
    tables.restaurant_menus.push({
      id: "menu-other",
      restaurant_id: "rest-1",
      status: "active",
      name: "Cocktails",
    });
    await expect(
      service.makeCurrent("rest-1", "menu-new", "user-1", plan.fingerprint),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("L11, as the founder confirmed it (\"The menu sets it, locks keep\"): a price a PERSON set after this menu was read is marked setAfterRead; a menu's own, or one set before the read, is not", async () => {
    const { tables, service } = setup();
    const menu = tables.restaurant_menus.find((m) => m.id === "menu-new")!;
    menu.extracted_at = "2026-09-05T10:00:00Z";
    // inv-1's price was last set by ANOTHER menu's choice after the read: not a person's.
    tables.menu_price_versions.push({ id: "v-1", restaurant_id: "rest-1", inventory_id: "inv-1", changed_by: "user-1", effective_from: "2026-09-12T08:00:00Z", change_source: "import", effective_to: null });
    const lineOf = async (id: string) => (await service.planFor("rest-1", "menu-new")).lines.find((l) => l.menuItemId === id)!;

    const plan = await service.planFor("rest-1", "menu-new");
    expect(plan.readAt).toBe("2026-09-05T10:00:00Z");
    // Deniz typed the Chianti's 50.00 by hand on 2026-09-10, after the read: the menu replaces it, listed first.
    expect((await lineOf("n-2")).bottle).toMatchObject({ result: "change", setAfterRead: true });
    expect((await lineOf("n-1")).glass).toMatchObject({ result: "change", setAfterRead: false });
    // A price that is not being replaced is never marked.
    expect((await lineOf("n-1")).bottle.setAfterRead).toBe(false);

    // Accepted advice is a person's act too.
    const v2 = tables.menu_price_versions.find((v) => v.id === "v-2")!;
    v2.change_source = "agent_accepted";
    expect((await lineOf("n-2")).bottle.setAfterRead).toBe(true);
    // Set BEFORE the read: the menu already saw it.
    v2.change_source = "manual";
    menu.extracted_at = "2026-09-11T00:00:00Z";
    expect((await lineOf("n-2")).bottle.setAfterRead).toBe(false);
    // A legacy menu with no read moment falls back to when its row was made...
    delete menu.extracted_at;
    menu.created_at = "2026-09-01T00:00:00Z";
    expect((await service.planFor("rest-1", "menu-new")).readAt).toBe("2026-09-01T00:00:00Z");
    expect((await lineOf("n-2")).bottle.setAfterRead).toBe(true);
    // ...and with neither recorded, nothing is called "after".
    delete menu.created_at;
    expect((await service.planFor("rest-1", "menu-new")).readAt).toBeNull();
    expect((await lineOf("n-2")).bottle.setAfterRead).toBe(false);
  });

  it("L18: a locked wine that was NOT on the menu being replaced is 'returned', and a differing vintage is marked", async () => {
    const { service } = setup();
    const plan = await service.planFor("rest-1", "menu-new");
    const barolo = plan.lines.find((l) => l.menuItemId === "n-1")!;
    expect(barolo.returned).toBe(true);
    // Read "2020" beside the locked row's library vintage 2019: the lock still holds, the mark is there to be seen.
    expect(barolo.vintageMismatch).toBe(true);
    expect(barolo.house).toEqual({ wineName: "Barolo", vintage: 2019, active: true });
    // Chianti is on the current menu too: not "returned"; and it has no lock.
    expect(plan.lines.find((l) => l.menuItemId === "n-2")!.returned).toBe(false);
  });

  it("F-661: a year against no year is marked too; no year on either side is not", async () => {
    const { tables, service } = setup();
    const n1 = tables.menu_items.find((m) => m.id === "n-1")!;
    const inv1 = tables.restaurant_inventory.find((r) => r.id === "inv-1")!;
    const barolo = async () =>
      (await service.planFor("rest-1", "menu-new")).lines.find(
        (l) => l.menuItemId === "n-1",
      )!;

    // The menu prints no year; the locked wine is the 2019.
    n1.vintage = null;
    expect((await barolo()).vintageMismatch).toBe(true);
    // NV reads as no year as well.
    n1.vintage = "NV";
    expect((await barolo()).vintageMismatch).toBe(true);
    // The menu prints 2020; the locked wine has no year on record.
    n1.vintage = "2020";
    inv1.master_wine_library = { vintage: null };
    expect((await barolo()).vintageMismatch).toBe(true);
    // Neither side names a year: nothing to look at.
    n1.vintage = null;
    expect((await barolo()).vintageMismatch).toBe(false);
  });

  it("L13: make-current without the plan's fingerprint is a 400, and nothing changes", async () => {
    const { calls, tables, service } = setup();
    await expect(service.makeCurrent("rest-1", "menu-new", "user-2")).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.makeCurrent("rest-1", "menu-new", "user-2", "  ")).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
    expect(tables.restaurant_menus.find((m) => m.id === "menu-new")!.status).toBe("draft");
  });

  it("L13: a plan that changed since it was shown is a 409, and nothing changes", async () => {
    const { calls, tables, service } = setup();
    const shown = await service.planFor("rest-1", "menu-new");
    // Someone typed a new price while the page was open.
    tables.restaurant_inventory.find((r) => r.id === "inv-2")!.menu_price_current = 52;
    await expect(service.makeCurrent("rest-1", "menu-new", "user-2", shown.fingerprint)).rejects.toBeInstanceOf(ConflictException);
    // ...and a lock that was set while it was open changes the plan too.
    const again = await service.planFor("rest-1", "menu-new");
    tables.house_price_locks.push({ id: "lock-new", restaurant_id: "rest-1", inventory_id: "inv-2", kind: "bottle", locked_price: 52, locked_by: "user-1", locked_at: T0, released_at: null });
    await expect(service.makeCurrent("rest-1", "menu-new", "user-2", again.fingerprint)).rejects.toBeInstanceOf(ConflictException);
    expect(calls).toHaveLength(0);
    expect(tables.restaurant_menus.find((m) => m.id === "menu-new")!.status).toBe("draft");
  });

  it("L11/L15: the choice carries every line dated by the choice, naming the menu; a held kind is counted AND named", async () => {
    const { calls, tables, service } = setup();
    const plan = await service.planFor("rest-1", "menu-new");
    const r = await service.makeCurrent("rest-1", "menu-new", "user-2", plan.fingerprint);
    const writes = calls.filter(([fn]) => fn === "set_house_menu_price").map(([, a]) => a);
    expect(writes.length).toBeGreaterThan(0);
    // S202: the act is named, 'menu_current', never the line word 'import'.
    for (const w of writes)
      expect(w).toMatchObject({
        p_effective_from: T0,
        p_menu_id: "menu-new",
        p_change_source: "menu_current",
        p_changed_by: "user-2",
      });
    // The Barolo line named both kinds: the bottle was held, the glass changed -- "changed" AND the held bottle named.
    expect(r.held).toEqual([
      expect.objectContaining({ menuItemId: "n-1", name: "Barolo", kind: "bottle", lockId: "lock-1", lockedPrice: 60 }),
    ]);
    expect(r.priceSync.changed).toBeGreaterThanOrEqual(1);
    expect(r.returned).toEqual([{ menuItemId: "n-1", name: "Barolo" }]);
    expect(r.madeCurrentAt).toBe(T0);
    // The two flags were written on their lines.
    expect(tables.menu_items.find((m) => m.id === "n-4")!.price_flag).toBe("blank_kept_last_known");
    expect(tables.menu_items.find((m) => m.id === "n-6")!.price_flag).toBe("blank_no_house_price");
  });

  it("L4/L15: a line whose every named kind is held is 'locked', counted as such, and named", async () => {
    const { tables, service } = setup();
    // Only the Barolo bottle on this menu, and it is locked.
    tables.menu_items = tables.menu_items.filter((m) => m.menu_id !== "menu-new");
    tables.menu_items.push({ id: "n-7", menu_id: "menu-new", restaurant_id: "rest-1", name: "Barolo", wine_library_id: "mw-1", bottle_price: 70, status: "approved" });
    const plan = await service.planFor("rest-1", "menu-new");
    const r = await service.makeCurrent("rest-1", "menu-new", "user-2", plan.fingerprint);
    expect(r.priceSync).toEqual({ locked: 1 });
    expect(r.held).toEqual([expect.objectContaining({ menuItemId: "n-7", kind: "bottle", lockId: "lock-1" })]);
  });

  it("L12: silence changes nothing -- a wine the chosen menu does not list is not written, and a kind a line leaves blank is never named in the write", async () => {
    const { calls, tables, service } = setup();
    const plan = await service.planFor("rest-1", "menu-new");
    const r = await service.makeCurrent("rest-1", "menu-new", "user-2", plan.fingerprint);
    const writes = calls.filter(([fn]) => fn === "set_house_menu_price").map(([, a]) => a);
    // Old Rioja (inv-9) is on no line of this menu: no write names it, and its price stands.
    expect(writes.some((w) => w.p_inventory_id === "inv-9")).toBe(false);
    expect(tables.restaurant_inventory.find((r) => r.id === "inv-9")!.menu_price_current).toBe(80);
    // The Soave line (inv-4) states no price at all: nothing is written for it (answer 3 keeps 30.00),
    // and it is said as "no price" -- not as a failure (Soave and the new Mystery wine: two lines).
    expect(writes.some((w) => w.p_inventory_id === "inv-4")).toBe(false);
    expect(r.priceSync).toEqual({ changed: 3, not_linked: 1, no_price: 2 });
    expect(r.failed).toEqual([]);
    // The Chianti line states a bottle price only: the glass is not named, so the house's glass stands.
    expect(writes.find((w) => w.p_inventory_id === "inv-2")).toMatchObject({ p_set_bottle: true, p_bottle_price: 55, p_set_glass: false, p_glass_price: null });
  });

  it("L25: a lock list that cannot be read makes the plan a 500, and make-current cannot go ahead", async () => {
    const { calls, tables, service } = setup();
    const plan = await service.planFor("rest-1", "menu-new");
    (tables as any).__readFails = [{ house_price_locks: "permission denied" }];
    await expect(service.planFor("rest-1", "menu-new")).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(service.makeCurrent("rest-1", "menu-new", "user-2", plan.fingerprint)).rejects.toThrow(/price locks could not be read.*permission denied/);
    expect(calls.filter(([fn]) => fn === "make_menus_current")).toHaveLength(0);
  });

  it("L25: a plan whose people cannot be named says so, and still decides nothing from names", async () => {
    const { tables, service } = setup();
    const before = await service.planFor("rest-1", "menu-new");
    (tables as any).__readFails = [{ users: "timeout" }];
    const plan = await service.planFor("rest-1", "menu-new");
    expect(plan.namesReadable).toBe(false);
    expect(plan.namesReason).toMatch(/could not be named: timeout/);
    expect(plan.fingerprint).toBe(before.fingerprint);
  });

  it("L4: a menu price correction on a locked kind is 'locked', names the lock, and names the menu on the write", async () => {
    const calls: RpcCall[] = [];
    const tables = house();
    tables.restaurant_menus[0].status = "active";
    tables.menu_items.push({ id: "c-1", menu_id: "menu-old", restaurant_id: "rest-1", name: "Barolo", wine_library_id: "mw-1", bottle_price: 60, inventory_item_id: "inv-1", status: "approved" });
    const service = makeService(tables, { rpcCalls: calls, rpc: rpcFor(tables) });
    const r = await service.reviewMenuItem("c-1", "user-2", "rest-1", { fieldName: "bottle_price", newValue: "75" } as any);
    expect(r.priceSync).toBe("locked");
    expect(r.priceHeld).toEqual([expect.objectContaining({ kind: "bottle", lockId: "lock-1" })]);
    expect(calls[0][1]).toMatchObject({ p_menu_id: "menu-old" });
  });

  it("the people behind kept menus: a failed name read is said (namesReadable false), never dropped", async () => {
    const { tables, service } = setup();
    tables.restaurant_menus[0].extracted_by = "user-1";
    (tables as any).__readFails = [{ users: "timeout" }];
    const list = await service.listVersions("rest-1");
    expect(list.namesReadable).toBe(false);
    expect(list.namesReason).toMatch(/timeout/);
  });
});

/**
 * ADR 0340 lane 3a (rules 7 and 8): every gate (a line added by hand, the
 * import's resolver call, the carry) asks lineIsDrink on the line's own menu
 * kind, the resolver is sent only a vocabulary token, and a category a person
 * confirmed is written on the house item as its declared kind.
 */
describe("MenusService — a line is a drink only when stored or proven (ADR 0340 lane 3a)", () => {
  const resolverCalls: unknown[][] = [];
  const wineSubmissions = {
    resolveLibraryWinesBatch: async (items: Array<{ name: string }>) => {
      resolverCalls.push(items);
      return items.map((i) => ({
        masterWineId: `mw-${i.name}`,
        matched: true,
        libraryTier: 1,
        confidence: 99,
      }));
    },
    normalizeText: (t: string | null | undefined) =>
      t ? t.toLowerCase() : null,
  };
  beforeEach(() => {
    resolverCalls.length = 0;
  });
  const sentToResolver = () =>
    resolverCalls.flat() as Array<{ name: string; menuCategory?: string }>;

  const liveMenu = (menuType: string): Record<string, Row[]> => ({
    restaurant_menus: [
      {
        id: "menu-1",
        restaurant_id: "rest-1",
        status: "active",
        menu_type: menuType,
      },
    ],
    restaurants: [{ id: "rest-1", default_threshold_min: 3 }],
    restaurant_inventory: [],
    menu_items: [],
    master_wine_library_submissions: [],
  });

  it.each(["food", "desserts"])(
    "a dish added to a live %s menu creates no library row, stock row or price",
    async (menuType) => {
      const calls: RpcCall[] = [];
      const tables = liveMenu(menuType);
      const service = makeService(tables, {
        wineSubmissions,
        rpcCalls: calls,
        rpc: () => ({ data: { outcome: "changed", held: [] }, error: null }),
      });
      // No heading and no kitchen word: the legacy rule alone would call it a drink.
      const item = await service.addMenuItem(
        { menuId: "menu-1", name: "Baklava", bottle_price: 9 } as any,
        "user-1",
        "rest-1",
        true,
      );
      expect(sentToResolver()).toEqual([]);
      expect(tables.restaurant_inventory).toEqual([]);
      expect(tables.master_wine_library_submissions).toEqual([]);
      expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toEqual([]);
      expect(tables.menu_items).toHaveLength(1);
      expect(tables.menu_items[0]).toMatchObject({
        name: "Baklava",
        wine_library_id: null,
      });
      expect(item.inventoryItemId).toBeNull();
    },
  );

  it("the same line on a live Drinks menu keeps today's rule: a wine is resolved and carried, a starter is not", async () => {
    const calls: RpcCall[] = [];
    const tables = liveMenu("beverage");
    const service = makeService(tables, {
      wineSubmissions,
      rpcCalls: calls,
      rpc: () => ({ data: { outcome: "changed", held: [] }, error: null }),
    });
    await service.addMenuItem(
      { menuId: "menu-1", name: "Baklava", bottle_price: 9 } as any,
      "user-1",
      "rest-1",
      true,
    );
    await service.addMenuItem(
      { menuId: "menu-1", name: "Meze tabağı", category: "Starters" } as any,
      "user-1",
      "rest-1",
      true,
    );
    expect(sentToResolver().map((i) => i.name)).toEqual(["Baklava"]);
    expect(tables.restaurant_inventory.map((r) => r.master_wine_id)).toEqual([
      "mw-Baklava",
    ]);
    expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(
      1,
    );
  });

  it("a heading text never reaches menuCategory: only a vocabulary token, or nothing", async () => {
    const tables: Record<string, Row[]> = {
      ...liveMenu("beverage"),
      user_onboarding_progress: [],
    };
    const service = makeService(tables, {
      wineSubmissions,
      scanParser: {
        parse: async () => [
          {
            name: "Old Fitzgerald",
            category: "Bourbon & Rye",
            bottle_price: 90,
          },
          {
            name: "House pour",
            category: "Wines by the glass",
            bottle_price: 30,
          },
          { name: "Opus One", category: "red", bottle_price: 400 },
          { name: "Yeni Rakı", category: "Rakı", bottle_price: 1400 },
          { name: "No section", bottle_price: 20 },
        ],
      },
    });
    await service.importMenu(
      {
        method: "scan",
        data: { imageBase64: Buffer.from("%PDF").toString("base64") },
        restaurantId: "rest-1",
      } as any,
      "user-1",
    );
    const sent = Object.fromEntries(
      sentToResolver().map((i) => [i.name, i.menuCategory]),
    );
    expect(sent).toEqual({
      "Old Fitzgerald": undefined,
      "House pour": undefined,
      "Opus One": "red",
      "Yeni Rakı": "spirit",
      "No section": undefined,
    });
  });

  /** A Drinks draft with these lines and sections, its plan shown, then chosen. */
  async function chooseDraft(
    lines: Row[],
    sections: Row[] = [],
    extra: Partial<Record<string, Row[]>> = {},
    fails: Row = {},
  ) {
    const calls: RpcCall[] = [];
    const tables: Record<string, Row[]> = {
      restaurant_menus: [
        {
          id: "menu-old",
          restaurant_id: "rest-1",
          status: "active",
          menu_type: "beverage",
        },
        {
          id: "menu-new",
          restaurant_id: "rest-1",
          status: "draft",
          menu_type: "beverage",
          name: "Drinks list",
        },
      ],
      restaurants: [{ id: "rest-1", default_threshold_min: 3 }],
      restaurant_inventory: [],
      menu_sections: sections.map((s) => ({
        restaurant_id: "rest-1",
        menu_id: "menu-new",
        parent_id: null,
        drink_category: null,
        confirmed_at: null,
        ...s,
      })),
      menu_items: lines.map((l, i) => ({
        id: `line-${i + 1}`,
        restaurant_id: "rest-1",
        menu_id: "menu-new",
        status: "approved",
        source: "scan",
        created_at: "2026-10-12T09:00:00Z",
        ...l,
      })),
      ...extra,
    } as Record<string, Row[]>;
    const service = makeService(tables, {
      rpcCalls: calls,
      rpc: (fn: string, args: Row) => {
        if (fn === "make_menu_current") {
          const menu = tables.restaurant_menus.find(
            (m) => m.id === args.p_menu_id,
          )!;
          for (const m of tables.restaurant_menus)
            if (m.status === "active" && m.menu_type === menu.menu_type)
              m.status = "archived";
          Object.assign(menu, {
            status: "active",
            made_current_at: "2026-10-12T12:00:00Z",
          });
          return {
            data: {
              outcome: "made_current",
              previous_menu_ids: ["menu-old"],
              made_current_at: "2026-10-12T12:00:00Z",
            },
            error: null,
          };
        }
        if (fn === "set_house_menu_price")
          return { data: { outcome: "changed", held: [] }, error: null };
        return { data: null, error: { message: `no rpc ${fn}` } };
      },
    });
    const plan = await service.planFor("rest-1", "menu-new");
    Object.assign(tables, fails);
    const run = service.makeCurrent(
      "rest-1",
      "menu-new",
      "user-2",
      plan.fingerprint,
    );
    return { calls, tables, plan, run };
  }

  it("a line stored as a dish is never carried, and one stored as a drink is, whatever its heading says", async () => {
    const { tables, plan, run, calls } = await chooseDraft([
      {
        name: "Mixed grill",
        category: "red",
        line_kind: "dish",
        wine_library_id: "mw-grill",
      },
      {
        name: "House red",
        category: "Starters",
        line_kind: "drink",
        // ADR 0340 rule 7 / lane 3c: a drink line with no vocabulary
        // category is Unsure and blocks make-live; this one has its own.
        drink_category: "red",
        wine_library_id: "mw-house",
        bottle_price: 40,
      },
    ]);
    const byName = Object.fromEntries(
      plan.lines.map((l) => [l.name, l.bottle.result]),
    );
    expect(byName).toEqual({
      "Mixed grill": "kitchen",
      "House red": "new_wine",
    });
    const r = await run;
    expect(r.priceSync).toEqual({ kitchen: 1, changed: 1 });
    expect(tables.restaurant_inventory.map((i) => i.master_wine_id)).toEqual([
      "mw-house",
    ]);
    expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(
      1,
    );
  });

  it("legacy lines on a Drinks menu carry exactly as before (no kind is written)", async () => {
    const { tables, plan, run } = await chooseDraft([
      {
        name: "Opus One",
        category: "red",
        wine_library_id: "mw-opus",
        bottle_price: 400,
      },
      { name: "Meze", category: "Starters", wine_library_id: "mw-meze" },
    ]);
    expect(
      Object.fromEntries(plan.lines.map((l) => [l.name, l.bottle.result])),
    ).toEqual({
      "Opus One": "new_wine",
      Meze: "kitchen",
    });
    await run;
    expect(tables.restaurant_inventory).toHaveLength(1);
    expect(tables.restaurant_inventory[0]).toMatchObject({
      master_wine_id: "mw-opus",
    });
    expect(tables.restaurant_inventory[0]).not.toHaveProperty("kind");
    expect(tables.restaurant_inventory[0]).not.toHaveProperty(
      "identity_provenance",
    );
  });

  it("a confirmed category is written on the house item as declared; a back-filled one is not", async () => {
    const { tables, run } = await chooseDraft(
      [
        // Its section was confirmed as spirits by a person.
        {
          name: "Yeni Rakı",
          section_id: "sec-bar",
          wine_library_id: "mw-raki",
          bottle_price: 1400,
        },
        // A child of the confirmed section, with no category of its own.
        {
          name: "Tekirdağ",
          section_id: "sec-bar-tr",
          wine_library_id: "mw-tekirdag",
          bottle_price: 1200,
        },
        // A back-filled section category, never tapped.
        {
          name: "Yakut",
          category: "red",
          section_id: "sec-red",
          wine_library_id: "mw-yakut",
          bottle_price: 900,
        },
        // A per-line category, on an existing house item the library filed as wine.
        {
          name: "Bomonti",
          line_kind: "drink",
          drink_category: "beer",
          section_id: "sec-red",
          wine_library_id: "mw-bomonti",
          bottle_price: 150,
        },
      ],
      [
        {
          id: "sec-bar",
          drink_category: "spirit",
          confirmed_at: "2026-10-12T10:00:00Z",
          confirmed_by: "user-2",
        },
        { id: "sec-bar-tr", parent_id: "sec-bar" },
        { id: "sec-red", drink_category: "red" },
      ],
      {
        restaurant_inventory: [
          {
            id: "inv-bomonti",
            restaurant_id: "rest-1",
            master_wine_id: "mw-bomonti",
            is_active: true,
            kind: "wine",
            identity_provenance: "wine_library",
          },
        ],
      },
    );
    const r = await run;
    expect(r.failed).toEqual([]);
    const byWine = Object.fromEntries(
      tables.restaurant_inventory.map((i) => [i.master_wine_id, i]),
    );
    expect(byWine["mw-raki"]).toMatchObject({
      kind: "spirit",
      identity_provenance: "house_declared",
    });
    expect(byWine["mw-tekirdag"]).toMatchObject({
      kind: "spirit",
      identity_provenance: "house_declared",
    });
    expect(byWine["mw-yakut"]).not.toHaveProperty("kind");
    expect(byWine["mw-yakut"]).not.toHaveProperty("identity_provenance");
    expect(byWine["mw-bomonti"]).toMatchObject({
      id: "inv-bomonti",
      kind: "beer",
      identity_provenance: "house_declared",
    });
  });

  it("a failed sections read changes nothing", async () => {
    const { tables, run, calls } = await chooseDraft(
      [
        {
          name: "Opus One",
          category: "red",
          wine_library_id: "mw-opus",
          bottle_price: 400,
        },
      ],
      [],
      {},
      { __readFails: [{ menu_sections: "timeout" }] as any },
    );
    await expect(run).rejects.toThrow(
      /sections could not be read.*Nothing was changed: timeout/,
    );
    expect(calls.filter(([fn]) => fn === "make_menu_current")).toEqual([]);
    expect(
      tables.restaurant_menus.find((m) => m.id === "menu-new")!.status,
    ).toBe("draft");
  });

  it("a declared kind that cannot be written is said on the line, and its price is not carried", async () => {
    const { run, calls } = await chooseDraft(
      [
        {
          name: "Bomonti",
          line_kind: "drink",
          drink_category: "beer",
          wine_library_id: "mw-bomonti",
          bottle_price: 150,
        },
      ],
      [],
      {
        restaurant_inventory: [
          {
            id: "inv-bomonti",
            restaurant_id: "rest-1",
            master_wine_id: "mw-bomonti",
            is_active: true,
            kind: "wine",
            identity_provenance: "wine_library",
          },
        ],
      },
      { __updateFails: [{ restaurant_inventory: "denied" }] as any },
    );
    const r = await run;
    expect(r.priceSync).toEqual({ failed: 1 });
    expect(r.failed).toEqual([
      {
        menuItemId: "line-1",
        name: "Bomonti",
        error: expect.stringMatching(
          /kind confirmed for this drink could not be written.*denied/,
        ),
      },
    ]);
    expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toEqual([]);
  });
});

describe("MenusService — one live menu per kind: the plan and make-live per kind (ADR 0340 lane 3c)", () => {
  const AT = {
    beverage: "2026-10-12T12:00:00Z",
    food: "2026-10-12T12:00:01Z",
    desserts: "2026-10-12T12:00:02Z",
  } as Record<string, string>;
  const wine = (
    id: string,
    menuId: string,
    w: string,
    bottle: number | null,
    extra: Row = {},
  ) => ({
    id,
    restaurant_id: "rest-1",
    menu_id: menuId,
    status: "approved",
    source: "scan",
    created_at: "2026-10-12T09:00:00Z",
    name: `Wine ${w}`,
    category: "red",
    line_kind: "drink",
    drink_category: "red",
    wine_library_id: w,
    bottle_price: bottle,
    ...extra,
  });
  const dish = (
    id: string,
    menuId: string,
    name: string,
    price: number | null,
    extra: Row = {},
  ) => ({
    id,
    restaurant_id: "rest-1",
    menu_id: menuId,
    status: "approved",
    source: "scan",
    created_at: "2026-10-12T09:00:00Z",
    name,
    category: "Mains",
    line_kind: "dish",
    price,
    ...extra,
  });
  const menu = (id: string, kind: string, status: string, extra: Row = {}) => ({
    id,
    restaurant_id: "rest-1",
    name: `${kind} ${id}`,
    menu_type: kind,
    status,
    ...(status === "active"
      ? {
          made_current_at: "2026-10-01T10:00:00Z",
          carried_at: "2026-10-01T10:00:05Z",
        }
      : {}),
    ...extra,
  });

  /**
   * A house: Drinks and Food live, a Drinks draft and a Food draft. The
   * database function is per kind (lane 1): it archives only the live menu of
   * the chosen menu's kind. `set_house_menu_price` moves the house row, so a
   * test reads the one live price there; `priceFails` names inventory ids
   * whose write fails.
   */
  function house(
    opts: {
      lines?: Row[];
      inventory?: Row[];
      locks?: Row[];
      refuse?: string;
      priceFails?: string[];
    } = {},
  ) {
    const calls: RpcCall[] = [];
    const tables: Record<string, Row[]> = {
      restaurant_menus: [
        menu("drinks-live", "beverage", "active"),
        menu("food-live", "food", "active"),
        menu("drinks-new", "beverage", "draft"),
        menu("food-new", "food", "draft"),
      ],
      restaurants: [{ id: "rest-1", default_threshold_min: 3 }],
      restaurant_inventory: opts.inventory ?? [],
      house_price_locks: opts.locks ?? [],
      menu_sections: [],
      menu_items: opts.lines ?? [],
    } as Record<string, Row[]>;
    const rpc = (fn: string, args: Row) => {
      if (fn === "make_menu_current") {
        if (opts.refuse && args.p_menu_id === opts.refuse)
          return {
            data: null,
            error: {
              code: "22023",
              message: "refused: this menu cannot go live",
            },
          };
        const m = tables.restaurant_menus.find(
          (x) =>
            x.id === args.p_menu_id && x.restaurant_id === args.p_restaurant_id,
        );
        if (!m)
          return { data: null, error: { code: "P0002", message: "no menu" } };
        if (m.status === "active")
          return {
            data: { outcome: "already_current", previous_menu_ids: [] },
            error: null,
          };
        const prev = tables.restaurant_menus.filter(
          (x) => x.status === "active" && x.menu_type === m.menu_type,
        );
        for (const p of prev) p.status = "archived";
        Object.assign(m, {
          status: "active",
          made_current_at: AT[m.menu_type],
          carried_at: null,
        });
        return {
          data: {
            outcome: "made_current",
            previous_menu_ids: prev.map((p) => p.id),
            made_current_at: AT[m.menu_type],
          },
          error: null,
        };
      }
      if (fn === "set_house_menu_price") {
        if ((opts.priceFails ?? []).includes(args.p_inventory_id))
          return { data: null, error: { message: "connection reset" } };
        const row = tables.restaurant_inventory.find(
          (r) => r.id === args.p_inventory_id,
        );
        if (row && args.p_set_bottle)
          row.menu_price_current = args.p_bottle_price;
        return { data: { outcome: "changed", held: [] }, error: null };
      }
      return { data: null, error: { message: `no rpc ${fn}` } };
    };
    const service = makeService(tables, { rpcCalls: calls, rpc });
    return { calls, tables, service };
  }
  const inv = (id: string, w: string, price: number | null) => ({
    id,
    restaurant_id: "rest-1",
    master_wine_id: w,
    wine_name: `Wine ${w}`,
    is_active: true,
    menu_price_current: price,
    menu_price_glass: null,
  });
  const lock = (inventoryId: string) => ({
    id: `lock-${inventoryId}`,
    restaurant_id: "rest-1",
    inventory_id: inventoryId,
    kind: "bottle",
    locked_price: 30,
    locked_by: "user-1",
    locked_at: "2026-10-01T09:00:00Z",
    released_at: null,
  });

  it("plans per kind: a Drinks draft retires only the live Drinks menu, says only its lines are gone, and a lock on a wine the live Food menu lists is not dormant", async () => {
    const { service } = house({
      inventory: [inv("inv-a", "mw-a", 40), inv("inv-p", "mw-pair", 30)],
      locks: [lock("inv-p")],
      lines: [
        wine("l-d0a", "drinks-live", "mw-a", 40),
        wine("l-d0b", "drinks-live", "mw-b", 55),
        dish("l-f0", "food-live", "Mixed grill", 18),
        wine("l-f0w", "food-live", "mw-pair", 30),
        wine("l-d1a", "drinks-new", "mw-a", 40),
      ],
    });
    const plan = await service.planFor("rest-1", "drinks-new");
    expect(plan.retiring.map((m) => m.menuId)).toEqual(["drinks-live"]);
    expect(plan.gone.map((g) => g.menuItemId)).toEqual(["l-d0b"]);
    expect(plan.dormantLocks).toEqual([]);
    expect(plan.menus).toEqual([
      {
        menuId: "drinks-new",
        kind: "beverage",
        current: false,
        partRead: null,
        lines: 1,
        unsure: 0,
        conflicts: 0,
      },
    ]);
  });

  it("two prices for one wine across the batch block make-live until picked, and nothing is written", async () => {
    const { service, calls, tables } = house({
      inventory: [inv("inv-a", "mw-a", 40)],
      lines: [
        wine("l-d1a", "drinks-new", "mw-a", 45),
        wine("l-f1a", "food-new", "mw-a", 50),
        dish("l-f1d", "food-new", "Mixed grill", 18),
      ],
    });
    const plan = await service.planFor("rest-1", "drinks-new", ["food-new"]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({
      wineLibraryId: "mw-a",
      kind: "bottle",
    });
    expect(plan.conflicts[0].prices.map((p) => p.price).sort()).toEqual([
      45, 50,
    ]);
    await expect(
      service.makeCurrent(
        "rest-1",
        "drinks-new",
        "user-2",
        plan.fingerprint,
        false,
        { menuIds: ["food-new"] },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    // A pick at a price nobody listed is refused too.
    await expect(
      service.makeCurrent(
        "rest-1",
        "drinks-new",
        "user-2",
        plan.fingerprint,
        false,
        {
          menuIds: ["food-new"],
          picks: [{ wineLibraryId: "mw-a", kind: "bottle", price: 47 }],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(calls.map(([fn]) => fn)).toEqual([]);
    expect(tables.menu_items.find((l) => l.id === "l-f1a")!.bottle_price).toBe(
      50,
    );
    expect(
      tables.restaurant_menus
        .filter((m) => m.status === "active")
        .map((m) => m.id)
        .sort(),
    ).toEqual(["drinks-live", "food-live"]);
  });

  it.each([
    ["keep live", 30],
    ["take draft", 52],
  ])(
    "%s: a pick is a draft edit before the switch, and the carry leaves one live price",
    async (_label, picked) => {
      const { service, calls, tables } = house({
        inventory: [inv("inv-p", "mw-pair", 30)],
        lines: [
          wine("l-f0w", "food-live", "mw-pair", 30),
          dish("l-f0", "food-live", "Mixed grill", 18),
          wine("l-d1p", "drinks-new", "mw-pair", 52),
        ],
      });
      const plan = await service.planFor("rest-1", "drinks-new");
      expect(plan.conflicts).toHaveLength(1);
      expect(plan.conflicts[0].prices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            menuItemId: "l-f0w",
            live: true,
            price: 30,
          }),
          expect.objectContaining({
            menuItemId: "l-d1p",
            live: false,
            price: 52,
          }),
        ]),
      );
      const r = await service.makeCurrent(
        "rest-1",
        "drinks-new",
        "user-2",
        plan.fingerprint,
        false,
        {
          picks: [{ wineLibraryId: "mw-pair", kind: "bottle", price: picked }],
        },
      );
      expect(r.picked).toBe(1);
      // The draft took the pick; the other kind's live line was never written here.
      expect(
        tables.menu_items.find((l) => l.id === "l-d1p")!.bottle_price,
      ).toBe(picked);
      expect(
        tables.menu_items.find((l) => l.id === "l-f0w")!.bottle_price,
      ).toBe(30);
      // The only price write is the carry's, after the switch, at the pick.
      const fns = calls.map(([fn]) => fn);
      expect(fns.indexOf("make_menus_current")).toBeGreaterThanOrEqual(0);
      const writes = calls.filter(([fn]) => fn === "set_house_menu_price");
      expect(fns.indexOf("set_house_menu_price")).toBeGreaterThan(
        fns.indexOf("make_menus_current"),
      );
      expect(
        writes.map(([, a]) => [
          a.p_bottle_price,
          a.p_effective_from,
          a.p_change_source,
        ]),
      ).toEqual([[picked, AT.beverage, "menu_current"]]);
      expect(tables.restaurant_inventory[0].menu_price_current).toBe(picked);
    },
  );

  it("a refused switch leaves every live price and live line as it was", async () => {
    const { service, calls, tables } = house({
      refuse: "food-new",
      inventory: [inv("inv-p", "mw-pair", 30)],
      lines: [
        wine("l-f0w", "food-live", "mw-pair", 30),
        wine("l-d1p", "drinks-new", "mw-pair", 52),
        dish("l-f1d", "food-new", "Mixed grill", 18),
      ],
    });
    const plan = await service.planFor("rest-1", "drinks-new", ["food-new"]);
    await expect(
      service.makeCurrent(
        "rest-1",
        "drinks-new",
        "user-2",
        plan.fingerprint,
        false,
        {
          menuIds: ["food-new"],
          picks: [{ wineLibraryId: "mw-pair", kind: "bottle", price: 52 }],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(
      0,
    );
    expect(tables.restaurant_inventory[0].menu_price_current).toBe(30);
    expect(tables.menu_items.find((l) => l.id === "l-f0w")!.bottle_price).toBe(
      30,
    );
    expect(
      tables.restaurant_menus
        .filter((m) => m.status === "active")
        .map((m) => m.id)
        .sort(),
    ).toEqual(["drinks-live", "food-live"]);
  });

  it("a line's stored kind or a dish price moved after the plan was shown is a 409, nothing switched", async () => {
    const { service, calls, tables } = house({
      lines: [
        dish("l-f0", "food-live", "Mixed grill", 18),
        dish("l-f1", "food-new", "Mixed grill", 20),
      ],
    });
    const plan = await service.planFor("rest-1", "food-new");
    expect(plan.lines.find((l) => l.menuItemId === "l-f1")!.dish).toEqual({
      price: 20,
      livePrice: 18,
      changed: true,
    });
    tables.menu_items.find((l) => l.id === "l-f1")!.price = 21;
    await expect(
      service.makeCurrent("rest-1", "food-new", "user-2", plan.fingerprint),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(calls.map(([fn]) => fn)).toEqual([]);
  });

  it("an Unsure line on a Food draft blocks that batch: nothing is switched", async () => {
    const { service, calls } = house({
      lines: [dish("l-f1", "food-new", "Mixed grill", 20, { line_kind: null })],
    });
    const plan = await service.planFor("rest-1", "food-new");
    expect(plan.unsure).toEqual([
      {
        menuId: "food-new",
        menuItemId: "l-f1",
        name: "Mixed grill",
        reason: "kind_not_decided",
      },
    ]);
    await expect(
      service.makeCurrent("rest-1", "food-new", "user-2", plan.fingerprint),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(calls.map(([fn]) => fn)).toEqual([]);
  });

  it("a carry that did not finish is finished by the retry, dated by that menu's own choice; a finished one is not carried again", async () => {
    const { service, calls, tables } = house({
      inventory: [inv("inv-a", "mw-a", 40)],
      priceFails: ["inv-a"],
      lines: [
        wine("l-d1a", "drinks-new", "mw-a", 45),
        dish("l-f1d", "food-new", "Mixed grill", 18),
      ],
    });
    const first = await service.planFor("rest-1", "drinks-new", ["food-new"]);
    const r1 = await service.makeCurrent(
      "rest-1",
      "drinks-new",
      "user-2",
      first.fingerprint,
      false,
      {
        menuIds: ["food-new"],
      },
    );
    expect(r1.menus.map((m) => [m.menuId, m.outcome, m.carryFinished])).toEqual(
      [
        ["drinks-new", "made_current", false],
        ["food-new", "made_current", true],
      ],
    );
    const row = (id: string) =>
      tables.restaurant_menus.find((m) => m.id === id)!;
    expect(row("drinks-new").carried_at).toBeNull();
    expect(typeof row("food-new").carried_at).toBe("string");
    // The versions list says which carry has not finished (rule 4).
    const listed = (await service.listVersions("rest-1")).versions;
    expect(listed.find((v) => v.menuId === "drinks-new")!.carryFinished).toBe(
      false,
    );
    expect(listed.find((v) => v.menuId === "food-new")!.carryFinished).toBe(
      true,
    );
    expect(listed.find((v) => v.menuId === "drinks-live")!.carryFinished).toBe(
      true,
    );

    // The connection comes back; the person chooses the same batch again.
    calls.length = 0;
    (tables.restaurant_inventory[0] as Row).menu_price_current = 40;
    const again = await service.planFor("rest-1", "drinks-new", ["food-new"]);
    const house2 = makeService(tables, {
      rpcCalls: calls,
      rpc: (fn: string, args: Row) =>
        fn === "make_menu_current"
          ? {
              data: { outcome: "already_current", previous_menu_ids: [] },
              error: null,
            }
          : fn === "set_house_menu_price"
            ? (() => {
                tables.restaurant_inventory[0].menu_price_current =
                  args.p_bottle_price;
                return { data: { outcome: "changed", held: [] }, error: null };
              })()
            : { data: null, error: { message: `no rpc ${fn}` } },
    });
    const r2 = await house2.makeCurrent(
      "rest-1",
      "drinks-new",
      "user-2",
      again.fingerprint,
      false,
      {
        menuIds: ["food-new"],
      },
    );
    expect(r2.outcome).toBe("already_current");
    expect(
      r2.menus.map((m) => [m.menuId, m.recarried, m.carryFinished]),
    ).toEqual([
      ["drinks-new", true, true],
      ["food-new", false, true],
    ]);
    const writes = calls.filter(([fn]) => fn === "set_house_menu_price");
    expect(
      writes.map(([, a]) => [
        a.p_bottle_price,
        a.p_effective_from,
        a.p_menu_id,
      ]),
    ).toEqual([[45, AT.beverage, "drinks-new"]]);
    expect(typeof row("drinks-new").carried_at).toBe("string");
    expect(tables.restaurant_inventory[0].menu_price_current).toBe(45);
  });
});

describe("MenusService — one upload, one draft per kind, behind MENUS_SPLIT_BY_KIND (ADR 0340 lane 5b)", () => {
  const before = process.env.MENUS_SPLIT_BY_KIND;
  afterEach(() => {
    if (before === undefined) delete process.env.MENUS_SPLIT_BY_KIND;
    else process.env.MENUS_SPLIT_BY_KIND = before;
  });

  const GAP = "pages 11-20 could not be read";
  // A read of a menu that prints drinks, food and desserts, and a heading
  // no rule knows.
  const read = () => [
    {
      name: "Merlot",
      producer: "Duckhorn",
      category: "red",
      bottle_price: 120,
      line_kind_suggested: "drink",
      section: {
        path: ["Wines", "Red"],
        kind_suggested: "drinks",
        drink_category: "red",
      },
    },
    {
      name: "Lamb shank",
      price: 32,
      line_kind_suggested: "dish",
      section: { path: ["Mains"], kind_suggested: "food" },
    },
    {
      name: "Baklava",
      price: 9,
      line_kind_suggested: "dish",
      section: { path: ["Desserts"], kind_suggested: "desserts" },
    },
    { name: "Mystery", bottle_price: 5, section: { path: ["Zzqx"] } },
  ];
  const resolved: unknown[][] = [];
  const wineSubmissions = {
    resolveLibraryWinesBatch: async (items: unknown[]) => {
      resolved.push(items);
      return items.map(() => ({
        masterWineId: "mw-1",
        matched: true,
        libraryTier: 1,
        confidence: 99,
      }));
    },
    normalizeText: (t: string | null | undefined) =>
      t ? t.toLowerCase() : null,
  };
  const scanParser = () => ({
    parse: jest.fn(
      async (
        _b: string,
        _r: string,
        _a: boolean,
        gaps: string[],
        _o: unknown,
      ) => {
        gaps.push(GAP);
        return read();
      },
    ),
    classifyHeadings: jest.fn(async () => new Map()),
  });
  const tables = (): Record<string, Row[]> => ({
    restaurant_menus: [],
    restaurants: [{ id: "rest-1", default_threshold_min: 3 }],
    restaurant_inventory: [],
    menu_items: [],
    user_onboarding_progress: [],
    master_wine_library_submissions: [],
  });
  const scan = {
    method: "scan",
    data: { imageBase64: Buffer.from("menu").toString("base64") },
    restaurantId: "rest-1",
  } as any;
  beforeEach(() => {
    resolved.length = 0;
  });

  it("off (the default): one Drinks draft, sections from categories, the partial read in its own column", async () => {
    delete process.env.MENUS_SPLIT_BY_KIND;
    const t = tables();
    const parser = scanParser();
    const service = makeService(t, { wineSubmissions, scanParser: parser });
    const r = await service.importMenu(scan, "user-1");
    expect(parser.parse.mock.calls[0][4]).toEqual({ sections: false });
    expect(parser.classifyHeadings).not.toHaveBeenCalled();
    expect(t.restaurant_menus).toHaveLength(1);
    expect(t.restaurant_menus[0]).toMatchObject({
      name: "Drinks list",
      menu_type: "beverage",
      part_read: GAP,
    });
    expect(r.partRead).toBe(GAP);
    expect(r.drafts).toBeUndefined();
    expect(t.__materialised).toHaveLength(1);
    expect(
      t.menu_items.every((l) => l.line_kind === null && l.price === null),
    ).toBe(true);
  });

  it("on: a draft per kind, Drinks first, one read id, every draft says it was read in part", async () => {
    process.env.MENUS_SPLIT_BY_KIND = "true";
    const t = tables();
    const parser = scanParser();
    const sections: Row[] = [];
    const service = makeService(t, {
      wineSubmissions,
      scanParser: parser,
      rpc: (fn, args) => {
        if (fn === "materialise_read_sections") sections.push(args);
        return { data: {}, error: null };
      },
    });
    const r = await service.importMenu(scan, "user-1");
    expect(parser.parse.mock.calls[0][4]).toEqual({ sections: true });
    expect(parser.classifyHeadings).toHaveBeenCalledTimes(1);
    expect(
      t.restaurant_menus.map((m) => [m.menu_type, m.name, m.part_read]),
    ).toEqual([
      ["beverage", "Drinks list", GAP],
      ["food", "Food menu", GAP],
      ["desserts", "Desserts menu", GAP],
    ]);
    expect(new Set(t.restaurant_menus.map((m) => m.read_together_id))).toEqual(
      new Set([r.readTogetherId]),
    );
    expect(r.menuId).toBe(t.restaurant_menus[0].id);
    expect(r.drafts!.map((d) => [d.kind, d.items.map((i) => i.name)])).toEqual([
      ["beverage", ["Merlot", "Mystery"]],
      ["food", ["Lamb shank"]],
      ["desserts", ["Baklava"]],
    ]);
    // The printed sections, not the category back-fill.
    expect(t.__materialised).toBeUndefined();
    expect(sections.map((s) => s.p_sections.map((x: Row) => x.path))).toEqual([
      [["Wines", "Red"], ["Zzqx"]],
      [["Mains"]],
      [["Desserts"]],
    ]);
    const line = (name: string) => t.menu_items.find((l) => l.name === name)!;
    expect(sections[0].p_sections[0].lines).toEqual([line("Merlot").id]);
    expect(line("Merlot")).toMatchObject({
      line_kind: "drink",
      price: null,
      bottle_price: 120,
    });
    expect(line("Lamb shank")).toMatchObject({
      line_kind: "dish",
      price: 32,
      bottle_price: null,
      by_glass_price: null,
    });
    expect(line("Mystery").line_kind).toBeNull();
    expect(line("Mystery").kind_flag).toMatch(/rules_unknown/);
  });

  it("on: only a line decided to be a drink reaches the resolver; a dish and an Unsure line never do", async () => {
    process.env.MENUS_SPLIT_BY_KIND = "true";
    const service = makeService(tables(), {
      wineSubmissions,
      scanParser: scanParser(),
      rpc: () => ({ data: {}, error: null }),
    });
    await service.importMenu(scan, "user-1");
    expect(resolved.flat().map((i: any) => i.name)).toEqual(["Merlot"]);
  });

  it("on: a failure at the second draft takes every draft of the read back out", async () => {
    process.env.MENUS_SPLIT_BY_KIND = "true";
    const t = tables();
    let n = 0;
    const service = makeService(t, {
      wineSubmissions,
      scanParser: scanParser(),
      rpc: (fn) =>
        fn === "materialise_read_sections" && ++n === 2
          ? { data: null, error: { message: "sections down" } }
          : { data: {}, error: null },
    });
    await expect(service.importMenu(scan, "user-1")).rejects.toThrow(
      /nothing was kept/,
    );
    expect(t.restaurant_menus).toEqual([]);
    expect(t.menu_items).toEqual([]);
  });

  it("a kept menu says why it was read in part from its column, and a version from before rule 17 from its name", async () => {
    const t: Record<string, Row[]> = {
      restaurant_menus: [
        {
          id: "m1",
          restaurant_id: "rest-1",
          status: "draft",
          name: "Food menu",
          part_read: GAP,
          extracted_at: "2026-10-02T00:00:00Z",
        },
        {
          id: "m2",
          restaurant_id: "rest-1",
          status: "draft",
          name: "Drinks list, read in part: old reason",
          extracted_at: "2026-10-01T00:00:00Z",
        },
      ],
      users: [],
    };
    const r = await makeService(t).listVersions("rest-1");
    expect(r.versions.map((v) => [v.menuId, v.partRead])).toEqual([
      ["m1", GAP],
      ["m2", "old reason"],
    ]);
  });
});
