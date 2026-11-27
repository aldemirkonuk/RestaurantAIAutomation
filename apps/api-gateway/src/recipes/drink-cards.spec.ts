/**
 * The spec book (r108 drinks-g7): GET recipes/:rid/drinks/cards answers every drink with a current recipe as one
 * printable card, for any signed-in role, with NO money, and reads the house's rows only, in chunks of 100 ids,
 * paged past PostgREST's 1,000-row cap. The fake client applies eq / is / in / range and the cap.
 */
import { INestApplication, ServiceUnavailableException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DishesController } from "./dishes.controller";
import { DishesService, DRINK_CARDS_UNREAD } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { ALLERGENS } from "./recipe-nutrition";
import { FLOUR, HOUSE_A, HOUSE_B, SOUP, fakeDb, type Row } from "./dishes.testing";

const GIN = "f0000000-0000-4000-8000-0000000000c1";
const B_GIN = "f0000000-0000-4000-8000-0000000000c2";
const NEGRONI = "c0000000-0000-4000-8000-0000000000a1";
const SOUR = "c0000000-0000-4000-8000-0000000000a2";
const NO_RECIPE = "c0000000-0000-4000-8000-0000000000a3";
const B_DRINK = "c0000000-0000-4000-8000-0000000000b1";
const V_NEGRONI = "e0000000-0000-4000-8000-0000000000c1";
const V_SOUR = "e0000000-0000-4000-8000-0000000000c2";
const V_B = "e0000000-0000-4000-8000-0000000000c9";

const lineRow = (id: string, version: string, house: string, position: number, label: string, item: string | null, extra: Row = {}): Row => ({
  id, version_id: version, restaurant_id: house, position, role: "stocked", inventory_id: item, label,
  qty_entered: 30, unit_code: "ml", qty_base: 300, base_unit: "ml10", ...extra,
});

function rows(): Record<string, Row[]> {
  return {
    cocktails: [
      { id: NEGRONI, restaurant_id: HOUSE_A, name: "negroni", display_name: "Negroni", menu_section: "Aperitivo", glass: "Rocks", garnish: "Orange", method: "Stir", price: 12, deleted_at: null },
      { id: SOUR, restaurant_id: HOUSE_A, name: "Whisky sour", display_name: null, menu_section: null, glass: null, garnish: null, method: null, price: 11, deleted_at: null },
      { id: NO_RECIPE, restaurant_id: HOUSE_A, name: "Unwritten", display_name: null, menu_section: "Aperitivo", glass: null, garnish: null, method: null, price: 9, deleted_at: null },
      { id: B_DRINK, restaurant_id: HOUSE_B, name: "B-ONLY martini", display_name: null, menu_section: "B", glass: null, garnish: null, method: null, price: 777, deleted_at: null },
    ],
    recipe_current: [
      { cocktail_id: NEGRONI, version_id: V_NEGRONI, restaurant_id: HOUSE_A },
      { cocktail_id: SOUR, version_id: V_SOUR, restaurant_id: HOUSE_A },
      { cocktail_id: B_DRINK, version_id: V_B, restaurant_id: HOUSE_B },
    ],
    recipe_versions: [
      { id: V_NEGRONI, restaurant_id: HOUSE_A, cocktail_id: NEGRONI, version: 4, yield_serves: 1, method: "Stir with ice", glass: "Coupe", garnish: null, created_at: "2026-11-07T10:00:00Z" },
      { id: V_SOUR, restaurant_id: HOUSE_A, cocktail_id: SOUR, version: 1, yield_serves: 1, method: null, glass: null, garnish: null, created_at: "2026-11-02T10:00:00Z" },
      { id: V_B, restaurant_id: HOUSE_B, cocktail_id: B_DRINK, version: 1, yield_serves: 1, method: "B-SECRET method", glass: null, garnish: null, created_at: "2026-11-02T10:00:00Z" },
    ],
    recipe_lines: [
      lineRow("l1", V_NEGRONI, HOUSE_A, 2, "vermouth", null),
      lineRow("l2", V_NEGRONI, HOUSE_A, 1, "gin", GIN),
      lineRow("l3", V_SOUR, HOUSE_A, 1, "Lemon juice", null, { role: "untracked" }),
      lineRow("l4", V_B, HOUSE_B, 1, "B-SECRET gin", B_GIN),
    ],
    restaurant_inventory: [
      { id: GIN, restaurant_id: HOUSE_A, display_name: "Plymouth gin" },
      { id: B_GIN, restaurant_id: HOUSE_B, display_name: "B-SECRET gin" },
    ],
    item_allergens: ALLERGENS.map((a, i) => ({
      id: `a0000000-0000-4000-8000-${String(i).padStart(12, "0")}`, restaurant_id: HOUSE_A, inventory_id: GIN, allergen: a, status: a === "sulphites" ? "contains" : "free",
    })),
    dishes: [{ id: SOUP, restaurant_id: HOUSE_A, name: "House syrup", deleted_at: null }],
  };
}

