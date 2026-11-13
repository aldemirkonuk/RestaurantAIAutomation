import "reflect-metadata";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { DatabaseService } from "../database/database.service";
import { DishesController } from "./dishes.controller";
import { DishesService, PAGE, dishNameTaken, foldName } from "./dishes.service";
import { DISH_NOT_THIS_HOUSE, RecipesService } from "./recipes.service";

/**
 * Dishes on the recipe engine (ADR 0366).
 *
 * part 1  the real JwtAuthGuard over every route DishesController declares
 *         (from Nest's metadata): house B in the path is a 403; writes are
 *         owner/manager.
 * part 2  the real services over a fake database that APPLIES eq / is / in /
 *         order / range to two houses' rows, so a read that forgets its house
 *         filter, its current-version rule or its paging returns a wrong row
 *         and an assertion sees it.
 */

const HOUSE_A = "11111111-1111-4111-8111-111111111111";
const HOUSE_B = "22222222-2222-4222-8222-222222222222";
const TART = "d0000000-0000-4000-8000-0000000000a1";
const SOUP = "d0000000-0000-4000-8000-0000000000a2";
const GONE = "d0000000-0000-4000-8000-0000000000a3";
const B_DISH = "d0000000-0000-4000-8000-0000000000b1";
const FLOUR = "f0000000-0000-4000-8000-0000000000a1";
const B_FLOUR = "f0000000-0000-4000-8000-0000000000b1";
const V_TART_1 = "e0000000-0000-4000-8000-0000000000a1";
const V_TART_2 = "e0000000-0000-4000-8000-0000000000a2";
const V_SOUP = "e0000000-0000-4000-8000-0000000000a3";
const V_GONE = "e0000000-0000-4000-8000-0000000000a4";
const V_B = "e0000000-0000-4000-8000-0000000000b1";

/* ── part 1: the real guard, over every declared route ───────────────── */

type Route = { handler: string; method: number; path: string };
const proto = DishesController.prototype as unknown as Record<string, object>;
const routes: Route[] = Object.getOwnPropertyNames(proto)
  .filter((n) => n !== "constructor" && Reflect.hasMetadata(PATH_METADATA, proto[n]))
  .map((n) => ({ handler: n, method: Reflect.getMetadata(METHOD_METADATA, proto[n]), path: Reflect.getMetadata(PATH_METADATA, proto[n]) }));

function contextFor(route: Route, pathHouse: string) {
  const params: Record<string, string> = {};
  for (const seg of route.path.split("/")) if (seg.startsWith(":")) params[seg.slice(1)] = seg === ":restaurantId" ? pathHouse : TART;
  const request = { headers: {}, params, query: {}, body: {}, user: { userId: "u-a", restaurantId: HOUSE_A, role: "owner", emailVerified: true } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => proto[route.handler],
    getClass: () => DishesController,
  } as never;
}

function realGuard() {
  const guard = new JwtAuthGuard(new Reflector(), { isBlacklisted: jest.fn().mockResolvedValue(false) } as never);
  jest.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), "canActivate").mockResolvedValue(true as never);
  return guard;
}

