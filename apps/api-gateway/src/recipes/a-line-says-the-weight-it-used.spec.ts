/**
 * r28 recipes audit, gap 7, what r32 left: a line priced through a weight the
 * house stated says which weight and how many grams, so the sheet can show the
 * figure behind the price and a mistyped weight (600 g for one egg) is seen
 * and changed where it is used, not only guessed at from a price.
 *
 * part 1  recipeCost: each of the four bridges names the weight it used; a
 *         line measured the good's own way, or waiting for a weight, names
 *         none;
 * part 2  the service: the sheet and the preview carry it, and a role that
 *         does not see money does not get it.
 */
import { CostLineInput, recipeCost } from "./recipe-cost";
import { RecipesService } from "./recipes.service";
import { HOUSE_A, TART, fakeDb, twoHouses } from "./dishes.testing";

/* ── part 1: cost ─────────────────────────────────────────────────────── */

const lot = (wac: number) => ({ has_invoice_cost: true, wac, wac_qty: 2, live_qty: 2 });
const line = (baseUnit: CostLineInput["baseUnit"], qtyBase: number, item: CostLineInput["item"], wac: number) =>
  recipeCost([{ role: "stocked", inventoryId: "i", qtyBase, baseUnit, item, lot: lot(wac) }], 1).lines[0];

describe("recipeCost: a line says the stated weight it was priced through", () => {
  it("names one piece's weight on 2 eggs against eggs kept by the kg", () => {
    expect(line("each_milli", 2000, { uom: "kg", piece_grams: "60.000" }, 50)).toEqual({
      status: "linked",
      costPerServe: 6,
      costPerServeExact: 6,
      costBasis: "invoice_lot_wac",
      weighed: { by: "piece_grams", grams: 60 },
    });
  });

  it("names one piece's weight on 50 g of butter against a block counted in pieces", () => {
    expect(line("mg", 50_000, { uom: "each", piece_grams: 250 }, 50).weighed).toEqual({ by: "piece_grams", grams: 250 });
  });

  it("names one ml's weight on 2 tbsp of flour against flour kept by the kg", () => {
    expect(line("ml10", 300, { uom: "kg", ml_grams: "0.5300" }, 20).weighed).toEqual({ by: "ml_grams", grams: 0.53 });
  });

  it("names one ml's weight on 20 g of syrup from a 700 ml bottle", () => {
    expect(line("mg", 20_000, { uom: "bottle", bottle_size_ml: 700, ml_grams: 1.3 }, 140).weighed).toEqual({
      by: "ml_grams",
      grams: 1.3,
    });
  });

  it("names no weight on a line measured the good's own way, whatever weights the good has", () => {
    const l = line("ml10", 300, { uom: "bottle", bottle_size_ml: 700, ml_grams: 0.95, piece_grams: 1200 }, 700);
    expect(l.costPerServe).toBe(30);
    expect(l).not.toHaveProperty("weighed");
  });

  it("names no weight on a line still waiting for one", () => {
    const l = line("each_milli", 2000, { uom: "kg" }, 50);
    expect(l.needs).toBe("piece_grams");
    expect(l).not.toHaveProperty("weighed");
  });

  it("names no weight when the good has no price: nothing was priced through it", () => {
    const c = recipeCost(
      [{ role: "stocked", inventoryId: "i", qtyBase: 2000, baseUnit: "each_milli", item: { uom: "kg", piece_grams: 60 }, lot: null }],
      1,
    );
    expect(c.lines[0]).not.toHaveProperty("weighed");
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
  rows.item_nutrition = [];
  rows.item_allergens = [];
  rows.inventory_lot_agreed_cost = [];
  rows.inventory_lot_invoice_cost = [];
  return rows;
}

describe("the sheet says the weight a line was priced through", () => {
  it("carries one egg's 60 g on the eggs line, and nothing on the others", async () => {
    const svc = new RecipesService(fakeDb(houseWithEggs({ piece_grams: "60.000" })).db);
    const out: any = await svc.getDishRecipe(HOUSE_A, TART, "owner");
    const egg = out.current.lines.find((l: any) => l.label === "Eggs");
    expect(egg.weighed).toEqual({ by: "piece_grams", grams: 60 });
    for (const other of out.current.lines.filter((l: any) => l.label !== "Eggs")) expect(other.weighed).toBeNull();
  });

  it("carries none while the weight is not stated", async () => {
    const out: any = await new RecipesService(fakeDb(houseWithEggs()).db).getDishRecipe(HOUSE_A, TART, "owner");
    expect(out.current.lines.find((l: any) => l.label === "Eggs")).toMatchObject({ weighed: null, needs: "piece_grams" });
  });

  it("gives a role without money no weight beside a price it does not see", async () => {
    const out: any = await new RecipesService(fakeDb(houseWithEggs({ piece_grams: 60 })).db).getDishRecipe(HOUSE_A, TART, "staff");
    expect(out.current.lines.find((l: any) => l.label === "Eggs")).toMatchObject({ weighed: null, costPerServe: null });
  });

  it("carries the weight on a preview line, and none where none was used", async () => {
    const rpc = (_n: string, a: any) => ({ data: [{ qty_base: Math.round(a.p_qty * 1000), base_unit: "each_milli" }] });
    const dto = { yieldServes: 1, lines: [{ role: "stocked", inventoryId: EGGS, qtyEntered: 2, unitCode: "each" }] } as any;
    const weighed: any = await new RecipesService(fakeDb(houseWithEggs({ piece_grams: 60 }), { rpc }).db).previewDishCost(HOUSE_A, TART, dto);
    expect(weighed.lines[0].weighed).toEqual({ by: "piece_grams", grams: 60 });
    const bare: any = await new RecipesService(fakeDb(houseWithEggs(), { rpc }).db).previewDishCost(HOUSE_A, TART, dto);
    expect(bare.lines[0].weighed).toBeNull();
  });
});
