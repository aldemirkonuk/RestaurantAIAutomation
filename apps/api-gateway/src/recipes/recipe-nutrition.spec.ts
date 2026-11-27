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
  alcoholMl: null,
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

  it("sums pure alcohol from each line's stated ABV; a mixer that states none is unknown for it, never 0", () => {
    const out = serveNutrition(
      [
        line("Gin", { qtyBase: 500, figures: per100ml({ alcoholMl: 40 }) }), // 50 ml at 40%
        line("Tonic", { qtyBase: 2000, figures: per100ml({ energyKcal: 34 }) }), // no strength stated
      ],
      1,
    );
    expect(out.figures.alcoholMl).toEqual({ value: 20, atLeast: true, missing: ["Tonic"] });
  });

  it("counts a mixer that states 0% as 0, and divides a batch's alcohol by its serves", () => {
    const out = serveNutrition(
      [
        line("Gin", { qtyBase: 5000, figures: per100ml({ alcoholMl: 40 }) }), // 500 ml
        line("Tonic", { qtyBase: 20000, figures: per100ml({ alcoholMl: 0 }) }),
      ],
      10,
    );
    expect(out.figures.alcoholMl).toEqual({ value: 20, atLeast: false, missing: [] });
  });

  it("never counts a weighed line's alcohol: a strength is a share of a volume", () => {
    const out = serveNutrition(
      [
        line("Gin", { qtyBase: 500, figures: per100ml({ alcoholMl: 40 }) }),
        line("Sugar", { baseUnit: "mg", qtyBase: 10000, figures: { ...per100ml({ carbohydrateG: 100 }), basis: "100g" } }),
      ],
      1,
    );
    expect(out.figures.alcoholMl).toEqual({ value: 20, atLeast: true, missing: ["Sugar"] });
  });

  it("a line that states 0% adds 0 alcohol even with no amount or counted in pieces; one that states nothing stays unknown", () => {
    const out = serveNutrition(
      [
        line("Gin", { qtyBase: 500, figures: per100ml({ alcoholMl: 40 }) }), // 20 ml pure alcohol
        line("Tonic", { qtyBase: 0, figures: per100ml({ alcoholMl: 0, energyKcal: 34 }) }), // "top with", no amount
        line("Soda", { baseUnit: "each_milli", qtyBase: 1000, figures: per100ml({ alcoholMl: 0 }) }), // 1 can
      ],
      1,
    );
    expect(out.figures.alcoholMl).toEqual({ value: 20, atLeast: false, missing: [] });
    // Every other figure still says it could not count them.
    expect(out.figures.energyKcal).toEqual({ value: null, atLeast: false, missing: ["Tonic", "Soda", "Gin"] });
    expect(out.notCounted.map((n) => n.label)).toEqual(["Tonic", "Soda"]);

    const garnished = serveNutrition(
      [
        line("Gin", { qtyBase: 500, figures: per100ml({ alcoholMl: 40 }) }),
        line("Cherry", { baseUnit: "each_milli", qtyBase: 1000, figures: { ...per100ml({}), basis: "100g" } }),
        line("Orange peel", { role: "untracked", inventoryId: null }),
      ],
      1,
    );
    // A brandied cherry is counted in pieces too: no stated strength is never read as none.
    expect(garnished.figures.alcoholMl).toEqual({ value: 20, atLeast: true, missing: ["Cherry", "Orange peel"] });
  });

  it("a drink of only 0% lines not counted by volume says 0 ml, not unknown", () => {
    const out = serveNutrition([line("Ginger beer", { baseUnit: "each_milli", qtyBase: 1000, figures: per100ml({ alcoholMl: 0 }) })], 1);
    expect(out.figures.alcoholMl).toEqual({ value: 0, atLeast: false, missing: [] });
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
  it("names every line that leaves an allergen unstated, untracked and unlinked lines too", () => {
    const allFree = ["gluten", "crustaceans", "eggs", "fish", "peanuts", "soy", "milk", "tree_nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs"].map(
      (allergen) => ({ allergen, status: "free" }),
    );
    const out = serveNutrition(
      [
        line("Gin", { allergens: allFree }),
        line("Campari", { allergens: [{ allergen: "milk", status: "free" }] }),
        line("Orange twist", { role: "untracked", inventoryId: null }),
        line("Vermouth", { inventoryId: null }),
      ],
      1,
    );
    expect(out.allergensUnstatedBy).toEqual(["Campari", "Orange twist", "Vermouth"]);
    expect(serveNutrition([line("Gin", { allergens: allFree })], 1).allergensUnstatedBy).toEqual([]);
  });
});