describe("dishes: the path's house is the caller's (real guard, every route)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("declares the dish, dish-recipe, item-use and shelf-match routes, all under :restaurantId", () => {
    expect(routes.map((r) => r.handler).sort()).toEqual([
      "createDish", "dishesUsingItem", "getDishRecipe", "listDishVersions", "listDishes",
      "matchShelf", "previewDishCost", "readDishVersion", "saveDishRecipe", "updateDish",
    ]);
    for (const r of routes) expect(r.path.split("/")[0]).toBe(":restaurantId");
  });

  it.each(routes.map((r) => [r.handler, r] as const))("%s refuses house B in the path with 403", async (_n, route) => {
    await expect(realGuard().canActivate(contextFor(route, HOUSE_B))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("every write is owner or manager; every read is not role-gated", () => {
    const roles = Object.fromEntries(routes.map((r) => [r.handler, Reflect.getMetadata(ROLES_KEY, proto[r.handler]) ?? null]));
    for (const w of ["createDish", "updateDish", "saveDishRecipe", "previewDishCost", "matchShelf"]) {
      expect([w, roles[w]]).toEqual([w, ["owner", "manager"]]);
    }
    for (const r of ["listDishes", "getDishRecipe", "listDishVersions", "readDishVersion", "dishesUsingItem"]) {
      expect([r, roles[r]]).toEqual([r, null]);
    }
  });
});

/* ── part 2: the real services over two houses' rows ─────────────────── */

type Row = Record<string, any>;

function fakeDb(rows: Record<string, Row[]>, opts: { rpc?: (name: string, args: Row) => { data?: unknown; error?: unknown }; insertError?: unknown } = {}) {
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  const reads: string[] = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let sortBy: string | null = null;
    let window: [number, number] | null = null;
    let head = false;
    let patch: Row | null = null;
    let insert: Row | null = null;
    const hits = () => {
      let out = (rows[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (sortBy) out = [...out].sort((x, y) => (x[sortBy!] < y[sortBy!] ? -1 : x[sortBy!] > y[sortBy!] ? 1 : 0));
      // PostgREST's cap: never more than PAGE rows in one answer.
      return window ? out.slice(window[0], Math.min(window[1] + 1, window[0] + PAGE)) : out.slice(0, PAGE);
    };
    const run = () => {
      reads.push(table);
      if (insert) {
        if (opts.insertError) return { data: null, error: opts.insertError };
        const r = { id: "d0000000-0000-4000-8000-00000000new1", ...insert };
        (rows[table] ??= []).push(r);
        return { data: r, error: null };
      }
      if (patch) {
        const hit = hits()[0];
        if (hit) Object.assign(hit, patch);
        return { data: hit ?? null, error: null };
      }
      return head ? { data: null, count: hits().length, error: null } : { data: hits(), error: null };
    };
    const q: any = {
      select: (_c: string, o?: { head?: boolean }) => ((head = !!o?.head), q),
      insert: (r: Row) => ((insert = r), q),
      update: (p: Row) => ((patch = p), q),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      order: (c: string) => ((sortBy = c), q),
      range: (a: number, b: number) => ((window = [a, b]), q),
      limit: () => q,
      maybeSingle: async () => {
        const out = run() as { data: unknown; error: unknown };
        return { data: Array.isArray(out.data) ? (out.data[0] ?? null) : out.data, error: out.error };
      },
      single: async () => run(),
      then: (ok: (v: unknown) => unknown) => ok(run()),
    };
    return q;
  };
  const client = {
    from,
    rpc: async (name: string, args: Row) => (rpcCalls.push({ name, args }), { data: null, error: null, ...opts.rpc?.(name, args) }),
  };
  return { db: { getClient: () => client } as unknown as DatabaseService, rpcCalls, reads };
}

const line = (id: string, version: string, house: string, position: number, label: string, item: string | null, extra: Row = {}) => ({
  id, version_id: version, restaurant_id: house, position, role: "stocked", inventory_id: item, label,
  qty_entered: 250, unit_code: "g", qty_base: 250_000, base_unit: "mg", ...extra,
});

function twoHouses(): Record<string, Row[]> {
  return {
    dishes: [
      { id: TART, restaurant_id: HOUSE_A, name: "Lemon tart", menu_section: "Desserts", price: 9, description: null, deleted_at: null },
      { id: SOUP, restaurant_id: HOUSE_A, name: "Bread soup", menu_section: null, price: null, description: null, deleted_at: null },
      { id: GONE, restaurant_id: HOUSE_A, name: "Retired pie", menu_section: null, price: 5, description: null, deleted_at: "2026-10-01" },
      { id: B_DISH, restaurant_id: HOUSE_B, name: "B-ONLY flan", menu_section: null, price: 777, description: null, deleted_at: null },
    ],
    recipe_current_dish: [
      { dish_id: TART, version_id: V_TART_2, restaurant_id: HOUSE_A },
      { dish_id: SOUP, version_id: V_SOUP, restaurant_id: HOUSE_A },
      { dish_id: GONE, version_id: V_GONE, restaurant_id: HOUSE_A },
      { dish_id: B_DISH, version_id: V_B, restaurant_id: HOUSE_B },
    ],
    recipe_versions: [
      { id: V_TART_1, restaurant_id: HOUSE_A, dish_id: TART, owner_kind: "dish", version: 1, yield_serves: 4, created_at: "2026-11-01" },
      { id: V_TART_2, restaurant_id: HOUSE_A, dish_id: TART, owner_kind: "dish", version: 2, yield_serves: 8, created_at: "2026-11-02" },
      { id: V_SOUP, restaurant_id: HOUSE_A, dish_id: SOUP, owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" },
      { id: V_GONE, restaurant_id: HOUSE_A, dish_id: GONE, owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" },
      { id: V_B, restaurant_id: HOUSE_B, dish_id: B_DISH, owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" },
    ],
    recipe_lines: [
      // Tart v1 used flour; v2 (current) uses flour twice and lemons; soup does not use flour now.
      line("l1", V_TART_1, HOUSE_A, 1, "Old flour line", FLOUR, { qty_entered: 999 }),
      line("l2", V_TART_2, HOUSE_A, 1, "Flour", FLOUR),
      line("l3", V_TART_2, HOUSE_A, 2, "Lemons", null, { qty_entered: 3, unit_code: "each", qty_base: 3000, base_unit: "each_milli" }),
      line("l4", V_TART_2, HOUSE_A, 3, "Flour for the base", FLOUR, { qty_entered: 50, qty_base: 50_000 }),
      line("l5", V_SOUP, HOUSE_A, 1, "Stale bread", null),
      line("l6", V_GONE, HOUSE_A, 1, "Flour", FLOUR),
      line("l7", V_B, HOUSE_B, 1, "B-SECRET flour", FLOUR),
    ],
    restaurant_inventory: [
      { id: FLOUR, restaurant_id: HOUSE_A, display_name: "Bread Flour", kind: "food", uom: "kg", bottle_size_ml: null, last_purchase_price: 2, is_active: true, deleted_at: null },
      { id: B_FLOUR, restaurant_id: HOUSE_B, display_name: "Lemons", kind: "food", uom: "each", bottle_size_ml: null, last_purchase_price: 1, is_active: true, deleted_at: null },
      { id: "f0000000-0000-4000-8000-0000000000a2", restaurant_id: HOUSE_A, display_name: "Tonic  Water", kind: "mixer", uom: "bottle", bottle_size_ml: 200, is_active: true, deleted_at: null },
      { id: "f0000000-0000-4000-8000-0000000000a3", restaurant_id: HOUSE_A, display_name: "Sugar", kind: "food", uom: "g", bottle_size_ml: null, is_active: true, deleted_at: null },
      { id: "f0000000-0000-4000-8000-0000000000a4", restaurant_id: HOUSE_A, display_name: "sugar", kind: "food", uom: "kg", bottle_size_ml: null, is_active: true, deleted_at: null },
      { id: "f0000000-0000-4000-8000-0000000000a5", restaurant_id: HOUSE_A, display_name: "Old salt", kind: "food", uom: "g", bottle_size_ml: null, is_active: false, deleted_at: null },
    ],
    inventory_lot_rollup: [],
    users: [],
  };
}

function services(rows = twoHouses(), opts: Parameters<typeof fakeDb>[1] = {}) {
  const fake = fakeDb(rows, opts);
  const recipes = new RecipesService(fake.db);
  return { recipes, dishes: new DishesService(fake.db, recipes), ...fake };
}

describe("dishes: the list", () => {
  it("lists this house's live dishes only, each with its current recipe's cost a plate", async () => {
    const { dishes } = services();
    const out = await dishes.listDishes(HOUSE_A, "owner");
    expect(out.map((d) => d.name)).toEqual(["Bread soup", "Lemon tart"]);
    const tart = out.find((d) => d.id === TART)!;
    // 300 g of flour at 2 a kg = 0.60 for a batch of 8; the lemons are not linked, so not complete.
    expect(tart).toMatchObject({ hasRecipe: true, yieldServes: 8, lineCount: 3, price: 9 });
    expect(tart.cost).toMatchObject({ complete: false, priced: 2, of: 3 });
    expect(JSON.stringify(out)).not.toContain("B-ONLY");
  });

  it("a role that does not see money reads no price and no cost", async () => {
    const { dishes } = services();
    const out = await dishes.listDishes(HOUSE_A, "staff");
    expect(out.every((d) => d.price === null && d.cost === null)).toBe(true);
  });

  it("reads past the 1,000-row cap: 1,005 dishes are 1,005 dishes", async () => {
    const rows = twoHouses();
    rows.dishes = Array.from({ length: 1005 }, (_, i) => ({
      id: `d1000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      restaurant_id: HOUSE_A, name: `Dish ${i}`, menu_section: null, price: null, deleted_at: null,
    }));
    const { dishes } = services(rows);
    expect((await dishes.listDishes(HOUSE_A, "owner")).length).toBe(1005);
  });

  it("a pointer naming another dish's version is not read as this dish's recipe", async () => {
    const rows = twoHouses();
    rows.recipe_current_dish.push({ dish_id: "d0000000-0000-4000-8000-0000000000a9", version_id: V_TART_2, restaurant_id: HOUSE_A });
    rows.dishes.push({ id: "d0000000-0000-4000-8000-0000000000a9", restaurant_id: HOUSE_A, name: "Stray", price: null, deleted_at: null });
    const { dishes } = services(rows);
    const stray = (await dishes.listDishes(HOUSE_A, "owner")).find((d) => d.name === "Stray")!;
    expect(stray.hasRecipe).toBe(false);
  });
});

describe("dishes: which dishes use an item", () => {
  it("lists only the dishes whose CURRENT recipe links the item, with the item's own lines", async () => {
    const { dishes } = services();
    const out = await dishes.dishesUsingItem(HOUSE_A, FLOUR, "owner");
    expect(out.dishes.map((d) => d.name)).toEqual(["Lemon tart"]);
    expect(out.dishes[0].uses).toEqual([
      { label: "Flour", qtyEntered: 250, unitCode: "g" },
      { label: "Flour for the base", qtyEntered: 50, unitCode: "g" },
    ]);
    expect(out.dishes[0]).toMatchObject({ yieldServes: 8, price: 9, hasRecipe: true });
    // The old version's line, the deleted dish and house B's dish are not here.
    expect(JSON.stringify(out)).not.toMatch(/Old flour line|Retired pie|B-ONLY|B-SECRET/);
  });

  it("another house's item is a 404, never its dishes", async () => {
    const { dishes } = services();
    await expect(dishes.dishesUsingItem(HOUSE_A, B_FLOUR, "owner")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("an item no current dish uses is an empty list", async () => {
    const { dishes } = services();
    expect(await dishes.dishesUsingItem(HOUSE_A, "f0000000-0000-4000-8000-0000000000a3", "owner")).toEqual({ dishes: [] });
  });

  it("staff read the dishes without price or cost", async () => {
    const { dishes } = services();
    const out = await dishes.dishesUsingItem(HOUSE_A, FLOUR, "staff");
    expect(out.dishes[0]).toMatchObject({ price: null, cost: null, name: "Lemon tart" });
  });

  it("reads every line of the item past the 1,000-row cap", async () => {
    const rows = twoHouses();
    // 1,000 old lines of the item come first; the current one is the 1,001st.
    rows.recipe_lines = [
      ...Array.from({ length: 1000 }, (_, i) => line(`a${String(i).padStart(5, "0")}`, V_TART_1, HOUSE_A, i + 1, "Old", FLOUR)),
      line("z-current", V_TART_2, HOUSE_A, 1, "Flour", FLOUR),
    ];
    const { dishes } = services(rows);
    const out = await dishes.dishesUsingItem(HOUSE_A, FLOUR, "owner");
    expect(out.dishes.map((d) => d.name)).toEqual(["Lemon tart"]);
  });
});

describe("dishes: a pasted label proposes its shelf item by exact name", () => {
  it("matches case- and space-folded names of this house's live items only", async () => {
    const { dishes } = services();
    const out = await dishes.matchShelf(HOUSE_A, ["bread  flour", "Tonic Water", "Lemons", "Old salt", "Flour"]);
    expect(out.map((m) => m.item?.name ?? null)).toEqual(["Bread Flour", "Tonic  Water", null, null, null]);
  });

  it("two shelf items of one name match neither, and say how many", async () => {
    const { dishes } = services();
    const [m] = await dishes.matchShelf(HOUSE_A, ["SUGAR"]);
    expect(m).toMatchObject({ item: null, sameName: 2 });
  });

  it("folds runs of spaces and case, nothing else", () => {
    expect(foldName("  Bread  FLOUR ")).toBe("bread flour");
    expect(foldName("Flour")).not.toBe(foldName("Flours"));
  });
});

describe("dishes: the recipe of a dish", () => {
  it("reads a dish's current recipe under `dish`, with its cost and versions", async () => {
    const { recipes } = services();
    const out = await recipes.getDishRecipe(HOUSE_A, TART, "owner");
    expect(out.dish).toMatchObject({ id: TART, name: "Lemon tart", section: "Desserts", price: 9 });
    expect((out.current as any).versionId).toBe(V_TART_2);
    expect(out.versionCount).toBe(2);
    expect(out.legacyLines).toEqual([]);
  });

  it("another house's dish and a deleted dish are 404", async () => {
    const { recipes } = services();
    await expect(recipes.getDishRecipe(HOUSE_A, B_DISH, "owner")).rejects.toThrow(DISH_NOT_THIS_HOUSE);
    await expect(recipes.getDishRecipe(HOUSE_A, GONE, "owner")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("an earlier version of another dish is not this dish's", async () => {
    const { recipes } = services();
    await expect(recipes.readDishVersion(HOUSE_A, SOUP, V_TART_1, "owner")).rejects.toBeInstanceOf(NotFoundException);
    const v = await recipes.readDishVersion(HOUSE_A, TART, V_TART_1, "owner");
    expect((v.version as any).lines[0].label).toBe("Old flour line");
  });

  it("saves through save_dish_recipe_version with the dish and no glass; a stale save is a 409", async () => {
    const { recipes, rpcCalls } = services(twoHouses(), {
      rpc: (name) => (name === "save_dish_recipe_version" ? { data: { version_id: "v3", version: 3, lines: [] } } : {}),
    });
    const dto = { expectedVersionId: V_TART_2, yieldServes: 8, glass: "Coupe", garnish: "Mint", lines: [{ role: "untracked" as const, label: " Salt ", qty: 1, unit: "g" }] };
    await expect(recipes.saveDishRecipe(HOUSE_A, TART, "u-a", dto)).resolves.toMatchObject({ versionId: "v3", version: 3 });
    expect(rpcCalls[0].name).toBe("save_dish_recipe_version");
    expect(rpcCalls[0].args).toMatchObject({ p_restaurant: HOUSE_A, p_dish: TART, p_expected_version: V_TART_2, p_garnish: "Mint" });
    expect(rpcCalls[0].args).not.toHaveProperty("p_glass");
    expect(rpcCalls[0].args.p_lines[0].label).toBe("Salt");

    const stale = services(twoHouses(), { rpc: () => ({ error: { code: "RCP09", message: "stale" } }) });
    await expect(stale.recipes.saveDishRecipe(HOUSE_A, TART, "u-a", dto)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("dishes: adding and changing a dish", () => {
  it("adds a dish in this house, its name's spaces folded", async () => {
    const rows = twoHouses();
    const { dishes } = services(rows);
    const out = await dishes.createDish(HOUSE_A, { name: "  Fig   salad ", section: " ", price: 12.5 });
    expect(out).toMatchObject({ name: "Fig salad", section: null, price: 12.5 });
    expect(rows.dishes.at(-1)).toMatchObject({ restaurant_id: HOUSE_A, name: "Fig salad" });
  });

  it("a name the house already has is a 409 that names it", async () => {
    const { dishes } = services(twoHouses(), { insertError: { code: "23505", message: "dup" } });
    await expect(dishes.createDish(HOUSE_A, { name: "Lemon tart" })).rejects.toThrow(dishNameTaken("Lemon tart"));
  });

  it("a blank name is refused before the database", async () => {
    const { dishes, reads } = services();
    await expect(dishes.createDish(HOUSE_A, { name: "   " })).rejects.toThrow("A dish needs a name.");
    expect(reads).toEqual([]);
  });

  it("changes only this house's live dish; another house's is a 404", async () => {
    const rows = twoHouses();
    const { dishes } = services(rows);
    await expect(dishes.updateDish(HOUSE_A, B_DISH, { price: 1 })).rejects.toBeInstanceOf(NotFoundException);
    expect(rows.dishes.find((d) => d.id === B_DISH)!.price).toBe(777);
    await expect(dishes.updateDish(HOUSE_A, TART, { price: null })).resolves.toMatchObject({ price: null, name: "Lemon tart" });
  });
});
