import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { DishesService, DRINK_FIGURES_UNREAD, DRINK_USE_UNREAD } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { HOUSE_A, HOUSE_B, V_TART_2, fakeDb, line, twoHouses, type Row } from "./dishes.testing";

/**
 * Which of the house's drinks use a good, with the same figures a dish has
 * (cost a serve at today's prices, price), so the /inventory drawer gives a
 * drink the cards it gives a dish (founder /goal 2026-11-07: "the same for
 * drinks and their recipes"). Through the real services over two houses'
 * rows that the fake filters and caps at 1,000. Route guards are in
 * dishes-recipe.spec.ts.
 */

const GIN = "f0000000-0000-4000-8000-0000000000c1";
const SYRUP = "f0000000-0000-4000-8000-0000000000c2";
const B_GIN = "f0000000-0000-4000-8000-0000000000c9";
const GT = "c0000000-0000-4000-8000-0000000000a1";
const SOUR = "c0000000-0000-4000-8000-0000000000a2";
const GONE_DRINK = "c0000000-0000-4000-8000-0000000000a3";
const CATALOGUE = "c0000000-0000-4000-8000-0000000000a4";
const B_DRINK = "c0000000-0000-4000-8000-0000000000b1";
const V_GT_1 = "e0000000-0000-4000-8000-0000000000c1";
const V_GT_2 = "e0000000-0000-4000-8000-0000000000c2";
const V_SOUR = "e0000000-0000-4000-8000-0000000000c3";
const V_GONE_DRINK = "e0000000-0000-4000-8000-0000000000c4";
const V_CATALOGUE = "e0000000-0000-4000-8000-0000000000c5";
const V_B_DRINK = "e0000000-0000-4000-8000-0000000000c9";

const ml = (n: number): Row => ({ qty_entered: n, unit_code: "ml", qty_base: n * 10, base_unit: "ml10" });

function withDrinks(): Record<string, Row[]> {
  const rows = twoHouses();
  rows.cocktails = [
    { id: GT, restaurant_id: HOUSE_A, name: "gt", display_name: "House G&T", menu_section: "Highballs", price: 12, deleted_at: null },
    { id: SOUR, restaurant_id: HOUSE_A, name: "Gin Sour", display_name: null, menu_section: null, price: null, deleted_at: null },
    { id: GONE_DRINK, restaurant_id: HOUSE_A, name: "Retired fizz", display_name: null, menu_section: null, price: 9, deleted_at: "2026-10-01" },
    { id: CATALOGUE, restaurant_id: null, name: "Catalogue martini", display_name: null, menu_section: null, price: 1, deleted_at: null },
    { id: B_DRINK, restaurant_id: HOUSE_B, name: "B-ONLY negroni", display_name: null, menu_section: null, price: 777, deleted_at: null },
  ];
  rows.recipe_current = [
    { cocktail_id: GT, version_id: V_GT_2, restaurant_id: HOUSE_A },
    { cocktail_id: SOUR, version_id: V_SOUR, restaurant_id: HOUSE_A },
    { cocktail_id: GONE_DRINK, version_id: V_GONE_DRINK, restaurant_id: HOUSE_A },
    { cocktail_id: CATALOGUE, version_id: V_CATALOGUE, restaurant_id: HOUSE_A },
    { cocktail_id: B_DRINK, version_id: V_B_DRINK, restaurant_id: HOUSE_B },
  ];
  rows.recipe_versions.push(
    { id: V_GT_1, restaurant_id: HOUSE_A, cocktail_id: GT, owner_kind: "cocktail", version: 1, yield_serves: 1 },
    { id: V_GT_2, restaurant_id: HOUSE_A, cocktail_id: GT, owner_kind: "cocktail", version: 2, yield_serves: 1 },
    { id: V_SOUR, restaurant_id: HOUSE_A, cocktail_id: SOUR, owner_kind: "cocktail", version: 1, yield_serves: 2 },
    { id: V_GONE_DRINK, restaurant_id: HOUSE_A, cocktail_id: GONE_DRINK, owner_kind: "cocktail", version: 1, yield_serves: 1 },
    { id: V_CATALOGUE, restaurant_id: HOUSE_A, cocktail_id: CATALOGUE, owner_kind: "cocktail", version: 1, yield_serves: 1 },
    { id: V_B_DRINK, restaurant_id: HOUSE_B, cocktail_id: B_DRINK, owner_kind: "cocktail", version: 1, yield_serves: 1 },
  );
  rows.recipe_lines.push(
    line("g1", V_GT_1, HOUSE_A, 1, "Old gin line", GIN, ml(999)),
    line("g2", V_GT_2, HOUSE_A, 1, "Gin", GIN, ml(50)),
    line("g3", V_GT_2, HOUSE_A, 2, "Lime wedge", null, { role: "untracked", ...ml(5) }),
    line("g4", V_SOUR, HOUSE_A, 1, "Gin", GIN, ml(100)),
    line("g5", V_SOUR, HOUSE_A, 2, "Syrup", SYRUP, ml(40)),
    line("g6", V_GONE_DRINK, HOUSE_A, 1, "Gin", GIN, ml(50)),
    line("g7", V_CATALOGUE, HOUSE_A, 1, "Gin", GIN, ml(50)),
    line("g8", V_B_DRINK, HOUSE_B, 1, "B-SECRET gin", GIN, ml(50)),
    // A dish that uses the gin is a dish, never a drink.
    line("g9", V_TART_2, HOUSE_A, 9, "Gin glaze", GIN, ml(10)),
  );
  rows.restaurant_inventory.push(
    { id: GIN, restaurant_id: HOUSE_A, display_name: "House Gin", kind: "spirit", uom: "bottle", bottle_size_ml: 700, last_purchase_price: 21, is_active: true, deleted_at: null },
    // No price: the sour's cost is not complete.
    { id: SYRUP, restaurant_id: HOUSE_A, display_name: "Simple Syrup", kind: "food", uom: "ml", bottle_size_ml: null, last_purchase_price: null, is_active: true, deleted_at: null },
    { id: B_GIN, restaurant_id: HOUSE_B, display_name: "B gin", kind: "spirit", uom: "bottle", bottle_size_ml: 700, last_purchase_price: 1, is_active: true, deleted_at: null },
  );
  return rows;
}

