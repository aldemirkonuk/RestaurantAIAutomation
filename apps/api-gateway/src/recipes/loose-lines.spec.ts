import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DishesService } from "./dishes.service";
import { RecipeLineDto } from "./dto/recipes.dto";
import { LooseLinesController } from "./loose-lines.controller";
import { LooseLinesService } from "./loose-lines.service";

/**
 * The loose-lines queue (r108 drinks-g9): every counted line of a drink's
 * CURRENT version that names no shelf good, grouped by folded name, with each
 * affected drink whole in the PUT's shape. The fake database APPLIES the
 * house, null, in and range filters, and caps every page at 1,000 rows as
 * PostgREST does, so a read that forgets its house filter or its paging shows.
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

function fakeDb(tables: Tables) {
  const reads: Array<{ table: string; house: unknown }> = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let house: unknown = undefined;
    let range: [number, number] = [0, 999];
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (c === "restaurant_id" && (house = v), filters.push((r) => r[c] === v), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      order: () => q,
      range: (a: number, b: number) => ((range = [a, b]), q),
      maybeSingle: () => {
        reads.push({ table, house });
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then: (ok: (v: unknown) => unknown) => {
        reads.push({ table, house });
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        // PostgREST answers at most 1,000 rows, whatever range was asked.
        const page = rows.slice(range[0], Math.min(range[1] + 1, range[0] + 1000));
        return Promise.resolve({ data: page, error: null }).then(ok);
      },
    };
    return q;
  };
  return { db: { getClient: () => ({ from }) } as any, reads };
}

const svc = (tables: Tables) => {
  const { db } = fakeDb(tables);
  return new LooseLinesService(db, new DishesService(db, null as any));
};

let n = 0;
const id = (p: string) => `${p}-${String(++n).padStart(6, "0")}`;
const line = (over: Row): Row => ({
  id: id("l"),
  role: "stocked",
  inventory_id: null,
  component_dish_id: null,
  qty_entered: "30",
  unit_code: "ml",
  usable_pct: null,
  base_unit: "ml10",
  ...over,
});

function house(): Tables {
  return {
    cocktails: [
      { id: "c-neg", restaurant_id: A, name: "negroni", display_name: "Negroni", deleted_at: null },
      { id: "c-gim", restaurant_id: A, name: "Gimlet", display_name: null, deleted_at: null },
      { id: "c-old", restaurant_id: A, name: "Gone", display_name: null, deleted_at: "2026-01-01" },
      { id: "c-b", restaurant_id: B, name: "Their drink", display_name: null, deleted_at: null },
    ],
    recipe_current: [
      { restaurant_id: A, cocktail_id: "c-neg", version_id: "v-neg2" },
      { restaurant_id: A, cocktail_id: "c-gim", version_id: "v-gim1" },
      { restaurant_id: A, cocktail_id: "c-old", version_id: "v-old1" },
      { restaurant_id: B, cocktail_id: "c-b", version_id: "v-b1" },
    ],
    recipe_versions: [
      { id: "v-neg2", restaurant_id: A, cocktail_id: "c-neg", yield_serves: 1, method: "Stir", glass: "Rocks", garnish: null },
      { id: "v-gim1", restaurant_id: A, cocktail_id: "c-gim", yield_serves: 2, method: null, glass: null, garnish: "Lime" },
      { id: "v-old1", restaurant_id: A, cocktail_id: "c-old", yield_serves: 1, method: null, glass: null, garnish: null },
      { id: "v-b1", restaurant_id: B, cocktail_id: "c-b", yield_serves: 1, method: null, glass: null, garnish: null },
    ],
    recipe_lines: [
      // Negroni's current version: gin linked, Campari loose, vermouth loose, an orange twist not counted, a made syrup.
      line({ restaurant_id: A, version_id: "v-neg2", position: 2, label: "Campari", qty_entered: "25" }),
      line({ restaurant_id: A, version_id: "v-neg2", position: 0, label: "Gin", inventory_id: "i-gin" }),
      line({ restaurant_id: A, version_id: "v-neg2", position: 1, label: "Sweet vermouth", usable_pct: "90" }),
      line({ restaurant_id: A, version_id: "v-neg2", position: 3, label: "Orange twist", role: "untracked", unit_code: "each", qty_entered: "1" }),
      line({ restaurant_id: A, version_id: "v-neg2", position: 4, label: "Syrup", role: "made", component_dish_id: "d-syrup", qty_entered: "5" }),
      // An earlier Negroni version: history, never counted.
      line({ restaurant_id: A, version_id: "v-neg1", position: 0, label: "Old bitter" }),
      // Gimlet: "LIME  JUICE" folds with "Lime juice"; "Kampari" is a different name.
      line({ restaurant_id: A, version_id: "v-gim1", position: 0, label: "LIME  JUICE" }),
      line({ restaurant_id: A, version_id: "v-gim1", position: 1, label: "campari" }),
      // A deleted drink's line.
      line({ restaurant_id: A, version_id: "v-old1", position: 0, label: "Campari" }),
      // House B: never read for A.
      line({ restaurant_id: B, version_id: "v-b1", position: 0, label: "Campari" }),
      line({ restaurant_id: A, version_id: "v-neg2", position: 5, label: "Lime juice" }),
    ],
    restaurant_inventory: [
      { id: "i-camp", restaurant_id: A, display_name: "Campari 700 ml", kind: "spirit", uom: "ml", bottle_size_ml: 700, is_active: true, deleted_at: null },
      { id: "i-camp-a", restaurant_id: A, display_name: "CAMPARI", kind: "spirit", uom: "ml", bottle_size_ml: 1000, is_active: true, deleted_at: null },
      { id: "i-lime1", restaurant_id: A, display_name: "Lime juice", kind: "mixer", uom: "ml", bottle_size_ml: null, is_active: true, deleted_at: null },
      { id: "i-lime2", restaurant_id: A, display_name: "lime juice", kind: "mixer", uom: "ml", bottle_size_ml: null, is_active: true, deleted_at: null },
      { id: "i-verm-b", restaurant_id: B, display_name: "Sweet vermouth", kind: "wine", uom: "ml", bottle_size_ml: 750, is_active: true, deleted_at: null },
    ],
  };
}

describe("loose lines: grouping", () => {
  it("groups this house's current loose lines by folded name and proposes the one good of that name", async () => {
    const out = await svc(house()).looseLines(A);
    expect(out.lineCount).toBe(5);
    expect(out.drinkCount).toBe(2);
    const byKey = Object.fromEntries(out.groups.map((g) => [g.key, g]));
    expect(Object.keys(byKey).sort()).toEqual(["campari", "lime juice", "sweet vermouth"]);
    // Gimlet sorts before Negroni; each place is the line's index in the drink's ordered lines.
    expect(byKey.campari.lines).toEqual([
      { cocktailId: "c-gim", index: 1, baseUnit: "ml10" },
      { cocktailId: "c-neg", index: 2, baseUnit: "ml10" },
    ]);
    expect(byKey.campari.drinkCount).toBe(2);
    // One live good folds to "campari": proposed.
    expect(byKey.campari.proposed?.id).toBe("i-camp-a");
    expect(byKey.campari.sameName).toBe(1);
    // Two goods of one name: none proposed.
    expect(byKey["lime juice"].proposed).toBeNull();
    expect(byKey["lime juice"].sameName).toBe(2);
    expect(out.groups[0].key).toBe("campari");
  });

  it("never reads another house: its lines, drinks and shelf goods are not seen", async () => {
    const out = await svc(house()).looseLines(A);
    expect(out.drinks.map((d) => d.cocktailId)).not.toContain("c-b");
    // House B has a "Sweet vermouth" good; house A's vermouth line gets no proposal from it.
    const verm = out.groups.find((g) => g.key === "sweet vermouth");
    expect(verm?.proposed).toBeNull();
    expect(verm?.sameName).toBe(0);
    // Every read of every table names the house, even where a later read would also drop the row.
    const { db, reads } = fakeDb(house());
    await new LooseLinesService(db, new DishesService(db, null as any)).looseLines(A);
    expect(new Set(reads.map((r) => r.table))).toEqual(
      new Set(["recipe_lines", "recipe_current", "cocktails", "recipe_versions", "restaurant_inventory"]),
    );
    expect(reads.filter((r) => r.house !== A)).toEqual([]);
    const theirs = await svc(house()).looseLines(B);
    expect(theirs.drinks.map((d) => d.cocktailId)).toEqual(["c-b"]);
    expect(theirs.groups.map((g) => g.proposed)).toEqual([null]);
  });

  it("counts only current versions of live drinks", async () => {
    const out = await svc(house()).looseLines(A);
    expect(out.groups.flatMap((g) => g.lines).map((l) => l.cocktailId)).not.toContain("c-old");
    expect(out.groups.map((g) => g.key)).not.toContain("old bitter");
  });

  it("returns each affected drink whole, in the PUT's own shape, ordered by position", async () => {
    const out = await svc(house()).looseLines(A);
    const neg = out.drinks.find((d) => d.cocktailId === "c-neg")!;
    expect(neg).toMatchObject({ name: "Negroni", versionId: "v-neg2", yieldServes: 1, method: "Stir", glass: "Rocks", garnish: null });
    expect(neg.lines).toEqual([
      { role: "stocked", componentId: null, inventoryId: "i-gin", label: "Gin", qty: 30, unit: "ml", usablePct: null },
      { role: "stocked", componentId: null, inventoryId: null, label: "Sweet vermouth", qty: 30, unit: "ml", usablePct: 90 },
      { role: "stocked", componentId: null, inventoryId: null, label: "Campari", qty: 25, unit: "ml", usablePct: null },
      { role: "untracked", componentId: null, inventoryId: null, label: "Orange twist", qty: 1, unit: "each", usablePct: null },
      { role: "made", componentId: "d-syrup", inventoryId: null, label: "Syrup", qty: 5, unit: "ml", usablePct: null },
      { role: "stocked", componentId: null, inventoryId: null, label: "Lime juice", qty: 30, unit: "ml", usablePct: null },
    ]);
  });

  it("each line carries every field the PUT takes, so a field added to the save is not dropped by a link", async () => {
    const out = await svc(house()).looseLines(A);
    const props = (Reflect.getMetadata("swagger/apiModelPropertiesArray", RecipeLineDto.prototype) as string[]).map((p) => p.replace(/^:/, ""));
    for (const d of out.drinks) for (const l of d.lines) expect(Object.keys(l).sort()).toEqual([...props].sort());
  });

  it("reads past the 1,000-row cap: 1,200 loose lines in 40 drinks are all counted", async () => {
    const t: Tables = { cocktails: [], recipe_current: [], recipe_versions: [], recipe_lines: [], restaurant_inventory: [] };
    for (let d = 0; d < 40; d++) {
      const c = `c-${String(d).padStart(3, "0")}`;
      const v = `v-${c}`;
      t.cocktails.push({ id: c, restaurant_id: A, name: `Drink ${d}`, display_name: null, deleted_at: null });
      t.recipe_current.push({ restaurant_id: A, cocktail_id: c, version_id: v });
      t.recipe_versions.push({ id: v, restaurant_id: A, cocktail_id: c, yield_serves: 1, method: null, glass: null, garnish: null });
      for (let i = 0; i < 30; i++) t.recipe_lines.push(line({ restaurant_id: A, version_id: v, position: i, label: `Good ${i}` }));
    }
    for (let i = 0; i < 1100; i++) {
      t.restaurant_inventory.push({ id: `i-${i}`, restaurant_id: A, display_name: `Shelf ${i}`, kind: null, uom: "ml", bottle_size_ml: null, is_active: true, deleted_at: null });
    }
    t.restaurant_inventory.push({ id: "i-last", restaurant_id: A, display_name: "Good 29", kind: null, uom: "ml", bottle_size_ml: null, is_active: true, deleted_at: null });
    const out = await svc(t).looseLines(A);
    expect(out.lineCount).toBe(1200);
    expect(out.drinkCount).toBe(40);
    expect(out.groups).toHaveLength(30);
    expect(out.groups.every((g) => g.lines.length === 40)).toBe(true);
    // The shelf good past the first 1,000 is still found.
    expect(out.groups.find((g) => g.key === "good 29")?.proposed?.id).toBe("i-last");
  });

  it("a house with no loose line answers an empty queue", async () => {
    const t = house();
    t.recipe_lines = t.recipe_lines.filter((l) => l.inventory_id || l.role !== "stocked");
    expect(await svc(t).looseLines(A)).toEqual({ lineCount: 0, drinkCount: 0, dishCount: 0, groups: [], drinks: [] });
  });
});

describe("loose lines: ?linkedTo= a good (r108 drinks-g10, swap a good)", () => {
  function withDishes(): Tables {
    const t = house();
    t.restaurant_inventory.push({ id: "i-gin", restaurant_id: A, display_name: "Gin 700 ml", kind: "spirit", uom: "bottle", bottle_size_ml: 700, is_active: true, deleted_at: null });
    t.recipe_lines.push(
      line({ restaurant_id: A, version_id: "v-gim1", position: 2, label: "Gin", inventory_id: "i-gin", unit_code: "each", base_unit: "each_milli", qty_entered: "1" }),
      line({ restaurant_id: A, version_id: "v-neg1", position: 0, label: "Gin", inventory_id: "i-gin" }),
      line({ restaurant_id: A, version_id: "v-dish1", position: 0, label: "Gin", inventory_id: "i-gin" }),
      line({ restaurant_id: A, version_id: "v-dish2", position: 0, label: "Gin", inventory_id: "i-gin" }),
      line({ restaurant_id: A, version_id: "v-dish3", position: 0, label: "Gin", inventory_id: "i-gin" }),
    );
    t.recipe_current_dish = [
      { restaurant_id: A, dish_id: "d-1", version_id: "v-dish1" },
      { restaurant_id: A, dish_id: "d-2", version_id: "v-dish2" },
      { restaurant_id: B, dish_id: "d-b", version_id: "v-dish3" },
    ];
    t.dishes = [
      { id: "d-1", restaurant_id: A, deleted_at: null },
      { id: "d-2", restaurant_id: A, deleted_at: "2026-02-02" },
      { id: "d-b", restaurant_id: B, deleted_at: null },
    ];
    return t;
  }

  it("lists the lines that pour from the good in current drink versions, with each line's base unit", async () => {
    const out = await svc(withDishes()).looseLines(A, "i-gin");
    expect(out.lineCount).toBe(2);
    expect(out.drinkCount).toBe(2);
    expect(out.groups.flatMap((g) => g.lines)).toEqual([
      { cocktailId: "c-gim", index: 2, baseUnit: "each_milli" },
      { cocktailId: "c-neg", index: 0, baseUnit: "ml10" },
    ]);
    // The whole versions come back, in the PUT's shape, linked lines and all.
    expect(out.drinks.map((d) => d.cocktailId)).toEqual(["c-gim", "c-neg"]);
    expect(out.drinks[1].lines[0]).toEqual({ role: "stocked", componentId: null, inventoryId: "i-gin", label: "Gin", qty: 30, unit: "ml", usablePct: null });
  });

  it("counts the live dishes of this house that use it too, and changes none", async () => {
    const out = await svc(withDishes()).looseLines(A, "i-gin");
    expect(out.dishCount).toBe(1);
    expect(out.drinks.map((d) => d.cocktailId)).not.toContain("d-1");
  });

  it("another house's good is not found, and every read names the house", async () => {
    await expect(svc(withDishes()).looseLines(A, "i-verm-b")).rejects.toMatchObject({ status: 404 });
    const { db, reads } = fakeDb(withDishes());
    await new LooseLinesService(db, new DishesService(db, null as any)).looseLines(A, "i-gin");
    expect(reads.map((r) => r.table)).toEqual(expect.arrayContaining(["restaurant_inventory", "recipe_current_dish", "dishes"]));
    expect(reads.filter((r) => r.house !== A)).toEqual([]);
  });

  it("without linkedTo the queue is the loose lines only: a linked line is never in it", async () => {
    const out = await svc(withDishes()).looseLines(A);
    expect(out.groups.map((g) => g.key)).not.toContain("gin");
    expect(out.dishCount).toBe(0);
  });
});

describe("loose lines: who reads them", () => {
  let app: INestApplication;
  let base: string;
  const calls: string[] = [];
  const linked: unknown[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LooseLinesController],
      providers: [{ provide: LooseLinesService, useValue: { looseLines: async (r: string, l?: string) => (calls.push(r), l && linked.push(l), { lineCount: 0 }) } }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const role = req.headers["x-test-role"];
          if (!role) return false;
          req.user = { userId: `user-${role}`, restaurantId: A, role };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    base = await app.getUrl();
  });
  afterAll(() => app.close());

  const get = (role: string, qs = "") => fetch(`${base}/recipes/${A}/drinks/loose-lines${qs}`, { headers: { "x-test-role": role } });

  it("passes ?linkedTo= on, and refuses one that is not an id with 400", async () => {
    calls.length = 0;
    expect((await get("manager", "?linkedTo=not-an-id")).status).toBe(400);
    expect(calls).toEqual([]);
    expect((await get("manager", `?linkedTo=${B}`)).status).toBe(200);
    expect(linked).toEqual([B]);
  });

  it("refuses staff with 403 and never reaches the service", async () => {
    calls.length = 0;
    expect((await get("staff")).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it.each(["owner", "manager"])("answers a %s", async (role) => {
    calls.length = 0;
    const r = await get(role);
    expect(r.status).toBe(200);
    expect(calls).toEqual([A]);
  });
});
