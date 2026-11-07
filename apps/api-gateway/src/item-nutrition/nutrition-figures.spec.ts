import { basisFor, checkWrite, figureOrNull, kcalFromAbv, type Figures } from "./nutrition-figures";

/**
 * The pure rules a write passes before it reaches save_item_nutrition()
 * (migration 20270512091500_a_good_says_what_is_in_it):
 *  - an unknown figure stays null, never 0;
 *  - per 100 g vs per 100 ml: grams are bounded by the basis, ABV only per 100 ml;
 *  - energy from ABV is the database's arithmetic to the last digit.
 */

const none: Figures = {
  energyKcal: null,
  fatG: null,
  saturatesG: null,
  carbohydrateG: null,
  sugarsG: null,
  proteinG: null,
  saltG: null,
  abvPct: null,
};

describe("the figures", () => {
  it("works out energy from ABV exactly as Postgres rounds it", () => {
    expect(kcalFromAbv(40)).toBe(220.9);
    expect(kcalFromAbv(50)).toBe(276.2); // 276.15 rounds half away from zero
    expect(kcalFromAbv(12.5)).toBe(69);
    // Postgres: round(numeric, 1) is half away from zero on the exact decimal.
    for (let t = 1; t <= 1000; t++) {
      const tenThousandths = t * 5523;
      expect(kcalFromAbv(t / 10)).toBe(Math.floor((tenThousandths + 500) / 1000) / 10);
    }
    expect(kcalFromAbv(0)).toBeNull();
    expect(kcalFromAbv(null)).toBeNull();
  });

  it("fills energy from ABV only when energy is unknown, and marks it", () => {
    const derived = checkWrite({ basis: "100ml", figures: { ...none, abvPct: 40 }, source: "house", sourceRef: null });
    expect(derived.ok && derived.row.energy_kcal).toBe(220.9);
    expect(derived.ok && derived.row.energy_from_abv).toBe(true);
    expect(derived.ok && derived.row.sugars_g).toBeNull();
    const typed = checkWrite({ basis: "100ml", figures: { ...none, abvPct: 5, energyKcal: 43 }, source: "pack_label", sourceRef: null });
    expect(typed.ok && typed.row.energy_kcal).toBe(43);
    expect(typed.ok && typed.row.energy_from_abv).toBe(false);
  });

  it("bounds grams by the basis: 120 g fits in 100 ml of syrup, not in 100 g", () => {
    expect(checkWrite({ basis: "100ml", figures: { ...none, sugarsG: 120, carbohydrateG: 125 }, source: "house", sourceRef: null }).ok).toBe(true);
    const g = checkWrite({ basis: "100g", figures: { ...none, sugarsG: 120 }, source: "house", sourceRef: null });
    expect(g.ok).toBe(false);
    expect(!g.ok && g.why).toContain("100 g");
  });

  it("refuses a lookup that names no reference, and a part above its whole", () => {
    expect(checkWrite({ basis: "100g", figures: none, source: "open_food_facts", sourceRef: " " }).ok).toBe(false);
    expect(checkWrite({ basis: "100g", figures: { ...none, fatG: 5, saturatesG: 9 }, source: "house", sourceRef: null }).ok).toBe(false);
  });

  it("suggests per 100 g for a weighed good, per 100 ml for a drink, and nothing for a food kept in packs", () => {
    expect(basisFor("food", "g")).toBe("100g");
    expect(basisFor("spirit", "bottle")).toBe("100ml");
    expect(basisFor("food", "ml")).toBe("100ml");
    expect(basisFor("food", "pack")).toBeNull();
  });
});

describe("an unknown figure", () => {
  it("is null, never 0", () => {
    expect(figureOrNull(null)).toBeNull();
    expect(figureOrNull(undefined)).toBeNull();
    expect(figureOrNull("")).toBeNull();
    expect(figureOrNull("abc")).toBeNull();
    expect(figureOrNull(0)).toBe(0);
    expect(figureOrNull("12.345")).toBe(12.35);
  });
});
