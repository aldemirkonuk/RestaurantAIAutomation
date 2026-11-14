import "reflect-metadata";
import { ForbiddenException, HttpException, INestApplication, ValidationPipe } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DatabaseService } from "../database/database.service";
import { RecipesController } from "./recipes.controller";
import { NOT_THIS_HOUSE, RecipesService } from "./recipes.service";

/**
 * House A never reads, versions or saves house B's recipe (round-15 QA, #867).
 *
 * Round 15 removed the house filters from recipes.service.ts one at a time and
 * 9 of 17 removals left every recipes test green; with the cocktail filter gone
 * a house-1 owner read house 2's drink, price and recipe through their own
 * path. These specs make each of those removals fail:
 *
 * part 1  the real JwtAuthGuard over every route the controller declares
 *         (read from Nest's metadata, so a route added later is covered):
 *         house B in the path is a 403;
 * part 2  the real service over a fake database that APPLIES its filters to
 *         rows of two houses, so a read that forgets its house filter returns
 *         the other house's row and the assertion sees it;
 * part 3  the real ValidationPipe (main.ts options) and the real service: a
 *         number the database cannot hold is a 400 with a sentence, not a 500.
 */

const HOUSE_A = "11111111-1111-4111-8111-111111111111";
const HOUSE_B = "22222222-2222-4222-8222-222222222222";
const DRINK_A = "a0000000-0000-4000-8000-00000000000a";
const DRINK_A_GONE = "a0000000-0000-4000-8000-0000000000de";
const DRINK_A_STRAY_POINTER = "a0000000-0000-4000-8000-0000000000c1";
const DRINK_A_FOREIGN_VERSION = "a0000000-0000-4000-8000-0000000000c2";
const DRINK_B = "b0000000-0000-4000-8000-00000000000b";
const VA1 = "a1000000-0000-4000-8000-000000000001";
const VA_FOREIGN = "a1000000-0000-4000-8000-0000000000f0";
const VB1 = "b1000000-0000-4000-8000-000000000001";
const VB_STRAY = "b1000000-0000-4000-8000-0000000000a0";
const ITEM_A = "a2000000-0000-4000-8000-000000000001";
const ITEM_B = "b2000000-0000-4000-8000-000000000001";
const ITEM_A_ARCHIVED = "a3000000-0000-4000-8000-0000000000ac";
const AUTHOR_A = "a9000000-0000-4000-8000-000000000001";
const VA0 = "a1000000-0000-4000-8000-000000000000";

/* ── part 1: the real guard, over every declared route ───────────────── */

type Route = { handler: string; method: number; path: string };

function declaredRoutes(): Route[] {
  const proto = RecipesController.prototype as unknown as Record<string, object>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== "constructor" && Reflect.hasMetadata(PATH_METADATA, proto[name]))
    .map((name) => ({
      handler: name,
      method: Reflect.getMetadata(METHOD_METADATA, proto[name]),
      path: Reflect.getMetadata(PATH_METADATA, proto[name]),
    }));
}

function contextFor(route: Route, pathHouse: string) {
  const params: Record<string, string> = {};
  for (const seg of route.path.split("/")) {
    if (seg.startsWith(":")) params[seg.slice(1)] = seg === ":restaurantId" ? pathHouse : DRINK_A;
  }
  const request = {
    headers: {},
    params,
    query: {},
    body: { expectedVersionId: null, yieldServes: 1, lines: [] },
    user: { userId: "user-of-a", restaurantId: HOUSE_A, role: "owner", emailVerified: true },
  };
  const handler = (RecipesController.prototype as unknown as Record<string, unknown>)[route.handler];
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => RecipesController,
  } as never;
}

function realGuard() {
  const guard = new JwtAuthGuard(new Reflector(), { isBlacklisted: jest.fn().mockResolvedValue(false) } as never);
  // Stand in for passport only: report success, leave request.user as seeded.
  jest.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), "canActivate").mockResolvedValue(true as never);
  return guard;
}

