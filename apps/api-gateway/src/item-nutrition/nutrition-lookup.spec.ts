import { draftFromFoodDataCentral, draftFromOpenFoodFacts } from "./nutrition-lookup";

/**
 * A lookup's answer as a DRAFT, pure. Pinned here:
 *  - a figure the source does not give stays null, never 0;
 *  - per 100 g vs per 100 ml comes from the product, and a mismatch with the item is said;
 *  - a lookup's allergen is only ever contains / may_contain, never free;
 *  - every worked-out figure (salt from sodium, kcal from kJ) says so.
 */

describe("a draft from Open Food Facts", () => {
  it("is per 100 ml for a drink sold by volume, keeps a missing salt null, and never states an allergen free", () => {
    const d = draftFromOpenFoodFacts(
      "8690000000001",
      {
        product_name: "Ayran",
        brands: "Sütaş",
        quantity: "1 l",
        product_quantity_unit: "ml",
        nutriments: { "energy-kcal_100g": 38, fat_100g: 1.8, proteins_100g: 1.7, carbohydrates_100g: 2.6 },
        allergens_tags: ["en:milk"],
        traces_tags: ["en:nuts", "en:milk", "en:not-one-of-the-14"],
      },
      "100ml",
    );
    expect(d.basis).toBe("100ml");
    expect(d.figures.energyKcal).toBe(38);
    expect(d.figures.saltG).toBeNull();
    expect(d.figures.sugarsG).toBeNull();
    expect(d.figures.saturatesG).toBeNull();
    expect(d.productName).toBe("Ayran · Sütaş");
    expect(d.allergens).toEqual(
      expect.arrayContaining([
        { allergen: "milk", status: "contains" },
        { allergen: "tree_nuts", status: "may_contain" },
      ]),
    );
    expect(d.allergens).toHaveLength(2);
    expect(d.attribution).toContain("Open Database License");
  });

  it("works salt out from sodium and kcal from kJ, and says both", () => {
    const d = draftFromOpenFoodFacts("8690000000002", { quantity: "200 g", nutriments: { sodium_100g: 0.4, "energy-kj_100g": 1464 } }, "100g");
    expect(d.basis).toBe("100g");
    expect(d.figures.saltG).toBe(1);
    expect(d.figures.energyKcal).toBe(349.9);
    expect(d.notes.join(" ")).toMatch(/sodium/);
    expect(d.notes.join(" ")).toMatch(/kJ/);
  });

  it("says when the product is sold by volume but the item is kept by weight, and keeps the product's basis", () => {
    const d = draftFromOpenFoodFacts("8690000000003", { product_quantity_unit: "ml", nutriments: { sugars_100g: 10 } }, "100g");
    expect(d.basis).toBe("100ml");
    expect(d.notes.join(" ")).toMatch(/Check before saving/);
  });

  it("takes ABV only per 100 ml, and says so when it leaves it out", () => {
    const beer = draftFromOpenFoodFacts("8690000000004", { quantity: "50 cl", nutriments: { alcohol_100g: 5 } }, "100ml");
    expect(beer.figures.abvPct).toBe(5);
    const odd = draftFromOpenFoodFacts("8690000000005", { quantity: "250 g", nutriments: { alcohol_100g: 3 } }, "100g");
    expect(odd.figures.abvPct).toBeNull();
    expect(odd.notes.join(" ")).toMatch(/alcohol figure/);
  });

  it("says when the product has no figures at all, rather than drafting zeros", () => {
    const d = draftFromOpenFoodFacts("8690000000006", { quantity: "1 kg", nutriments: {} }, "100g");
    expect(Object.values(d.figures).every((v) => v === null)).toBe(true);
    expect(d.notes.join(" ")).toMatch(/no figures/);
  });
});

describe("a draft from FoodData Central", () => {
  it("is per 100 g, works salt out from sodium mg, leaves a missing figure null and drafts no allergens", () => {
    const d = draftFromFoodDataCentral("173430", {
      description: "Butter, salted",
      foodNutrients: [
        { nutrient: { number: "204" }, amount: 81.11 },
        { nutrient: { number: "208" }, amount: 717 },
        { nutrient: { number: "307" }, amount: 643 },
      ],
    });
    expect(d.basis).toBe("100g");
    expect(d.sourceRef).toBe("173430");
    expect(d.figures.fatG).toBe(81.11);
    expect(d.figures.energyKcal).toBe(717);
    expect(d.figures.saltG).toBe(1.61);
    expect(d.figures.proteinG).toBeNull();
    expect(d.allergens).toEqual([]);
    expect(d.notes.join(" ")).toMatch(/no allergen information/);
  });

  it("uses Atwater energy only when the plain energy figure is missing", () => {
    const d = draftFromFoodDataCentral("1", { foodNutrients: [{ nutrient: { number: "958" }, amount: 52 }] });
    expect(d.figures.energyKcal).toBe(52);
  });
});