function service(rows = withDrinks()) {
  const fake = fakeDb(rows);
  return new DishesService(fake.db, new RecipesService(fake.db));
}

describe("drinks: which of the house's drinks use an item", () => {
  it("lists the drinks whose CURRENT recipe links the item, with its lines, cost a serve and price", async () => {
    const out = await service().drinksUsingItem(HOUSE_A, GIN, "owner");
    expect(out.drinks.map((d) => d.name)).toEqual(["Gin Sour", "House G&T"]);
    const gt = out.drinks.find((d) => d.cocktailId === GT)!;
    expect(gt).toMatchObject({ section: "Highballs", price: 12, yieldServes: 1, lineCount: 2, hasRecipe: true });
    expect(gt.uses).toEqual([{ label: "Gin", qtyEntered: 50, unitCode: "ml" }]);
    // 50 ml of a 700 ml bottle at 21 is 1.50; the untracked lime is not counted.
    expect(gt.cost).toMatchObject({ perServe: 1.5, complete: true, priced: 1, of: 1 });
    // The display name is the drink's name; the old version's 999 ml is not here.
    expect(JSON.stringify(out)).not.toMatch(/Old gin line|Retired fizz|Catalogue martini|B-ONLY|B-SECRET|Lemon tart|Gin glaze/);
  });

  it("a drink with an unpriced line has an incomplete cost, never a smaller one", async () => {
    const out = await service().drinksUsingItem(HOUSE_A, GIN, "owner");
    const sour = out.drinks.find((d) => d.cocktailId === SOUR)!;
    expect(sour).toMatchObject({ price: null, yieldServes: 2 });
    expect(sour.cost).toMatchObject({ complete: false, perServe: null, priced: 1, of: 2 });
  });

  it("a dish that uses the item is listed as a dish, and never as a drink", async () => {
    const svc = service();
    expect((await svc.dishesUsingItem(HOUSE_A, GIN, "owner")).dishes.map((d) => d.name)).toEqual(["Lemon tart"]);
    expect((await svc.drinksUsingItem(HOUSE_A, GIN, "owner")).drinks.map((d) => d.name)).not.toContain("Lemon tart");
  });

  it("another house's item is a 404, never its drinks", async () => {
    await expect(service().drinksUsingItem(HOUSE_A, B_GIN, "owner")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("an item no current drink uses is an empty list", async () => {
    const rows = withDrinks();
    rows.recipe_lines = rows.recipe_lines.filter((l) => l.inventory_id !== SYRUP);
    expect(await service(rows).drinksUsingItem(HOUSE_A, SYRUP, "owner")).toEqual({ drinks: [] });
  });

  it("staff read the drinks without price or cost", async () => {
    const out = await service().drinksUsingItem(HOUSE_A, GIN, "staff");
    expect(out.drinks.map((d) => [d.name, d.price, d.cost])).toEqual([
      ["Gin Sour", null, null],
      ["House G&T", null, null],
    ]);
  });

  it("reads every line of the item past the 1,000-row cap", async () => {
    const rows = withDrinks();
    rows.recipe_lines = [
      ...Array.from({ length: 1000 }, (_, i) => line(`a${String(i).padStart(5, "0")}`, V_GT_1, HOUSE_A, i + 1, "Old", GIN, ml(1))),
      line("z-current", V_GT_2, HOUSE_A, 1, "Gin", GIN, ml(50)),
    ];
    const out = await service(rows).drinksUsingItem(HOUSE_A, GIN, "owner");
    expect(out.drinks.map((d) => d.name)).toEqual(["House G&T"]);
  });

  it("a failed read is a 503 with its sentence, never an empty list", async () => {
    const fake = fakeDb(withDrinks());
    const client = fake.db.getClient() as unknown as { from: (t: string) => unknown };
    const real = client.from;
    client.from = (t: string) => {
      const q = real(t) as Record<string, unknown>;
      // Every builder method returns this same object, so its answer is what the chain awaits.
      if (t === "recipe_current") q.then = (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "boom" } });
      return q;
    };
    const svc = new DishesService(fake.db, new RecipesService(fake.db));
    const err = await svc.drinksUsingItem(HOUSE_A, GIN, "owner").catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.message).toBe(DRINK_USE_UNREAD);
  });
});

