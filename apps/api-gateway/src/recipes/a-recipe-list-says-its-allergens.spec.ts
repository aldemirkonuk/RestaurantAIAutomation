import { ALLERGEN_CHUNK, DishesService, rowAllergens } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { ALLERGENS } from "./recipe-nutrition";
import { FLOUR, HOUSE_A, HOUSE_B, SOUP, TART, V_TART_2, fakeDb, line, twoHouses, type Row } from "./dishes.testing";

/**
 * r36 recipes audit, gap 8: staff could not answer "which dishes have nuts"
 * without opening every sheet. The /dishes list and the /cocktails figures now
 * carry each recipe's allergens by the sheet's own rule (recipe-nutrition.ts):
 * free only when every line states it free, and the lines that leave one
 * unstated are named. Allergens are not money, so staff read them too. A
 * failed read says so on the row and never reads as allergen-free.
 */

const BUTTER = "f0000000-0000-4000-8000-0000000000d1";
const GIN = "f0000000-0000-4000-8000-0000000000c1";
const SOUR = "c0000000-0000-4000-8000-0000000000a2";
const V_SOUR = "e0000000-0000-4000-8000-0000000000c3";

/** Every one of the 14 allergens stated for an item, `free` unless named. */
function states(item: string, house: string, named: Record<string, string> = {}, idPrefix = item.slice(-4)): Row[] {
  return ALLERGENS.map((a, i) => ({
    id: `a${idPrefix}000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    restaurant_id: house,
    inventory_id: item,
    allergen: a,
    status: named[a] ?? "free",
  }));
}

function rows(): Record<string, Row[]> {
  const r = twoHouses();
  // The tart (current v2): Flour, Lemons (not linked), Flour for the base.
  // The soup: Stale bread (not linked).
  r.item_allergens = [...states(FLOUR, HOUSE_A, { gluten: "contains", sesame: "may_contain" })];
  return r;
}

function service(r = rows()) {
  const fake = fakeDb(r);
  return { dishes: new DishesService(fake.db, new RecipesService(fake.db)), ...fake };
}

describe("a recipe list says its allergens (gap 8)", () => {
  it("a dish contains what a line contains, and names the lines that leave one unstated", async () => {
    const tart = (await service().dishes.listDishes(HOUSE_A, "owner")).find((d) => d.id === TART)!;
    expect(tart.allergens).toMatchObject({ readable: true, unstatedBy: ["Lemons"] });
    const a = tart.allergens as Extract<typeof tart.allergens, { readable: true }>;
    expect(a.status.gluten).toBe("contains");
    expect(a.status.sesame).toBe("may_contain");
    // Flour states milk free, but the lemons say nothing: milk is not known, never free.
    expect(a.status.milk).toBe("not_stated");
  });

  it("a dish whose every line states every allergen is free of the ones none contains", async () => {
    const r = rows();
    r.recipe_lines = r.recipe_lines.filter((l) => !(l.version_id === V_TART_2 && l.label === "Lemons"));
    const tart = (await service(r).dishes.listDishes(HOUSE_A, "owner")).find((d) => d.id === TART)!;
    const a = tart.allergens as any;
    expect(a.unstatedBy).toEqual([]);
    expect(a.status.milk).toBe("free");
    expect(a.status.gluten).toBe("contains");
  });

  it("staff read the allergens, with no price and no cost", async () => {
    const tart = (await service().dishes.listDishes(HOUSE_A, "staff")).find((d) => d.id === TART)!;
    expect(tart.price).toBeNull();
    expect(tart.cost).toBeNull();
    expect((tart.allergens as any).status.gluten).toBe("contains");
  });

  it("another house's statement about an item is never read", async () => {
    const r = rows();
    r.item_allergens = states(FLOUR, HOUSE_B, {}, "bbbb");
    const tart = (await service(r).dishes.listDishes(HOUSE_A, "owner")).find((d) => d.id === TART)!;
    const a = tart.allergens as any;
    expect(a.status.gluten).toBe("not_stated");
    expect(a.unstatedBy).toEqual(["Flour", "Lemons", "Flour for the base"]);
  });

  it("a failed allergen read says so on each row, and the list and its costs still show", async () => {
    const fake = fakeDb(rows());
    const client: any = fake.db.getClient();
    const from = client.from;
    client.from = (t: string) => {
      const q = from(t);
      if (t === "item_allergens") q.then = (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "down" } });
      return q;
    };
    const out = await new DishesService(fake.db, new RecipesService(fake.db)).listDishes(HOUSE_A, "owner");
    const tart = out.find((d) => d.id === TART)!;
    expect(tart.allergens).toEqual({ readable: false });
    expect(tart.cost).toMatchObject({ priced: 2, of: 3 });
  });

  it("names a line by the label the list reads, so the line read asks for it", async () => {
    // The fake answers every column; PostgREST answers only the ones asked for.
    const fake = fakeDb(rows());
    const client: any = fake.db.getClient();
    const from = client.from;
    client.from = (t: string) => {
      const q = from(t);
      if (t !== "recipe_lines") return q;
      const select = q.select;
      q.select = (cols: string, o?: unknown) => {
        const keep = cols.split(",").map((c) => c.trim());
        const then = q.then;
        q.then = (ok: (v: any) => unknown) =>
          then((r: any) => ok({ ...r, data: (r.data ?? []).map((x: Row) => Object.fromEntries(keep.map((k) => [k, x[k]]))) }));
        return select(cols, o);
      };
      return q;
    };
    const out = await new DishesService(fake.db, new RecipesService(fake.db)).listDishes(HOUSE_A, "staff");
    expect((out.find((d) => d.id === TART)!.allergens as any).unstatedBy).toEqual(["Lemons"]);
  });

  it("a dish with no recipe says nothing of allergens", async () => {
    const r = rows();
    r.recipe_current_dish = r.recipe_current_dish.filter((p) => p.dish_id !== SOUP);
    const soup = (await service(r).dishes.listDishes(HOUSE_A, "owner")).find((d) => d.id === SOUP)!;
    expect(soup.hasRecipe).toBe(false);
    expect(soup.allergens).toBeNull();
  });

  it("reads every chunk of items: an item in the second chunk still states its allergens", async () => {
    const r = rows();
    const n = ALLERGEN_CHUNK + 10;
    const ids = Array.from({ length: n }, (_, i) => `f1000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    r.restaurant_inventory.push(...ids.map((id) => ({ id, restaurant_id: HOUSE_A, display_name: `Good ${id}`, kind: "food", uom: "g", is_active: true, deleted_at: null })));
    r.recipe_lines = r.recipe_lines.filter((l) => l.version_id !== V_TART_2);
    ids.forEach((id, i) => r.recipe_lines.push(line(`m${i}`, V_TART_2, HOUSE_A, i + 1, `Good ${i}`, id)));
    r.item_allergens = ids.flatMap((id, i) => states(id, HOUSE_A, i === n - 1 ? { tree_nuts: "contains" } : {}, String(i).padStart(4, "0")));
    const tart = (await service(r).dishes.listDishes(HOUSE_A, "owner")).find((d) => d.id === TART)!;
    const a = tart.allergens as any;
    expect(a.unstatedBy).toEqual([]);
    expect(a.status.tree_nuts).toBe("contains");
    expect(a.status.milk).toBe("free");
  });

  it("a drink's figures carry its allergens, for staff too", async () => {
    const r = rows();
    r.cocktails = [{ id: SOUR, restaurant_id: HOUSE_A, name: "Gin Sour", display_name: null, menu_section: null, price: 11, deleted_at: null }];
    r.recipe_current = [{ cocktail_id: SOUR, version_id: V_SOUR, restaurant_id: HOUSE_A }];
    r.recipe_versions.push({ id: V_SOUR, restaurant_id: HOUSE_A, cocktail_id: SOUR, owner_kind: "cocktail", version: 1, yield_serves: 1 });
    r.recipe_lines.push(
      line("s1", V_SOUR, HOUSE_A, 1, "Gin", GIN, { qty_entered: 50, unit_code: "ml", qty_base: 500, base_unit: "ml10" }),
      line("s2", V_SOUR, HOUSE_A, 2, "Egg white", BUTTER, { qty_entered: 20, unit_code: "ml", qty_base: 200, base_unit: "ml10" }),
    );
    r.item_allergens = [...states(GIN, HOUSE_A), ...states(BUTTER, HOUSE_A, { eggs: "contains" })];
    const out = await service(r).dishes.drinkFigures(HOUSE_A, "staff");
    const sour = out.drinks.find((d) => d.cocktailId === SOUR)!;
    expect(sour.price).toBeNull();
    expect(sour.allergens).toMatchObject({ readable: true, unstatedBy: [] });
    expect((sour.allergens as any).status.eggs).toBe("contains");
    expect((sour.allergens as any).status.gluten).toBe("free");
  });
});

describe("rowAllergens", () => {
  it("an untracked line leaves every allergen unstated", () => {
    const out = rowAllergens(
      [{ label: "Garnish", role: "untracked", inventory_id: null, qty_base: 1, base_unit: "each_milli" }],
      1,
      new Map(),
    );
    expect(out).toMatchObject({ readable: true, unstatedBy: ["Garnish"] });
    expect((out as any).status.gluten).toBe("not_stated");
  });

  it("no statements read is not readable, never free", () => {
    expect(rowAllergens([], 1, null)).toEqual({ readable: false });
  });
});
