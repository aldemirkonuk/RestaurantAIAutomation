/**
 * r109 drinks fixer (r105 walk, findings 1 and 3 on #2067): a made line is
 * priced only in the kind of unit its component is made in, and only a LIVE
 * drink or dish holds the unit of a component.
 *
 * part 1  recipeCost: a rate per millilitre is never applied to a line in
 *         milligrams;
 * part 2  the version history: an old version that drew 40 ml of a syrup reads
 *         "not priced" once the syrup is made in grams, never 70 times too low;
 * part 3  setYield: a retired drink or dish does not hold the unit; a live one
 *         still does.
 */
import { recipeCost } from "./recipe-cost";
import { BadRequestException } from "@nestjs/common";
import { DishesService, yieldUnitInUse } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { FLOUR, HOUSE_A, TART, V_TART_1, V_TART_2, fakeDb, line, twoHouses, type Row } from "./dishes.testing";

const SYRUP = "d0000000-0000-4000-8000-0000000000c1";
const V_SYRUP = "e0000000-0000-4000-8000-0000000000c1";
const COCKTAIL = "c0000000-0000-4000-8000-0000000000c1";
const V_SOUR = "e0000000-0000-4000-8000-0000000000c3";

const FACTOR: Record<string, [number, string]> = { ml: [10, "ml10"], g: [1000, "mg"] };
const rpc = (name: string, a: Row) => {
  if (name !== "recipe_qty_base") return {};
  const f = FACTOR[a.p_unit];
  return { data: f ? [{ qty_base: Math.round(a.p_qty * f[0]), base_unit: f[1] }] : [] };
};

