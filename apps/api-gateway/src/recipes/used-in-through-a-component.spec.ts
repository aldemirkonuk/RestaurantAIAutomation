import { DishesService } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { HOUSE_A, HOUSE_B, fakeDb, line, twoHouses, type Row } from "./dishes.testing";

/**
 * r110 inventory g1: Used in follows a house-made component. Sugar is in
 * simple syrup, so every current drink and dish that draws the syrup is
 * listed under it with the sugar in one serve. Through the real service over
 * two houses' rows that the fake filters and caps at 1,000.
 */
const SUGAR = "f0000000-0000-4000-8000-0000000000a3";
const SYRUP = "d1000000-0000-4000-8000-0000000000a1";
const BATCH = "d1000000-0000-4000-8000-0000000000a2";
const PASTE = "d1000000-0000-4000-8000-0000000000a3";
const DAIQ = "c1000000-0000-4000-8000-0000000000a1";
const MOJITO = "c1000000-0000-4000-8000-0000000000a2";
const PUNCH = "c1000000-0000-4000-8000-0000000000a3";
const SOUR = "c1000000-0000-4000-8000-0000000000a4";
const FIZZ = "c1000000-0000-4000-8000-0000000000a5";
const B_DRINK = "c1000000-0000-4000-8000-0000000000b1";

