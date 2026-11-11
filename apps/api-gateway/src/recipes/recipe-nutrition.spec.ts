import { ItemFigures, NutritionLineInput, serveNutrition } from "./recipe-nutrition";

/** Invariant: a figure is a number only when a counted line states it; unknown is never 0. */
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
  ...f,
});
const line = (label: string, more: Partial<NutritionLineInput>): NutritionLineInput => ({
  label,
  role: "stocked",
  inventoryId: `item-${label}`,
  qtyBase: 300,
  baseUnit: "ml10",
  figures: null,
  allergens: [],
  ...more,
});

describe("serveNutrition", () => {
  it("sums linked lines per 100 ml by their millilitres, per serve", () => {
    const out = serveNutrition(
      [
        line("Gin", { qtyBase: 450, figures: per100ml({ energyKcal: 222, carbohydrateG: 0 }) }), // 45 ml
        line("Syrup", { qtyBase: 150, figures: per100ml({ energyKcal: 260, carbohydrateG: 65 }) }), // 15 ml
      ],
      1,
    );
    expect(out.figures.energyKcal).toEqual({ value: 138.9, atLeast: false, missing: [] });
    expect(out.figures.carbohydrateG).toEqual({ value: 9.75, atLeast: false, missing: [] });
    expect(out.figures.fatG).toEqual({ value: null, atLeast: false, missing: ["Gin", "Syrup"] });
    expect(out.notCounted).toEqual([]);
    expect(out).toMatchObject({ counted: 2, of: 2 });
  });

  it("divides a batch by its serves, as the cost does", () => {
    const out = serveNutrition([line("Gin", { qtyBase: 4500, figures: per100ml({ energyKcal: 222 }) })], 10);
    expect(out.figures.energyKcal.value).toBe(99.9);
  });

  it("reads an unlinked or untracked line as unknown for it, never 0, and says why", () => {
    const out = serveNutrition(
      [
        line("Gin", { figures: per100ml({ energyKcal: 222 }) }),
        line("Campari", { inventoryId: null }),
        line("Orange peel", { role: "untracked", inventoryId: null, baseUnit: "each_milli", qtyBase: 1000 }),
      ],
      1,
    );
    expect(out.figures.energyKcal).toEqual({ value: 66.6, atLeast: true, missing: ["Campari", "Orange peel"] });
    expect(out.notCounted).toEqual([
      { label: "Campari", why: "it is not linked to anything on the shelf" },
      { label: "Orange peel", why: "it is not counted from the shelf" },
    ]);
  });

  it("keeps every figure null when no line states anything: unknown, not a drink of zeros", () => {
    const out = serveNutrition([line("Gin", {}), line("Tonic", { inventoryId: null })], 1);
    for (const f of Object.values(out.figures)) expect(f.value).toBeNull();
    expect(out.figures.energyKcal.missing).toEqual(["Gin", "Tonic"]);
    expect(out.counted).toBe(0);
  });

  it("never turns grams into millilitres: a weighed line against per 100 ml figures is not counted", () => {
    const out = serveNutrition(
      [line("Sugar", { baseUnit: "mg", qtyBase: 10000, figures: per100ml({ energyKcal: 400 }) })],
      1,
    );
    expect(out.figures.energyKcal.value).toBeNull();
    expect(out.notCounted).toEqual([{ label: "Sugar", why: "it is weighed, but its figures are per 100 ml" }]);
    const grams = serveNutrition(
      [line("Sugar", { baseUnit: "mg", qtyBase: 10000, figures: { ...per100ml({ energyKcal: 400 }), basis: "100g" } })],
      1,
    );
    expect(grams.figures.energyKcal).toEqual({ value: 40, atLeast: false, missing: [] });
  });

  it("marks energy from ABV as at least: it is the alcohol alone", () => {
    const out = serveNutrition([line("Gin", { figures: per100ml({ energyKcal: 220.9, energyFromAbv: true }) })], 1);
    expect(out.figures.energyKcal).toMatchObject({ value: 66.27, atLeast: true });
  });

  it("says free only when every line, untracked ones too, states it free", () => {
    const free = [{ allergen: "milk", status: "free" }];
    const all = serveNutrition([line("Gin", { allergens: free }), line("Vermouth", { allergens: free })], 1);
    expect(all.allergens.milk).toBe("free");
    const withIce = serveNutrition(
      [line("Gin", { allergens: free }), line("Egg white", { role: "untracked", inventoryId: null })],
      1,
    );
    expect(withIce.allergens.milk).toBe("not_stated");
    const contains = serveNutrition(
      [line("Gin", { allergens: free }), line("Cream", { allergens: [{ allergen: "milk", status: "contains" }] })],
      1,
    );
    expect(contains.allergens.milk).toBe("contains");
  });
});