/** Syrup: 500 g sugar-ish flour (1.00) to 700 ml. Tart v1 drew 40 ml of it; the current v2 does not. */
function house(): Record<string, Row[]> {
  const rows = twoHouses();
  rows.dishes.push({ id: SYRUP, restaurant_id: HOUSE_A, name: "Simple syrup", yield_qty_base: 7000, yield_base_unit: "ml10", deleted_at: null });
  rows.recipe_current_dish.push({ dish_id: SYRUP, version_id: V_SYRUP, restaurant_id: HOUSE_A });
  rows.recipe_versions.push({ id: V_SYRUP, restaurant_id: HOUSE_A, dish_id: SYRUP, owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" });
  rows.recipe_lines = [
    line("s1", V_SYRUP, HOUSE_A, 1, "Sugar", FLOUR, { qty_entered: 500, qty_base: 500_000 }),
    line("s2", V_SYRUP, HOUSE_A, 2, "Water", null, { role: "untracked", qty_entered: 500, unit_code: "ml", qty_base: 5000, base_unit: "ml10" }),
    line("t0", V_TART_1, HOUSE_A, 1, "House syrup", null, { role: "made", component_dish_id: SYRUP, qty_entered: 40, unit_code: "ml", qty_base: 400, base_unit: "ml10" }),
    line("t2", V_TART_2, HOUSE_A, 1, "Flour", FLOUR),
  ];
  for (const v of rows.recipe_versions) if (v.id === V_TART_1) v.yield_serves = 1;
  rows.item_nutrition = [];
  rows.item_allergens = [];
  rows.inventory_lot_agreed_cost = [];
  rows.inventory_lot_invoice_cost = [];
  rows.cocktails = [];
  rows.recipe_current = [];
  return rows;
}

const services = (rows: Record<string, Row[]>) => {
  const { db } = fakeDb(rows, { rpc });
  const recipes = new RecipesService(db);
  return { dishes: new DishesService(db, recipes), recipes };
};
/** Tart v1 as the history reads it: its first line, and the total. */
const oldVersion = async (rows: Record<string, Row[]>) => {
  const r = (await services(rows).recipes.readDishVersion(HOUSE_A, TART, V_TART_1, "owner")) as any;
  return { line: r.version.lines[0], cost: r.cost };
};

/** A drink whose current version draws the syrup in millilitres. */
function addDrink(rows: Record<string, Row[]>, deletedAt: string | null) {
  rows.cocktails.push({ id: COCKTAIL, restaurant_id: HOUSE_A, name: "Sour Test", deleted_at: deletedAt });
  rows.recipe_current.push({ cocktail_id: COCKTAIL, version_id: V_SOUR, restaurant_id: HOUSE_A });
  rows.recipe_versions.push({ id: V_SOUR, restaurant_id: HOUSE_A, cocktail_id: COCKTAIL, owner_kind: "cocktail", version: 1, yield_serves: 1, created_at: "2026-11-03" });
  rows.recipe_lines.push(line("c1", V_SOUR, HOUSE_A, 1, "House syrup", null, { role: "made", component_dish_id: SYRUP, qty_entered: 30, unit_code: "ml", qty_base: 300, base_unit: "ml10" }));
}

describe("a made line is priced only in the kind of unit its component is made in", () => {
  const made = (baseUnit: any, baseUnitOnLine: any = "ml10") =>
    recipeCost([{ role: "made", inventoryId: null, qtyBase: 400, baseUnit: baseUnitOnLine, item: null, lot: null, made: { name: "Simple syrup", perBase: 0.0002, ...(baseUnit === undefined ? {} : { baseUnit }) } }], 1);

  it("prices a line in the unit the component is made in, and one whose caller did not say the unit as before", () => {
    expect(made("ml10").lines[0]).toMatchObject({ costBasis: "component", costPerServeExact: 0.08 });
    expect(made(undefined).lines[0]).toMatchObject({ costBasis: "component", costPerServeExact: 0.08 });
  });

  it("does not price a millilitre line against a component now made in grams, or one with no unit", () => {
    for (const unit of ["mg", "each_milli", null]) {
      const c = made(unit);
      expect(c.lines[0]).toMatchObject({ costPerServe: null, costPerServeExact: null, costBasis: "component_not_priced", throughComponent: "Simple syrup" });
      expect(c).toMatchObject({ complete: false, perServe: null });
    }
  });
});

describe("an old version after its component changed kind", () => {
  it("still prices at today's price while the component is made in the unit the line was saved in", async () => {
    const { line: first, cost } = await oldVersion(house());
    expect(first).toMatchObject({ costBasis: "component", costPerServeExact: 0.057143 });
    expect(cost.complete).toBe(true);
  });

  it("says not known once the syrup is made in grams: 40 ml is never priced as 400 mg", async () => {
    const rows = house();
    await services(rows).dishes.setYield(HOUSE_A, SYRUP, { amount: 500, unit: "g" });
    expect(rows.dishes.find((d) => d.id === SYRUP)).toMatchObject({ yield_qty_base: 500_000, yield_base_unit: "mg" });
    const { line: first, cost } = await oldVersion(rows);
    expect(first).toMatchObject({ costPerServe: null, costPerServeExact: null, costBasis: "component_not_priced", componentName: "Simple syrup" });
    expect(cost).toMatchObject({ complete: false, perServe: null });
  });
});

describe("only a live drink or dish holds the unit of a component", () => {
  it("a live drink that draws it still refuses grams", async () => {
    const rows = house();
    addDrink(rows, null);
    await expect(services(rows).dishes.setYield(HOUSE_A, SYRUP, { amount: 500, unit: "g" })).rejects.toThrow("millilitres");
    expect(rows.dishes.find((d) => d.id === SYRUP)!.yield_base_unit).toBe("ml10");
  });

  it("a retired drink that drew it does not: the change goes through", async () => {
    const rows = house();
    addDrink(rows, "2026-11-20T10:00:00Z");
    await services(rows).dishes.setYield(HOUSE_A, SYRUP, { amount: 500, unit: "g" });
    expect(rows.dishes.find((d) => d.id === SYRUP)!.yield_base_unit).toBe("mg");
  });

  it("a retired dish that draws it does not, and a live one does", async () => {
    const live = house();
    live.recipe_lines.push(line("t3", V_TART_2, HOUSE_A, 2, "House syrup", null, { role: "made", component_dish_id: SYRUP, qty_entered: 40, unit_code: "ml", qty_base: 400, base_unit: "ml10" }));
    await expect(services(live).dishes.setYield(HOUSE_A, SYRUP, { amount: 500, unit: "g" })).rejects.toThrow("millilitres");
    const gone = house();
    gone.recipe_lines.push(line("t3", V_TART_2, HOUSE_A, 2, "House syrup", null, { role: "made", component_dish_id: SYRUP, qty_entered: 40, unit_code: "ml", qty_base: 400, base_unit: "ml10" }));
    gone.dishes.find((d) => d.id === TART)!.deleted_at = "2026-11-21";
    await services(gone).dishes.setYield(HOUSE_A, SYRUP, { amount: 500, unit: "g" });
    expect(gone.dishes.find((d) => d.id === SYRUP)!.yield_base_unit).toBe("mg");
  });
});

describe("a save that commits between the check and the write", () => {
  it("is refused by the database in the same words, and the yield is not touched", async () => {
    const rows = house();
    const { db } = fakeDb(rows, { rpc });
    const real = db.getClient() as any;
    const refusal = { code: "RCP00", hint: "component_unit_in_use", message: "Take Simple syrup out of the recipes that use it" };
    const chain: any = { eq: () => chain, is: () => chain, select: () => chain, maybeSingle: async () => ({ data: null, error: refusal }) };
    const racing = { ...real, from: (t: string) => (t === "dishes" ? { select: (...a: any[]) => real.from(t).select(...a), update: () => chain } : real.from(t)) };
    const svc = new DishesService({ getClient: () => racing } as any, new RecipesService(db));
    await expect(svc.setYield(HOUSE_A, SYRUP, { amount: 500, unit: "g" })).rejects.toThrow(new BadRequestException(yieldUnitInUse("millilitres")));
    expect(rows.dishes.find((d) => d.id === SYRUP)).toMatchObject({ yield_qty_base: 7000, yield_base_unit: "ml10" });
  });
});