describe("recipes: the path's house is the caller's (real guard, every route)", () => {
  afterEach(() => jest.restoreAllMocks());
  const routes = declaredRoutes();

  it("declares the five routes the sheet calls, all under :restaurantId", () => {
    expect(routes.map((r) => r.handler).sort()).toEqual(["getRecipe", "listVersions", "readVersion", "saveRecipe", "shelf"]);
    for (const r of routes) expect(r.path.split("/")[0]).toBe(":restaurantId");
  });

  it.each(routes.map((r) => [r.handler, r] as const))("%s refuses house B in the path with 403", async (_n, route) => {
    await expect(realGuard().canActivate(contextFor(route, HOUSE_B))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(routes.map((r) => [r.handler, r] as const))("%s admits the caller's own house", async (_n, route) => {
    await expect(realGuard().canActivate(contextFor(route, HOUSE_A))).resolves.toBe(true);
  });
});

/* ── part 2: the real service over two houses' rows ──────────────────── */

type Row = Record<string, any>;

/** SQL LIKE (with ESCAPE '\'), case-insensitive, as PostgREST's ilike runs it. */
function likeToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "%") out += ".*";
    else if (c === "_") out += ".";
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "is");
}

/**
 * A Supabase stand-in that APPLIES eq / is / in / ilike / order / limit to
 * seeded rows, so a query missing its house filter returns the other house's
 * row. `recipe_lines(count)` is embedded as PostgREST would, unfiltered.
 */
