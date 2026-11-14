import * as crypto from "crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { LINE_SELECT, MenusService, SOURCE_NOT_TAKEN, houseZoneOf, newestCurrentFirst, parseMenuPrice } from "./menus.service";
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
    let deleting = false;
    // ADR 0193's tests drive the whole add-a-line pipeline, which INSERTs and
    // reads the inserted rows back; the fake appends them to the table so a
    // later read sees them, same as the real write.
    let inserted: Row[] | null = null;
    let insertError: { code: string; message: string } | null = null;
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
      // `.delete().eq(...)`: applied lazily in `then`, like `update`. A failed
      // background read drops the lines it had kept; a failed line write drops
      // the version (#773). `tables.__deleteFails = [{ <table>: "<message>" }]`
      // makes it fail.

      delete() {
        deleting = true;
        return api;
      },
      insert(rows: Row | Row[]) {
        // `tables.__insertFails = [{ <table>: "<message>" }]` makes every
        // INSERT into that table fail with the message and land nothing.
        const insertFails = ((tables as any).__insertFails?.[0] ?? {})[table];
        if (insertFails) {
          inserted = [];
          insertError = { code: "XX000", message: insertFails };
          return api;
        }
        const list = Array.isArray(rows) ? rows : [rows];
        // uq_restaurant_menus_one_read_of_a_file_at_a_time: one read under way
        // per house, file and labels (migration 20270722100000).
        const key = (r: Row) =>
          [r.restaurant_id, r.source_sha256, r.cadence ?? "", r.menu_date ?? "", r.menu_date_precision ?? ""].join("|");
        if (
          table === "restaurant_menus" &&
          list.some(
            (r) =>
              r.read_state === "reading" &&
              r.source_sha256 &&
              (tables[table] || []).some((o) => o.read_state === "reading" && o.source_sha256 && key(o) === key(r)),
          )
        ) {
          insertError = { code: "23505", message: 'duplicate key value violates unique constraint "uq_restaurant_menus_one_read_of_a_file_at_a_time"' };
          inserted = [];
          return api;
        }
        // `tables.__insertFails = { <table>: (rows) => "<message>" | undefined }`
        // refuses an INSERT whose rows the function names (nothing lands).
        const refuse = (tables as any).__insertFails?.[table]?.(list);
        if (refuse) {
          insertError = { code: "XX000", message: refuse };
          return api;
        }
        inserted = list.map((r) => ({
          id: `${table}-${++seq}`,
          created_at: "2026-09-21T10:00:00.000Z",
          ...r,
        }));
        (tables[table] = tables[table] || []).push(...inserted);
        return api;
      },
      single: async () => {
        if (insertError) return { data: null, error: insertError };
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
        if (insertError) return resolve({ data: null, error: insertError });
        if (inserted) return resolve({ data: inserted, error: null });
        if (deleting) {
          const deleteFails = ((tables as any).__deleteFails?.[0] ?? {})[table];
          if (deleteFails) return resolve({ data: null, error: { message: deleteFails } });
          const gone = new Set(matching());
          tables[table] = (tables[table] || []).filter((r) => !gone.has(r));
          return resolve({ data: null, error: null });
        }
        if (!updatePatch && readFails()) return resolve({ data: null, error: { message: readFails() } });
        const rows = matching();
        if (updatePatch) for (const row of rows) Object.assign(row, updatePatch);
        if (deleting) tables[table] = (tables[table] || []).filter((r) => !rows.includes(r));
        resolve({ data: rows, error: null });
      },
    };
    return api;
  }
  const rpc = async (fn: string, args: Row): Promise<{ data: unknown; error: unknown }> => {
    rpcCalls.push([fn, args]);
    if (fn === "set_house_menu_prices" && rpcImpl) {
      // The batch writer (migration 20270913140000) as the SQL runs it: the
      // test's own set_house_menu_price for each row, in order, one refusal
      // failing its own row. `tables.__batchWriter` overrides it:
      // "missing" answers as a database without the function does.
      const mode = (tables as any).__batchWriter;
      if (mode === "missing") return { data: null, error: { code: "PGRST202", message: "Could not find the function public.set_house_menu_prices" } };
      if (typeof mode === "function") return mode(args);
      const out: Row[] = [];
      for (const e of args.p_rows as Row[]) {
        const one = await rpc("set_house_menu_price", {
          p_restaurant_id: args.p_restaurant_id,
          p_inventory_id: e.inventory_id,
          p_set_bottle: "bottle" in e,
          p_bottle_price: "bottle" in e ? e.bottle : null,
          p_set_glass: "glass" in e,
          p_glass_price: "glass" in e ? e.glass : null,
          p_change_source: args.p_change_source,
          p_changed_by: args.p_changed_by,
          p_effective_from: args.p_effective_from,
          p_reason: args.p_reason,
          p_unit_cost: null,
          p_pricing_analysis_id: null,
          p_menu_id: args.p_menu_id,
        });
        const err = one.error as { code?: string; message?: string } | null;
        out.push({ id: e.id, result: err ? { outcome: "failed", error: err.message, code: err.code ?? null } : one.data });
      }
      return { data: out, error: null };
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
      remove: async (paths: string[]) => {
        (tables.__storageRemoved = tables.__storageRemoved || []).push(...paths.map((path) => ({ bucket, path })));
        return { data: paths.map((name) => ({ name })), error: null };
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
});

/**
 * r28 G11 (r21 defect 7): /menu showed only the printed price. A price changed
 * on Inventory after the menu, or held by a lock, was never shown beside it.
 */
describe("MenusService.getMenu -- the house's own price beside each linked line (r28 G11)", () => {
  const menu = { id: "menu-1", restaurant_id: "rest-1", name: "Wine List", status: "active" };
  const line = (id: string, over: Row = {}): Row => ({
    id, menu_id: "menu-1", restaurant_id: "rest-1", name: id, category: "Red", status: "approved", ...over,
  });

  it("sends bottle, glass and removed for a linked line, nothing for an unlinked one, and only this house's row", async () => {
    const service = makeService({
      restaurant_menus: [menu],
      menu_items: [
        line("mi-1", { inventory_item_id: "inv-1", bottle_price: 48, by_glass_price: 12 }),
        line("mi-2", { inventory_item_id: null, bottle_price: 30 }),
        line("mi-3", { inventory_item_id: "inv-other", bottle_price: 20 }),
        line("mi-4", { inventory_item_id: "inv-gone", bottle_price: 20 }),
        line("mi-5", { inventory_item_id: "inv-off", bottle_price: 20 }),
      ],
      restaurant_inventory: [
        { id: "inv-1", restaurant_id: "rest-1", menu_price_current: "55.00", menu_price_glass: 12, is_active: true, deleted_at: null },
        { id: "inv-other", restaurant_id: "rest-2", menu_price_current: 99, menu_price_glass: null, is_active: true, deleted_at: null },
        { id: "inv-gone", restaurant_id: "rest-1", menu_price_current: 20, menu_price_glass: null, is_active: true, deleted_at: "2026-11-01T00:00:00Z" },
        { id: "inv-off", restaurant_id: "rest-1", menu_price_current: null, menu_price_glass: null, is_active: false, deleted_at: null },
      ],
    });
    const r: any = await service.getMenu("rest-1");
    const by = (id: string) => r.items.find((i: any) => i.id === id);
    expect(by("mi-1").house_price).toEqual({ bottle: 55, glass: 12, removed: false });
    expect(by("mi-2")).not.toHaveProperty("house_price");
    expect(by("mi-3")).not.toHaveProperty("house_price");
    expect(by("mi-4").house_price).toEqual({ bottle: 20, glass: null, removed: true });
    expect(by("mi-5").house_price).toEqual({ bottle: null, glass: null, removed: true });
    expect(r).not.toHaveProperty("housePricesUnreadable");
  });

  it("reads the house's rows in chunks of 150 ids, so a 151-line menu is read whole", async () => {
    const lines: Row[] = [];
    const goods: Row[] = [];
    for (let n = 0; n < 151; n++) {
      lines.push(line(`mi-${String(n).padStart(3, "0")}`, { inventory_item_id: `inv-${n}`, bottle_price: n }));
      goods.push({ id: `inv-${n}`, restaurant_id: "rest-1", menu_price_current: n + 1, menu_price_glass: null, is_active: true, deleted_at: null });
    }
    const service = makeService({ restaurant_menus: [menu], menu_items: lines, restaurant_inventory: goods });
    const fake = (service as any).dbService.supabase;
    const from = fake.from;
    const sizes: number[] = [];
    fake.from = (table: string) => {
      const api = from(table);
      if (table !== "restaurant_inventory") return api;
      const inner = api.in;
      api.in = (col: string, vals: any[]) => {
        sizes.push(vals.length);
        return inner(col, vals);
      };
      return api;
    };
    const r: any = await service.getMenu("rest-1");
    expect(sizes).toEqual([150, 1]);
    expect(r.items.every((i: any) => i.house_price && i.house_price.bottle === Number(i.inventory_item_id.slice(4)) + 1)).toBe(true);
  });

  it("says an unreadable read once on the reply, and never sends a line a house price it did not read", async () => {
    const service = makeService({
      restaurant_menus: [menu],
      menu_items: [line("mi-1", { inventory_item_id: "inv-1", bottle_price: 48 })],
      restaurant_inventory: [{ id: "inv-1", restaurant_id: "rest-1", menu_price_current: 55, is_active: true }],
      __readFails: [{ restaurant_inventory: "pooler timeout" }] as any,
    });
    const r: any = await service.getMenu("rest-1");
    expect(r.housePricesUnreadable).toBe("the house's own prices could not be read: pooler timeout");
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).not.toHaveProperty("house_price");
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
    "price_flag", "price_flag_note", "created_at",
  ];
  const ROOT_KEYS = ["menuId", "name", "status", "items"];

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
      price_flag: null,
      price_flag_note: null,
      raw_extracted_text: null,
      created_at: "2026-10-07T10:00:00Z",
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
    expect(LINE_SELECT.split(",").map((c) => c.trim()).sort()).toEqual([...MEMBER_KEYS, "raw_extracted_text", "review_notes"].sort());
    // review_notes is read only to say why a line is flagged (flag_reason,
    // flag_field); its text is never a member key.
    expect(MEMBER_LINE_KEYS as readonly string[]).not.toContain("review_notes");
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
    expect(Object.keys(barolo).sort()).toEqual([...MEMBER_KEYS, "kitchen_line", "flag_reason", "flag_field", "raw_line_withheld"].sort());
    expect(Object.keys(tiramisu).sort()).toEqual([...MEMBER_KEYS, "kitchen_line", "flag_reason", "flag_field", "raw_line_withheld"].sort());
    expect(Object.keys(soave).sort()).toEqual([...MEMBER_KEYS, "kitchen_line", "flag_reason", "flag_field"].sort());
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
    expect(Object.keys(barolo).sort()).toEqual([...MEMBER_KEYS, "kitchen_line", "flag_reason", "flag_field", "raw_extracted_text"].sort());
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
      expect(Object.keys(r).sort()).toEqual([...ROOT_KEYS, "rawLineWithheld"].sort());
      expect(r.rawLineWithheld).toBe(true);
      expect(Object.keys(byName(r.items, "Barolo")).sort()).toEqual([...MEMBER_KEYS, "kitchen_line", "flag_reason", "flag_field", "raw_line_withheld"].sort());
      expect(byName(r.items, "Tiramisu").kitchen_line).toBe(true);
      const text = JSON.stringify(r);
      for (const secret of SECRETS) expect(text).not.toContain(secret);
    }
    const holder: any = await service.getMenu("rest-1", { rawLine: true });
    expect(Object.keys(holder).sort()).toEqual([...ROOT_KEYS].sort());
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

  // Menu r21: "45,50" was stored as 4550 and became the house's price.
  it("a decimal comma is a decimal: '45,50' sets 45.5 on the line and on the house", async () => {
    const calls: RpcCall[] = [];
    const tables = { menu_items: [line()], restaurant_menus: [CURRENT()] };
    const service = makeService(tables, { rpc: changed, rpcCalls: calls });
    const result = await service.reviewMenuItem("mi-1", "user-1", "rest-1", {
      fieldName: "bottle_price",
      newValue: "45,50",
    } as any);
    expect(tables.menu_items[0].bottle_price).toBe(45.5);
    expect(calls[0][1]).toMatchObject({ p_bottle_price: 45.5 });
    expect(result.newValue).toBe("45.5");
  });

  it("a price it cannot read for sure is refused, and nothing is written", async () => {
    const calls: RpcCall[] = [];
    const tables = { menu_items: [line()], restaurant_menus: [CURRENT()] };
    const service = makeService(tables, { rpc: changed, rpcCalls: calls });
    for (const typed of ["-5", "1,250", "abc"]) {
      await expect(
        service.reviewMenuItem("mi-1", "user-1", "rest-1", { fieldName: "bottle_price", newValue: typed } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(tables.menu_items[0].bottle_price).toBe(60);
    expect(tables.menu_items[0].status).toBe("approved");
    expect(calls).toHaveLength(0);
  });

  it("a dish's price changes on its line only, and the reply says it is a kitchen line", async () => {
    const calls: RpcCall[] = [];
    const tables = {
      menu_items: [{ ...line(), name: "Tiramisu", category: "Desserts", inventory_item_id: null, bottle_price: 9 }],
      restaurant_menus: [CURRENT()],
    };
    const service = makeService(tables, { rpc: changed, rpcCalls: calls });
    const result = await service.reviewMenuItem("mi-1", "user-1", "rest-1", {
      fieldName: "bottle_price",
      newValue: "11",
    } as any);
    expect(tables.menu_items[0].bottle_price).toBe(11);
    expect(result.priceSync).toBe("kitchen_line");
    expect(calls).toHaveLength(0);
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

  it("reads a decimal-comma price as written: '45,50' is 45.50, not 4550", async () => {
    const tables = { menu_items: [line()], restaurant_menus: [CURRENT()] };
    const service = makeService(tables, { rpc: changed });
    await service.reviewMenuItem("mi-1", "user-1", "rest-1", {
      fieldName: "bottle_price",
      newValue: "45,50",
    } as any);
    expect(tables.menu_items[0].bottle_price).toBe(45.5);
  });

  it("refuses a price with two readings ('1.250') in words, and touches neither the line nor the house price", async () => {
    const calls: RpcCall[] = [];
    const tables = { menu_items: [line()], restaurant_menus: [CURRENT()] };
    const service = makeService(tables, { rpc: changed, rpcCalls: calls });
    const write = service.reviewMenuItem("mi-1", "user-1", "rest-1", {
      fieldName: "bottle_price",
      newValue: "1.250",
    } as any);
    await expect(write).rejects.toBeInstanceOf(BadRequestException);
    // r33 meet: parseMenuPrice says the two readings by name.
    await expect(write).rejects.toThrow(/could be 1250 or 1\.25/);
    expect(tables.menu_items[0].bottle_price).toBe(60);
    expect(tables.menu_items[0].status).toBe("approved");
    expect(calls).toHaveLength(0);
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
  });

  it("a kitchen line added to the CURRENT menu gets no house row and no price, and says so", async () => {
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
      rpc: () => ({ data: { outcome: "changed", bottle_price: 9, glass_price: null }, error: null }),
    });

    const item = await service.addMenuItem(
      { menuId: "menu-1", name: "Tiramisu", category: "dessert", bottle_price: 9 } as any,
      "user-1",
      "rest-1",
      true,
    );

    expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(0);
    expect(tables.restaurant_inventory).toHaveLength(0);
    expect(item.priceSync).toBe("kitchen_line");
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
      restaurant_inventory: [{ id: "inv-1", restaurant_id: "rest-1", master_wine_id: "mw-1", kind: "wine" }],
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
    expect(tables.menu_items[0].price_flag_note).toMatch(/shows no price, and the house had no price for this wine either/);
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

  it("a kitchen line is never sent to the library: no library row, no submission, kept on the menu unlinked (menu walk 2026-11-11)", async () => {
    const tables: Record<string, Row[]> = base();
    const sent: string[] = [];
    const spy = {
      ...wineSubmissions,
      resolveLibraryWinesBatch: async (items: Array<{ name: string }>) => {
        sent.push(...items.map((i) => i.name));
        return items.map(() => ({ masterWineId: "mw-1", matched: true, libraryTier: 1, confidence: 99 }));
      },
    };
    const service = makeService(tables, { wineSubmissions: spy, csvParser: new CsvParserService() });
    const r = await service.importMenu(
      {
        method: "csv",
        data: { csvContent: "name,category,bottle_price\nTiramisu,dessert,9\nOpus One,red,62\nSauternes 2015,dessert,80\n" },
        restaurantId: "rest-1",
      } as any,
      "user-1",
    );

    // The dish is not sent; the wine and the dessert WINE are, in menu order.
    expect(sent).toEqual(["Opus One", "Sauternes 2015"]);
    expect(r.items.map((i: any) => [i.name, i.matched])).toEqual([
      ["Tiramisu", false],
      ["Opus One", true],
      ["Sauternes 2015", true],
    ]);
    const tiramisu = tables.menu_items.find((l) => l.name === "Tiramisu")!;
    expect(tiramisu.wine_library_id).toBeNull();
    expect(tiramisu.submission_id ?? null).toBeNull();
    expect(tables.master_wine_library_submissions).toHaveLength(2);
    expect(tables.menu_items.find((l) => l.name === "Opus One")!.wine_library_id).toBe("mw-1");
  });

  it("a menu of kitchen lines only asks the library nothing", async () => {
    const tables: Record<string, Row[]> = base();
    let asked = 0;
    const spy = {
      ...wineSubmissions,
      resolveLibraryWinesBatch: async (items: unknown[]) => {
        asked += 1;
        return items.map(() => ({ masterWineId: "mw-1", matched: true, libraryTier: 1, confidence: 99 }));
      },
    };
    const service = makeService(tables, { wineSubmissions: spy, csvParser: new CsvParserService() });
    const r = await service.importMenu(
      { method: "csv", data: { csvContent: "name,category,bottle_price\nTiramisu,dessert,9\nCaesar salad,food,12\n" }, restaurantId: "rest-1" } as any,
      "user-1",
    );
    expect(asked).toBe(0);
    expect(r.items).toHaveLength(2);
    expect(tables.menu_items.every((l) => l.wine_library_id === null)).toBe(true);
    expect(tables.master_wine_library_submissions).toHaveLength(0);
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
    expect([r.warnings, version.read_warnings]).toEqual([[], []]);
    expect(version.source_path).toMatch(/^rest-1\/menus\/[0-9a-f]{64}\.csv$/);
    expect(tables.__storage[0]).toMatchObject({ bucket: "vendor-attachments", path: version.source_path });
    // The house's current menu is untouched, and no price moved.
    expect(tables.restaurant_menus.find((m) => m.id === "menu-old")!.status).toBe("active");
    expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(0);
    expect(r.items[0].priceSync).toBe("not_current");
    // Lines are stored against the new version, not appended to the old menu.
    expect(tables.menu_items.every((l) => l.menu_id === r.menuId)).toBe(true);
  });

  it("a price the file read left blank is SAID on the reply, row by row, not only dropped", async () => {
    const service = makeService(base(), { wineSubmissions, csvParser: new CsvParserService() });
    const r = await service.importMenu(
      { method: "csv", data: { csvContent: "name;bottle_price\nOpus One;1.250\n;90\n" }, restaurantId: "rest-1" } as any,
      "user-1",
    );
    expect(r.itemsExtracted).toBe(1);
    expect(r.notes).toEqual([
      { row: 2, reason: "two_readings", field: "bottle_price", raw: "1.250" },
      { row: 3, reason: "no_name" },
    ]);
  });

  it("a source that could not be stored is SAID on the version, and the read is still kept", async () => {
    const tables: Record<string, Row[]> = { ...base(), __storageFails: ["bucket unavailable"] as any };
    const service = makeService(tables, { wineSubmissions, csvParser: new CsvParserService() });
    const r = await service.importMenu({ method: "csv", data: { csvContent: csv }, restaurantId: "rest-1" } as any, "user-1");
    expect(r.source).toEqual({ kept: false, failure: SOURCE_NOT_TAKEN });
    const version = tables.restaurant_menus.find((m) => m.id === r.menuId)!;
    expect(version.source_path).toBeNull();
    expect(version.source_failure).toBe(SOURCE_NOT_TAKEN); // the storage error goes to the log, not the page
    expect(version.cadence).toBeNull(); // not tagged is NULL, never a default
    expect(version.menu_date).toBeNull();
  });

  it("a date that is not on the calendar is refused BEFORE the billed read", async () => {
    const parse = jest.fn();
    const service = makeService(base(), { wineSubmissions, scanParser: { parse, parseWithWarnings: parse } });
    await expect(
      service.importMenu(
        { method: "scan", data: { imageBase64: "JVBERi0=" }, restaurantId: "rest-1", menuDate: "2026-02-30" } as any,
        "user-1",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(parse).not.toHaveBeenCalled();
  });

  it("a scan that WAITS (spend record unreadable) ends as a FAILED read that says why, with no line and no onboarding mark", async () => {
    const tables = base();
    const service = makeService(tables, {
      wineSubmissions,
      scanParser: {
        parseWithWarnings: async () => {
          throw new MenuReadWaitingException("This restaurant's AI spend record could not be read, so the menu read is waiting");
        },
      },
    });
    const r = await service.importMenu({ method: "scan", data: { imageBase64: "JVBERi0=" }, restaurantId: "rest-1" } as any, "user-1");
    expect(r.reading).toBe(true);
    await service.whenRead(r.menuId);
    const version = tables.restaurant_menus.find((m) => m.id === r.menuId)!;
    expect(version).toMatchObject({ status: "draft", read_state: "failed", lines_extracted: 0 });
    expect(version.read_failure).toMatch(/menu read is waiting/);
    expect(tables.menu_items).toHaveLength(0);
  });

  it("a scan keeps its photo/PDF under the house, content-addressed, with the sniffed type", async () => {
    const tables: Record<string, Row[]> = base();
    const service = makeService(tables, {
      wineSubmissions,
      scanParser: {
        parseWithWarnings: async () => ({ items: [{ name: "Opus One", bottle_price: 62 }], warnings: [] }),
      },
    });
    const pdf = Buffer.from("%PDF-1.7 fake").toString("base64");
    const r = await service.importMenu({ method: "scan", data: { imageBase64: pdf }, restaurantId: "rest-1" } as any, "user-1");
    // Kept at once, before the read: a read cut off later still names its file.
    const version = tables.restaurant_menus.find((m) => m.id === r.menuId)!;
    expect(version).toMatchObject({ source_method: "scan", source_mime: "application/pdf", read_state: "reading" });
    expect(version.source_path).toMatch(/^rest-1\/menus\/[0-9a-f]{64}\.pdf$/);
    await service.whenRead(r.menuId);
    expect(version.read_state).toBe("done");
  });

  // Proposal-menu step 1c: ADR 0213 #17 and ADR 0193 item 7.
  it("a partial scan keeps WHICH pages it could not read, on the version and in the finished read", async () => {
    const tables: Record<string, Row[]> = {
      ...base(),
      user_onboarding_progress: [{ id: "p-1", restaurant_id: "rest-1", menu_uploaded: false }],
    };
    const warnings = [{ kind: "chunk_failed", pages: { first: 11, last: 20 } }];
    const service = makeService(tables, {
      wineSubmissions,
      scanParser: {
        parseWithWarnings: async () => ({ items: [{ name: "Opus One", bottle_price: 62 }], warnings }),
      },
    });
    const pdf = Buffer.from("%PDF-1.7 fake").toString("base64");
    const r = await service.importMenu({ method: "scan", data: { imageBase64: pdf }, restaurantId: "rest-1" } as any, "user-1");
    await service.whenRead(r.menuId);
    const read = await service.readStatus("rest-1", r.menuId);
    expect(read.state).toBe("done");
    expect(read.reply!.warnings).toEqual(warnings);
    expect(read.reply!.items).toEqual([expect.objectContaining({ name: "Opus One" })]);
    const version = tables.restaurant_menus.find((m) => m.id === r.menuId)!;
    expect(version.read_warnings).toEqual(warnings);
    expect(version.extraction).toEqual([{ name: "Opus One", bottle_price: 62 }]);
    const listed = await service.listVersions("rest-1");
    const v = listed.versions.find((x) => x.menuId === r.menuId)!;
    expect([v.readWarnings, v.readState]).toEqual([warnings, "done"]);
    expect(tables.user_onboarding_progress[0].menu_uploaded).toBe(true);
  });

  // r28 G16: a typed line past the 25th was flagged "Free tier: exceeds 25 item
  // limit". No plan holds that cap, the flag gated nothing, and a new house
  // typing its menu was told it was over a limit.
  it("keeps every typed line as typed, the 26th and after included: no free-plan flag", async () => {
    const tables: Record<string, Row[]> = { ...base() };
    const service = makeService(tables, { wineSubmissions });
    const items = Array.from({ length: 30 }, (_, n) => ({ name: `Typed wine ${n + 1}`, bottle_price: 40 + n }));
    const r = await service.importMenu({ method: "manual", data: { items }, restaurantId: "rest-1" } as any, "user-1");
    const lines = tables.menu_items.filter((m) => m.menu_id === r.menuId);
    expect(lines).toHaveLength(30);
    for (const l of lines) expect(l).toMatchObject({ status: "approved", review_notes: null, source: "manual" });
  });

  // QA B-5: a read with no line used to make a "Wine List" draft and answer 200
  // with itemsExtracted 0. A spreadsheet or typed lines are refused, and nothing
  // is written. A scan is read in the background, so its file and version are
  // already kept: it ends as a FAILED read saying it read nothing.
  it("a read that found no line: a sheet or typed lines are REFUSED and nothing is kept; a scan ends FAILED, saying so", async () => {
    const tables: Record<string, Row[]> = {
      ...base(),
      user_onboarding_progress: [{ id: "p-1", restaurant_id: "rest-1", menu_uploaded: false }],
    };
    const before = tables.restaurant_menus.length;
    const warnings = [{ kind: "chunk_failed", pages: { first: 1, last: 10 } }];
    const service = makeService(tables, {
      wineSubmissions,
      csvParser: new CsvParserService(),
      scanParser: { parseWithWarnings: async () => ({ items: [], warnings }) },
    });
    for (const data of [{ method: "csv", data: { csvContent: "name,price\n" } }, { method: "manual", data: { items: [] } }]) {
      const e: any = await service.importMenu({ ...data, restaurantId: "rest-1" } as any, "user-1").catch((x: unknown) => x);
      expect(e?.getStatus?.()).toBe(422);
      expect(String(e.getResponse().message)).toMatch(/so no menu was kept/);
    }
    expect(tables.restaurant_menus).toHaveLength(before);
    expect(tables.__storage ?? []).toHaveLength(0);

    const pdf = Buffer.from("%PDF-1.7 fake").toString("base64");
    const r = await service.importMenu({ method: "scan", data: { imageBase64: pdf }, restaurantId: "rest-1" } as any, "user-1");
    await service.whenRead(r.menuId);
    const read = await service.readStatus("rest-1", r.menuId);
    expect(read).toMatchObject({ state: "failed", warnings, reply: null });
    expect(read.failure).toMatch(/^No line could be read from this file\./);
    expect(tables.user_onboarding_progress[0].menu_uploaded).toBe(false);
  });

  describe("a failed import leaves no orphan version (M8)", () => {
    // A sibling draft already names the content-addressed object these bytes
    // hash to, so a cleanup that deleted "its" source would delete theirs.
    const sha = crypto.createHash("sha256").update(Buffer.from(csv, "utf8")).digest("hex");
    const sharedPath = `rest-1/menus/${sha}.csv`;
    const withSibling = (): Record<string, Row[]> => {
      const t: Record<string, Row[]> = base();
      t.restaurant_menus.push({ id: "menu-sibling", restaurant_id: "rest-1", status: "draft", source_path: sharedPath, source_sha256: sha });
      (t as any).__storage = [{ bucket: "vendor-attachments", path: sharedPath, bytes: csv.length }];
      return t;
    };
    const failingLibrary = {
      ...wineSubmissions,
      resolveLibraryWinesBatch: async () => {
        throw new Error("pooler unavailable");
      },
    };

    it("a library-resolve throw writes no version, uploads nothing, and leaves the shared source", async () => {
      const tables = withSibling();
      const service = makeService(tables, { wineSubmissions: failingLibrary, csvParser: new CsvParserService() });
      await expect(
        service.importMenu({ method: "csv", data: { csvContent: csv }, restaurantId: "rest-1" } as any, "user-1"),
      ).rejects.toThrow(/library resolution: pooler unavailable/);
      expect(tables.restaurant_menus.map((m) => m.id)).toEqual(["menu-old", "menu-sibling"]);
      expect(tables.menu_items).toHaveLength(0);
      expect((tables as any).__storage).toEqual([{ bucket: "vendor-attachments", path: sharedPath, bytes: csv.length }]);
      expect((tables as any).__storageRemoved).toBeUndefined();
    });

    it("a failed line write removes the version it made, and never the source another version names", async () => {
      const tables = withSibling();
      (tables as any).__insertFails = [{ menu_items: "insert or update on table menu_items violates a check" }];
      const service = makeService(tables, { wineSubmissions, csvParser: new CsvParserService() });
      await expect(
        service.importMenu({ method: "csv", data: { csvContent: csv }, restaurantId: "rest-1" } as any, "user-1"),
      ).rejects.toThrow(/menu_items insert failed: insert or update on table menu_items violates a check/);
      expect(tables.restaurant_menus.map((m) => m.id)).toEqual(["menu-old", "menu-sibling"]);
      expect(tables.restaurant_menus.find((m) => m.id === "menu-sibling")!.source_path).toBe(sharedPath);
      expect((tables as any).__storageRemoved).toBeUndefined();
      expect(tables.user_onboarding_progress).toHaveLength(0);
    });

    it("if that removal also fails, the error says the empty draft remains", async () => {
      const tables = withSibling();
      (tables as any).__insertFails = [{ menu_items: "check violated" }];
      (tables as any).__deleteFails = [{ restaurant_menus: "permission denied" }];
      const service = makeService(tables, { wineSubmissions, csvParser: new CsvParserService() });
      const err = await service
        .importMenu({ method: "csv", data: { csvContent: csv }, restaurantId: "rest-1" } as any, "user-1")
        .catch((e) => e);
      expect(err).toBeInstanceOf(InternalServerErrorException);
      expect(err.message).toMatch(/lines could not be saved \(menu_items insert failed: check violated\), and the empty draft version \S+ could not be removed: permission denied/);
    });

    it("Arrival's kept version follows the same order: a library throw writes no version", async () => {
      const tables = base();
      const service = makeService(tables, { wineSubmissions: failingLibrary });
      await expect(
        service.importParsedItems([{ name: "Opus One" } as any], "rest-1", "user-1", "scan"),
      ).rejects.toThrow(/library resolution/);
      expect(tables.restaurant_menus.map((m) => m.id)).toEqual(["menu-old"]);
    });
  });

  describe("makeCurrent — the person's choice, then the menu's prices reach the house", () => {
    const makeCurrentRpc = (tables: Record<string, Row[]>) => (fn: string, args: Row) => {
      if (fn === "make_menu_current") {
        const menu = tables.restaurant_menus.find((m) => m.id === args.p_menu_id && m.restaurant_id === args.p_restaurant_id);
        if (!menu) return { data: null, error: { code: "P0002", message: "no menu" } };
        // As 20260922230800 answers it: the moment of the original choice.
        if (menu.status === "active") return { data: { outcome: "already_current", previous_menu_ids: [], made_current_at: menu.made_current_at ?? null }, error: null };
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
        scanParser: { parseWithWarnings: async () => ({ items: lines, warnings: [] }) },
      });
      const read = await service.importMenu(
        { method: "scan", data: { imageBase64: Buffer.from("%PDF").toString("base64") }, restaurantId: "rest-1" } as any,
        "user-1",
      );
      // A scan reads in the background; the choice is made once it is done.
      await service.whenRead(read.menuId);
      return { calls, tables, service, read };
    }

    /** The plan the page showed, then the choice naming it (L13). */
    const choose = async (service: MenusService, menuId: string, house = "rest-1", user = "user-2") =>
      service.makeCurrent(house, menuId, user, (await service.planFor(house, menuId)).fingerprint);

    // r28 G20: a house can hold two menus marked current (no unique index).
    // getMenu's maybeSingle failed the whole /menu page, and an active menu was
    // planned as "already current", so the house could not settle it.
    describe("two menus marked current (r28 G20)", () => {
      /** As 20260922230700 runs it: an active menu with another active beside it is made current, and the other archived. */
      const faithfulRpc = (tables: Record<string, Row[]>) => (fn: string, args: Row) => {
        if (fn === "make_menu_current") {
          const menu = tables.restaurant_menus.find((m) => m.id === args.p_menu_id && m.restaurant_id === args.p_restaurant_id)!;
          const others = tables.restaurant_menus.filter((m) => m.restaurant_id === args.p_restaurant_id && m.status === "active" && m.id !== menu.id);
          if (menu.status === "active" && others.length === 0)
            return { data: { outcome: "already_current", previous_menu_ids: [], made_current_at: menu.made_current_at ?? null }, error: null };
          for (const m of others) Object.assign(m, { status: "archived", retired_by: args.p_actor });
          Object.assign(menu, { status: "active", made_current_at: "2026-11-13T12:00:00Z" });
          return { data: { outcome: "made_current", previous_menu_ids: others.map((m) => m.id), made_current_at: "2026-11-13T12:00:00Z" }, error: null };
        }
        return makeCurrentRpc(tables)(fn, args);
      };

      async function twoCurrent() {
        const tables: Record<string, Row[]> = base();
        const calls: RpcCall[] = [];
        const service = makeService(tables, {
          wineSubmissions,
          rpcCalls: calls,
          rpc: faithfulRpc(tables),
          scanParser: { parseWithWarnings: async () => ({ items: [{ name: "Opus One", bottle_price: 64 }], warnings: [] }) },
        });
        const read = await service.importMenu(
          { method: "scan", data: { imageBase64: Buffer.from("%PDF").toString("base64") }, restaurantId: "rest-1" } as any,
          "user-1",
        );
        // A scan reads in the background; the menu is settled once it is done.
        await service.whenRead(read.menuId);
        // The old menu lists a drink the new one does not.
        tables.menu_items.push({ id: "mi-old", menu_id: "menu-old", restaurant_id: "rest-1", name: "Old Rioja", category: "red", status: "approved" });
        // Both marked current: the old one chosen in September, the new one in October.
        Object.assign(tables.restaurant_menus.find((m) => m.id === "menu-old")!, { name: "September", made_current_at: "2026-09-01T10:00:00Z" });
        Object.assign(tables.restaurant_menus.find((m) => m.id === read.menuId)!, { status: "active", made_current_at: "2026-10-01T10:00:00Z" });
        return { tables, calls, service, read };
      }

      it("/menu reads the one made current last and says how many more are marked current", async () => {
        const { tables, service, read } = await twoCurrent();
        // Listed first, so a single-row read would have taken the September menu.
        expect(tables.restaurant_menus[0].id).toBe("menu-old");
        const r = await service.getMenu("rest-1");
        expect(r.menuId).toBe(read.menuId);
        expect(r.otherCurrent).toBe(1);
        expect(r.items.map((i: any) => i.name)).toEqual(["Opus One"]);
      });

      it("one current menu says nothing more", async () => {
        const { tables, service } = await twoCurrent();
        tables.restaurant_menus.find((m) => m.id === "menu-old")!.status = "archived";
        const r = await service.getMenu("rest-1");
        expect(r).not.toHaveProperty("otherCurrent");
      });

      it("each is planned as a menu being chosen: it lists what the other carries, and choosing it sets the other aside", async () => {
        const { tables, calls, service, read } = await twoCurrent();
        const plan = await service.planFor("rest-1", read.menuId);
        expect(plan.current).toBe(false);
        expect(plan.notOnThisFile.map((n) => n.name)).toEqual(["Old Rioja"]);
        const r = await service.makeCurrent("rest-1", read.menuId, "user-2", plan.fingerprint);
        expect(r).toMatchObject({ outcome: "made_current", previousMenuIds: ["menu-old"], lines: 1 });
        expect(tables.restaurant_menus.find((m) => m.id === "menu-old")).toMatchObject({ status: "archived", retired_by: "user-2" });
        expect(calls.some(([fn]) => fn === "set_house_menu_price" || fn === "set_house_menu_prices")).toBe(true);
        // Now the only current menu: planned as current again.
        expect((await service.planFor("rest-1", read.menuId)).current).toBe(true);
        expect((await service.getMenu("rest-1")).otherCurrent).toBeUndefined();
      });
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
        p_change_source: "import",
        p_changed_by: "user-2",
        // ADR 0193 round 3, L11 (this assertion was flipped): dated by the
        // CHOICE, never by the line's created_at, and naming the menu.
        p_effective_from: "2026-09-21T12:00:00Z",
        p_menu_id: read.menuId,
      });
      expect(r.madeCurrentAt).toBe("2026-09-21T12:00:00Z");
      expect(tables.menu_items[0].inventory_item_id).toBe("inv-1");
    });

    // r31 walk w1, F2: "Check its prices" said 3 prices would become 501.00,
    // and "Carry again" then set 0 and kept 3. The carry of a current menu is
    // dated by its choice, and the writer keeps a price that took effect
    // after it (stale, L14); the plan now reads the same moment.
    describe("Check its prices says what Carry again does (r31 w1 F2)", () => {
      const CHOSEN = "2026-11-13T12:00:00Z";
      async function withAPriceSetAt(at: string, current = true) {
        const { tables, service, read } = await readThenChoose([{ name: "Opus One", bottle_price: 64 }]);
        const menu = tables.restaurant_menus.find((m) => m.id === read.menuId)!;
        menu.extracted_at = "2026-11-13T09:00:00Z";
        if (current) {
          Object.assign(menu, { status: "active", made_current_at: CHOSEN });
          tables.restaurant_menus.find((m) => m.id === "menu-old")!.status = "archived";
        }
        tables.menu_price_versions = [
          { id: "v1", restaurant_id: "rest-1", inventory_id: "inv-1", changed_by: "user-3", effective_from: at, change_source: "manual" },
        ];
        return { tables, service, read };
      }

      it("a price set after the menu was chosen stays: kept_newer, never a change", async () => {
        const { service, read } = await withAPriceSetAt("2026-11-13T15:00:00Z");
        const plan = await service.planFor("rest-1", read.menuId);
        expect(plan.current).toBe(true);
        expect(plan.lines[0].bottle).toMatchObject({ result: "kept_newer", menuPrice: 64, housePrice: 60, setAfterRead: false });
        expect(plan.lines[0].bottle.lastSet).toMatchObject({ by: { userId: "user-3" }, at: "2026-11-13T15:00:00Z", source: "manual" });
        expect(plan.counts).toMatchObject({ change: 0, kept_newer: 1 });
      });

      it("a price set after the read but before the choice is replaced by the carry: a change, set after read", async () => {
        const { service, read } = await withAPriceSetAt("2026-11-13T10:00:00Z");
        const plan = await service.planFor("rest-1", read.menuId);
        expect(plan.lines[0].bottle).toMatchObject({ result: "change", setAfterRead: true });
        expect(plan.counts).toMatchObject({ change: 1, kept_newer: 0 });
      });

      it("a menu not yet chosen is chosen now: a price set after its read is replaced (L11)", async () => {
        const { service, read } = await withAPriceSetAt("2026-11-13T15:00:00Z", false);
        const plan = await service.planFor("rest-1", read.menuId);
        expect(plan.current).toBe(false);
        expect(plan.lines[0].bottle).toMatchObject({ result: "change", setAfterRead: true });
      });

      it("a menu that was current once and is not now is chosen now too: its old choice dates nothing", async () => {
        const { tables, service, read } = await withAPriceSetAt("2026-11-13T15:00:00Z", false);
        Object.assign(tables.restaurant_menus.find((m) => m.id === read.menuId)!, { status: "archived", made_current_at: CHOSEN });
        const plan = await service.planFor("rest-1", read.menuId);
        expect(plan.current).toBe(false);
        expect(plan.lines[0].bottle).toMatchObject({ result: "change" });
        expect(plan.counts).toMatchObject({ kept_newer: 0 });
      });

      it("Carry again on that plan is accepted (the fingerprints agree)", async () => {
        const { service, read } = await withAPriceSetAt("2026-11-13T15:00:00Z");
        const plan = await service.planFor("rest-1", read.menuId);
        await expect(service.makeCurrent("rest-1", read.menuId, "user-2", plan.fingerprint)).resolves.toBeDefined();
      });
    });

    it("a kitchen line stays on the menu and is carried nowhere: not in the plan's prices, no house row, no price", async () => {
      const { calls, tables, service, read } = await readThenChoose([
        { name: "Opus One", bottle_price: 64, by_glass_price: 15 },
        { name: "Tiramisu", category: "dessert", bottle_price: 9, raw_text: "Tiramisu 9" },
      ]);
      const plan = await service.planFor("rest-1", read.menuId);
      expect(plan.lines.map((l) => l.name)).toEqual(["Opus One"]);
      expect(plan.kitchenLines).toEqual([{ menuItemId: expect.any(String), name: "Tiramisu" }]);
      expect(plan.counts.new_wine + plan.counts.change + plan.counts.unchanged).toBe(2);

      const inventoryBefore = tables.restaurant_inventory.length;
      const r = await service.makeCurrent("rest-1", read.menuId, "user-2", plan.fingerprint);
      expect(r.priceSync).toEqual({ changed: 1, kitchen_line: 1 });
      const price = calls.filter(([fn]) => fn === "set_house_menu_price");
      expect(price).toHaveLength(1);
      expect(price[0][1]).toMatchObject({ p_bottle_price: 64 });
      expect(tables.restaurant_inventory).toHaveLength(inventoryBefore);
      const tiramisu = tables.menu_items.find((m) => m.name === "Tiramisu")!;
      expect(tiramisu.inventory_item_id ?? null).toBeNull();
      expect(tiramisu.status).not.toBe("discarded");
    });

    it("2d: the plan lists what the current menu has and this file does not, and choosing it leaves them as they are (L12)", async () => {
      const calls: RpcCall[] = [];
      const tables: Record<string, Row[]> = base();
      tables.restaurant_inventory.push(
        { id: "inv-2", restaurant_id: "rest-1", master_wine_id: "mw-2", wine_name: "Barolo", menu_price_current: 80, menu_price_glass: null, is_active: true },
      );
      tables.house_price_locks = [
        { id: "lock-1", restaurant_id: "rest-1", inventory_id: "inv-2", kind: "bottle", locked_price: 80, locked_by: "user-1", locked_at: "2026-09-01T00:00:00Z", released_at: null },
      ];
      const old = (id: string, over: Row) => ({ id, menu_id: "menu-old", restaurant_id: "rest-1", status: "approved", created_at: "2026-09-01T00:00:00Z", ...over });
      tables.menu_items.push(
        old("old-1", { name: "Opus One", wine_library_id: "mw-1", bottle_price: 60 }),
        old("old-2", { name: "Barolo", wine_library_id: "mw-2", bottle_price: 80 }),
        old("old-3", { name: "House red", wine_library_id: null, bottle_price: 30 }),
        old("old-4", { name: "RAKI", wine_library_id: null, bottle_price: 40 }),
        old("old-5", { name: "Tiramisu", category: "dessert", wine_library_id: null, bottle_price: 9 }),
      );
      const service = makeService(tables, {
        wineSubmissions,
        rpcCalls: calls,
        rpc: makeCurrentRpc(tables),
        scanParser: {
          parseWithWarnings: async () => ({
            items: [{ name: "Opus One", bottle_price: 64 }, { name: "Rakı", bottle_price: 45 }],
            warnings: [],
          }),
        },
      });
      const read = await service.importMenu(
        { method: "scan", data: { imageBase64: Buffer.from("%PDF").toString("base64") }, restaurantId: "rest-1" } as any,
        "user-1",
      );
      // A scan is read in the background on the #1086 chain (whenRead); here it is not.
      await (service as any).whenRead?.(read.menuId);

      const plan = await service.planFor("rest-1", read.menuId);
      // Barolo (linked, locked) and the unlinked House red are not on this file.
      // Opus One is (same wine); RAKI is (same name, Turkish i folded); a
      // kitchen line is never a wine that left the list.
      expect(plan.notOnThisFile).toEqual([
        {
          menuItemId: "old-2",
          name: "Barolo",
          producer: null,
          vintage: null,
          wineLibraryId: "mw-2",
          inventoryId: "inv-2",
          bottle: 80,
          glass: null,
          locked: ["bottle"],
          active: true,
        },
        expect.objectContaining({ menuItemId: "old-3", name: "House red", wineLibraryId: null, inventoryId: null, locked: [], active: null }),
      ]);

      const r = await service.makeCurrent("rest-1", read.menuId, "user-2", plan.fingerprint);
      expect(r.outcome).toBe("made_current");
      // Nothing was written for Barolo: its row, price and lock stand.
      expect(calls.filter(([fn, a]) => fn === "set_house_menu_price" && a.p_inventory_id === "inv-2")).toHaveLength(0);
      expect(tables.restaurant_inventory.find((i) => i.id === "inv-2")).toMatchObject({ menu_price_current: 80, is_active: true });
      expect(tables.house_price_locks[0].released_at).toBeNull();
    });

    it("2d: two linked lines of one name are compared by the wine, so a vintage change is listed; an unlinked side still matches by name", async () => {
      // Every line this file reads resolves to mw-1 (wineSubmissions).
      const { tables, service, read } = await readThenChoose([{ name: "Barolo", vintage: "2018", bottle_price: 95 }]);
      tables.restaurant_inventory.push(
        { id: "inv-2", restaurant_id: "rest-1", master_wine_id: "mw-2", wine_name: "Barolo", menu_price_current: 80, menu_price_glass: null, is_active: true },
      );
      const old = (id: string, over: Row) => ({ id, menu_id: "menu-old", restaurant_id: "rest-1", status: "approved", ...over });
      tables.menu_items.push(
        // The 2015 Barolo is another library wine: choosing this menu does not carry mw-2.
        old("old-1", { name: "Barolo", vintage: "2015", wine_library_id: "mw-2", bottle_price: 80 }),
        // An unlinked line of the same name may be this wine: it is on this file.
        old("old-2", { name: "BAROLO", wine_library_id: null, bottle_price: 70 }),
      );
      const plan = await service.planFor("rest-1", read.menuId);
      expect(plan.notOnThisFile).toEqual([
        expect.objectContaining({ menuItemId: "old-1", name: "Barolo", vintage: "2015", wineLibraryId: "mw-2", inventoryId: "inv-2", bottle: 80, active: true }),
      ]);
    });

    it("2d: a wine whose house row is deleted or inactive is listed as no longer sold, its prices as they stand", async () => {
      const { tables, service, read } = await readThenChoose([{ name: "Opus One", bottle_price: 64 }]);
      tables.restaurant_inventory.push(
        { id: "inv-2", restaurant_id: "rest-1", master_wine_id: "mw-2", wine_name: "Barolo", menu_price_current: 80, menu_price_glass: null, is_active: true, deleted_at: "2026-10-01T00:00:00Z" },
        { id: "inv-3", restaurant_id: "rest-1", master_wine_id: "mw-3", wine_name: "Chianti", menu_price_current: 40, menu_price_glass: 9, is_active: false },
      );
      const old = (id: string, over: Row) => ({ id, menu_id: "menu-old", restaurant_id: "rest-1", status: "approved", ...over });
      tables.menu_items.push(
        old("old-1", { name: "Barolo", wine_library_id: "mw-2", bottle_price: 80 }),
        old("old-2", { name: "Chianti", wine_library_id: "mw-3", bottle_price: 40 }),
      );
      const plan = await service.planFor("rest-1", read.menuId);
      expect(plan.notOnThisFile.map((n) => [n.menuItemId, n.inventoryId, n.bottle, n.active])).toEqual([
        ["old-1", "inv-2", 80, false],
        ["old-2", "inv-3", 40, false],
      ]);
    });

    it("2d: a menu chosen again lists nothing as 'not on this file', and the list is part of the fingerprint", async () => {
      const { tables, service, read } = await readThenChoose([{ name: "Opus One", bottle_price: 64 }]);
      tables.menu_items.push({ id: "old-9", menu_id: "menu-old", restaurant_id: "rest-1", name: "Barolo", wine_library_id: "mw-2", status: "approved" });
      const before = await service.planFor("rest-1", read.menuId);
      expect(before.notOnThisFile.map((n) => n.name)).toEqual(["Barolo"]);
      // The current menu changes under the page: the plan it showed is no longer true.
      tables.menu_items.push({ id: "old-10", menu_id: "menu-old", restaurant_id: "rest-1", name: "Chianti", wine_library_id: "mw-3", status: "approved" });
      const err: any = await service
        .makeCurrent("rest-1", read.menuId, "user-2", before.fingerprint)
        .catch((e: unknown) => e);
      expect(err?.getStatus?.()).toBe(409);
      // Once current, there is nothing it replaces.
      await choose(service, read.menuId);
      expect((await service.planFor("rest-1", read.menuId)).notOnThisFile).toEqual([]);
    });

    describe("2e: make-current writes in batches, the price still per line (L4, L27)", () => {
      /** The write-back the migration adds, against the fake's tables: only the named keys, only this house. */
      const writeBack = (tables: Record<string, Row[]>, args: Row) => {
        let n = 0;
        for (const r of args.p_rows as Row[]) {
          const row = tables.menu_items.find((m) => m.id === r.id && m.restaurant_id === args.p_restaurant_id);
          if (!row) continue;
          for (const k of ["inventory_item_id", "submission_id", "price_flag", "price_flag_note"]) if (k in r) row[k] = r[k];
          n += 1;
        }
        return { data: n, error: null };
      };
      /** set_house_menu_price that moves the house's price, as the real writer does. */
      const pricing = (tables: Record<string, Row[]>) => (fn: string, args: Row) => {
        if (fn === "menu_items_write_back") return writeBack(tables, args);
        if (fn === "set_house_menu_price") {
          const inv = tables.restaurant_inventory.find((i) => i.id === args.p_inventory_id)!;
          if (args.p_set_bottle) inv.menu_price_current = args.p_bottle_price;
          if (args.p_set_glass) inv.menu_price_glass = args.p_glass_price;
          return { data: { outcome: "changed", held: [] }, error: null };
        }
        return makeCurrentRpc(tables)(fn, args);
      };
      /** Counts the fake's round trips by table and kind. */
      const counting = (service: MenusService) => {
        const fake = (service as any).dbService.supabase;
        const real = fake.from;
        const n: Record<string, number> = {};
        const bump = (k: string) => (n[k] = (n[k] ?? 0) + 1);
        fake.from = (table: string) => {
          const api = real(table);
          bump(`${table}:from`);
          const { update, insert } = api;
          api.update = (p: Row) => (bump(`${table}:update`), update(p));
          api.insert = (r: Row | Row[]) => (bump(`${table}:insert`), insert(r));
          return api;
        };
        return n;
      };
      const each = {
        ...wineSubmissions,
        resolveLibraryWinesBatch: async (items: Array<{ name: string }>) =>
          items.map((i) => ({ masterWineId: `mw-${i.name}`, matched: true, libraryTier: 1, confidence: 99 })),
      };

      it("a 300-line menu: the house's rows in 2 reads and 1 insert, every link and flag in 1 write-back, 1 price call per line", async () => {
        const calls: RpcCall[] = [];
        const tables: Record<string, Row[]> = base();
        const lines = Array.from({ length: 300 }, (_, i) => ({ name: `Wine ${i}`, bottle_price: 40 + i }));
        const service = makeService(tables, {
          wineSubmissions: each,
          rpcCalls: calls,
          rpc: pricing(tables),
          scanParser: { parseWithWarnings: async () => ({ items: lines, warnings: [] }) },
        });
        const read = await service.importMenu(
          { method: "scan", data: { imageBase64: Buffer.from("%PDF").toString("base64") }, restaurantId: "rest-1" } as any,
          "user-1",
        );
        // A scan is read in the background on the #1086 chain (whenRead); here it is not.
        await (service as any).whenRead?.(read.menuId);
        const plan = await service.planFor("rest-1", read.menuId);
        const n = counting(service);
        calls.length = 0;
        const r = await service.makeCurrent("rest-1", read.menuId, "user-2", plan.fingerprint);

        expect(r.priceSync).toEqual({ changed: 300 });
        expect(r.failed).toEqual([]);
        // The plan's own paged read (1) + 300 wines in chunks of 150 (2) + one insert.
        expect(n["restaurant_inventory:from"]).toBe(4);
        expect(n["restaurant_inventory:insert"]).toBe(1);
        expect(n["menu_items:update"] ?? 0).toBe(0);
        expect(calls.filter(([fn]) => fn === "menu_items_write_back")).toHaveLength(1);
        // r28 G1: 300 prices in 2 round trips (250 a call), each still run
        // through set_house_menu_price inside the database.
        expect(calls.filter(([fn]) => fn === "set_house_menu_prices").map(([, a]) => (a.p_rows as Row[]).length)).toEqual([250, 50]);
        expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(300);
        const mine = tables.menu_items.filter((m) => m.menu_id === read.menuId);
        expect(mine.every((m) => typeof m.inventory_item_id === "string")).toBe(true);
        expect(new Set(mine.map((m) => m.inventory_item_id)).size).toBe(300);
        expect(tables.restaurant_inventory).toHaveLength(301);
      });

      /** A read menu of these lines, ready to choose (r28 G1). */
      const readMenu = async (tables: Record<string, Row[]>, lines: Row[], calls: RpcCall[] = [], rpc = pricing(tables)) => {
        const service = makeService(tables, {
          wineSubmissions: each,
          rpcCalls: calls,
          rpc,
          scanParser: { parseWithWarnings: async () => ({ items: lines, warnings: [] }) },
        });
        const read = await service.importMenu(
          { method: "scan", data: { imageBase64: Buffer.from("%PDF").toString("base64") }, restaurantId: "rest-1" } as any,
          "user-1",
        );
        await (service as any).whenRead?.(read.menuId);
        return { service, menuId: read.menuId as string };
      };
      const fingerprintOf = async (service: MenusService, menuId: string) => (await service.planFor("rest-1", menuId)).fingerprint;

      it("r28 G1: each price round trip is one call for the whole menu, dated by the choice and naming the menu", async () => {
        const calls: RpcCall[] = [];
        const tables: Record<string, Row[]> = base();
        const { service, menuId } = await readMenu(tables, [
          { name: "Barolo", bottle_price: 80 },
          { name: "Etna", by_glass_price: 12 },
          { name: "Chablis" },
        ], calls);
        calls.length = 0;
        const r = await service.makeCurrent("rest-1", menuId, "user-2", await fingerprintOf(service, menuId));
        const batches = calls.filter(([fn]) => fn === "set_house_menu_prices").map(([, a]) => a);
        expect(batches).toHaveLength(1);
        expect(batches[0]).toMatchObject({
          p_restaurant_id: "rest-1",
          p_change_source: "import",
          p_changed_by: "user-2",
          p_effective_from: "2026-09-21T12:00:00Z",
          p_menu_id: menuId,
          p_reason: "menu line",
        });
        // A line with no price is never sent; a kind the line leaves blank is not named.
        const rows = batches[0].p_rows as Row[];
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({ id: expect.any(String), inventory_id: expect.any(String), bottle: 80 });
        expect(rows[1]).toEqual({ id: expect.any(String), inventory_id: expect.any(String), glass: 12 });
        expect(r.priceSync).toEqual({ changed: 2, no_price: 1 });
      });

      it("r28 G1: one row the writer refuses fails only that line, in the writer's words; the rest are carried", async () => {
        const tables: Record<string, Row[]> = base();
        const rpc = (fn: string, args: Row) =>
          fn === "set_house_menu_price" && args.p_bottle_price === 81
            ? { data: null, error: { code: "P0002", message: "no inventory item" } }
            : pricing(tables)(fn, args);
        const { service, menuId } = await readMenu(tables, [
          { name: "Barolo", bottle_price: 80 },
          { name: "Barbaresco", bottle_price: 81 },
          { name: "Etna", bottle_price: 82 },
        ], [], rpc);
        const r = await service.makeCurrent("rest-1", menuId, "user-2", await fingerprintOf(service, menuId));
        expect(r.priceSync).toEqual({ changed: 2, failed: 1 });
        expect(r.failed).toEqual([
          { menuItemId: expect.any(String), name: "Barbaresco", error: "No wine of this house by that id. Nothing was changed." },
        ]);
      });

      it("r28 G1: a refused batch call fails every priced line, said on each, and the menu is still reported current", async () => {
        const calls: RpcCall[] = [];
        const tables: Record<string, Row[]> = base();
        (tables as any).__batchWriter = () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
        const { service, menuId } = await readMenu(tables, [
          { name: "Barolo", bottle_price: 80 },
          { name: "Etna", bottle_price: 82 },
        ], calls);
        calls.length = 0;
        const r = await service.makeCurrent("rest-1", menuId, "user-2", await fingerprintOf(service, menuId));
        expect(r.outcome).toBe("made_current");
        expect(r.priceSync).toEqual({ failed: 2 });
        expect(r.failed.map((f) => f.error)).toEqual([
          "The price was not saved: canceling statement due to statement timeout",
          "The price was not saved: canceling statement due to statement timeout",
        ]);
        // Never retried line by line: that is the slow path the batch replaces.
        expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(0);
      });

      it("r28 G1: an answer that does not name a line leaves it unknown, never changed", async () => {
        const tables: Record<string, Row[]> = base();
        (tables as any).__batchWriter = () => ({ data: [], error: null });
        const { service, menuId } = await readMenu(tables, [{ name: "Barolo", bottle_price: 80 }]);
        const r = await service.makeCurrent("rest-1", menuId, "user-2", await fingerprintOf(service, menuId));
        expect(r.priceSync).toEqual({ failed: 1 });
        expect(r.failed[0].error).toMatch(/whether its price changed is unknown/);
      });

      it("r28 G1: a database without the batch writer is carried one call per line, as before", async () => {
        const calls: RpcCall[] = [];
        const tables: Record<string, Row[]> = base();
        (tables as any).__batchWriter = "missing";
        const { service, menuId } = await readMenu(tables, [
          { name: "Barolo", bottle_price: 80 },
          { name: "Etna", bottle_price: 82 },
        ], calls);
        calls.length = 0;
        const r = await service.makeCurrent("rest-1", menuId, "user-2", await fingerprintOf(service, menuId));
        expect(r.priceSync).toEqual({ changed: 2 });
        expect(calls.filter(([fn]) => fn === "set_house_menu_prices")).toHaveLength(1);
        expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(2);
      });

      it("r28 G1: choosing the current menu again finishes its carry, dated by the first choice", async () => {
        const calls: RpcCall[] = [];
        const tables: Record<string, Row[]> = base();
        (tables as any).__batchWriter = () => ({ data: null, error: { message: "connection reset" } });
        const { service, menuId } = await readMenu(tables, [{ name: "Barolo", bottle_price: 80 }], calls);
        const first = await service.makeCurrent("rest-1", menuId, "user-2", await fingerprintOf(service, menuId));
        expect(first.priceSync).toEqual({ failed: 1 });
        // The menu is current; the make_menu_current fake now answers
        // already_current WITH the moment of the choice, as the SQL does.
        const menu = tables.restaurant_menus.find((m) => m.id === menuId)!;
        expect(menu.status).toBe("active");
        delete (tables as any).__batchWriter;
        calls.length = 0;
        const again = await service.makeCurrent("rest-1", menuId, "user-2", await fingerprintOf(service, menuId));
        expect(again.outcome).toBe("already_current");
        expect(again.lines).toBe(1);
        expect(again.priceSync).toEqual({ changed: 1 });
        const batch = calls.find(([fn]) => fn === "set_house_menu_prices")![1];
        expect(batch.p_effective_from).toBe("2026-09-21T12:00:00Z");
      });

      it("r28 G1: a later round reads the house's rows again, never reusing the first read", async () => {
        const tables: Record<string, Row[]> = base();
        // A writer that REPLACES the row (as a database read would return a
        // new one), so a stale first read cannot pass for the price just set.
        const rpc = (fn: string, args: Row) => {
          if (fn === "set_house_menu_price") {
            const at = tables.restaurant_inventory.findIndex((i) => i.id === args.p_inventory_id);
            const inv = { ...tables.restaurant_inventory[at] };
            if (args.p_set_bottle) inv.menu_price_current = args.p_bottle_price;
            if (args.p_set_glass) inv.menu_price_glass = args.p_glass_price;
            tables.restaurant_inventory[at] = inv;
            return { data: { outcome: "changed", held: [] }, error: null };
          }
          return pricing(tables)(fn, args);
        };
        const service = makeService(tables, {
          wineSubmissions: {
            ...wineSubmissions,
            resolveLibraryWinesBatch: async (items: unknown[]) =>
              items.map(() => ({ masterWineId: "mw-1", matched: true, libraryTier: 1, confidence: 99 })),
          },
          rpc,
          scanParser: {
            parseWithWarnings: async () => ({
              items: [{ name: "Opus One", bottle_price: 64 }, { name: "Opus One by the glass", by_glass_price: 15 }],
              warnings: [],
            }),
          },
        });
        const read = await service.importMenu(
          { method: "scan", data: { imageBase64: Buffer.from("%PDF").toString("base64") }, restaurantId: "rest-1" } as any,
          "user-1",
        );
        await (service as any).whenRead?.(read.menuId);
        await service.makeCurrent("rest-1", read.menuId, "user-2", await fingerprintOf(service, read.menuId));
        const second = tables.menu_items.find((m) => m.name === "Opus One by the glass")!;
        expect(second.price_flag_note).toMatch(/kept the bottle price 64\.00/);
      });

      it("r28 G2: a good a menu adds takes its kind and unit from the line's section, never 'a bottle of wine' for all", async () => {
        const tables: Record<string, Row[]> = base();
        const { service, menuId } = await readMenu(tables, [
          { name: "Efes Pilsen", category: "beer", bottle_price: 90 },
          { name: "Negroni", category: "cocktail", bottle_price: 350 },
          { name: "Jameson", category: "whiskey", bottle_price: 220 },
          { name: "Bombay", category: "spirit", bottle_price: 240 },
          { name: "Baileys", category: "Liqueurs", bottle_price: 200 },
          { name: "Ayran", category: "non-alcoholic", bottle_price: 40 },
          { name: "Cola", category: "soft drink", bottle_price: 50 },
          { name: "Somersby", category: "cider", bottle_price: 110 },
          { name: "Barolo", category: "red", bottle_price: 900 },
          { name: "Mystery", bottle_price: 100 },
        ]);
        await service.makeCurrent("rest-1", menuId, "user-2", await fingerprintOf(service, menuId));
        const made = (name: string) => {
          const r = tables.restaurant_inventory.find((i) => i.wine_name === name)!;
          return [r.kind, r.uom];
        };
        expect(made("Efes Pilsen")).toEqual(["beer", "bottle"]);
        expect(made("Negroni")).toEqual(["cocktail", "each"]);
        expect(made("Jameson")).toEqual(["whiskey", "bottle"]);
        expect(made("Bombay")).toEqual(["spirit", "bottle"]);
        expect(made("Baileys")).toEqual(["liqueur", "bottle"]);
        expect(made("Ayran")).toEqual(["non_alcoholic", "bottle"]);
        expect(made("Cola")).toEqual(["soft_drink", "bottle"]);
        expect(made("Somersby")).toEqual(["cider", "bottle"]);
        expect(made("Barolo")).toEqual(["wine", "bottle"]);
        // A line whose section says nothing leaves the kind to the insert trigger (wine, bottle).
        const mystery = tables.restaurant_inventory.find((i) => i.wine_name === "Mystery")!;
        expect("kind" in mystery || "uom" in mystery).toBe(false);
      });

      it("r28 G3: a dish under a Turkish course is a kitchen line: no good, no price", async () => {
        const calls: RpcCall[] = [];
        const tables: Record<string, Row[]> = base();
        const { service, menuId } = await readMenu(tables, [
          { name: "Adana Kebap", category: "Kebaplar", bottle_price: 420 },
          { name: "Künefe", category: "Tatlılar", bottle_price: 180 },
          { name: "Barolo", category: "red", bottle_price: 900 },
        ], calls);
        const r = await service.makeCurrent("rest-1", menuId, "user-2", await fingerprintOf(service, menuId));
        expect(r.priceSync).toEqual({ changed: 1, kitchen_line: 2 });
        expect(tables.restaurant_inventory.some((i) => i.wine_name === "Adana Kebap" || i.wine_name === "Künefe")).toBe(false);
      });

      it("r28 G1: a refusal after the switch says the menu IS current, never that nothing changed", async () => {
        const tables: Record<string, Row[]> = base();
        const { service, menuId } = await readMenu(tables, [{ name: "Barolo", bottle_price: 80 }]);
        jest.spyOn(service as any, "addToInventory").mockRejectedValueOnce(new Error("pool closed"));
        const err: any = await service
          .makeCurrent("rest-1", menuId, "user-2", await fingerprintOf(service, menuId))
          .catch((e: unknown) => e);
        expect(err?.getStatus?.()).toBe(500);
        expect(err.message).toMatch(/^This menu is now the current one, but its prices did not reach the house \(pool closed\)/);
        expect(err.message).not.toMatch(/[Nn]othing (was|has) changed/);
        expect(tables.restaurant_menus.find((m) => m.id === menuId)!.status).toBe("active");
      });

      it("two lines of one wine: the second sees the price the first just set, as the per-line read did", async () => {
        const tables: Record<string, Row[]> = base();
        const twice = {
          ...wineSubmissions,
          resolveLibraryWinesBatch: async (items: unknown[]) =>
            items.map(() => ({ masterWineId: "mw-1", matched: true, libraryTier: 1, confidence: 99 })),
        };
        const service = makeService(tables, {
          wineSubmissions: twice,
          rpc: pricing(tables),
          scanParser: {
            parseWithWarnings: async () => ({
              items: [{ name: "Opus One", bottle_price: 64 }, { name: "Opus One by the glass", by_glass_price: 15 }],
              warnings: [],
            }),
          },
        });
        const read = await service.importMenu(
          { method: "scan", data: { imageBase64: Buffer.from("%PDF").toString("base64") }, restaurantId: "rest-1" } as any,
          "user-1",
        );
        // A scan is read in the background on the #1086 chain (whenRead); here it is not.
        await (service as any).whenRead?.(read.menuId);
        await service.makeCurrent("rest-1", read.menuId, "user-2", (await service.planFor("rest-1", read.menuId)).fingerprint);
        const second = tables.menu_items.find((m) => m.name === "Opus One by the glass")!;
        // 64.00, not the 60.00 read before the first line moved it.
        expect(second.price_flag).toBe("blank_kept_last_known");
        expect(second.price_flag_note).toMatch(/kept the bottle price 64\.00/);
        expect(second.inventory_item_id).toBe("inv-1");
      });

      it("a write-back that does not answer falls back to one write per line, and the lines are still linked", async () => {
        const tables: Record<string, Row[]> = base();
        const rpc = (fn: string, args: Row) =>
          fn === "menu_items_write_back"
            ? { data: null, error: { code: "PGRST202", message: "Could not find the function" } }
            : pricing(tables)(fn, args);
        const service = makeService(tables, {
          wineSubmissions: each,
          rpc,
          scanParser: { parseWithWarnings: async () => ({ items: [{ name: "Barolo", bottle_price: 80 }], warnings: [] }) },
        });
        const read = await service.importMenu(
          { method: "scan", data: { imageBase64: Buffer.from("%PDF").toString("base64") }, restaurantId: "rest-1" } as any,
          "user-1",
        );
        // A scan is read in the background on the #1086 chain (whenRead); here it is not.
        await (service as any).whenRead?.(read.menuId);
        const r = await service.makeCurrent("rest-1", read.menuId, "user-2", (await service.planFor("rest-1", read.menuId)).fingerprint);
        expect(r.failed).toEqual([]);
        expect(tables.menu_items.find((m) => m.name === "Barolo")!.inventory_item_id).toEqual(expect.any(String));
      });

      it("a refused batch insert is tried wine by wine: one refusal fails its own line, said, and the rest are carried", async () => {
        const tables: Record<string, Row[]> = base();
        (tables as any).__insertFails = {
          restaurant_inventory: (rows: Row[]) =>
            rows.length > 1 || rows[0].master_wine_id === "mw-Barolo" ? "duplicate key value" : undefined,
        };
        const service = makeService(tables, {
          wineSubmissions: each,
          rpc: pricing(tables),
          scanParser: {
            parseWithWarnings: async () => ({
              items: [{ name: "Barolo", bottle_price: 80 }, { name: "Chianti", bottle_price: 48 }],
              warnings: [],
            }),
          },
        });
        const read = await service.importMenu(
          { method: "scan", data: { imageBase64: Buffer.from("%PDF").toString("base64") }, restaurantId: "rest-1" } as any,
          "user-1",
        );
        // A scan is read in the background on the #1086 chain (whenRead); here it is not.
        await (service as any).whenRead?.(read.menuId);
        const r = await service.makeCurrent("rest-1", read.menuId, "user-2", (await service.planFor("rest-1", read.menuId)).fingerprint);
        expect(r.priceSync).toEqual({ failed: 1, changed: 1 });
        expect(r.failed).toEqual([
          { menuItemId: expect.any(String), name: "Barolo", error: expect.stringMatching(/could not be added to the house's inventory.*duplicate key value/) },
        ]);
        expect(tables.menu_items.find((m) => m.name === "Chianti")!.inventory_item_id).toEqual(expect.any(String));
        expect(tables.menu_items.find((m) => m.name === "Barolo")!.inventory_item_id ?? null).toBeNull();
      });
    });

    it("a dessert WINE under Desserts is still carried: a vintage says it is a drink", async () => {
      const { calls, service, read } = await readThenChoose([
        { name: "Sauternes", category: "dessert", vintage: "2015", bottle_price: 90 },
      ]);
      const plan = await service.planFor("rest-1", read.menuId);
      expect(plan.kitchenLines).toEqual([]);
      const r = await service.makeCurrent("rest-1", read.menuId, "user-2", plan.fingerprint);
      expect(r.priceSync).toEqual({ changed: 1 });
      expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(1);
    });

    it("a blank bottle price keeps the house's last known 60.00 and FLAGS the line (founder answer 3)", async () => {
      const { calls, tables, service, read } = await readThenChoose([{ name: "Opus One", by_glass_price: 15 }]);
      const r = await choose(service, read.menuId);
      const price = calls.filter(([fn]) => fn === "set_house_menu_price");
      expect(price[0][1]).toMatchObject({ p_set_bottle: false, p_set_glass: true, p_glass_price: 15 });
      expect(r.flagged).toBe(1);
      expect(tables.menu_items[0].price_flag).toBe("blank_kept_last_known");
      // Past tense: the note must stay true after a manager changes the price.
      expect(tables.menu_items[0].price_flag_note).toMatch(/no bottle price, so the house kept the bottle price 60\.00 it already had/);
    });

    it("a blank kind the house never priced is not flagged: nothing is kept, nothing is unclear", async () => {
      const { tables, service, read } = await readThenChoose([{ name: "Opus One", bottle_price: 64 }]);
      const r = await choose(service, read.menuId);
      expect(r.flagged).toBe(0);
      expect(tables.menu_items[0].price_flag).toBeNull();
    });

    it("choosing a current menu whose choice has no moment on record writes no price", async () => {
      const calls: RpcCall[] = [];
      const tables: Record<string, Row[]> = base();
      const service = makeService(tables, { rpcCalls: calls, rpc: makeCurrentRpc(tables) });
      const r = await choose(service, "menu-old");
      expect(r.outcome).toBe("already_current");
      expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(0);
    });

    it("another house's menu id is a 404", async () => {
      const tables: Record<string, Row[]> = base();
      const service = makeService(tables, { rpc: makeCurrentRpc(tables) });
      await expect(service.makeCurrent("rest-2", "menu-old", "user-2", "any-fingerprint")).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.planFor("rest-2", "menu-old")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("a failed read of the menu's lines changes NOTHING: the switch is not made, so it can be tried again", async () => {
      const { calls, tables, service, read } = await readThenChoose([{ name: "Opus One", bottle_price: 64 }]);
      const fp = (await service.planFor("rest-1", read.menuId)).fingerprint;
      (tables as any).__readFails = [{ menu_items: "statement timeout" }];
      await expect(service.makeCurrent("rest-1", read.menuId, "user-2", fp)).rejects.toThrow(/statement timeout/);
      expect(calls.filter(([fn]) => fn === "make_menu_current")).toHaveLength(0);
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

  // Menu r21: dates in the house's time zone, never the viewing device's.
  it("names the house's own time zone with the list, and only this house's", async () => {
    const tables: Record<string, Row[]> = {
      restaurant_menus: [{ id: "m1", restaurant_id: "rest-1", status: "active", extracted_at: "2026-11-12T03:05:00Z" }],
      restaurants: [
        { id: "rest-2", timezone: "America/Detroit" },
        { id: "rest-1", timezone: "Europe/Istanbul" },
      ],
    };
    const r = await makeService(tables).listVersions("rest-1");
    expect(r).toMatchObject({ timezone: "Europe/Istanbul", timezoneReason: null });
  });

  it("a house with no zone is said to have none, never given a default", async () => {
    const tables: Record<string, Row[]> = {
      restaurant_menus: [{ id: "m1", restaurant_id: "rest-1", status: "active" }],
      restaurants: [{ id: "rest-1", timezone: null }],
    };
    const r = await makeService(tables).listVersions("rest-1");
    expect(r).toMatchObject({ timezone: null, timezoneReason: "the house has no time zone set" });
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
        { id: "n-3", menu_id: "menu-new", restaurant_id: "rest-1", name: "Nebbiolo", category: "cocktail", wine_library_id: "mw-3", bottle_price: 40, status: "approved" },
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
    expect(tables.restaurant_menus.find((m) => m.id === "menu-new")!.status).toBe("draft");
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

  // r13 walk 2026-11-12: the plan called a typed Negroni a "wine"; it now
  // carries each line's section so the page names the line by its kind.
  it("each plan line carries its section as read or set; a line with none carries null", async () => {
    const { tables, service } = setup();
    tables.menu_items.find((m: any) => m.id === "n-5")!.category = "   ";
    const plan = await service.planFor("rest-1", "menu-new");
    const by = Object.fromEntries(plan.lines.map((l) => [l.menuItemId, l]));
    expect(by["n-3"].category).toBe("cocktail");
    expect(by["n-1"].category).toBeNull();
    expect(by["n-5"].category).toBeNull();
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
    for (const w of writes) expect(w).toMatchObject({ p_effective_from: T0, p_menu_id: "menu-new", p_change_source: "import", p_changed_by: "user-2" });
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
    expect(calls.filter(([fn]) => fn === "make_menu_current")).toHaveLength(0);
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

// Founder 2026-11-07: "Background job".
describe("MenusService — a scan reads in the background (founder 2026-11-07)", () => {
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const wineSubmissions = {
    resolveLibraryWinesBatch: async (items: unknown[]) =>
      items.map(() => ({ masterWineId: "mw-1", matched: true, libraryTier: 1, confidence: 99 })),
    normalizeText: (t: string | null | undefined) => (t ? t.toLowerCase() : null),
  };
  const base = (): Record<string, Row[]> => ({
    restaurant_menus: [{ id: "menu-old", restaurant_id: "rest-1", status: "active" }],
    restaurants: [{ id: "rest-1", default_threshold_min: 3 }],
    restaurant_inventory: [],
    menu_items: [],
    user_onboarding_progress: [],
    master_wine_library_submissions: [],
  });
  const reads = () => {
    const seen: string[] = [];
    return {
      seen,
      parser: {
        parseWithWarnings: async (file: string) => {
          seen.push(file);
          return { items: [{ name: "Opus One", bottle_price: 62 }], warnings: [] };
        },
      },
    };
  };

  it("answers at once with the version it is reading; the read finishes on the server", async () => {
    const tables = base();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const service = makeService(tables, {
      wineSubmissions,
      scanParser: {
        parseWithWarnings: async () => {
          await gate;
          return { items: [{ name: "Opus One", bottle_price: 62 }], warnings: [] };
        },
      },
    });
    const r = await service.importMenu({ method: "scan", data: { imageBase64: PNG }, restaurantId: "rest-1" } as any, "user-1");
    expect(r).toMatchObject({ reading: true, itemsExtracted: 0, items: [], pages: 1 });
    expect((await service.readStatus("rest-1", r.menuId)).state).toBe("reading");
    // Neither a plan nor a choice exists for a menu still being read.
    await expect(service.planFor("rest-1", r.menuId)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.makeCurrent("rest-1", r.menuId, "user-1", "fp")).rejects.toThrow(/still being read/);
    release();
    await service.whenRead(r.menuId);
    const done = await service.readStatus("rest-1", r.menuId);
    expect(done.state).toBe("done");
    expect(done.reply).toMatchObject({ menuId: r.menuId, itemsExtracted: 1, current: false });
    expect(tables.menu_items.filter((l) => l.menu_id === r.menuId)).toHaveLength(1);
  });

  it("several photos sent together are ONE version, read and kept as one PDF of that many pages", async () => {
    const tables = base();
    const { seen, parser } = reads();
    const service = makeService(tables, { wineSubmissions, scanParser: parser });
    const r = await service.importMenu(
      { method: "scan", data: { images: [PNG, `data:image/png;base64,${PNG}`, PNG] }, restaurantId: "rest-1" } as any,
      "user-1",
    );
    await service.whenRead(r.menuId);
    expect(r.pages).toBe(3);
    expect(seen).toHaveLength(1);
    expect(seen[0].startsWith("JVBERi0")).toBe(true); // %PDF
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(Buffer.from(seen[0], "base64"))).getPageCount()).toBe(3);
    const mine = tables.restaurant_menus.filter((m) => m.id !== "menu-old");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ source_mime: "application/pdf", read_state: "done" });
  });

  it("refuses in words, before any read, a page that is not a photo it can join, and more than 20 pages", async () => {
    const tables = base();
    const { seen, parser } = reads();
    const service = makeService(tables, { wineSubmissions, scanParser: parser });
    const gif = Buffer.from("GIF89a....").toString("base64");
    await expect(
      service.importMenu({ method: "scan", data: { images: [PNG, gif] }, restaurantId: "rest-1" } as any, "user-1"),
    ).rejects.toThrow(/Page 2 is not a JPEG or PNG photo/);
    await expect(
      service.importMenu({ method: "scan", data: { images: Array(21).fill(PNG) }, restaurantId: "rest-1" } as any, "user-1"),
    ).rejects.toThrow(/at most 20 pages; this one has 21/);
    expect(seen).toHaveLength(0);
    expect(tables.restaurant_menus).toHaveLength(1);
  });

  it("the same bytes again reopen the read they made, not billed twice; readAgain reads them again", async () => {
    const tables = base();
    const { seen, parser } = reads();
    const service = makeService(tables, { wineSubmissions, scanParser: parser });
    const dto = { method: "scan", data: { imageBase64: PNG }, restaurantId: "rest-1" } as any;
    const first = await service.importMenu(dto, "user-1");
    await service.whenRead(first.menuId);
    const again = await service.importMenu(dto, "user-1");
    expect(again.menuId).toBe(first.menuId);
    expect(again.reopened).toBeDefined();
    expect(again.items).toEqual([expect.objectContaining({ name: "Opus One" })]);
    expect(seen).toHaveLength(1);
    const fresh = await service.importMenu({ ...dto, readAgain: true }, "user-1");
    await service.whenRead(fresh.menuId);
    expect(fresh.menuId).not.toBe(first.menuId);
    expect(seen).toHaveLength(2);
  });

  it("a double send while the first is still reading starts one read, not two", async () => {
    const tables = base();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const service = makeService(tables, {
      wineSubmissions,
      scanParser: {
        parseWithWarnings: async () => {
          calls++;
          await gate;
          return { items: [{ name: "Opus One" }], warnings: [] };
        },
      },
    });
    const dto = { method: "scan", data: { imageBase64: PNG }, restaurantId: "rest-1" } as any;
    const a = await service.importMenu(dto, "user-1");
    const b = await service.importMenu(dto, "user-1");
    expect([b.menuId, b.reading]).toEqual([a.menuId, true]);
    release();
    await service.whenRead(a.menuId);
    expect(calls).toBe(1);
  });

  it("two sends of the same file AT ONCE (both pass the look-up before either keeps a version) make one version and one read", async () => {
    const tables = base();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const service = makeService(tables, {
      wineSubmissions,
      scanParser: {
        parseWithWarnings: async () => {
          calls++;
          await gate;
          return { items: [{ name: "Opus One" }], warnings: [] };
        },
      },
    });
    const dto = { method: "scan", data: { imageBase64: PNG }, restaurantId: "rest-1" } as any;
    // Both look before either inserts: the look-up alone cannot tell them apart.
    const look = jest.spyOn(service as any, "sameFileRead");
    const [a, b] = await Promise.all([service.importMenu(dto, "user-1"), service.importMenu(dto, "user-1")]);
    expect(look.mock.calls.filter((c) => !(c[3] as any)?.readingOnly)).toHaveLength(2);
    expect(b.menuId).toBe(a.menuId);
    expect(b.reading).toBe(true);
    expect(tables.restaurant_menus.filter((m) => m.id !== "menu-old")).toHaveLength(1);
    release();
    await service.whenRead(a.menuId);
    expect(calls).toBe(1);
  });

  it("a reopened read is said as it is NOW: a line discarded since is gone, a corrected price is the corrected one", async () => {
    const tables = base();
    const service = makeService(tables, {
      wineSubmissions,
      scanParser: {
        parseWithWarnings: async () => ({
          items: [
            { name: "Opus One", bottle_price: 62 },
            { name: "Misread Line", bottle_price: 1 },
          ],
          warnings: [],
        }),
      },
    });
    const dto = { method: "scan", data: { imageBase64: PNG }, restaurantId: "rest-1" } as any;
    const first = await service.importMenu(dto, "user-1");
    await service.whenRead(first.menuId);
    const lines = tables.menu_items.filter((l) => l.menu_id === first.menuId);
    lines.find((l) => l.name === "Misread Line")!.status = "discarded";
    lines.find((l) => l.name === "Opus One")!.bottle_price = 70;
    const again = await service.importMenu(dto, "user-1");
    expect(again.menuId).toBe(first.menuId);
    expect(again.reopened).toBeDefined();
    expect(again.items).toHaveLength(1);
    expect(again.items[0]).toMatchObject({ name: "Opus One", bottlePrice: 70, matched: true });
    // What the read found stays what it found.
    expect(again.itemsExtracted).toBe(2);
  });

  it("the same file for another day is its own version; an upload naming no label reopens the labelled one", async () => {
    const tables = base();
    const { seen, parser } = reads();
    const service = makeService(tables, { wineSubmissions, scanParser: parser });
    const dto = { method: "scan", data: { imageBase64: PNG }, restaurantId: "rest-1", menuDate: "2026-11-11" } as any;
    const monday = await service.importMenu(dto, "user-1");
    await service.whenRead(monday.menuId);
    const tuesday = await service.importMenu({ ...dto, menuDate: "2026-11-12" }, "user-1");
    await service.whenRead(tuesday.menuId);
    expect(tuesday.menuId).not.toBe(monday.menuId);
    expect(tuesday.reopened).toBeUndefined();
    expect(tables.restaurant_menus.find((m) => m.id === tuesday.menuId)!.menu_date).toBe("2026-11-12");
    expect(seen).toHaveLength(2);
    const unlabelled = await service.importMenu({ ...dto, menuDate: undefined }, "user-1");
    expect(unlabelled.reopened).toBeDefined();
    expect(seen).toHaveLength(2);
  });

  it("a retired menu sent again is read as a new version; the current one reopens saying it is current", async () => {
    const tables = base();
    const { seen, parser } = reads();
    const service = makeService(tables, { wineSubmissions, scanParser: parser });
    const dto = { method: "scan", data: { imageBase64: PNG }, restaurantId: "rest-1" } as any;
    const first = await service.importMenu(dto, "user-1");
    await service.whenRead(first.menuId);
    const row = tables.restaurant_menus.find((m) => m.id === first.menuId)!;
    row.status = "active";
    const current = await service.importMenu(dto, "user-1");
    expect(current).toMatchObject({ menuId: first.menuId, current: true });
    row.status = "archived";
    const fresh = await service.importMenu(dto, "user-1");
    await service.whenRead(fresh.menuId);
    expect(fresh.menuId).not.toBe(first.menuId);
    expect(fresh.reopened).toBeUndefined();
    expect(seen).toHaveLength(2);
  });

  it("a read that breaks after its lines were kept drops them and ends FAILED in words; it can never be made current", async () => {
    const tables = base();
    const service = makeService(tables, { wineSubmissions, scanParser: reads().parser });
    // Breaks after menu_items were inserted for this version.
    jest.spyOn(service as any, "markMenuUploaded").mockRejectedValue(new Error("progress table down"));
    const r = await service.importMenu({ method: "scan", data: { imageBase64: PNG }, restaurantId: "rest-1" } as any, "user-1");
    await service.whenRead(r.menuId);
    const read = await service.readStatus("rest-1", r.menuId);
    expect(read.state).toBe("failed");
    expect(read.failure).toBe(
      "The read stopped with an error, and nothing from it was kept but the file: progress table down.",
    );
    expect(tables.menu_items.filter((l) => l.menu_id === r.menuId)).toHaveLength(0);
    // The library submission made for its line goes with it: nothing points back to it.
    expect(tables.master_wine_library_submissions).toHaveLength(0);
    await expect(service.planFor("rest-1", r.menuId)).rejects.toThrow(/This read failed/);
  });

  it("a read the sweep already ended stays FAILED when it finishes late, and keeps no line or submission", async () => {
    const tables = base();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const service = makeService(tables, {
      wineSubmissions,
      scanParser: {
        parseWithWarnings: async () => {
          await gate;
          return { items: [{ name: "Opus One", bottle_price: 62 }], warnings: [] };
        },
      },
    });
    const r = await service.importMenu({ method: "scan", data: { imageBase64: PNG }, restaurantId: "rest-1" } as any, "user-1");
    // Another server (or the half-hour sweep) took this read for stopped.
    Object.assign(tables.restaurant_menus.find((m) => m.id === r.menuId)!, {
      read_state: "failed",
      read_failure: "The read stopped before it finished.",
    });
    release();
    await service.whenRead(r.menuId);
    const read = await service.readStatus("rest-1", r.menuId);
    expect(read.state).toBe("failed");
    expect(read.reply).toBeNull();
    expect(tables.menu_items.filter((l) => l.menu_id === r.menuId)).toHaveLength(0);
    expect(tables.master_wine_library_submissions).toHaveLength(0);
  });

  it("a read nobody is reading any more (a restart) is said to have FAILED when the house's menus are next read", async () => {
    const tables = base();
    tables.restaurant_menus.push({
      id: "menu-stuck",
      restaurant_id: "rest-1",
      status: "draft",
      read_state: "reading",
      extracted_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    });
    // It had kept a line and its submission before the server stopped.
    tables.master_wine_library_submissions.push({ id: "sub-stuck", restaurant_id: "rest-1" });
    tables.menu_items.push({ id: "line-stuck", menu_id: "menu-stuck", restaurant_id: "rest-1", submission_id: "sub-stuck" });
    const service = makeService(tables, { wineSubmissions });
    const listed = await service.listVersions("rest-1");
    const v = listed.versions.find((x) => x.menuId === "menu-stuck")!;
    expect(v.readState).toBe("failed");
    expect(v.readFailure).toMatch(/stopped before it finished/);
    // A stopped read keeps no half of what it wrote, as a failed one does.
    expect(tables.menu_items.filter((l) => l.menu_id === "menu-stuck")).toHaveLength(0);
    expect(tables.master_wine_library_submissions).toHaveLength(0);
  });
});

// Founder 2026-11-07 ("Background job"): a version says where its read stands,
// and only a finished read has a plan or can be made current.
describe("MenusService — a version says where its read stands", () => {
  const tables = (): Record<string, Row[]> => ({
    restaurant_menus: [
      { id: "menu-old", restaurant_id: "rest-1", status: "active" },
      { id: "m-reading", restaurant_id: "rest-1", status: "draft", read_state: "reading", extracted_at: new Date().toISOString() },
      {
        id: "m-failed",
        restaurant_id: "rest-1",
        status: "draft",
        read_state: "failed",
        read_failure: "No line could be read from this file.",
        read_warnings: [null, { kind: "chunk_failed", pages: { first: 2, last: 2 } }],
      },
    ],
    menu_items: [],
  });

  it("lists each version's read state and failure; a version read before the column is done; a null warning is dropped", async () => {
    const service = makeService(tables());
    const { versions } = await service.listVersions("rest-1");
    const by = (id: string) => versions.find((v) => v.menuId === id)!;
    expect([by("menu-old").readState, by("menu-old").readFailure]).toEqual(["done", null]);
    expect(by("m-reading").readState).toBe("reading");
    expect(by("m-failed")).toMatchObject({
      readState: "failed",
      readFailure: "No line could be read from this file.",
      readWarnings: [{ kind: "chunk_failed", pages: { first: 2, last: 2 } }],
    });
  });

  it.each([
    ["m-reading", /still being read/],
    ["m-failed", /This read failed, so it has no lines to make current\. No line could be read/],
  ])("%s has no plan and cannot be made current (409), and nothing is written", async (id, said) => {
    const t = tables();
    const calls: RpcCall[] = [];
    const service = makeService(t, { rpcCalls: calls });
    await expect(service.planFor("rest-1", id)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.makeCurrent("rest-1", id, "user-1", "fp")).rejects.toThrow(said);
    expect(calls).toHaveLength(0);
    expect(t.restaurant_menus.find((m) => m.id === "menu-old")!.status).toBe("active");
  });
});

describe("houseZoneOf -- the zone a house's menu dates are said in (menu r21)", () => {
  it("keeps a real IANA zone and says why there is none otherwise", () => {
    expect(houseZoneOf("Europe/Istanbul", null)).toEqual({ timezone: "Europe/Istanbul", timezoneReason: null });
    expect(houseZoneOf(" America/Detroit ", null)).toEqual({ timezone: "America/Detroit", timezoneReason: null });
    expect(houseZoneOf(null, null)).toEqual({ timezone: null, timezoneReason: "the house has no time zone set" });
    expect(houseZoneOf("", null).timezone).toBeNull();
    expect(houseZoneOf("Mars/Olympus", null)).toEqual({
      timezone: null,
      timezoneReason: 'the house\'s time zone "Mars/Olympus" is not one this page knows',
    });
    expect(houseZoneOf("Europe/Istanbul", "timeout")).toEqual({
      timezone: null,
      timezoneReason: "the house's time zone could not be read (timeout)",
    });
  });

  it("the plan says the house's zone, and the zone never moves its fingerprint", async () => {
    const tables = (timezone: string | null): Record<string, Row[]> => ({
      restaurant_menus: [{ id: "menu-1", restaurant_id: "rest-1", status: "draft", extracted_at: "2026-11-12T03:05:00Z" }],
      menu_items: [
        { id: "mi-1", menu_id: "menu-1", restaurant_id: "rest-1", name: "Barolo", category: "red", bottle_price: 120, wine_library_id: null, status: "approved" },
      ],
      restaurants: [{ id: "rest-1", timezone }],
    });
    const zoned = await makeService(tables("Europe/Istanbul")).planFor("rest-1", "menu-1");
    const bare = await makeService(tables(null)).planFor("rest-1", "menu-1");
    expect(zoned).toMatchObject({ timezone: "Europe/Istanbul", timezoneReason: null });
    expect(bare).toMatchObject({ timezone: null, timezoneReason: "the house has no time zone set" });
    expect(zoned.fingerprint).toBe(bare.fingerprint);
  });
});

describe("parseMenuPrice -- a typed price is read, never guessed (menu r21)", () => {
  const value = (raw: string) => {
    const r = parseMenuPrice(raw);
    return "value" in r ? r.value : null;
  };
  it("reads a dot or a comma decimal, thousands groups and a currency mark", () => {
    expect(value("70")).toBe(70);
    expect(value("45.50")).toBe(45.5);
    expect(value("45,5")).toBe(45.5);
    expect(value("$70")).toBe(70);
    expect(value("45 TL")).toBe(45);
    expect(value("₺ 1 250")).toBe(1250);
    expect(value("1.250,00")).toBe(1250);
    expect(value("1,250.75")).toBe(1250.75);
    expect(value("1.250.000")).toBe(1250000);
    expect(value("0")).toBe(0);
  });
  it("refuses a minus, letters, two decimals and a three-digit tail it cannot place", () => {
    for (const raw of ["-5", "abc", "", "12.5.1", "1,2.50", "1.250,505", ".5"]) expect(value(raw)).toBeNull();
    const r = parseMenuPrice("1,250");
    expect("refused" in r && r.refused).toMatch(/could be 1250 or 1\.25/);
    const k = parseMenuPrice("1.000");
    expect("refused" in k && k.refused).toMatch(/could be 1000 or 1;/);
  });
});

/**
 * A LINE LINKED TO THE HOUSE'S OWN GOOD IS CARRIED BY THAT LINK (r21 D1, part
 * 2): a good whose row names no library wine (a house gin) used to be left out
 * of the plan and the carry, which keyed on the library wine alone.
 */
describe("a line linked to a good with no library wine is planned and carried by its link", () => {
  const priceRpc = (tables: Record<string, Row[]>) => (fn: string, args: Row) => {
    if (fn === "make_menu_current") {
      for (const m of tables.restaurant_menus) m.status = m.id === args.p_menu_id ? "active" : "archived";
      return { data: { outcome: "made_current", previous_menu_ids: ["menu-old"], made_current_at: "2026-11-13T12:00:00Z" }, error: null };
    }
    if (fn === "set_house_menu_price") return { data: { outcome: "changed", held: [] }, error: null };
    return { data: null, error: null };
  };
  const house = (lines: Row[], inventory: Row[]): Record<string, Row[]> => ({
    restaurant_menus: [
      { id: "menu-old", restaurant_id: "rest-1", status: "active" },
      { id: "menu-new", restaurant_id: "rest-1", status: "draft", read_status: "done" },
    ],
    restaurants: [{ id: "rest-1", default_threshold_min: 3 }],
    restaurant_inventory: inventory,
    menu_items: lines.map((l, i) => ({
      id: `line-${i + 1}`,
      menu_id: "menu-new",
      restaurant_id: "rest-1",
      status: "approved",
      source: "csv",
      wine_library_id: null,
      created_at: "2026-11-13T10:00:00Z",
      ...l,
    })),
  });
  const gin = { id: "inv-gin", restaurant_id: "rest-1", master_wine_id: null, display_name: "House London Dry Gin", kind: "spirit", is_active: true, menu_price_current: null, menu_price_glass: null };

  it("the plan prices it on the good and the choice writes the good's price", async () => {
    const calls: RpcCall[] = [];
    const tables = house([{ name: "House London Dry Gin", category: "spirit", bottle_price: 40, inventory_item_id: "inv-gin" }], [{ ...gin }]);
    const service = makeService(tables, { rpcCalls: calls, rpc: priceRpc(tables) });
    const plan = await service.planFor("rest-1", "menu-new");
    expect(plan.lines[0]).toMatchObject({ inventoryId: "inv-gin", bottle: { result: "change", menuPrice: 40 } });
    const r = await service.makeCurrent("rest-1", "menu-new", "user-2", plan.fingerprint);
    expect(r).toMatchObject({ outcome: "made_current", priceSync: { changed: 1 } });
    const price = calls.filter(([fn]) => fn === "set_house_menu_price");
    expect(price).toHaveLength(1);
    expect(price[0][1]).toMatchObject({ p_inventory_id: "inv-gin", p_bottle_price: 40 });
    expect(tables.restaurant_inventory).toHaveLength(1);
  });

  it("an unpriced line on an unpriced gin is called a spirit, never a wine (D4)", async () => {
    const tables = house([{ name: "House London Dry Gin", category: "spirit", inventory_item_id: "inv-gin" }], [{ ...gin }]);
    const service = makeService(tables, { rpc: priceRpc(tables) });
    const plan = await service.planFor("rest-1", "menu-new");
    expect(plan.lines[0].flag).toBe("blank_no_house_price");
    await service.makeCurrent("rest-1", "menu-new", "user-2", plan.fingerprint);
    expect(tables.menu_items[0].price_flag).toBe("blank_no_house_price");
    expect(tables.menu_items[0].price_flag_note).toMatch(/the house had no price for this spirit either/);
  });

  it("a link to a good that is gone is said on the line, and no row is made for it", async () => {
    const tables = house([{ name: "House London Dry Gin", bottle_price: 40, inventory_item_id: "inv-gone" }], [{ ...gin }]);
    const service = makeService(tables, { rpc: priceRpc(tables) });
    const plan = await service.planFor("rest-1", "menu-new");
    expect(plan.lines[0].bottle.result).toBe("not_linked");
    const r = await service.makeCurrent("rest-1", "menu-new", "user-2", plan.fingerprint);
    expect(r.priceSync).toEqual({ failed: 1 });
    expect(r.failed[0].error).toMatch(/no longer in the house's inventory/);
    expect(tables.restaurant_inventory).toHaveLength(1);
  });

  it("a link to another house's good is never followed: its price is not touched", async () => {
    const calls: RpcCall[] = [];
    const theirs = { ...gin, id: "inv-theirs", restaurant_id: "rest-2" };
    const tables = house([{ name: "House London Dry Gin", bottle_price: 40, inventory_item_id: "inv-theirs" }], [{ ...gin }, theirs]);
    const service = makeService(tables, { rpcCalls: calls, rpc: priceRpc(tables) });
    const plan = await service.planFor("rest-1", "menu-new");
    const r = await service.makeCurrent("rest-1", "menu-new", "user-2", plan.fingerprint);
    expect(calls.filter(([fn, a]) => fn === "set_house_menu_price" && a.p_inventory_id === "inv-theirs")).toHaveLength(0);
    expect(r.priceSync).toEqual({ failed: 1 });
  });
});

/**
 * A MENU LINE FINDS THE HOUSE'S OWN GOOD FIRST (r21 walk, D1 and D4). A line
 * that names exactly one good the house carries is linked to it: no library
 * row, no second inventory row. Its price is carried onto that good.
 */
describe("a menu line finds the house's own good before the library (r21 D1)", () => {
  const spyLibrary = () => {
    const sent: unknown[] = [];
    return {
      sent,
      resolveLibraryWinesBatch: async (items: unknown[]) => {
        sent.push(...items);
        return items.map(() => ({ masterWineId: "mw-new", matched: false, libraryTier: 3, confidence: 40 }));
      },
      normalizeText: (t: string | null | undefined) => (t ? t.toLowerCase() : null),
    };
  };
  const priceRpc = (fn: string) =>
    fn === "set_house_menu_price" ? { data: { outcome: "changed", held: [] }, error: null } : { data: null, error: null };
  const good = (over: Row): Row => ({ restaurant_id: "rest-1", is_active: true, deleted_at: null, menu_price_current: null, menu_price_glass: null, ...over });
  const house = (inventory: Row[], extra: Record<string, Row[]> = {}): Record<string, Row[]> => ({
    restaurant_menus: [{ id: "menu-1", restaurant_id: "rest-1", status: "active" }],
    restaurants: [{ id: "rest-1", default_threshold_min: 3 }],
    restaurant_inventory: inventory,
    menu_items: [],
    master_wine_library_submissions: [],
    ...extra,
  });

  it("a hand-added line naming the house's wine, year typed in the name, links that wine: no library row, no second row", async () => {
    const lib = spyLibrary();
    const calls: RpcCall[] = [];
    const tables = house(
      [good({ id: "inv-c1", master_wine_id: "mw-c1", display_name: "Local Check Cabernet", wine_name: "Local Check Cabernet", kind: "wine", menu_price_current: 70 })],
      { master_wine_library: [{ id: "mw-c1", vintage: 2020 }] },
    );
    const service = makeService(tables, { wineSubmissions: lib, rpcCalls: calls, rpc: priceRpc });
    const item = await service.addMenuItem({ menuId: "menu-1", name: "Local Check Cabernet 2020", bottle_price: 75 } as any, "user-1", "rest-1", true);

    expect(lib.sent).toHaveLength(0);
    expect(tables.restaurant_inventory).toHaveLength(1);
    expect(tables.master_wine_library_submissions).toHaveLength(0);
    expect(tables.menu_items[0]).toMatchObject({ wine_library_id: "mw-c1", inventory_item_id: "inv-c1" });
    expect(item).toMatchObject({ inventoryItemId: "inv-c1", inventoryCreated: false, submissionId: null, matched: true, priceSync: "changed" });
    const price = calls.filter(([fn]) => fn === "set_house_menu_price");
    expect(price).toHaveLength(1);
    expect(price[0][1]).toMatchObject({ p_inventory_id: "inv-c1", p_bottle_price: 75 });
  });

  it("another vintage of the same name is not the house's wine: it goes to the library", async () => {
    const lib = spyLibrary();
    const tables = house(
      [good({ id: "inv-c1", master_wine_id: "mw-c1", display_name: "Local Check Cabernet", kind: "wine" })],
      { master_wine_library: [{ id: "mw-c1", vintage: 2019 }] },
    );
    const service = makeService(tables, { wineSubmissions: lib, rpc: priceRpc });
    await service.addMenuItem({ menuId: "menu-1", name: "Local Check Cabernet 2020" } as any, "user-1", "rest-1", true);
    expect(lib.sent).toHaveLength(1);
    expect(tables.menu_items[0].wine_library_id).toBe("mw-new");
  });

  it("a spirit line links the house's gin whose row names no library wine, and an unpriced one is called a spirit (D4)", async () => {
    const lib = spyLibrary();
    const tables = house([good({ id: "inv-gin", master_wine_id: null, display_name: "House London Dry Gin", kind: "spirit" })]);
    const service = makeService(tables, { wineSubmissions: lib, rpc: priceRpc });
    const item = await service.addMenuItem({ menuId: "menu-1", name: "House London Dry Gin", category: "Spirits" } as any, "user-1", "rest-1", true);

    expect(lib.sent).toHaveLength(0);
    expect(tables.restaurant_inventory).toHaveLength(1);
    expect(tables.menu_items[0]).toMatchObject({ wine_library_id: null, inventory_item_id: "inv-gin" });
    expect(item).toMatchObject({ inventoryItemId: "inv-gin", priceSync: "no_price", priceFlag: "blank_no_house_price" });
    expect(item.priceFlagNote).toMatch(/the house had no price for this spirit either/);
    expect(tables.menu_items[0].price_flag_note).not.toMatch(/wine/);
  });

  it("a priced spirit line sets the price on the house's gin, by its row", async () => {
    const calls: RpcCall[] = [];
    const tables = house([good({ id: "inv-gin", master_wine_id: null, display_name: "House London Dry Gin", kind: "spirit" })]);
    const service = makeService(tables, { wineSubmissions: spyLibrary(), rpcCalls: calls, rpc: priceRpc });
    const item = await service.addMenuItem({ menuId: "menu-1", name: "house london dry gin", category: "Spirits", by_glass_price: 12 } as any, "user-1", "rest-1", true);
    expect(item.priceSync).toBe("changed");
    const price = calls.filter(([fn]) => fn === "set_house_menu_price");
    expect(price).toHaveLength(1);
    expect(price[0][1]).toMatchObject({ p_inventory_id: "inv-gin", p_glass_price: 12 });
  });

  it("a good of another kind, or another house's good, is never taken", async () => {
    const lib = spyLibrary();
    const tables = house([
      good({ id: "inv-food", master_wine_id: null, display_name: "House London Dry Gin", kind: "food" }),
      good({ id: "inv-wine", master_wine_id: null, display_name: "House London Dry Gin", kind: "wine" }),
      good({ id: "inv-other-house", restaurant_id: "rest-2", master_wine_id: null, display_name: "House London Dry Gin", kind: "spirit" }),
    ]);
    const service = makeService(tables, { wineSubmissions: lib, rpc: priceRpc });
    const item = await service.addMenuItem({ menuId: "menu-1", name: "House London Dry Gin", category: "Spirits" } as any, "user-1", "rest-1", true);
    expect(lib.sent).toHaveLength(1);
    expect(item.houseCandidates).toBeUndefined();
    expect(["inv-food", "inv-wine", "inv-other-house"]).not.toContain(tables.menu_items[0].inventory_item_id);
  });

  it("two of the house's goods that fit are not guessed between: the line goes to the library and names both", async () => {
    const lib = spyLibrary();
    const tables = house([
      good({ id: "inv-a", master_wine_id: null, display_name: "House Red", kind: "wine" }),
      good({ id: "inv-b", master_wine_id: null, wine_name: "HOUSE RED", display_name: "House red.", kind: "other" }),
    ]);
    const service = makeService(tables, { wineSubmissions: lib, rpc: priceRpc });
    const item = await service.addMenuItem({ menuId: "menu-1", name: "House Red" } as any, "user-1", "rest-1", true);
    expect(lib.sent).toHaveLength(1);
    expect(item.houseCandidates?.map((c) => c.inventoryItemId)).toEqual(["inv-a", "inv-b"]);
    expect(tables.menu_items[0].wine_library_id).toBe("mw-new");
  });

  it("a failed read of the house's goods adds nothing: it is never taken for a house that carries nothing", async () => {
    const lib = spyLibrary();
    const tables = house([good({ id: "inv-gin", master_wine_id: null, display_name: "House London Dry Gin", kind: "spirit" })]);
    (tables as any).__readFails = [{ restaurant_inventory: "connection reset" }];
    const service = makeService(tables, { wineSubmissions: lib, rpc: priceRpc });
    await expect(
      service.addMenuItem({ menuId: "menu-1", name: "House London Dry Gin" } as any, "user-1", "rest-1", true),
    ).rejects.toThrow(/the house's goods could not be read: connection reset/);
    expect(lib.sent).toHaveLength(0);
    expect(tables.menu_items).toHaveLength(0);
  });

  it("a kitchen line is never matched: adding a dish does not even read the house's goods", async () => {
    const lib = spyLibrary();
    const tables = house([good({ id: "inv-x", master_wine_id: null, display_name: "Tiramisu", kind: "other" })]);
    (tables as any).__readFails = [{ restaurant_inventory: "connection reset" }];
    const service = makeService(tables, { wineSubmissions: lib, rpc: priceRpc });
    const item = await service.addMenuItem({ menuId: "menu-1", name: "Tiramisu", category: "dessert", bottle_price: 9 } as any, "user-1", "rest-1", true);
    expect(item.priceSync).toBe("kitchen_line");
    expect(tables.menu_items[0].inventory_item_id ?? null).toBeNull();
    expect(lib.sent).toHaveLength(0);
  });

  it("a kept menu's line keeps its link; the plan and the choice carry its price onto the house's gin", async () => {
    const lib = spyLibrary();
    const calls: RpcCall[] = [];
    const tables: Record<string, Row[]> = {
      restaurant_menus: [{ id: "menu-old", restaurant_id: "rest-1", status: "active" }],
      restaurants: [{ id: "rest-1", default_threshold_min: 3 }],
      restaurant_inventory: [good({ id: "inv-gin", master_wine_id: null, display_name: "House London Dry Gin", kind: "spirit" })],
      menu_items: [],
      user_onboarding_progress: [],
      master_wine_library_submissions: [],
    };
    const service = makeService(tables, {
      wineSubmissions: lib,
      rpcCalls: calls,
      rpc: (fn: string, args: Row) => {
        if (fn === "make_menu_current") {
          for (const m of tables.restaurant_menus) m.status = m.id === args.p_menu_id ? "active" : "archived";
          return { data: { outcome: "made_current", previous_menu_ids: ["menu-old"], made_current_at: "2026-11-13T12:00:00Z" }, error: null };
        }
        return priceRpc(fn);
      },
      scanParser: { parseWithWarnings: async () => ({ items: [{ name: "House London Dry Gin", category: "spirit", bottle_price: 40 }], warnings: [] }) },
    });
    const read = await service.importMenu(
      { method: "scan", data: { imageBase64: Buffer.from("%PDF").toString("base64") }, restaurantId: "rest-1" } as any,
      "user-1",
    );
    await (service as any).whenRead?.(read.menuId);
    expect(lib.sent).toHaveLength(0);
    const line = tables.menu_items.find((m) => m.menu_id === read.menuId)!;
    expect(line).toMatchObject({ wine_library_id: null, inventory_item_id: "inv-gin" });
    // Kept, not current: the house's price is not touched yet.
    expect(calls.filter(([fn]) => fn === "set_house_menu_price")).toHaveLength(0);

    const plan = await service.planFor("rest-1", read.menuId);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]).toMatchObject({ inventoryId: "inv-gin", bottle: { result: "change", menuPrice: 40 } });

    const r = await service.makeCurrent("rest-1", read.menuId, "user-2", plan.fingerprint);
    expect(r).toMatchObject({ outcome: "made_current", priceSync: { changed: 1 } });
    const price = calls.filter(([fn]) => fn === "set_house_menu_price");
    expect(price).toHaveLength(1);
    expect(price[0][1]).toMatchObject({ p_inventory_id: "inv-gin", p_bottle_price: 40 });
    expect(tables.restaurant_inventory).toHaveLength(1);
  });

  /**
   * r28 G21: a line that fits two of the house's goods is linked to neither and
   * goes to the library, and choosing the menu then made a second good beside
   * the house's. An owner or a manager now picks the good on the kept menu.
   */
  describe("linkLineToHouseGood (r28 G21)", () => {
    function twoReds(extra: Row[] = []) {
      const lib = spyLibrary();
      const calls: RpcCall[] = [];
      const tables: Record<string, Row[]> = {
        restaurant_menus: [{ id: "menu-old", restaurant_id: "rest-1", status: "active" }],
        restaurants: [{ id: "rest-1", default_threshold_min: 3 }],
        restaurant_inventory: [
          good({ id: "inv-a", master_wine_id: "mw-a", display_name: "House Red", kind: "wine" }),
          good({ id: "inv-b", master_wine_id: null, wine_name: "HOUSE RED", display_name: "House red.", kind: "wine" }),
          ...extra,
        ],
        menu_items: [],
        user_onboarding_progress: [],
        master_wine_library_submissions: [],
      };
      const service = makeService(tables, {
        wineSubmissions: lib,
        rpcCalls: calls,
        rpc: (fn: string, args: Row) => {
          if (fn === "make_menu_current") {
            for (const m of tables.restaurant_menus) m.status = m.id === args.p_menu_id ? "active" : "archived";
            return { data: { outcome: "made_current", previous_menu_ids: ["menu-old"], made_current_at: "2026-11-13T12:00:00Z" }, error: null };
          }
          return priceRpc(fn);
        },
        scanParser: {
          parseWithWarnings: async () => ({
            items: [
              { name: "House Red", category: "Red wine", bottle_price: 40 },
              { name: "Künefe", category: "Tatlılar", bottle_price: 140 },
            ],
            warnings: [],
          }),
        },
      });
      return { tables, service, calls };
    }
    async function read(service: MenusService, tables: Record<string, Row[]>) {
      let r: any = await service.importMenu(
        { method: "scan", data: { imageBase64: Buffer.from("%PDF").toString("base64") }, restaurantId: "rest-1" } as any,
        "user-1",
      );
      await (service as any).whenRead?.(r.menuId);
      // r37 meet: with the background scan (#1460 in the r33 menu meet) the
      // first reply only says "reading"; the lines are in the finished read.
      if (r.reading) r = (await service.readStatus("rest-1", r.menuId)).reply;
      const red = tables.menu_items.find((m) => m.menu_id === r.menuId && m.name === "House Red")!;
      const dish = tables.menu_items.find((m) => m.menu_id === r.menuId && m.name === "Künefe")!;
      return { r, red, dish };
    }

    it("links the line to the picked good and its library wine; the plan and the choice carry it there, and no second good is made", async () => {
      const { tables, service, calls } = twoReds();
      const { r, red } = await read(service, tables);
      expect(r.items.find((i) => i.name === "House Red")?.houseCandidates?.map((c) => c.inventoryItemId)).toEqual(["inv-a", "inv-b"]);
      expect(red).toMatchObject({ wine_library_id: "mw-new" });
      const before = await service.planFor("rest-1", r.menuId);

      const linked = await service.linkLineToHouseGood("rest-1", r.menuId, red.id, "inv-a");
      expect(linked).toEqual({ menuItemId: red.id, inventoryItemId: "inv-a", goodName: "House Red" });
      expect(red).toMatchObject({ inventory_item_id: "inv-a", wine_library_id: "mw-a" });

      const plan = await service.planFor("rest-1", r.menuId);
      expect(plan.fingerprint).not.toBe(before.fingerprint);
      expect(plan.lines.find((l) => l.menuItemId === red.id)).toMatchObject({ inventoryId: "inv-a" });
      // A plan shown before the link is a plan nobody chose.
      await expect(service.makeCurrent("rest-1", r.menuId, "user-2", before.fingerprint)).rejects.toMatchObject({ status: 409 });
      await service.makeCurrent("rest-1", r.menuId, "user-2", plan.fingerprint);
      const price = calls.filter(([fn]) => fn === "set_house_menu_price");
      expect(price.map(([, a]) => a.p_inventory_id)).toEqual(["inv-a"]);
      expect(tables.restaurant_inventory).toHaveLength(2);
    });

    it("a good with no library wine leaves the line carried by the good alone", async () => {
      const { tables, service } = twoReds();
      const { r, red } = await read(service, tables);
      await service.linkLineToHouseGood("rest-1", r.menuId, red.id, "inv-b");
      expect(red).toMatchObject({ inventory_item_id: "inv-b", wine_library_id: null });
    });

    it("refuses the current menu, a dish, another house's or a removed good, and a line of another menu; nothing is written", async () => {
      const { tables, service } = twoReds([
        { id: "inv-x", restaurant_id: "rest-2", master_wine_id: null, display_name: "House Red", kind: "wine", is_active: true, deleted_at: null },
        good({ id: "inv-off", master_wine_id: null, display_name: "Old Red", kind: "wine", is_active: false }),
        good({ id: "inv-del", master_wine_id: null, display_name: "Gone Red", kind: "wine", deleted_at: "2026-11-01T00:00:00Z" }),
      ]);
      const { r, red, dish } = await read(service, tables);
      tables.menu_items.push({ id: "mi-old", menu_id: "menu-old", restaurant_id: "rest-1", name: "House Red", category: "Red wine", status: "approved" });
      const untouched = JSON.stringify(tables.menu_items);
      await expect(service.linkLineToHouseGood("rest-1", "menu-old", "mi-old", "inv-a")).rejects.toMatchObject({ status: 409 });
      await expect(service.linkLineToHouseGood("rest-1", r.menuId, dish.id, "inv-a")).rejects.toMatchObject({ status: 400 });
      await expect(service.linkLineToHouseGood("rest-1", r.menuId, red.id, "inv-x")).rejects.toMatchObject({ status: 404 });
      await expect(service.linkLineToHouseGood("rest-1", r.menuId, red.id, "inv-off")).rejects.toMatchObject({ status: 409 });
      await expect(service.linkLineToHouseGood("rest-1", r.menuId, red.id, "inv-del")).rejects.toMatchObject({ status: 409 });
      await expect(service.linkLineToHouseGood("rest-1", r.menuId, "mi-old", "inv-a")).rejects.toMatchObject({ status: 404 });
      await expect(service.linkLineToHouseGood("rest-2", r.menuId, red.id, "inv-x")).rejects.toMatchObject({ status: 404 });
      // Another house's menu is not found, before it is ever said to be current.
      await expect(service.linkLineToHouseGood("rest-2", "menu-old", "mi-old", "inv-x")).rejects.toMatchObject({ status: 404 });
      red.status = "discarded";
      await expect(service.linkLineToHouseGood("rest-1", r.menuId, red.id, "inv-a")).rejects.toMatchObject({ status: 404 });
      red.status = "approved";
      expect(JSON.stringify(tables.menu_items)).toBe(untouched);
    });
  });
});

describe("newestCurrentFirst (r28 G20)", () => {
  it("puts the menu made current last first, a never-chosen menu after every chosen one, then by when it was kept, then by id", () => {
    const rows = [
      { id: "c", name: null, status: "active", made_current_at: null, created_at: "2026-11-01T00:00:00Z" },
      { id: "a", name: null, status: "active", made_current_at: "2026-09-01T00:00:00Z", created_at: "2026-08-01T00:00:00Z" },
      { id: "b", name: null, status: "active", made_current_at: "2026-10-01T00:00:00Z", created_at: "2026-07-01T00:00:00Z" },
      { id: "e", name: null, status: "active", made_current_at: null, created_at: null },
      { id: "d", name: null, status: "active", made_current_at: null, created_at: "2026-10-15T00:00:00Z" },
      { id: "f", name: null, status: "active", made_current_at: null, created_at: null },
    ];
    expect(newestCurrentFirst(rows).map((r) => r.id)).toEqual(["b", "a", "c", "d", "e", "f"]);
    expect(newestCurrentFirst([...rows].reverse()).map((r) => r.id)).toEqual(["b", "a", "c", "d", "e", "f"]);
  });
});

describe("MenusService.getOnboardingProgress — the self-heal counts the lines a house has", () => {
  // A fake for this block alone, closer to PostgREST than the shared one where
  // it matters here: `.maybeSingle()` answers MORE than one row with an error
  // (postgrest-js PGRST116), `limit` limits, and a `menu_items` read embeds
  // `restaurant_menus!inner(...)` by `menu_id`, so a filter on
  // `restaurant_menus.<col>` drops the line when its version fails it (or is
  // missing), as an inner embed does. `readFails[table]` makes every read of
  // that table fail, or only its Nth read when given `{ message, nth }`
  // (1-based); writes still land.
  type ReadFail = string | { message: string; nth: number };
  function onboardingDb(
    tables: Record<string, Row[]>,
    readFails: Record<string, ReadFail> = {},
  ) {
    const reads: string[] = [];
    function from(table: string) {
      const preds: Array<(r: Row) => boolean> = [];
      let patch: Row | null = null;
      let cap = Infinity;
      const col = (r: Row, c: string) => {
        if (!c.includes(".")) return r[c];
        const [embedded, field] = c.split(".");
        if (table !== "menu_items" || embedded !== "restaurant_menus") {
          throw new Error(`fake: no embed ${embedded} on ${table}`);
        }
        const version = (tables.restaurant_menus || []).find(
          (m) => m.id === r.menu_id,
        );
        return version ? version[field] : undefined;
      };
      const hasEmbed = (c: string, r: Row) =>
        !c.includes(".") ||
        (tables.restaurant_menus || []).some((m) => m.id === r.menu_id);
      const rows = () =>
        (tables[table] || [])
          .filter((r) => preds.every((p) => p(r)))
          .slice(0, cap);
      const read = () => {
        reads.push(table);
        const fail = readFails[table];
        if (!fail) return null;
        if (typeof fail === "string") return { message: fail };
        const nth = reads.filter((t) => t === table).length;
        return nth === fail.nth ? { message: fail.message } : null;
      };
      const api: any = {
        select: () => api,
        eq: (c: string, v: any) => (
          preds.push((r) => hasEmbed(c, r) && col(r, c) === v),
          api
        ),
        neq: (c: string, v: any) => (
          preds.push((r) => hasEmbed(c, r) && col(r, c) !== v),
          api
        ),
        // gt/is are kept so the specs can run against the earlier rule (by
        // lines_extracted) and show it fails for the reason they name.
        gt: (c: string, v: number) => (
          preds.push((r) => col(r, c) != null && col(r, c) > v),
          api
        ),
        is: (c: string, v: null) => (
          preds.push((r) => (col(r, c) ?? null) === v),
          api
        ),
        // PostgREST `or` ("col.not.is.null" / "col.gt.<value>"), as the
        // invite read uses it.
        or: (expr: string) => {
          const terms = expr.split(",").map((t) => {
            const [c, ...rest] = t.split(".");
            const op = rest.join(".");
            return op === "not.is.null"
              ? (r: Row) => (r[c] ?? null) !== null
              : (r: Row) => r[c] != null && String(r[c]) > op.slice(3);
          });
          preds.push((r) => terms.some((f) => f(r)));
          return api;
        },
        limit: (n: number) => ((cap = n), api),
        order: () => api,
        update: (p: Row) => ((patch = p), api),
        maybeSingle: async () => {
          const err = read();
          if (err) return { data: null, error: err };
          const found = rows();
          if (found.length > 1) {
            return {
              data: null,
              error: {
                code: "PGRST116",
                message:
                  "JSON object requested, multiple (or no) rows returned",
              },
            };
          }
          return { data: found[0] ?? null, error: null };
        },
        then(resolve: any) {
          if (patch) {
            for (const r of rows()) Object.assign(r, patch);
            return resolve({ data: null, error: null });
          }
          const err = read();
          resolve(
            err ? { data: null, error: err } : { data: rows(), error: null },
          );
        },
      };
      return api;
    }
    return { db: { from } as any, reads };
  }

  function serviceOn(
    menus: Row[],
    items: Row[],
    readFails: Record<string, ReadFail> = {},
  ) {
    const tables: Record<string, Row[]> = {
      user_onboarding_progress: [
        {
          id: "uop-1",
          user_id: "invitee-1",
          restaurant_id: "rest-1",
          menu_uploaded: false,
          completed_at: null,
        },
      ],
      restaurant_menus: menus,
      menu_items: items,
      restaurants: [{ id: "rest-1", threshold_configured: true }],
    };
    const { db, reads } = onboardingDb(tables, readFails);
    const service = new MenusService(
      { supabase: db } as unknown as DatabaseService,
      undefined as any,
      undefined as any,
      undefined as any,
    );
    return { service, tables, reads };
  }

  // `lines_extracted` is what the read counted when the version was made; the
  // self-heal must not trust it, so most versions here carry a count that
  // disagrees with the lines they hold.
  const menu = (
    id: string,
    status: string,
    linesExtracted: number | null,
    source_method = "scan",
    restaurant_id = "rest-1",
  ) => ({
    id,
    restaurant_id,
    status,
    source_method,
    lines_extracted: linesExtracted,
  });
  const line = (
    id: string,
    menu_id: string,
    status = "approved",
    restaurant_id = "rest-1",
  ) => ({ id, menu_id, restaurant_id, status });

  it("a read that found no line, then lines typed in during review, reads as uploaded for a later invitee", async () => {
    // QA round 4 (#770): addMenuItem adds rows and never moves lines_extracted.
    const { service, tables } = serviceOn(
      [menu("m-1", "active", 0)],
      [line("i-1", "m-1", "flagged"), line("i-2", "m-1", "flagged")],
    );
    const progress = await service.getOnboardingProgress("invitee-1", "rest-1");
    expect(progress.menu_uploaded).toBe(true);
    expect(progress.activated).toBe(true);
    // OB-1: the read writes nothing; the fact is read from the house.
    expect(tables.user_onboarding_progress[0].menu_uploaded).toBe(false);
  });

  it("a CSV version and a manual version each count by their lines", async () => {
    const csv = serviceOn(
      [menu("m-1", "draft", 0, "csv")],
      [line("i-1", "m-1")],
    );
    const fromCsv = await csv.service.getOnboardingProgress("invitee-1", "rest-1");
    expect(fromCsv.menu_uploaded).toBe(true);
    const manual = serviceOn(
      [menu("m-1", "draft", null, "manual")],
      [line("i-1", "m-1", "flagged")],
    );
    const typed = await manual.service.getOnboardingProgress("invitee-1", "rest-1");
    expect(typed.menu_uploaded).toBe(true);
  });

  it("a version whose every line was discarded does not count, whatever its read count says", async () => {
    const { service, tables } = serviceOn(
      [menu("m-1", "active", 9)],
      [line("i-1", "m-1", "discarded"), line("i-2", "m-1", "discarded")],
    );
    const progress = await service.getOnboardingProgress("invitee-1", "rest-1");
    expect(progress.menu_uploaded).toBe(false);
    expect(progress.activated).toBe(false);
    expect(tables.user_onboarding_progress[0].menu_uploaded).toBe(false);
  });

  it("a version with no line at all does not count, even active and with no read count", async () => {
    const { service } = serviceOn([menu("m-1", "active", null)], []);
    const progress = await service.getOnboardingProgress("invitee-1", "rest-1");
    expect(progress.menu_uploaded).toBe(false);
  });

  it("a house holding two active versions with lines reads as uploaded, and nothing is written", async () => {
    const { service, tables } = serviceOn(
      [menu("m-1", "active", 12), menu("m-2", "active", 9)],
      [line("i-1", "m-1"), line("i-2", "m-2")],
    );
    const progress = await service.getOnboardingProgress("invitee-1", "rest-1");
    expect(progress.menu_uploaded).toBe(true);
    expect(tables.user_onboarding_progress[0].menu_uploaded).toBe(false);
  });

  it("a draft-only house with lines reads as uploaded for an invitee", async () => {
    const { service } = serviceOn(
      [menu("m-1", "draft", 7)],
      [line("i-1", "m-1")],
    );
    const progress = await service.getOnboardingProgress("invitee-1", "rest-1");
    expect(progress.menu_uploaded).toBe(true);
  });

  it("lines on an archived version do not count, nor another house's lines", async () => {
    const { service } = serviceOn(
      [menu("m-1", "archived", 30), menu("m-2", "draft", 4, "scan", "rest-2")],
      [line("i-1", "m-1"), line("i-2", "m-2", "approved", "rest-2")],
    );
    const progress = await service.getOnboardingProgress("invitee-1", "rest-1");
    expect(progress.menu_uploaded).toBe(false);
  });

  it("a failed read of the house's lines is said, not read as 'not uploaded'", async () => {
    const { service, tables } = serviceOn(
      [menu("m-1", "active", 12)],
      [line("i-1", "m-1")],
      { menu_items: "connection reset" },
    );
    await expect(service.getOnboardingProgress("invitee-1", "rest-1")).rejects.toThrow(
      /connection reset/,
    );
    expect(tables.user_onboarding_progress[0].menu_uploaded).toBe(false);
  });

  it("a stored flag set true says nothing: a house with no line reads as not uploaded (OB-1)", async () => {
    const { service, tables, reads } = serviceOn([], []);
    tables.user_onboarding_progress[0].menu_uploaded = true;
    const progress = await service.getOnboardingProgress("invitee-1", "rest-1");
    expect(progress.menu_uploaded).toBe(false);
    expect(progress.activated).toBe(false);
    expect(reads).toContain("menu_items");
  });
});
