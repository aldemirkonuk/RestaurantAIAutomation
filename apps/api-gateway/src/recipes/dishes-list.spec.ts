import { NotFoundException } from "@nestjs/common";
import { DishesService, dishNameTaken } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { B_DISH, GONE, HOUSE_A, TART, V_TART_2, fakeDb, twoHouses } from "./dishes.testing";

/**
 * A house's dish list, and adding and changing a dish (ADR 0366), through the
 * real services over two houses' rows that the fake filters and caps at 1,000.
 * Route guards for these handlers are in dishes-recipe.spec.ts.
 */

function services(rows = twoHouses(), opts: Parameters<typeof fakeDb>[1] = {}) {
  const fake = fakeDb(rows, opts);
  const recipes = new RecipesService(fake.db);
  return { dishes: new DishesService(fake.db, recipes), ...fake };
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
    expect(JSON.stringify(out)).not.toMatch(/B-ONLY|Retired pie/);
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
    const stray = "d0000000-0000-4000-8000-0000000000a9";
    rows.recipe_current_dish.push({ dish_id: stray, version_id: V_TART_2, restaurant_id: HOUSE_A });
    rows.dishes.push({ id: stray, restaurant_id: HOUSE_A, name: "Stray", price: null, deleted_at: null });
    const { dishes } = services(rows);
    expect((await dishes.listDishes(HOUSE_A, "owner")).find((d) => d.name === "Stray")!.hasRecipe).toBe(false);
  });
});

describe("dishes: adding and changing a dish", () => {
  it("adds a dish in this house, its name's spaces folded and a blank section null", async () => {
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

describe("dishes: taking a dish off the list", () => {
  it("soft-deletes this house's live dish, keeps its versions, and the list stops reading it", async () => {
    const rows = twoHouses();
    const versionsBefore = rows.recipe_versions.length;
    const { dishes } = services(rows);
    await expect(dishes.removeDish(HOUSE_A, TART)).resolves.toEqual({ id: TART, name: "Lemon tart", removed: true });
    expect(rows.dishes.find((d) => d.id === TART)!.deleted_at).toEqual(expect.any(String));
    expect(rows.recipe_versions.length).toBe(versionsBefore);
    const list = await dishes.listDishes(HOUSE_A, "owner");
    expect(list.map((d) => d.id)).not.toContain(TART);
  });

  it("another house's dish, and one already removed, are a 404 and stay as they were", async () => {
    const rows = twoHouses();
    const { dishes } = services(rows);
    await expect(dishes.removeDish(HOUSE_A, B_DISH)).rejects.toBeInstanceOf(NotFoundException);
    expect(rows.dishes.find((d) => d.id === B_DISH)!.deleted_at ?? null).toBeNull();
    await expect(dishes.removeDish(HOUSE_A, GONE)).rejects.toBeInstanceOf(NotFoundException);
    expect(rows.dishes.find((d) => d.id === GONE)!.deleted_at).toBe("2026-10-01");
  });
});