function fakeDb(rows: Record<string, Row[]>, rpc?: (args: Row) => { data?: unknown; error?: unknown }) {
  const rpcCalls: Row[] = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let head = false;
    let embedLineCount = false;
    let sortBy: { col: string; asc: boolean } | null = null;
    let cap = Infinity;
    const hits = () => {
      let out = (rows[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (sortBy) {
        const { col, asc } = sortBy;
        out = [...out].sort((x, y) => (x[col] < y[col] ? -1 : x[col] > y[col] ? 1 : 0) * (asc ? 1 : -1));
      }
      out = out.slice(0, cap);
      if (embedLineCount) {
        out = out.map((r) => ({
          ...r,
          recipe_lines: [{ count: (rows.recipe_lines ?? []).filter((l) => l.version_id === r.id).length }],
        }));
      }
      return out;
    };
    const q: any = {
      select: (cols: string, opts?: { head?: boolean }) => {
        head = !!opts?.head;
        embedLineCount = /recipe_lines\(count\)/.test(cols);
        return q;
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      ilike: (c: string, p: string) => (filters.push((r) => likeToRegExp(p).test(String(r[c] ?? ""))), q),
      order: (c: string, o?: { ascending?: boolean }) => ((sortBy = { col: c, asc: o?.ascending !== false }), q),
      limit: (n: number) => ((cap = n), q),
      maybeSingle: async () => ({ data: hits()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) =>
        ok(head ? { data: null, count: hits().length, error: null } : { data: hits(), error: null }),
    };
    return q;
  };
  const client = {
    from,
    rpc: async (_name: string, args: Row) => (rpcCalls.push(args), { data: null, error: null, ...rpc?.(args) }),
  };
  return { db: { getClient: () => client } as unknown as DatabaseService, rpcCalls };
}

function twoHouses() {
  const shelf: Row[] = Array.from({ length: 55 }, (_, i) => ({
    id: `a3000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    restaurant_id: HOUSE_A,
    display_name: `Bottle ${String(i).padStart(2, "0")}`,
    kind: "spirit",
    uom: "bottle",
    bottle_size_ml: 700,
    is_active: true,
    deleted_at: null,
  }));
  const item = (id: string, house: string, name: string, extra: Row = {}) => ({
    id,
    restaurant_id: house,
    display_name: name,
    kind: "spirit",
    uom: "bottle",
    bottle_size_ml: 700,
    last_purchase_price: house === HOUSE_A ? 700 : 99_999,
    is_active: true,
    deleted_at: null,
    ...extra,
  });
  const line = (id: string, version: string, house: string, position: number, label: string, inventory: string | null) => ({
    id,
    version_id: version,
    restaurant_id: house,
    position,
    role: "stocked",
    inventory_id: inventory,
    label,
    qty_entered: 30,
    unit_code: "ml",
    qty_base: 300,
    base_unit: "ml10",
  });
  const version = (id: string, house: string, cocktail: string, n: number) => ({
    id,
    restaurant_id: house,
    cocktail_id: cocktail,
    version: n,
    yield_serves: 1,
    created_at: `2026-11-0${n}`,
    author: house === HOUSE_A ? AUTHOR_A : null,
  });
  return {
    cocktails: [
      { id: DRINK_A, restaurant_id: HOUSE_A, name: "Negroni", price: 450, deleted_at: null },
      { id: DRINK_A_GONE, restaurant_id: HOUSE_A, name: "Retired", price: 1, deleted_at: "2026-10-01" },
      { id: DRINK_A_STRAY_POINTER, restaurant_id: HOUSE_A, name: "Stray pointer", price: 1, deleted_at: null },
      { id: DRINK_A_FOREIGN_VERSION, restaurant_id: HOUSE_A, name: "Foreign version", price: 1, deleted_at: null },
      { id: DRINK_B, restaurant_id: HOUSE_B, name: "B-ONLY Martini", price: 777, deleted_at: null },
    ],
    recipe_current: [
      { cocktail_id: DRINK_A, version_id: VA1, restaurant_id: HOUSE_A },
      { cocktail_id: DRINK_B, version_id: VB1, restaurant_id: HOUSE_B },
      // A pointer row that names another house is not this house's pointer.
      { cocktail_id: DRINK_A_STRAY_POINTER, version_id: VB1, restaurant_id: HOUSE_B },
      // A pointer of this house that names another house's version.
      { cocktail_id: DRINK_A_FOREIGN_VERSION, version_id: VA_FOREIGN, restaurant_id: HOUSE_A },
    ],
    recipe_versions: [
      version(VA0, HOUSE_A, DRINK_A, 1),
      version(VA1, HOUSE_A, DRINK_A, 2),
      version(VB1, HOUSE_B, DRINK_B, 1),
      // Rows that name house B under house A's drink or id: never shown to A.
      version(VB_STRAY, HOUSE_B, DRINK_A, 3),
      version(VA_FOREIGN, HOUSE_B, DRINK_A_FOREIGN_VERSION, 1),
    ],
    recipe_lines: [
      line("la1", VA1, HOUSE_A, 1, "Gin", ITEM_A),
      line("la2", VA1, HOUSE_A, 2, "Campari", ITEM_B),
      line("la0", VA0, HOUSE_A, 1, "Old amaro", ITEM_A_ARCHIVED),
      line("lb-stray", VA1, HOUSE_B, 3, "B-SECRET line", null),
      line("lb1", VB1, HOUSE_B, 1, "B-SECRET vermouth", null),
    ],
    cocktail_ingredients: [],
    users: [{ user_id: AUTHOR_A, name: "Ayşe Bar" }],
    restaurant_inventory: [
      item(ITEM_A, HOUSE_A, "House gin"),
      item(ITEM_B, HOUSE_B, "B-ONLY campari"),
      item("a3000000-0000-4000-8000-0000000000aa", HOUSE_A, "100% agave"),
      item("a3000000-0000-4000-8000-0000000000ab", HOUSE_A, "Gin_x"),
      item(ITEM_A_ARCHIVED, HOUSE_A, "Archived amaro", { is_active: false }),
      item("a3000000-0000-4000-8000-0000000000ad", HOUSE_A, "Deleted amaro", { deleted_at: "2026-10-01" }),
      item("b3000000-0000-4000-8000-0000000000ae", HOUSE_B, "B-ONLY amaro"),
      ...shelf,
    ],
    inventory_lot_rollup: [
      { inventory_id: ITEM_A, restaurant_id: HOUSE_A, has_invoice_cost: true, wac: 700, wac_qty: 1, live_qty: 1 },
      // The same item id under another house's rollup must never price A's line.
      { inventory_id: ITEM_A, restaurant_id: HOUSE_B, has_invoice_cost: true, wac: 70_000, wac_qty: 1, live_qty: 1 },
    ],
  };
}

/** The SQL's own house check (save_recipe_version), so a save of B's drink from A is refused as the database would. */
const sqlHouseCheck = (rows: Record<string, Row[]>) => (args: Row) =>
  rows.cocktails.some((c) => c.id === args.p_cocktail && c.restaurant_id === args.p_restaurant && !c.deleted_at)
    ? { data: { version_id: "v-new", version: 2, lines: [] } }
    : { error: { code: "RCP00", message: NOT_THIS_HOUSE } };

async function statusOf(p: Promise<unknown>) {
  try {
    await p;
    return 200;
  } catch (e) {
    return (e as HttpException).getStatus();
  }
}

describe("recipes: house A never reads, versions or saves house B's recipe (real service, two houses)", () => {
  const service = () => {
    const rows = twoHouses();
    const f = fakeDb(rows, sqlHouseCheck(rows));
    return { svc: new RecipesService(f.db), rpcCalls: f.rpcCalls };
  };

  it("reads its own drink: its lines only, priced from its own lots", async () => {
    const r: any = await service().svc.getRecipe(HOUSE_A, DRINK_A, "owner");
    expect(r.cocktail).toMatchObject({ name: "Negroni", price: 450 });
    expect(r.versionCount).toBe(2);
    expect(r.current.versionId).toBe(VA1);
    expect(r.current.lines.map((l: any) => l.label)).toEqual(["Gin", "Campari"]);
    expect(r.current.lines[0]).toMatchObject({ itemName: "House gin", status: "linked", costPerServe: 30 });
    expect(JSON.stringify(r)).not.toMatch(/B-SECRET|B-ONLY|777|99999|70000/);
  });

  it("does not name or price another house's item even when a line points at it", async () => {
    const r: any = await service().svc.getRecipe(HOUSE_A, DRINK_A, "owner");
    expect(r.current.lines[1]).toMatchObject({ inventoryId: ITEM_B, itemName: null, status: "not_linked", costPerServe: null });
  });

  it.each([
    ["house B's drink", DRINK_B],
    ["its own deleted drink", DRINK_A_GONE],
  ])("GET refuses %s with 404", async (_n, drink) => {
    expect(await statusOf(service().svc.getRecipe(HOUSE_A, drink, "owner"))).toBe(404);
  });

  it("GET ignores a current-pointer row that names another house", async () => {
    const r: any = await service().svc.getRecipe(HOUSE_A, DRINK_A_STRAY_POINTER, "owner");
    expect(r.current).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/B-SECRET/);
  });

  it("GET says a pointer to another house's version is unreadable rather than show it", async () => {
    expect(await statusOf(service().svc.getRecipe(HOUSE_A, DRINK_A_FOREIGN_VERSION, "owner"))).toBe(503);
  });

  it("versions: lists only its own rows for its own drink, with who saved each", async () => {
    const v = await service().svc.listVersions(HOUSE_A, DRINK_A);
    expect(v.map((x) => x.versionId)).toEqual([VA1, VA0]);
    expect(v[0]).toMatchObject({ authorName: "Ayşe Bar" });
  });

  it("past version: reads its own lines, at today's prices, and flags an archived item", async () => {
    const r: any = await service().svc.readVersion(HOUSE_A, DRINK_A, VA0, "owner");
    expect(r.version.versionId).toBe(VA0);
    expect(r.version.lines).toEqual([
      expect.objectContaining({ label: "Old amaro", itemName: "Archived amaro", itemGone: "archived", status: "linked" }),
    ]);
    expect(JSON.stringify(r)).not.toMatch(/B-SECRET|B-ONLY/);
  });

  it("past version: a staff read carries no money", async () => {
    const r: any = await service().svc.readVersion(HOUSE_A, DRINK_A, VA1, "staff");
    expect(r.cost).toBeNull();
    expect(r.version.lines.every((l: any) => l.costPerServe === null && l.costPerServeExact === null)).toBe(true);
  });

  it.each([
    ["house B's version of its own drink", DRINK_B, VB1],
    ["a house-B row filed under its drink", DRINK_A, VB_STRAY],
    ["its own version of another drink", DRINK_A_STRAY_POINTER, VA1],
    ["a version of house B's drink", DRINK_B, VA1],
  ])("past version refuses %s with 404", async (_n, drink, v) => {
    expect(await statusOf(service().svc.readVersion(HOUSE_A, drink, v, "owner"))).toBe(404);
  });

  it.each([
    ["house B's drink", DRINK_B],
    ["its own deleted drink", DRINK_A_GONE],
  ])("versions refuses %s with 404", async (_n, drink) => {
    expect(await statusOf(service().svc.listVersions(HOUSE_A, drink))).toBe(404);
  });

  it("save of house B's drink from house A's path is refused with 400 and the rpc is told house A", async () => {
    const { svc, rpcCalls } = service();
    const dto = { expectedVersionId: null, yieldServes: 1, lines: [{ role: "untracked" as const, label: "Ice", qty: 1, unit: "each" }] };
    await expect(svc.saveRecipe(HOUSE_A, DRINK_B, "u-a", dto)).rejects.toMatchObject({ status: 400, message: NOT_THIS_HOUSE });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({ p_restaurant: HOUSE_A, p_cocktail: DRINK_B });
  });

  it("shelf: its own live items only, capped at 50", async () => {
    const s = await service().svc.shelf(HOUSE_A, undefined, 500);
    expect(s).toHaveLength(50);
    const all = await service().svc.shelf(HOUSE_A, "amaro", undefined);
    expect(all.map((x) => x.name)).toEqual([]);
    expect((await service().svc.shelf(HOUSE_A, "gin", undefined)).map((x) => x.name)).toEqual(["Gin_x", "House gin"]);
  });

  it("shelf: never lists house B's items", async () => {
    const s = await service().svc.shelf(HOUSE_A, "B-ONLY", undefined);
    expect(s).toEqual([]);
  });

  it.each([
    ["%", ["100% agave"]],
    ["_", ["Gin_x"]],
  ])("shelf: %s is searched as a character, not a wildcard", async (term, names) => {
    expect((await service().svc.shelf(HOUSE_A, term, undefined)).map((x) => x.name)).toEqual(names);
  });
});

/* ── part 3: a number the database cannot hold is a 400 with a sentence ── */

describe("recipes: out-of-range numbers are a 400 with a sentence (real ValidationPipe)", () => {
  let app: INestApplication;
  let base: string;
  let rpcCalls: Row[];

  beforeAll(async () => {
    const rows = twoHouses();
    const f = fakeDb(rows, sqlHouseCheck(rows));
    rpcCalls = f.rpcCalls;
    const moduleRef = await Test.createTestingModule({
      controllers: [RecipesController],
      providers: [RecipesService, { provide: DatabaseService, useValue: f.db }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { userId: "u-a", restaurantId: HOUSE_A, role: "owner" };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0);
    base = await app.getUrl();
  });
  afterAll(() => app.close());

  const put = (body: unknown) =>
    fetch(`${base}/recipes/${HOUSE_A}/cocktails/${DRINK_A}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const line = (qty: number, unit = "ml") => ({ role: "stocked", inventoryId: null, label: "Gin", qty, unit });

  it.each([
    [1e30, "ml"],
    [1e308, "kg"],
    [100_001, "each"],
  ])("refuses qty %s %s with 400 and a sentence, never reaching the database", async (qty, unit) => {
    rpcCalls.length = 0;
    const res = await put({ expectedVersionId: null, yieldServes: 1, lines: [line(1), line(qty, unit)] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe(`Ingredient 2 (Gin) is more than one line can hold. The most is 100,000 ${unit}.`);
    expect(rpcCalls).toEqual([]);
  });

  it.each([1001, 2_147_483_648])("refuses yieldServes %s with 400 and a sentence", async (yieldServes) => {
    rpcCalls.length = 0;
    const res = await put({ expectedVersionId: null, yieldServes, lines: [line(30)] });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("A recipe makes at most 1,000 serves.");
    expect(rpcCalls).toEqual([]);
  });

  it.each(["\u00a0", " \u2003 "])("refuses a label of only spaces (%j) with 400, never reaching the database", async (label) => {
    rpcCalls.length = 0;
    const res = await put({ expectedVersionId: null, yieldServes: 1, lines: [line(30), { ...line(30), label }] });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("Ingredient 2 needs a name.");
    expect(rpcCalls).toEqual([]);
  });

  it("saves a label with no-break spaces around it, trimmed", async () => {
    rpcCalls.length = 0;
    const res = await put({ expectedVersionId: null, yieldServes: 1, lines: [{ ...line(30), label: "\u00a0Gin\u00a0" }] });
    expect(res.status).toBe(200);
    expect((rpcCalls[0].p_lines as Row[])[0].label).toBe("Gin");
  });

  it("saves the largest amounts it allows", async () => {
    rpcCalls.length = 0;
    const res = await put({ expectedVersionId: null, yieldServes: 1000, lines: [line(100_000, "kg")] });
    expect(res.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
  });
});