const v = (n: number) => `e1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const made = (id: string, version: string, house: string, component: string, qtyBase: number, baseUnit = "ml10") =>
  line(id, version, house, 1, "made", null, { role: "made", component_dish_id: component, qty_base: qtyBase, base_unit: baseUnit, unit_code: "ml" });
const dish = (id: string, name: string, yieldQtyBase: number | null, yieldBaseUnit: string | null, house = HOUSE_A) => ({
  id, restaurant_id: house, name, menu_section: null, price: null, description: null, deleted_at: null,
  yield_qty_base: yieldQtyBase, yield_base_unit: yieldBaseUnit,
});
const drink = (id: string, name: string, house = HOUSE_A) => ({ id, restaurant_id: house, name, display_name: null, menu_section: null, price: 10, deleted_at: null });
const version = (id: string, owner: Row, serves = 1, house = HOUSE_A) => ({ id, restaurant_id: house, yield_serves: serves, version: 1, created_at: "2026-11-20", ...owner });

/** Sugar -> syrup (700 ml from 500 g) -> Daiquiri 40 ml, Mojito 20 ml; syrup -> batch mix (1 l) -> Punch 100 ml. */
function house(): Record<string, Row[]> {
  const rows = twoHouses();
  rows.dishes.push(dish(SYRUP, "Simple syrup", 7000, "ml10"), dish(BATCH, "Punch batch", 10_000, "ml10"), dish(PASTE, "Sugar paste", null, null));
  rows.cocktails = [drink(DAIQ, "Daiquiri"), drink(MOJITO, "Mojito"), drink(PUNCH, "Punch"), drink(SOUR, "Sour"), drink(FIZZ, "Fizz"), drink(B_DRINK, "B-ONLY drink", HOUSE_B)];
  rows.recipe_current_dish.push(
    { dish_id: SYRUP, version_id: v(1), restaurant_id: HOUSE_A },
    { dish_id: BATCH, version_id: v(2), restaurant_id: HOUSE_A },
    { dish_id: PASTE, version_id: v(3), restaurant_id: HOUSE_A },
  );
  rows.recipe_current = [
    { cocktail_id: DAIQ, version_id: v(11), restaurant_id: HOUSE_A },
    { cocktail_id: MOJITO, version_id: v(12), restaurant_id: HOUSE_A },
    { cocktail_id: PUNCH, version_id: v(13), restaurant_id: HOUSE_A },
    { cocktail_id: SOUR, version_id: v(14), restaurant_id: HOUSE_A },
    { cocktail_id: FIZZ, version_id: v(15), restaurant_id: HOUSE_A },
    { cocktail_id: B_DRINK, version_id: v(99), restaurant_id: HOUSE_B },
  ];
  rows.recipe_versions.push(
    version(v(1), { dish_id: SYRUP }),
    version(v(2), { dish_id: BATCH }),
    version(v(3), { dish_id: PASTE }),
    version(v(10), { cocktail_id: DAIQ }),
    version(v(11), { cocktail_id: DAIQ }),
    version(v(12), { cocktail_id: MOJITO }),
    version(v(13), { cocktail_id: PUNCH }),
    version(v(14), { cocktail_id: SOUR }),
    version(v(15), { cocktail_id: FIZZ }),
    version(v(99), { cocktail_id: B_DRINK }, 1, HOUSE_B),
  );
  rows.recipe_lines.push(
    line("s1", v(1), HOUSE_A, 1, "Sugar", SUGAR, { qty_base: 500_000, base_unit: "mg" }),
    line("s2", v(3), HOUSE_A, 1, "Sugar", SUGAR, { qty_base: 100_000, base_unit: "mg" }),
    made("m-batch", v(2), HOUSE_A, SYRUP, 2000),
    made("m-daiq-old", v(10), HOUSE_A, SYRUP, 999),
    made("m-daiq", v(11), HOUSE_A, SYRUP, 400),
    made("m-mojito", v(12), HOUSE_A, SYRUP, 200),
    made("m-punch", v(13), HOUSE_A, BATCH, 1000),
    // 30 g of a syrup made by the litre: the units do not meet.
    made("m-sour", v(14), HOUSE_A, SYRUP, 30_000, "mg"),
    made("m-fizz", v(15), HOUSE_A, PASTE, 50),
    // Another house's drink draws this house's syrup id: never listed. A row of another house's that names
    // this house's Daiquiri version is not this house's line either.
    made("m-b", v(99), HOUSE_B, SYRUP, 400),
    made("m-b-forged", v(11), HOUSE_B, SYRUP, 400),
  );
  return rows;
}

const service = (rows = house()) => {
  const fake = fakeDb(rows);
  return new DishesService(fake.db, new RecipesService(fake.db));
};
const owner = (out: Awaited<ReturnType<DishesService["componentUsesOfItem"]>>, component: string, id: string) =>
  out.find((c) => c.componentId === component)?.owners.find((o) => o.id === id);

describe("Used in, through a house-made component (r110 inventory g1)", () => {
  it("40 ml of a 700 ml syrup made from 500 g of sugar is 28.57 g of sugar a serve", async () => {
    const out = await service().componentUsesOfItem(HOUSE_A, SUGAR);
    expect(owner(out, SYRUP, DAIQ)).toEqual({ kind: "cocktail", id: DAIQ, name: "Daiquiri", perServeQtyBase: 28_571.43, baseUnit: "mg", why: null });
    expect(owner(out, SYRUP, MOJITO)).toMatchObject({ perServeQtyBase: 14_285.71, baseUnit: "mg" });
  });

  it("a two-level chain multiplies the ratio at each level", async () => {
    const out = await service().componentUsesOfItem(HOUSE_A, SUGAR);
    // The batch mix is itself listed under the syrup: 2 l of syrup a batch, one batch a "serve".
    expect(owner(out, SYRUP, BATCH)).toMatchObject({ kind: "dish", name: "Punch batch", perServeQtyBase: 142_857.14 });
    const batch = out.find((c) => c.componentId === BATCH)!;
    expect(batch.level).toBe(2);
    // 100 ml of a 1 l batch that holds 2/7 of 500 g.
    expect(batch.owners).toEqual([{ kind: "cocktail", id: PUNCH, name: "Punch", perServeQtyBase: 14_285.71, baseUnit: "mg", why: null }]);
  });

  it("a recipe that makes several serves gives one serve's share, and one that says no serves gives no amount", async () => {
    const rows = house();
    rows.recipe_versions.find((r) => r.id === v(12))!.yield_serves = 2;
    rows.recipe_versions.find((r) => r.id === v(11))!.yield_serves = null;
    const out = await service(rows).componentUsesOfItem(HOUSE_A, SUGAR);
    expect(owner(out, SYRUP, MOJITO)).toMatchObject({ perServeQtyBase: 7_142.86, baseUnit: "mg", why: null });
    expect(owner(out, SYRUP, DAIQ)).toMatchObject({ perServeQtyBase: null, why: "no_serves" });
  });

  it("a drawn line in another unit than the batch is made in gives no amount, and says why", async () => {
    const out = await service().componentUsesOfItem(HOUSE_A, SUGAR);
    expect(owner(out, SYRUP, SOUR)).toMatchObject({ perServeQtyBase: null, baseUnit: null, why: "unit_mismatch" });
  });

  it("a component with no yield set gives no amount, and says why", async () => {
    const out = await service().componentUsesOfItem(HOUSE_A, SUGAR);
    expect(owner(out, PASTE, FIZZ)).toMatchObject({ name: "Fizz", perServeQtyBase: null, why: "no_yield" });
  });

  it("a version that is not current is left out, and a plain dish that is drawn by nothing is not a component", async () => {
    const out = await service().componentUsesOfItem(HOUSE_A, SUGAR);
    const syrup = out.find((c) => c.componentId === SYRUP)!;
    expect(syrup.owners.map((o) => o.name)).toEqual(["Daiquiri", "Mojito", "Punch batch", "Sour"]);
    expect(JSON.stringify(out)).not.toContain("28.5"); // 999 ml10 of the old Daiquiri would not give 28.57 either
    expect(out.map((c) => c.componentName).sort()).toEqual(["Punch batch", "Simple syrup", "Sugar paste"]);
  });

  it("another house's drink that draws this house's component is never listed", async () => {
    const out = await service().componentUsesOfItem(HOUSE_A, SUGAR);
    expect(JSON.stringify(out)).not.toContain("B-ONLY");
    expect(await service().componentUsesOfItem(HOUSE_B, SUGAR)).toEqual([]);
  });

  it("a cycle ends: each says why, and nothing recurses for ever", async () => {
    const rows = house();
    // The paste draws the batch, and the batch draws the paste.
    rows.dishes.find((d) => d.id === PASTE)!.yield_qty_base = 1000;
    rows.dishes.find((d) => d.id === PASTE)!.yield_base_unit = "ml10";
    rows.recipe_lines.push(made("m-loop-1", v(3), HOUSE_A, BATCH, 10), made("m-loop-2", v(2), HOUSE_A, PASTE, 10));
    const out = await service(rows).componentUsesOfItem(HOUSE_A, SUGAR);
    expect(owner(out, PASTE, BATCH)).toMatchObject({ perServeQtyBase: null, why: "cycle" });
    expect(owner(out, BATCH, PASTE)).toMatchObject({ perServeQtyBase: null, why: "cycle" });
    expect(owner(out, BATCH, PUNCH)).toMatchObject({ perServeQtyBase: null, why: "cycle" });
  });

  it("reads every drawing line past the 1,000-row cap", async () => {
    const rows = house();
    // 1,000 old lines that draw the syrup come first; the current Daiquiri's line is after them.
    rows.recipe_lines = rows.recipe_lines.filter((l) => l.id !== "m-daiq");
    for (let i = 0; i < 1000; i++) rows.recipe_lines.push(made(`a${String(i).padStart(5, "0")}`, v(10), HOUSE_A, SYRUP, 1));
    rows.recipe_lines.push(made("z-daiq", v(11), HOUSE_A, SYRUP, 400));
    const out = await service(rows).componentUsesOfItem(HOUSE_A, SUGAR);
    expect(owner(out, SYRUP, DAIQ)).toMatchObject({ perServeQtyBase: 28_571.43 });
  });

  it("the dishes read carries it as `through`, and a failed read is null, never an empty list", async () => {
    const svc = service();
    const out = await svc.dishesUsingItem(HOUSE_A, SUGAR, "staff");
    expect(out.dishes.map((d) => d.name)).toEqual(["Simple syrup", "Sugar paste"]);
    expect((out as any).through.map((c: any) => c.componentName)).toEqual(["Simple syrup", "Sugar paste", "Punch batch"]);
    // The drink pointer read fails: every chained call keeps the failure, and the answer is an error.
    const fake = fakeDb(house());
    const client = fake.db.getClient() as any;
    const from = client.from;
    client.from = (t: string) => {
      const q = from(t);
      if (t !== "recipe_current") return q;
      const failing: any = new Proxy(q, {
        get: (target, prop) =>
          prop === "then"
            ? (ok: any) => ok({ data: null, error: { message: "down" } })
            : (...args: unknown[]) => (target[prop](...args), failing),
      });
      return failing;
    };
    const failing = new DishesService(fake.db, new RecipesService(fake.db));
    const read = await failing.dishesUsingItem(HOUSE_A, SUGAR, "owner");
    expect((read as any).through).toBeNull();
    expect(read.dishes.map((d) => d.name)).toEqual(["Simple syrup", "Sugar paste"]);
  });
});
