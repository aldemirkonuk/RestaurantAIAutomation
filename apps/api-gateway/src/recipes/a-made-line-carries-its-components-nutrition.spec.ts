/**
 * r110 inventory g2: a recipe's nutrition card and its allergens count a made
 * line through its component. A drink with house orgeat contains nuts; its
 * energy is `qtyBase / yield` of the batch's, never "unknown for House
 * orgeat" when the batch says what it holds. Through the real services over
 * the fake that filters by house and caps at 1,000 rows; the list's allergen
 * column and the sheet use one helper and must say the same.
 */
import { ALLERGENS } from "./recipe-nutrition";
import { DishesService } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { HOUSE_A, HOUSE_B, TART, V_TART_2, fakeDb, figuredDishes, line, twoHouses, type Row } from "./dishes.testing";

const SUGAR = "f0000000-0000-4000-8000-0000000000a3";
const ALMOND = "f0000000-0000-4000-8000-0000000000e1";
const SYRUP = "d0000000-0000-4000-8000-0000000000c1";
const BATCH = "d0000000-0000-4000-8000-0000000000c2";
const ORGEAT = "d0000000-0000-4000-8000-0000000000c3";
const V_SYRUP = "e0000000-0000-4000-8000-0000000000c1";
const V_BATCH = "e0000000-0000-4000-8000-0000000000c2";
const V_ORGEAT = "e0000000-0000-4000-8000-0000000000c3";

const states = (item: string, house: string, named: Record<string, string> = {}): Row[] =>
  ALLERGENS.map((a, i) => ({ id: `${item.slice(-4)}-${house.slice(0, 2)}-${String(i).padStart(3, "0")}`, restaurant_id: house, inventory_id: item, allergen: a, status: named[a] ?? "free" }));
const per100g = (item: string, f: Record<string, number | null>) => ({
  inventory_id: item, restaurant_id: HOUSE_A, basis: "100g", energy_kcal: null, fat_g: null, saturates_g: null, carbohydrate_g: null,
  sugars_g: null, protein_g: null, salt_g: null, abv_pct: null, energy_from_abv: false, ...f,
});
const madeLine = (id: string, version: string, component: string, label: string, qtyBase: number, baseUnit = "ml10") =>
  line(id, version, HOUSE_A, 1, label, null, { role: "made", component_dish_id: component, qty_entered: qtyBase / 10, unit_code: "ml", qty_base: qtyBase, base_unit: baseUnit });

