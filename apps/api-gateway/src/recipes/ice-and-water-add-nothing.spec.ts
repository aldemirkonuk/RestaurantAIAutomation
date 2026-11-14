import { ALLERGENS, ItemFigures, NutritionLineInput, addsNothing, serveNutrition } from "./recipe-nutrition";

/**
 * Ice and plain water add nothing (r36 recipes audit, gap 6).
 *
 * The paste reader makes ice and water lines untracked, and an untracked line
 * made every figure "at least" and every allergen "not stated". So a drink
 * served over ice could never have a whole card: "No allergen can be ruled
 * out: Ice does not say what it contains". Plain ice and water are known
 * zeros; garnishes, tonic, soda and every other untracked line stay unknown.
 */

const per100ml = (f: Partial<ItemFigures>): ItemFigures => ({
  basis: "100ml",
  energyFromAbv: false,
  energyKcal: null,
  fatG: null,
  saturatesG: null,
  carbohydrateG: null,
  sugarsG: null,
  proteinG: null,
  saltG: null,
  alcoholMl: null,
  ...f,
});
const allFree = ALLERGENS.map((allergen) => ({ allergen, status: "free" }));
const gin = (): NutritionLineInput => ({
  label: "Gin",
  role: "stocked",
  inventoryId: "item-gin",
  qtyBase: 500, // 50 ml
  baseUnit: "ml10",
  figures: per100ml({ energyKcal: 222, fatG: 0, saturatesG: 0, carbohydrateG: 0, sugarsG: 0, proteinG: 0, saltG: 0, alcoholMl: 40 }),
  allergens: allFree,
});
const untracked = (label: string): NutritionLineInput => ({
  label,
  role: "untracked",
  inventoryId: null,
  qtyBase: 1000,
  baseUnit: "each_milli",
  figures: null,
  allergens: [],
});

describe("ice and plain water add nothing", () => {
  it("a drink of a fully stated good over ice has a whole card", () => {
    const out = serveNutrition([gin(), untracked("Ice"), untracked("still water")], 1);
    expect(out.figures.energyKcal).toEqual({ value: 111, atLeast: false, missing: [] });
    expect(out.figures.alcoholMl).toEqual({ value: 20, atLeast: false, missing: [] });
    expect(out.notCounted).toEqual([]);
    expect(out.allergensUnstatedBy).toEqual([]);
    expect(Object.values(out.allergens).every((s) => s === "free")).toBe(true);
    expect(out.counted).toBe(3);
  });

  it("a garnish still makes the card partial and names itself", () => {
    const out = serveNutrition([gin(), untracked("Ice"), untracked("Orange peel")], 1);
    expect(out.figures.energyKcal).toEqual({ value: 111, atLeast: true, missing: ["Orange peel"] });
    expect(out.allergensUnstatedBy).toEqual(["Orange peel"]);
    expect(out.allergens.milk).toBe("not_stated");
    expect(out.notCounted.map((n) => n.label)).toEqual(["Orange peel"]);
  });

  it("an allergen another line contains is still said", () => {
    const egg = { ...gin(), label: "Egg white", allergens: allFree.map((a) => (a.allergen === "eggs" ? { ...a, status: "contains" } : a)) };
    expect(serveNutrition([egg, untracked("crushed ice")], 1).allergens.eggs).toBe("contains");
  });

  it("ice never turns a figure no line states into 0", () => {
    const quiet = { ...gin(), figures: per100ml({ energyKcal: 222 }) };
    const out = serveNutrition([quiet, untracked("Ice")], 1);
    expect(out.figures.saltG).toEqual({ value: null, atLeast: false, missing: ["Gin"] });
  });

  it("a serve of only ice and water is 0 of everything, and free of every allergen", () => {
    const out = serveNutrition([untracked("Ice"), untracked("water")], 2);
    expect(out.figures.energyKcal).toEqual({ value: 0, atLeast: false, missing: [] });
    expect(out.allergens.gluten).toBe("free");
  });

  it.each(["Ice", "ICE", "crushed ice", "Ice cubes", "cracked ice", "water", "Still Water", "hot water", "Buz", "KIRIK BUZ", "küp buz", "Su", "soğuk su", "içme suyu"])(
    "%s adds nothing",
    (label) => {
      expect(addsNothing(untracked(label))).toBe(true);
    },
  );

  it.each(["tonic water", "soda water", "coconut water", "ice cream", "iced tea", "rose water", "maden suyu", "portakal suyu", "orange peel", "mint sprig", "dry ice"])(
    "%s is not plain ice or water, so it stays unknown",
    (label) => {
      expect(addsNothing(untracked(label))).toBe(false);
    },
  );

  it("a line counted from the shelf speaks for itself, even named Ice", () => {
    const shelfIce = { ...gin(), label: "Ice", figures: null, allergens: [] };
    expect(addsNothing(shelfIce)).toBe(false);
    expect(serveNutrition([gin(), shelfIce], 1).figures.energyKcal.atLeast).toBe(true);
  });
});
