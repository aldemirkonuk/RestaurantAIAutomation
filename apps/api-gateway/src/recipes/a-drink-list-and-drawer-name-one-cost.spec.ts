/**
 * r106 drinks-1 (walk FAIL 15): the list and the drawer name one cost for a
 * drink that has a made line. Sour Test: 50 ml gin and 30 ml House Sour Mix
 * (a batch of 1,750 g sugar at 2.00 a kg, made to 1,000 ml, so 3.50 a litre).
 * 30 ml of the mix costs 0.105; with the gin at 0.01 a ml the serve is 0.605.
 */
import { DishesService } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { HOUSE_A, FLOUR, fakeDb, twoHouses, line, type Row } from "./dishes.testing";

const GIN = "f0000000-0000-4000-8000-0000000000c1";
const SOUR = "c0000000-0000-4000-8000-0000000000c1";
const MIX = "d0000000-0000-4000-8000-0000000000c9";
const V_SOUR = "e0000000-0000-4000-8000-0000000000c9";
const V_MIX = "e0000000-0000-4000-8000-0000000000ca";

function sourTest(): Record<string, Row[]> {
  const rows = twoHouses();
  rows.restaurant_inventory.push({ id: GIN, restaurant_id: HOUSE_A, display_name: "Gin", kind: "spirit", uom: "bottle", bottle_size_ml: 700, last_purchase_price: 7, is_active: true, deleted_at: null });
  rows.cocktails = [{ id: SOUR, restaurant_id: HOUSE_A, name: "Sour Test", display_name: null, price: 12, deleted_at: null }];
  rows.recipe_current = [{ cocktail_id: SOUR, version_id: V_SOUR, restaurant_id: HOUSE_A }];
  rows.dishes.push({ id: MIX, restaurant_id: HOUSE_A, name: "House Sour Mix", yield_qty_base: 10_000, yield_base_unit: "ml10", deleted_at: null });
  rows.recipe_current_dish.push({ dish_id: MIX, version_id: V_MIX, restaurant_id: HOUSE_A });
  rows.recipe_versions.push(
    { id: V_SOUR, restaurant_id: HOUSE_A, cocktail_id: SOUR, owner_kind: "cocktail", version: 1, yield_serves: 1, created_at: "2026-11-02" },
    { id: V_MIX, restaurant_id: HOUSE_A, dish_id: MIX, owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" },
  );
  rows.recipe_lines.push(
    line("m1", V_MIX, HOUSE_A, 1, "Sugar", FLOUR, { qty_entered: 1750, qty_base: 1_750_000 }),
    line("g1", V_SOUR, HOUSE_A, 1, "Gin", GIN, { qty_entered: 50, unit_code: "ml", qty_base: 500, base_unit: "ml10" }),
    line("g2", V_SOUR, HOUSE_A, 2, "House Sour Mix", null, { role: "made", component_dish_id: MIX, qty_entered: 30, unit_code: "ml", qty_base: 300, base_unit: "ml10" }),
  );
  rows.cocktail_ingredients = [];
  rows.item_nutrition = [];
  rows.item_allergens = [];
  rows.inventory_lot_agreed_cost = [];
  rows.inventory_lot_invoice_cost = [];
  return rows;
}

async function both(rows: Record<string, Row[]>, role = "owner") {
  const { db } = fakeDb(rows);
  const list = (await new DishesService(db, new RecipesService(db)).drinkFigures(HOUSE_A, role)).drinks.find((d) => d.cocktailId === SOUR)!;
  const drawer = (await new RecipesService(db).getRecipe(HOUSE_A, SOUR, role)) as any;
  return { list, drawer };
}

describe("a drink with a made line: the list and the drawer name one cost", () => {
  it("both say 0.605 a serve, 2 of 2 priced, and the made line 0.105", async () => {
    const { list, drawer } = await both(sourTest());
    expect(drawer.current.lines[1]).toMatchObject({ role: "made", costPerServe: 0.11, costBasis: "component" });
    expect(drawer.cost).toMatchObject({ perServeExact: 0.605, priced: 2, of: 2, complete: true });
    expect(list.cost).toMatchObject({ perServeExact: 0.605, perServe: drawer.cost.perServe, priced: 2, of: 2, complete: true });
  });

  it("an unpriced component says '1 of 2 priced' in both, never a partial sum or nothing", async () => {
    const rows = sourTest();
    for (const l of rows.recipe_lines) if (l.id === "m1") l.inventory_id = null;
    const { list, drawer } = await both(rows);
    expect(drawer.cost).toMatchObject({ perServe: null, priced: 1, of: 2, complete: false });
    expect(list.cost).toMatchObject({ perServe: null, perServeExact: null, priced: 1, of: 2, complete: false });
  });

  it("staff see no cost in either", async () => {
    const { list, drawer } = await both(sourTest(), "staff");
    expect(list.cost).toBeNull();
    expect(drawer.cost).toBeNull();
  });
});

describe("at scale: many drinks drawing wide mixes (PostgREST's 1,000-row cap)", () => {
  // 30 drinks, each drawing its own made mix of 39 lines: 1,170 component lines,
  // more than one answer holds. The list must read every line, as the drawer does.
  function many(n: number, linesPer: number): { rows: Record<string, Row[]>; ids: string[] } {
    const rows = sourTest();
    const ids: string[] = [];
    const pad = (i: number, k: number) => `${k}0000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    for (let i = 0; i < n; i++) {
      const drink = pad(i + 1, "a");
      const mix = pad(i + 1, "b");
      const vd = pad(i + 1, "c");
      const vm = pad(i + 1, "d");
      ids.push(drink);
      rows.cocktails.push({ id: drink, restaurant_id: HOUSE_A, name: `Drink ${i}`, display_name: null, price: 12, deleted_at: null });
      rows.recipe_current.push({ cocktail_id: drink, version_id: vd, restaurant_id: HOUSE_A });
      rows.dishes.push({ id: mix, restaurant_id: HOUSE_A, name: `Mix ${i}`, yield_qty_base: 10_000, yield_base_unit: "ml10", deleted_at: null });
      rows.recipe_current_dish.push({ dish_id: mix, version_id: vm, restaurant_id: HOUSE_A });
      rows.recipe_versions.push(
        { id: vd, restaurant_id: HOUSE_A, cocktail_id: drink, owner_kind: "cocktail", version: 1, yield_serves: 1, created_at: "2026-11-02" },
        { id: vm, restaurant_id: HOUSE_A, dish_id: mix, owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" },
      );
      rows.recipe_lines.push(line(`d${i}`, vd, HOUSE_A, 1, "Mix", null, { role: "made", component_dish_id: mix, qty_entered: 30, unit_code: "ml", qty_base: 300, base_unit: "ml10" }));
      for (let k = 0; k < linesPer; k++) rows.recipe_lines.push(line(`m${i}-${k}`, vm, HOUSE_A, k + 1, "Sugar", FLOUR, { qty_entered: 10, qty_base: 10_000 }));
    }
    return { rows, ids };
  }

  it("the list names the drawer's cost for every drink, none cut short", async () => {
    const { rows, ids } = many(30, 39);
    expect(rows.recipe_lines.filter((l) => l.id.startsWith("m")).length).toBeGreaterThan(1000);
    const { db } = fakeDb(rows);
    const recipes = new RecipesService(db);
    const list = (await new DishesService(db, recipes).drinkFigures(HOUSE_A, "owner")).drinks;
    for (const id of ids) {
      const drawer = (await recipes.getRecipe(HOUSE_A, id, "owner")) as any;
      const row = list.find((d) => d.cocktailId === id)!;
      expect(row.cost).toMatchObject({ perServeExact: drawer.cost.perServeExact, priced: drawer.cost.priced, of: drawer.cost.of, complete: drawer.cost.complete });
      expect(row.cost?.complete).toBe(true);
    }
  });

  it("wider mixes (whole mixes past the cap) still read, never 'not known'", async () => {
    const { rows, ids } = many(30, 60);
    const { db } = fakeDb(rows);
    const list = (await new DishesService(db, new RecipesService(db)).drinkFigures(HOUSE_A, "owner")).drinks;
    for (const id of ids) expect(list.find((d) => d.cocktailId === id)!.cost).toMatchObject({ complete: true });
  });
});
