import { drawArgs, planRecipeDraw } from "./recipe-draw";

/**
 * Inventory r28 gap 1, slice 3b: what the gateway sends record_recipe_draw
 * (migration 20271020110000_a_recipe_sale_books_its_draw). The ledger key is
 * pinned on each side: drawKey in recipe-draw.spec.ts, the SQL key by case D1.
 */

describe("drawArgs carries the plan to record_recipe_draw", () => {
  it("sends each draw's measure, unit and exact amount, the big integers as strings", () => {
    const plan = planRecipeDraw(
      {
        id: "v-1",
        yieldServes: 1,
        lines: [
          { position: 1, role: "stocked", inventoryId: "gin", label: "gin", qtyBase: 450, baseUnit: "ml10" },
          { position: 2, role: "stocked", inventoryId: "salt", label: "salt", qtyBase: 7_500, baseUnit: "mg" },
        ],
      },
      3,
      new Map([
        ["gin", { uom: "bottle", bottleSizeMl: 700 }],
        ["salt", { uom: "g", bottleSizeMl: null }],
      ]),
    );
    if (plan.kind !== "draw") throw new Error("expected a draw");
    const args = drawArgs("house-1", "pos:sim:c1:negroni:0", "cocktail-1", plan, "2026-11-13T10:00:00.000Z");
    expect(args).toEqual({
      p_restaurant: "house-1",
      p_sale_key: "pos:sim:c1:negroni:0",
      p_version_id: "v-1",
      p_cocktail_id: "cocktail-1",
      p_occurred_at: "2026-11-13T10:00:00.000Z",
      p_draws: [
        { inventory_id: "gin", via: "pour", base_unit: "ml10", base_per_unit: "10", exact_micro: "1350000000" },
        { inventory_id: "salt", via: "book", base_unit: "mg", base_per_unit: "1000", exact_micro: "22500000000" },
      ],
    });
    expect(JSON.parse(JSON.stringify(args))).toEqual(args);
  });
});
