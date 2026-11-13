/**
 * r28 recipes audit, gap 7, slice 1: a recipe line measured one way meets a
 * good kept another way only through a weight the house stated for that very
 * good, and the cost says which statement a line waits for.
 *
 * part 1  recipeCost: each bridge prices the line, and a missing statement
 *         is named in `needs` beside `unit_mismatch`;
 * part 2  the service: the sheet carries the weights and `needs`, and the
 *         preview prices through them.
 */
import { CostLineInput, recipeCost } from "./recipe-cost";
import { RecipesService } from "./recipes.service";
import { HOUSE_A, HOUSE_B, TART, fakeDb, twoHouses } from "./dishes.testing";

/* ── part 1: cost ─────────────────────────────────────────────────────── */

const lot = (wac: number) => ({ has_invoice_cost: true, wac, wac_qty: 2, live_qty: 2 });
const costLine = (
  baseUnit: CostLineInput["baseUnit"],
  qtyBase: number,
  item: CostLineInput["item"],
  wac: number,
): CostLineInput => ({ role: "stocked", inventoryId: "i", qtyBase, baseUnit, item, lot: lot(wac) });
const one = (l: CostLineInput) => recipeCost([l], 1);

describe("recipeCost: a line meets its good through a weight the house stated", () => {
  it("prices 2 eggs against eggs kept by the kg, one egg weighing 60 g: 2 x 0.06 kg x 50 = 6.00", () => {
    const c = one(costLine("each_milli", 2000, { uom: "kg", piece_grams: "60.000" }, 50));
    expect(c.perServe).toBe(6);
    expect(c.complete).toBe(true);
    expect(c.lines[0].needs).toBeUndefined();
  });

  it("prices a piece against a good kept by the g, and by the mg", () => {
    // 1 lemon of 100 g at 0.02 a g = 2.00; at 0.00002 a mg the same.
    expect(one(costLine("each_milli", 1000, { uom: "g", piece_grams: 100 }, 0.02)).perServe).toBe(2);
    expect(one(costLine("each_milli", 1000, { uom: "mg", piece_grams: 100 }, 0.00002)).perServe).toBe(2);
  });

  it("asks what one weighs, and never guesses, when a piece meets a weighed good with no statement", () => {
    const c = one(costLine("each_milli", 2000, { uom: "kg" }, 50));
    expect(c.lines[0]).toEqual({ status: "linked", costPerServe: null, costPerServeExact: null, costBasis: "unit_mismatch", needs: "piece_grams" });
    expect(c.perServe).toBeNull();
  });

  it("prices 50 g of butter against a 250 g block counted in pieces: 50 / 250 x 50 = 10.00", () => {
    expect(one(costLine("mg", 50_000, { uom: "each", piece_grams: 250 }, 50)).perServe).toBe(10);
    expect(one(costLine("mg", 50_000, { uom: "each" }, 50)).lines[0]).toMatchObject({ costBasis: "unit_mismatch", needs: "piece_grams" });
  });

  it("prices 2 tbsp (30 ml) of flour kept by the kg at 20, one ml weighing 0.53 g: 15.9 g = 0.32", () => {
    const c = one(costLine("ml10", 300, { uom: "kg", ml_grams: 0.53 }, 20));
    expect(c.lines[0].costPerServeExact).toBe(0.318);
    expect(c.perServe).toBe(0.32);
    expect(one(costLine("ml10", 300, { uom: "kg" }, 20)).lines[0]).toMatchObject({ costBasis: "unit_mismatch", needs: "ml_grams" });
  });

  it("prices 20 g of syrup from a 700 ml bottle at 140, one ml weighing 1.3 g: 15.38 ml = 3.08", () => {
    const c = one(costLine("mg", 20_000, { uom: "bottle", bottle_size_ml: 700, ml_grams: 1.3 }, 140));
    expect(c.lines[0].costPerServeExact).toBe(3.076923);
    expect(c.perServe).toBe(3.08);
  });

  it("prices 100 g of milk kept by the ml at 0.03 and by the l at 30, one ml weighing 1.03 g", () => {
    expect(one(costLine("mg", 100_000, { uom: "ml", ml_grams: 1.03 }, 0.03)).perServe).toBe(2.91);
    expect(one(costLine("mg", 100_000, { uom: "l", ml_grams: 1.03 }, 30)).perServe).toBe(2.91);
    expect(one(costLine("mg", 100_000, { uom: "ml" }, 0.03)).lines[0]).toMatchObject({ costBasis: "unit_mismatch", needs: "ml_grams" });
  });

  it("says a bottle's size is not known before it asks for a weight", () => {
    const c = one(costLine("mg", 20_000, { uom: "bottle", bottle_size_ml: null, ml_grams: 1.3 }, 140));
    expect(c.lines[0]).toEqual({ status: "linked", costPerServe: null, costPerServeExact: null, costBasis: "size_not_known" });
  });

  it.each([
    ["a piece of a liquid", "each_milli", { uom: "ml", piece_grams: 50, ml_grams: 1 }],
    ["a piece of a bottle", "each_milli", { uom: "bottle", bottle_size_ml: 700, piece_grams: 900 }],
    ["a volume of a good counted in pieces", "ml10", { uom: "each", piece_grams: 50, ml_grams: 1 }],
  ] as const)("keeps %s a plain mismatch: a pack size closes it, not a weight", (_n, baseUnit, item) => {
    const c = one(costLine(baseUnit, 1000, item, 10));
    expect(c.lines[0]).toEqual({ status: "linked", costPerServe: null, costPerServeExact: null, costBasis: "unit_mismatch" });
  });

  it("keeps a pack's own reason: a weight does not say how many a case holds", () => {
    expect(one(costLine("each_milli", 1000, { uom: "case", piece_grams: 100 }, 10)).lines[0]).toEqual({
      status: "linked", costPerServe: null, costPerServeExact: null, costBasis: "unit_mismatch",
    });
    expect(one(costLine("mg", 1000, { uom: "pack", piece_grams: 100 }, 10)).lines[0].costBasis).toBe("pack_size_not_known");
  });

  it.each([0, -5, "abc", "", null])("reads a stated weight of %p as not stated", (bad) => {
    const c = one(costLine("each_milli", 2000, { uom: "kg", piece_grams: bad as never }, 50));
    expect(c.lines[0]).toMatchObject({ costPerServe: null, needs: "piece_grams" });
  });

  it("leaves a line already measured the good's way untouched by a stated weight", () => {
    // 30 ml of gin from a 700 ml bottle at 700: 30.00, whatever one ml weighs.
    expect(one(costLine("ml10", 300, { uom: "bottle", bottle_size_ml: 700, ml_grams: 0.95, piece_grams: 1200 }, 700)).perServe).toBe(30);
  });
});