/**
 * Every drink on the list with its figures, for the cost and pour cost columns
 * of /cocktails (r28 recipes audit, gap 9). The same figures as the drawer's
 * drink cards.
 */
describe("drinks: the list's figures", () => {
  it("gives each live drink of the house its price and cost a serve, never another house's or the catalogue's", async () => {
    const out = await service().drinkFigures(HOUSE_A, "owner");
    expect(out.drinks.map((d) => d.cocktailId).sort()).toEqual([GT, SOUR].sort());
    const gt = out.drinks.find((d) => d.cocktailId === GT)!;
    expect(gt).toMatchObject({ price: 12, hasRecipe: true, yieldServes: 1, lineCount: 2 });
    expect(gt.cost).toMatchObject({ perServe: 1.5, complete: true, priced: 1, of: 1 });
    expect(JSON.stringify(out)).not.toMatch(new RegExp([GONE_DRINK, CATALOGUE, B_DRINK].join("|")));
  });

  it("a drink with an unpriced line has no cost a serve, never a smaller one", async () => {
    const sour = (await service().drinkFigures(HOUSE_A, "owner")).drinks.find((d) => d.cocktailId === SOUR)!;
    expect(sour).toMatchObject({ price: null, yieldServes: 2 });
    expect(sour.cost).toMatchObject({ complete: false, perServe: null, priced: 1, of: 2 });
  });

  it("a drink with no recipe is listed with no figures", async () => {
    const rows = withDrinks();
    rows.recipe_current = rows.recipe_current.filter((p) => p.cocktail_id !== SOUR);
    const sour = (await service(rows).drinkFigures(HOUSE_A, "owner")).drinks.find((d) => d.cocktailId === SOUR)!;
    expect(sour).toEqual({ cocktailId: SOUR, price: null, hasRecipe: false, yieldServes: null, lineCount: 0, cost: null });
  });

  it("staff get no price and no cost", async () => {
    const out = await service().drinkFigures(HOUSE_A, "staff");
    expect(out.drinks.map((d) => [d.price, d.cost])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("reads every drink past the 1,000-row cap", async () => {
    const rows = withDrinks();
    rows.cocktails.push(
      ...Array.from({ length: 1000 }, (_, i) => ({
        id: `c1000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        restaurant_id: HOUSE_A, name: `Filler ${i}`, display_name: null, menu_section: null, price: null, deleted_at: null,
      })),
    );
    const out = await service(rows).drinkFigures(HOUSE_A, "owner");
    expect(out.drinks).toHaveLength(1002);
    expect(out.drinks.find((d) => d.cocktailId === SOUR)?.hasRecipe).toBe(true);
  });

  it("a failed read is a 503 with its sentence, never a list with no costs", async () => {
    for (const table of ["cocktails", "recipe_lines"]) {
      const fake = fakeDb(withDrinks());
      const client = fake.db.getClient() as unknown as { from: (t: string) => unknown };
      const real = client.from;
      client.from = (t: string) => {
        const q = real(t) as Record<string, unknown>;
        if (t === table) q.then = (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "boom" } });
        return q;
      };
      const err = await new DishesService(fake.db, new RecipesService(fake.db)).drinkFigures(HOUSE_A, "owner").catch((e) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.message).toBe(DRINK_FIGURES_UNREAD);
    }
  });
});