/** The tart (one serve) takes 40 ml of syrup; the syrup is 500 g of sugar made to 700 ml. */
function house(): Record<string, Row[]> {
  const rows = twoHouses();
  rows.restaurant_inventory.push({ id: ALMOND, restaurant_id: HOUSE_A, display_name: "Almonds", kind: "food", uom: "g", is_active: true, deleted_at: null });
  rows.dishes.push(
    { id: SYRUP, restaurant_id: HOUSE_A, name: "Simple syrup", yield_qty_base: 7000, yield_base_unit: "ml10", deleted_at: null },
    { id: BATCH, restaurant_id: HOUSE_A, name: "Sour batch", yield_qty_base: 10_000, yield_base_unit: "ml10", deleted_at: null },
    { id: ORGEAT, restaurant_id: HOUSE_A, name: "House orgeat", yield_qty_base: null, yield_base_unit: null, deleted_at: null },
  );
  rows.recipe_current_dish.push(
    { dish_id: SYRUP, version_id: V_SYRUP, restaurant_id: HOUSE_A },
    { dish_id: BATCH, version_id: V_BATCH, restaurant_id: HOUSE_A },
    { dish_id: ORGEAT, version_id: V_ORGEAT, restaurant_id: HOUSE_A },
  );
  for (const [id, dish] of [[V_SYRUP, SYRUP], [V_BATCH, BATCH], [V_ORGEAT, ORGEAT]]) {
    rows.recipe_versions.push({ id, restaurant_id: HOUSE_A, dish_id: dish, owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" });
  }
  rows.recipe_lines = [
    line("s1", V_SYRUP, HOUSE_A, 1, "Sugar", SUGAR, { qty_entered: 500, qty_base: 500_000 }),
    line("b1", V_BATCH, HOUSE_A, 1, "Simple syrup", null, { role: "made", component_dish_id: SYRUP, qty_entered: 350, unit_code: "ml", qty_base: 3500, base_unit: "ml10" }),
    line("o1", V_ORGEAT, HOUSE_A, 1, "Almonds", ALMOND, { qty_entered: 200, qty_base: 200_000 }),
    line("o2", V_ORGEAT, HOUSE_A, 2, "Sugar", SUGAR, { qty_entered: 200, qty_base: 200_000 }),
    madeLine("t1", V_TART_2, SYRUP, "House syrup", 400),
  ];
  for (const v of rows.recipe_versions) if (v.id === V_TART_2) v.yield_serves = 1;
  rows.item_nutrition = [
    per100g(SUGAR, { energy_kcal: 400, fat_g: 0, saturates_g: 0, carbohydrate_g: 100, sugars_g: 100, protein_g: 0, salt_g: 0 }),
    per100g(ALMOND, { energy_kcal: 600, fat_g: 50, saturates_g: 4, carbohydrate_g: 20, sugars_g: 4, protein_g: 21, salt_g: 0 }),
  ];
  rows.item_allergens = [...states(SUGAR, HOUSE_A), ...states(ALMOND, HOUSE_A, { tree_nuts: "contains" }), ...states(SUGAR, HOUSE_B, { milk: "contains" })];
  rows.inventory_lot_agreed_cost = [];
  rows.inventory_lot_invoice_cost = [];
  return rows;
}

const sheet = async (rows: Record<string, Row[]>) => ((await new RecipesService(fakeDb(rows).db).getDishRecipe(HOUSE_A, TART, "owner")) as any).whatIsIn;
const listRow = async (rows: Record<string, Row[]>) => {
  const fake = fakeDb(rows);
  return (await figuredDishes(new DishesService(fake.db, new RecipesService(fake.db)), HOUSE_A, "staff")).find((d) => d.id === TART)!.allergens as any;
};
const takes = (rows: Record<string, Row[]>, over: Row) => {
  for (const l of rows.recipe_lines) if (l.id === "t1") Object.assign(l, over);
  return rows;
};

describe("a made line carries its component's nutrition (r110 inventory g2)", () => {
  it("40 ml of a 700 ml syrup made from 500 g of sugar gives 28.57 g of sugar and 114.29 kcal, through Simple syrup", async () => {
    const w = await sheet(house());
    expect(w.readable).toBe(true);
    expect(w.figures.sugarsG).toEqual({ value: 28.57, atLeast: false, missing: [] });
    expect(w.figures.energyKcal).toEqual({ value: 114.29, atLeast: false, missing: [] });
    expect(w.notCounted).toEqual([]);
    expect(w.through).toEqual([{ label: "House syrup", componentName: "Simple syrup" }]);
    expect(w.counted).toBe(1);
  });

  it("house orgeat with no yield set still says it contains nuts; its figures are named not counted", async () => {
    const w = await sheet(takes(house(), { component_dish_id: ORGEAT, label: "House orgeat" }));
    expect(w.allergens.tree_nuts).toBe("contains");
    expect(w.allergens.milk).toBe("free");
    expect(w.allergensUnstatedBy).toEqual([]);
    expect(w.notCounted).toEqual([{ label: "House orgeat", why: "House orgeat has no yield set, so its figures are not counted; its allergens are" }]);
    expect(w.figures.energyKcal).toMatchObject({ value: null, missing: ["House orgeat"] });
  });

  it("a made line in another unit than its batch is made in counts no figure, and still its allergens", async () => {
    const w = await sheet(takes(house(), { qty_base: 40_000, base_unit: "mg" }));
    expect(w.notCounted[0].why).toBe("it is measured in another unit than Simple syrup is made in, so its figures are not counted; its allergens are");
    expect(w.figures.sugarsG.value).toBeNull();
    expect(w.allergens.gluten).toBe("free");
  });

  it("a two-level chain: 100 ml of a 1 l batch holding 350 ml of the syrup is 25 g of sugar", async () => {
    const w = await sheet(takes(house(), { component_dish_id: BATCH, label: "Sour batch", qty_base: 1000 }));
    expect(w.figures.sugarsG).toEqual({ value: 25, atLeast: false, missing: [] });
    expect(w.through).toEqual([{ label: "Sour batch", componentName: "Sour batch" }]);
  });

  it("a component whose own sum is partial makes the line 'at least', and names the lines inside it", async () => {
    const rows = house();
    rows.recipe_lines.push(line("s2", V_SYRUP, HOUSE_A, 2, "Lemon juice", null, { role: "untracked", qty_base: 1000, base_unit: "ml10" }));
    const w = await sheet(rows);
    expect(w.figures.sugarsG).toEqual({ value: 28.57, atLeast: true, missing: ["Lemon juice in Simple syrup"] });
    // The untracked line leaves its allergens unstated, so the drink cannot be said free of any.
    expect(w.allergensUnstatedBy).toEqual(["House syrup"]);
    expect(w.allergens.gluten).toBe("not_stated");
  });

  it("the list's allergen column says exactly what the sheet says", async () => {
    for (const rows of [house(), takes(house(), { component_dish_id: ORGEAT, label: "House orgeat" }), takes(house(), { component_dish_id: BATCH, label: "Sour batch", qty_base: 1000 })]) {
      const w = await sheet(rows);
      const row = await listRow(rows);
      expect(row).toEqual({ readable: true, status: w.allergens, unstatedBy: w.allergensUnstatedBy });
    }
    expect((await listRow(takes(house(), { component_dish_id: ORGEAT, label: "House orgeat" }))).status.tree_nuts).toBe("contains");
  });

  it("another house's allergen rows for the same good never count", async () => {
    // House B says the sugar contains milk; house A's sugar is free of it.
    expect((await sheet(house())).allergens.milk).toBe("free");
    expect((await listRow(house())).status.milk).toBe("free");
  });

  it("a loop ends: the line inside it is not counted, and nothing is said free", async () => {
    const rows = house();
    rows.dishes.find((d) => d.id === ORGEAT)!.yield_qty_base = 1000;
    rows.dishes.find((d) => d.id === ORGEAT)!.yield_base_unit = "ml10";
    rows.recipe_lines.push(madeLine("s9", V_SYRUP, ORGEAT, "Orgeat", 100), madeLine("o9", V_ORGEAT, SYRUP, "Syrup", 100));
    const w = await sheet(rows);
    expect(w.readable).toBe(true);
    expect(w.allergens.tree_nuts).toBe("contains");
    expect(w.allergensUnstatedBy).toEqual(["House syrup"]);
  });

  it("a failed component read makes the sheet unread and the list row unread, never free", async () => {
    const failing = (rows: Record<string, Row[]>) => {
      const fake = fakeDb(rows);
      const client: any = fake.db.getClient();
      const from = client.from;
      client.from = (t: string) => {
        const q = from(t);
        if (t !== "dishes") return q;
        const select = q.select;
        q.select = (cols: string, o?: any) => {
          if (cols === "id, name, yield_qty_base, yield_base_unit") q.then = (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "down" } });
          return select(cols, o);
        };
        return q;
      };
      return fake;
    };
    const fake = failing(house());
    const w = ((await new RecipesService(fake.db).getDishRecipe(HOUSE_A, TART, "owner")) as any).whatIsIn;
    expect(w).toMatchObject({ readable: false });
    const f2 = failing(house());
    const list = await figuredDishes(new DishesService(f2.db, new RecipesService(f2.db)), HOUSE_A, "owner");
    expect(list.find((d) => d.id === TART)!.allergens).toEqual({ readable: false });
    // A recipe with no made line keeps its allergens.
    expect(list.find((d) => d.id === SYRUP)!.allergens).toMatchObject({ readable: true });
  });
});
