/**
 * r104 drinks need 1 (ADR 0397): a line made in the house is priced through its
 * component, whose cost per base unit is one batch's cost over what the batch
 * makes.
 *
 * part 1  recipeCost + componentPerBase: the 40 ml of syrup case, an unpriced
 *         component never a smaller figure;
 * part 2  the sheet: a two-level chain, an unpriced child, a component that is
 *         gone, and a save that sends the component on and says the database's
 *         refusal (a cycle) as a 400.
 */
import { BadRequestException } from "@nestjs/common";
import { componentPerBase, recipeCost } from "./recipe-cost";
import { RecipesService } from "./recipes.service";
import { HOUSE_A, FLOUR, TART, V_TART_2, fakeDb, twoHouses, line, type Row } from "./dishes.testing";

const lot = { has_invoice_cost: true, wac: 2, wac_qty: 5, live_qty: 5 };
const sugar500 = { role: "stocked" as const, inventoryId: "s", qtyBase: 500_000, baseUnit: "mg" as const, item: { uom: "kg" }, lot };

describe("componentPerBase and a made line", () => {
  it("prices 40 ml of a syrup made from 500 g sugar (1.00) and water, yield 700 ml: 0.0571", () => {
    const batch = recipeCost([sugar500, { role: "untracked", inventoryId: null, qtyBase: 5000, baseUnit: "ml10", item: null, lot: null }], 1);
    const perBase = componentPerBase(batch, 7000);
    expect(perBase).toBeCloseTo(1 / 7000, 12);
    const c = recipeCost([{ role: "made", inventoryId: null, qtyBase: 400, baseUnit: "ml10", item: null, lot: null, made: { name: "Simple syrup", perBase } }], 1);
    expect(c.lines[0]).toMatchObject({ status: "linked", costPerServe: 0.06, costPerServeExact: 0.057143, costBasis: "component", throughComponent: "Simple syrup" });
    expect(c).toMatchObject({ complete: true, priced: 1, of: 1 });
  });

  it("a component with an unpriced line prices nothing, so the drink says it is not priced, never a smaller cost", () => {
    const unlinked = { role: "stocked" as const, inventoryId: null, qtyBase: 1000, baseUnit: "mg" as const, item: null, lot: null };
    const batch = recipeCost([sugar500, unlinked], 1);
    expect(batch.complete).toBe(false);
    expect(componentPerBase(batch, 7000)).toBeNull();
    const c = recipeCost(
      [
        { role: "made", inventoryId: null, qtyBase: 400, baseUnit: "ml10", item: null, lot: null, made: { name: "Simple syrup", perBase: null } },
        { ...sugar500, qtyBase: 1000 },
      ],
      1,
    );
    expect(c.lines[0]).toMatchObject({ costPerServe: null, costBasis: "component_not_priced", throughComponent: "Simple syrup" });
    expect(c).toMatchObject({ perServe: null, complete: false, priced: 1, of: 2 });
  });

  it("a made line that names nothing it draws is not priced, and a yield of nothing is not a rate", () => {
    expect(recipeCost([{ role: "made", inventoryId: null, qtyBase: 400, baseUnit: "ml10", item: null, lot: null }], 1).lines[0]).toMatchObject({
      costPerServe: null,
      costBasis: "component_not_priced",
    });
    const whole = recipeCost([sugar500], 1);
    for (const y of [0, -5, null, undefined, "x"]) expect(componentPerBase(whole, y as any)).toBeNull();
  });
});

const SYRUP = "d0000000-0000-4000-8000-0000000000c1";
const BATCH = "d0000000-0000-4000-8000-0000000000c2";
const V_SYRUP = "e0000000-0000-4000-8000-0000000000c1";
const V_BATCH = "e0000000-0000-4000-8000-0000000000c2";