const service = (r = rows()) => {
  const fake = fakeDb(r);
  return { svc: new DishesService(fake.db, new RecipesService(fake.db)), ...fake };
};

describe("the spec book (drinks/cards)", () => {
  it("answers every drink with a current recipe, with its lines and the version's own glass, method and date", async () => {
    const { drinks } = await service().svc.drinkCards(HOUSE_A);
    expect(drinks.map((d) => d.name).sort()).toEqual(["Negroni", "Whisky sour"]);
    const n = drinks.find((d) => d.cocktailId === NEGRONI)!;
    expect(n).toMatchObject({ section: "Aperitivo", glass: "Coupe", method: "Stir with ice", garnish: "Orange", yieldServes: 1, version: 4, versionDate: "2026-11-07T10:00:00Z" });
    // In recipe order, each with the good it names where it names one.
    expect(n.lines).toEqual([
      { label: "gin", qty: 30, unit: "ml", name: "Plymouth gin" },
      { label: "vermouth", qty: 30, unit: "ml", name: null },
    ]);
  });

  it("a made line names its component", async () => {
    const r = rows();
    r.recipe_lines.push(lineRow("l5", V_SOUR, HOUSE_A, 2, "syrup", null, { role: "made", component_dish_id: SOUP }));
    const { drinks } = await service(r).svc.drinkCards(HOUSE_A);
    expect(drinks.find((d) => d.cocktailId === SOUR)!.lines.map((l) => l.name)).toEqual([null, "House syrup"]);
  });

  it("carries the allergens by the sheet's own rule: contains, and the lines that leave one unstated named", async () => {
    const n = (await service().svc.drinkCards(HOUSE_A)).drinks.find((d) => d.cocktailId === NEGRONI)!;
    expect(n.allergens).toMatchObject({ readable: true, unstatedBy: ["vermouth"] });
    expect((n.allergens as any).status.sulphites).toBe("contains");
    expect((n.allergens as any).status.gluten).toBe("not_stated");
  });

  it("a failed allergen read says so on the card and never reads as allergen-free", async () => {
    const r = rows();
    const fake = fakeDb(r);
    const real = (fake.db.getClient() as any).from;
    (fake.db.getClient() as any).from = (t: string) => {
      const q = real(t);
      if (t === "item_allergens") q.then = (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "boom" } });
      return q;
    };
    const svc = new DishesService(fake.db, new RecipesService(fake.db));
    const n = (await svc.drinkCards(HOUSE_A)).drinks.find((d) => d.cocktailId === NEGRONI)!;
    expect(n.allergens).toEqual({ readable: false });
  });

  // r109 drinks-2 (DD-r107-40): the house's database has no item_allergens yet (#2119, schema gap #922).
  it("with no item_allergens table every card says its read failed, none free, and the book is still whole", async () => {
    const fake = fakeDb(rows());
    const real = (fake.db.getClient() as any).from;
    (fake.db.getClient() as any).from = (t: string) => {
      const q = real(t);
      const gap = { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.item_allergens' in the schema cache" } };
      if (t === "item_allergens") q.then = (ok: (v: unknown) => unknown) => ok(gap);
      return q;
    };
    const { drinks } = await new DishesService(fake.db, new RecipesService(fake.db)).drinkCards(HOUSE_A);
    expect(drinks.map((d) => d.name).sort()).toEqual(["Negroni", "Whisky sour"]);
    for (const d of drinks) expect(d.allergens).toEqual({ readable: false });
    expect(drinks.find((d) => d.cocktailId === NEGRONI)!.lines).toHaveLength(2);
  });

  it("a drink whose lines name no good states nothing: every allergen not stated, its lines named, none free", async () => {
    const r = rows();
    r.recipe_lines = r.recipe_lines.filter((l) => l.version_id === V_SOUR);
    r.recipe_current = r.recipe_current.filter((p) => p.cocktail_id === SOUR);
    const { drinks } = await service(r).svc.drinkCards(HOUSE_A);
    const a = drinks[0].allergens as any;
    expect(a).toMatchObject({ readable: true, unstatedBy: ["Lemon juice"] });
    expect(ALLERGENS.every((k) => a.status[k] === "not_stated")).toBe(true);
  });

  it("reads only the house's own rows: another house's drink, line, good and version never appear", async () => {
    const r = rows();
    // A pointer of this house naming another house's version is not read as a recipe.
    // Even one that claims this drink as its own (a corrupt row), with its own B-SECRET line.
    const V_B2 = "e0000000-0000-4000-8000-0000000000c8";
    r.recipe_current.push({ cocktail_id: NO_RECIPE, version_id: V_B2, restaurant_id: HOUSE_A });
    r.recipe_versions.push({ id: V_B2, restaurant_id: HOUSE_B, cocktail_id: NO_RECIPE, version: 1, yield_serves: 1, method: "B-SECRET method", glass: null, garnish: null, created_at: "2026-11-02T10:00:00Z" });
    r.recipe_lines.push(lineRow("l9", V_B2, HOUSE_B, 1, "B-SECRET rum", B_GIN));
    const out = JSON.stringify(await service(r).svc.drinkCards(HOUSE_A));
    expect(out).not.toMatch(/B-ONLY|B-SECRET/);
    expect((await service(r).svc.drinkCards(HOUSE_A)).drinks.map((d) => d.cocktailId)).not.toContain(NO_RECIPE);
  });

  it("carries no money key at any depth, and none of the drinks' prices as a value", async () => {
    const keys: string[] = [];
    const nums: number[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "number") nums.push(v);
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.push(k), walk(x));
    };
    walk(await service().svc.drinkCards(HOUSE_A));
    expect(keys.filter((k) => /price|cost|margin|pour|money|tax/i.test(k))).toEqual([]);
    // The prices in the rows are 12, 11 and 9; the only numbers in a card are quantities, serves and versions.
    expect(nums.filter((n) => [12, 11, 9].includes(n))).toEqual([]);
  });

  it("pages past 1,000 rows: 1,200 lines on 30 versions, and 1,010 drinks", async () => {
    const r = rows();
    const lines: Row[] = [];
    const drinks: Row[] = [];
    const pointers: Row[] = [];
    const versions: Row[] = [];
    for (let d = 0; d < 1010; d++) {
      const id = `c1000000-0000-4000-8000-${String(d).padStart(12, "0")}`;
      const vid = `e1000000-0000-4000-8000-${String(d).padStart(12, "0")}`;
      drinks.push({ id, restaurant_id: HOUSE_A, name: `Drink ${d}`, display_name: null, menu_section: null, glass: null, garnish: null, method: null, price: 5, deleted_at: null });
      pointers.push({ cocktail_id: id, version_id: vid, restaurant_id: HOUSE_A });
      versions.push({ id: vid, restaurant_id: HOUSE_A, cocktail_id: id, version: 1, yield_serves: 1, method: null, glass: null, garnish: null, created_at: "2026-11-01T00:00:00Z" });
      // The first 30 drinks carry 40 lines each (1,200 in one chunk of versions); the rest carry one.
      const n = d < 30 ? 40 : 1;
      for (let p = 0; p < n; p++) lines.push(lineRow(`b${d}-${p}`, vid, HOUSE_A, p, `line ${p}`, null));
    }
    r.cocktails = drinks;
    r.recipe_current = pointers;
    r.recipe_versions = versions;
    r.recipe_lines = lines;
    const out = (await service(r).svc.drinkCards(HOUSE_A)).drinks;
    expect(out).toHaveLength(1010);
    expect(out.slice(0, 1).map((d) => d.lines.length)).toHaveLength(1);
    expect(out.filter((d) => d.name.startsWith("Drink ") && Number(d.name.slice(6)) < 30).every((d) => d.lines.length === 40)).toBe(true);
    expect(out.reduce((n, d) => n + d.lines.length, 0)).toBe(30 * 40 + 980);
  });

  it("sends ids in chunks of 100", async () => {
    const r = rows();
    const many: Row[] = [];
    for (let d = 0; d < 250; d++) many.push({ id: `c2000000-0000-4000-8000-${String(d).padStart(12, "0")}`, restaurant_id: HOUSE_A, name: `D${d}`, display_name: null, menu_section: null, glass: null, garnish: null, method: null, deleted_at: null });
    r.cocktails = many;
    r.recipe_current = [];
    const seen: number[] = [];
    const fake = fakeDb(r);
    const real = (fake.db.getClient() as any).from;
    (fake.db.getClient() as any).from = (t: string) => {
      const q = real(t);
      if (t === "recipe_current") {
        const inn = q.in;
        q.in = (c: string, vs: unknown[]) => (seen.push(vs.length), inn(c, vs));
      }
      return q;
    };
    await new DishesService(fake.db, new RecipesService(fake.db)).drinkCards(HOUSE_A);
    expect(seen.sort((a, b) => b - a)).toEqual([100, 100, 50]);
  });

  it("a failed read is a 503 with a sentence, never a shorter book", async () => {
    const fake = fakeDb(rows());
    const real = (fake.db.getClient() as any).from;
    (fake.db.getClient() as any).from = (t: string) => {
      const q = real(t);
      if (t === "recipe_lines") q.then = (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "boom" } });
      return q;
    };
    const svc = new DishesService(fake.db, new RecipesService(fake.db));
    await expect(svc.drinkCards(HOUSE_A)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(svc.drinkCards(HOUSE_A)).rejects.toThrow(DRINK_CARDS_UNREAD);
  });
});

