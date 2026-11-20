import { NotFoundException } from "@nestjs/common";
import { DishesService, foldName } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { B_FLOUR, FLOUR, HOUSE_A, V_TART_1, V_TART_2, fakeDb, line, twoHouses } from "./dishes.testing";

/**
 * Which dishes use a good, and the exact-name shelf match a pasted recipe
 * line proposes its link from (ADR 0366 items 5 and 7), through the real
 * services over two houses' rows that the fake filters and caps at 1,000.
 * Route guards for these handlers are in dishes-recipe.spec.ts.
 */

function dishes(rows = twoHouses()) {
  const fake = fakeDb(rows);
  return new DishesService(fake.db, new RecipesService(fake.db));
}

describe("dishes: which dishes use an item", () => {
  it("lists only the dishes whose CURRENT recipe links the item, with the item's own lines", async () => {
    const out = await dishes().dishesUsingItem(HOUSE_A, FLOUR, "owner");
    expect(out.dishes.map((d) => d.name)).toEqual(["Lemon tart"]);
    expect(out.dishes[0].uses).toEqual([
      { label: "Flour", qtyEntered: 250, unitCode: "g" },
      { label: "Flour for the base", qtyEntered: 50, unitCode: "g" },
    ]);
    expect(out.dishes[0]).toMatchObject({ yieldServes: 8, price: 9, hasRecipe: true });
    // The old version's line, the deleted dish and house B's dish are not here.
    expect(JSON.stringify(out)).not.toMatch(/Old flour line|Retired pie|B-ONLY|B-SECRET/);
  });

  it("another house's item is a 404, never its dishes", async () => {
    await expect(dishes().dishesUsingItem(HOUSE_A, B_FLOUR, "owner")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("an item no current dish uses is an empty list", async () => {
    expect(await dishes().dishesUsingItem(HOUSE_A, "f0000000-0000-4000-8000-0000000000a3", "owner")).toEqual({ dishes: [] });
  });

  it("staff read the dishes without price or cost", async () => {
    const out = await dishes().dishesUsingItem(HOUSE_A, FLOUR, "staff");
    expect(out.dishes[0]).toMatchObject({ price: null, cost: null, name: "Lemon tart" });
  });

  it("reads every line of the item past the 1,000-row cap", async () => {
    const rows = twoHouses();
    // 1,000 old lines of the item come first; the current one is the 1,001st.
    rows.recipe_lines = [
      ...Array.from({ length: 1000 }, (_, i) => line(`a${String(i).padStart(5, "0")}`, V_TART_1, HOUSE_A, i + 1, "Old", FLOUR)),
      line("z-current", V_TART_2, HOUSE_A, 1, "Flour", FLOUR),
    ];
    const out = await dishes(rows).dishesUsingItem(HOUSE_A, FLOUR, "owner");
    expect(out.dishes.map((d) => d.name)).toEqual(["Lemon tart"]);
  });
});

describe("dishes: a pasted label proposes its shelf item by exact name", () => {
  it("matches case- and space-folded names of this house's live items only", async () => {
    const out = await dishes().matchShelf(HOUSE_A, ["bread  flour", "Tonic Water", "Lemons", "Old salt", "Flour"]);
    expect(out.map((m) => m.item?.name ?? null)).toEqual(["Bread Flour", "Tonic  Water", null, null, null]);
  });

  it("two shelf items of one name match neither, and say how many", async () => {
    const [m] = await dishes().matchShelf(HOUSE_A, ["SUGAR"]);
    expect(m).toMatchObject({ item: null, sameName: 2 });
  });

  it("folds runs of spaces, case the Turkish way, the dotless i and accents; nothing else", () => {
    expect(foldName("  Bread  FLOUR ")).toBe("bread flour");
    expect(foldName("Flour")).not.toBe(foldName("Flours"));
    // r28 gap 14: "RAKI" and "Rakı" are one name; so are "İSOT" and "isot", "ŞEKER" and "seker".
    expect(foldName("RAKI")).toBe(foldName("Rakı"));
    expect(foldName("Rakı")).toBe("raki");
    expect(foldName("İSOT")).toBe("isot");
    expect(foldName("ŞEKER")).toBe("seker");
    expect(foldName("Crème  brûlée")).toBe("creme brulee");
  });

  it("a RAKI line proposes the house's Rakı (r28 gap 14)", async () => {
    const rows = twoHouses();
    rows.restaurant_inventory.push({ id: "f0000000-0000-4000-8000-0000000000b9", restaurant_id: HOUSE_A, display_name: "Yeni Rakı", kind: "spirit", uom: "bottle", bottle_size_ml: 700, is_active: true, deleted_at: null });
    const out = await dishes(rows).matchShelf(HOUSE_A, ["YENİ RAKI", "yeni raki"]);
    expect(out.map((m) => m.item?.name ?? null)).toEqual(["Yeni Rakı", "Yeni Rakı"]);
  });
});