/* ── part 2: the service ──────────────────────────────────────────────── */

const EGGS = "f0000000-0000-4000-8000-0000000000e1";
function houseWithEggs(egg: Record<string, unknown> = {}) {
  const rows = twoHouses();
  rows.restaurant_inventory.push({
    id: EGGS, restaurant_id: HOUSE_A, display_name: "Eggs", kind: "food", uom: "kg", bottle_size_ml: null,
    last_purchase_price: 50, is_active: true, deleted_at: null, ...egg,
  });
  rows.recipe_lines.push({
    id: "l-egg", version_id: "e0000000-0000-4000-8000-0000000000a2", restaurant_id: HOUSE_A, position: 4, role: "stocked",
    inventory_id: EGGS, label: "Eggs", qty_entered: 2, unit_code: "each", qty_base: 2000, base_unit: "each_milli",
  });
  rows.item_nutrition = [
    { inventory_id: EGGS, restaurant_id: HOUSE_A, basis: "100g", energy_kcal: 143, fat_g: null, saturates_g: null, carbohydrate_g: null, sugars_g: null, protein_g: null, salt_g: null, abv_pct: null, energy_from_abv: false },
  ];
  rows.item_allergens = [];
  rows.inventory_lot_agreed_cost = [];
  rows.inventory_lot_invoice_cost = [];
  return rows;
}

describe("the sheet reads a good's stated weights", () => {
  it("prices and counts the eggs line once one egg's weight is stated, and says it on the line", async () => {
    const rows = houseWithEggs({ piece_grams: "60.000" });
    const svc = new RecipesService(fakeDb(rows).db);
    const out: any = await svc.getDishRecipe(HOUSE_A, TART, "owner");
    const egg = out.current.lines.find((l: any) => l.label === "Eggs");
    expect(egg).toMatchObject({ itemPieceGrams: 60, itemMlGrams: null, needs: null, costBasis: "last_purchase_price" });
    // 2 eggs x 0.06 kg x 50 over the tart's 8 serves.
    expect(egg.costPerServeExact).toBe(0.75);
  });

  it("names the weight the eggs line waits for, and does not count it, while none is stated", async () => {
    const svc = new RecipesService(fakeDb(houseWithEggs()).db);
    const out: any = await svc.getDishRecipe(HOUSE_A, TART, "owner");
    const egg = out.current.lines.find((l: any) => l.label === "Eggs");
    expect(egg).toMatchObject({ itemPieceGrams: null, needs: "piece_grams", costBasis: "unit_mismatch", costPerServe: null });
  });

  it("gives a role without money no cost and no need", async () => {
    const svc = new RecipesService(fakeDb(houseWithEggs({ piece_grams: 60 })).db);
    const out: any = await svc.getDishRecipe(HOUSE_A, TART, "staff");
    const egg = out.current.lines.find((l: any) => l.label === "Eggs");
    expect(egg).toMatchObject({ costPerServe: null, needs: null, costBasis: null, itemPieceGrams: 60 });
  });

  it("never reads another house's stated weight for this house's line", async () => {
    const rows = houseWithEggs();
    rows.restaurant_inventory.push({ id: EGGS, restaurant_id: HOUSE_B, uom: "kg", piece_grams: 60, is_active: true, deleted_at: null });
    const svc = new RecipesService(fakeDb(rows).db);
    const out: any = await svc.getDishRecipe(HOUSE_A, TART, "owner");
    expect(out.current.lines.find((l: any) => l.label === "Eggs")).toMatchObject({ needs: "piece_grams", itemPieceGrams: null });
  });

  it("prices an unsaved draft through the stated weight, and names the need on a preview line", async () => {
    const rows = houseWithEggs({ piece_grams: 60 });
    const rpc = (_n: string, a: any) => ({ data: [{ qty_base: Math.round(a.p_qty * 1000), base_unit: "each_milli" }] });
    const svc = new RecipesService(fakeDb(rows, { rpc }).db);
    const dto = { yieldServes: 1, lines: [{ role: "stocked", inventoryId: EGGS, qtyEntered: 2, unitCode: "each" }] } as any;
    const out: any = await svc.previewDishCost(HOUSE_A, TART, dto);
    expect(out.perServe).toBe(6);
    expect(out.lines[0]).toEqual({ status: "linked", costPerServe: 6, costBasis: "last_purchase_price", needs: null });

    const bare = new RecipesService(fakeDb(houseWithEggs(), { rpc }).db);
    expect(((await bare.previewDishCost(HOUSE_A, TART, dto)) as any).lines[0].needs).toBe("piece_grams");
  });
});