describe("the spec book: any signed-in role reads the same book", () => {
  let app: INestApplication;
  let base: string;
  beforeAll(async () => {
    const fake = fakeDb(rows());
    const recipes = new RecipesService(fake.db);
    const moduleRef = await Test.createTestingModule({
      controllers: [DishesController],
      providers: [
        { provide: RecipesService, useValue: recipes },
        { provide: DishesService, useValue: new DishesService(fake.db, recipes) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const role = req.headers["x-test-role"];
          if (!role) return false;
          req.user = { userId: `user-${role}`, restaurantId: HOUSE_A, role };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    base = await app.getUrl();
  });
  afterAll(() => app.close());

  const read = async (role?: string) => {
    const res = await fetch(`${base}/recipes/${HOUSE_A}/drinks/cards`, { headers: role ? { "x-test-role": role } : {} });
    return { status: res.status, text: await res.text() };
  };

  it("staff, manager and owner read one and the same book, with no price in it", async () => {
    const [staff, manager, owner] = await Promise.all([read("staff"), read("manager"), read("owner")]);
    expect([staff.status, manager.status, owner.status]).toEqual([200, 200, 200]);
    expect(staff.text).toBe(owner.text);
    expect(manager.text).toBe(owner.text);
    expect(JSON.parse(owner.text).drinks).toHaveLength(2);
    expect(owner.text).not.toMatch(/price|cost|margin/i);
  });

  it("a caller who is not signed in is refused", async () => {
    expect((await read()).status).toBe(403);
  });
});