/** The tart takes 40 ml of syrup; the syrup is 500 g flour (1.00) to 700 ml. */
function withSyrup(): Record<string, Row[]> {
  const rows = twoHouses();
  rows.dishes.push(
    { id: SYRUP, restaurant_id: HOUSE_A, name: "Simple syrup", yield_qty_base: 7000, yield_base_unit: "ml10", deleted_at: null },
    { id: BATCH, restaurant_id: HOUSE_A, name: "Sour batch", yield_qty_base: 10_000, yield_base_unit: "ml10", deleted_at: null },
  );
  rows.recipe_current_dish.push(
    { dish_id: SYRUP, version_id: V_SYRUP, restaurant_id: HOUSE_A },
    { dish_id: BATCH, version_id: V_BATCH, restaurant_id: HOUSE_A },
  );
  rows.recipe_versions.push(
    { id: V_SYRUP, restaurant_id: HOUSE_A, dish_id: SYRUP, owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" },
    { id: V_BATCH, restaurant_id: HOUSE_A, dish_id: BATCH, owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" },
  );
  rows.recipe_lines = [
    line("s1", V_SYRUP, HOUSE_A, 1, "Sugar", FLOUR, { qty_entered: 500, qty_base: 500_000 }),
    line("s2", V_SYRUP, HOUSE_A, 2, "Water", null, { role: "untracked", qty_entered: 500, unit_code: "ml", qty_base: 5000, base_unit: "ml10" }),
    // The tart (one serve): 40 ml of syrup.
    line("t1", V_TART_2, HOUSE_A, 1, "House syrup", null, { role: "made", component_dish_id: SYRUP, qty_entered: 40, unit_code: "ml", qty_base: 400, base_unit: "ml10" }),
  ];
  for (const v of rows.recipe_versions) if (v.id === V_TART_2) v.yield_serves = 1;
  rows.item_nutrition = [];
  rows.item_allergens = [];
  rows.inventory_lot_agreed_cost = [];
  rows.inventory_lot_invoice_cost = [];
  return rows;
}

const read = async (rows: Record<string, Row[]>, role = "owner") => (await new RecipesService(fakeDb(rows).db).getDishRecipe(HOUSE_A, TART, role)) as any;

describe("the sheet prices a made line through its component", () => {
  it("says what it draws and prices 40 ml at 0.06, the sheet's cost complete", async () => {
    const out = await read(withSyrup());
    expect(out.current.lines[0]).toMatchObject({ role: "made", componentId: SYRUP, componentName: "Simple syrup", costPerServe: 0.06, costBasis: "component" });
    expect(out.cost).toMatchObject({ complete: true, priced: 1, of: 1, perServeExact: 0.057143 });
  });

  it("prices a two-level chain: a batch of 350 ml syrup (0.50) and 200 g flour (0.40) made to 1 l, 100 ml of it is 0.09", async () => {
    const rows = withSyrup();
    rows.recipe_lines.push(
      line("b1", V_BATCH, HOUSE_A, 1, "House syrup", null, { role: "made", component_dish_id: SYRUP, qty_entered: 350, unit_code: "ml", qty_base: 3500, base_unit: "ml10" }),
      line("b2", V_BATCH, HOUSE_A, 2, "Flour", FLOUR, { qty_entered: 200, qty_base: 200_000 }),
    );
    for (const l of rows.recipe_lines) if (l.id === "t1") Object.assign(l, { component_dish_id: BATCH, label: "Sour batch", qty_entered: 100, qty_base: 1000 });
    const out = await read(rows);
    expect(out.current.lines[0]).toMatchObject({ componentName: "Sour batch", costPerServe: 0.09, costBasis: "component" });
  });

  it("an unpriced child makes the drink 'not priced': no cost, one of one line counted", async () => {
    const rows = withSyrup();
    for (const l of rows.recipe_lines) if (l.id === "s1") Object.assign(l, { inventory_id: null });
    const out = await read(rows);
    expect(out.current.lines[0]).toMatchObject({ componentName: "Simple syrup", costPerServe: null, costBasis: "component_not_priced" });
    expect(out.cost).toMatchObject({ perServe: null, complete: false, priced: 0, of: 1 });
  });

  it("a component that is gone, or has no recipe, prices nothing", async () => {
    const gone = withSyrup();
    for (const d of gone.dishes) if (d.id === SYRUP) d.deleted_at = "2026-11-10";
    expect((await read(gone)).current.lines[0]).toMatchObject({ costPerServe: null, costBasis: "component_not_priced" });
    const bare = withSyrup();
    bare.recipe_current_dish = bare.recipe_current_dish.filter((p) => p.dish_id !== SYRUP);
    expect((await read(bare)).current.lines[0]).toMatchObject({ costPerServe: null, costBasis: "component_not_priced" });
  });

  it("reads components three levels deep and no further: a fourth level leaves the drink not priced, never looping", async () => {
    const chain = (levels: number) => {
      const rows = withSyrup();
      // X1 uses X2 ... uses X<levels>, which is made of flour; the tart takes X1.
      for (let i = 1; i <= levels; i++) {
        const id = `d0000000-0000-4000-8000-00000000d00${i}`;
        const v = `e0000000-0000-4000-8000-00000000d00${i}`;
        rows.dishes.push({ id, restaurant_id: HOUSE_A, name: `Level ${i}`, yield_qty_base: 1000, yield_base_unit: "ml10", deleted_at: null });
        rows.recipe_current_dish.push({ dish_id: id, version_id: v, restaurant_id: HOUSE_A });
        rows.recipe_versions.push({ id: v, restaurant_id: HOUSE_A, dish_id: id, owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" });
        rows.recipe_lines.push(
          i < levels
            ? line(`x${i}`, v, HOUSE_A, 1, "Inner", null, { role: "made", component_dish_id: `d0000000-0000-4000-8000-00000000d00${i + 1}`, qty_entered: 100, unit_code: "ml", qty_base: 1000, base_unit: "ml10" })
            : line(`x${i}`, v, HOUSE_A, 1, "Flour", FLOUR, { qty_entered: 500, qty_base: 500_000 }),
        );
      }
      for (const l of rows.recipe_lines) if (l.id === "t1") Object.assign(l, { component_dish_id: "d0000000-0000-4000-8000-00000000d001", qty_base: 1000 });
      return rows;
    };
    // Three levels (X1 in X2 in X3, made of flour) are priced; a fourth is not read.
    expect((await read(chain(3))).current.lines[0]).toMatchObject({ costBasis: "component" });
    expect((await read(chain(4))).current.lines[0]).toMatchObject({ costPerServe: null, costBasis: "component_not_priced" });
  });

  it("shows staff what it draws and no money", async () => {
    const out = await read(withSyrup(), "staff");
    expect(out.current.lines[0]).toMatchObject({ role: "made", componentId: SYRUP, componentName: null, costPerServe: null });
    expect(out.cost).toBeNull();
  });
});

describe("a save sends the component on, and says the database's refusal", () => {
  const dto = (lines: unknown[]) => ({ expectedVersionId: V_TART_2, yieldServes: 1, lines }) as any;

  it("sends componentId on both saves, null for a line without one", async () => {
    const calls: any[] = [];
    const rpc = (name: string, args: any) => (calls.push({ name, args }), { data: { version_id: "v3", version: 3, lines: [] } });
    const svc = new RecipesService(fakeDb(twoHouses(), { rpc }).db);
    const lines = [
      { role: "made", componentId: SYRUP, label: "House syrup", qty: 40, unit: "ml" },
      { role: "stocked", label: "Flour", qty: 1, unit: "g" },
    ];
    await svc.saveDishRecipe(HOUSE_A, TART, "u", dto(lines));
    await svc.saveRecipe(HOUSE_A, "c", "u", dto(lines));
    for (const c of calls) expect(c.args.p_lines.map((l: any) => l.componentId)).toEqual([SYRUP, null]);
  });

  it("a cycle the database refuses is a 400 in its own sentence", async () => {
    const sentence = "Ingredient 1 (House syrup) would make a component contain itself, or sit more than three levels deep.";
    const rpc = () => ({ error: { code: "RCP00", message: sentence } });
    const svc = new RecipesService(fakeDb(twoHouses(), { rpc }).db);
    await expect(svc.saveDishRecipe(HOUSE_A, SYRUP, "u", dto([{ role: "made", componentId: SYRUP, label: "House syrup", qty: 40, unit: "ml" }]))).rejects.toThrow(
      new BadRequestException(sentence),
    );
  });

  it("refuses a usable share on a made line in words, and sends nothing", async () => {
    const calls: any[] = [];
    const svc = new RecipesService(fakeDb(twoHouses(), { rpc: (n: string, a: any) => (calls.push(a), { data: {} }) }).db);
    await expect(svc.saveRecipe(HOUSE_A, "c", "u", dto([{ role: "made", componentId: SYRUP, label: "House syrup", qty: 40, unit: "ml", usablePct: 50 }]))).rejects.toThrow(
      "Ingredient 1 (House syrup) is not counted, so it has no usable share.",
    );
    expect(calls).toEqual([]);
  });
});
