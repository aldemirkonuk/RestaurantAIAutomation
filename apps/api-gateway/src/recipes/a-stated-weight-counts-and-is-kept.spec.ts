/**
 * r28 recipes audit, gap 7, slice 2: the nutrition card counts a line
 * measured another way than its good through the same stated weights the
 * cost reads (slice 1, #1458), and an owner or manager can state them.
 *
 * part 1  serveNutrition: each bridge counts the line, and a missing
 *         statement is said in the line's reason;
 * part 2  the service: the card reads the weights beside the figures, and
 *         stateWeights keeps them, house-scoped and bounded.
 */
import "reflect-metadata";
import { BadRequestException, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { ItemFigures, NutritionLineInput, serveNutrition } from "./recipe-nutrition";
import { RecipesController } from "./recipes.controller";
import { RecipesService, WEIGHT_NOT_THIS_HOUSE } from "./recipes.service";
import { HOUSE_A, HOUSE_B, B_FLOUR, TART, fakeDb, twoHouses } from "./dishes.testing";

/* ── part 1: what is in a serve ───────────────────────────────────────── */

const per100 = (basis: "100g" | "100ml", over: Partial<ItemFigures> = {}): ItemFigures => ({
  basis, energyFromAbv: false, energyKcal: 100, fatG: null, saturatesG: null, carbohydrateG: null, sugarsG: null,
  proteinG: null, saltG: null, alcoholMl: null, ...over,
});
const nLine = (baseUnit: NutritionLineInput["baseUnit"], qtyBase: number, figures: ItemFigures, over: Partial<NutritionLineInput> = {}): NutritionLineInput => ({
  label: "X", role: "stocked", inventoryId: "i", qtyBase, baseUnit, figures, allergens: [], ...over,
});
const kcal = (l: NutritionLineInput) => serveNutrition([l], 1).figures.energyKcal;

describe("serveNutrition: a line counts through a weight the house stated", () => {
  it("counts 2 eggs of 50 g against figures per 100 g: 100 g, so 143 kcal", () => {
    const egg = per100("100g", { energyKcal: 143 });
    expect(kcal(nLine("each_milli", 2000, egg, { pieceGrams: 50 }))).toEqual({ value: 143, atLeast: false, missing: [] });
  });

  it("says what is missing for a piece with no stated weight, and never counts it", () => {
    const out = serveNutrition([nLine("each_milli", 2000, per100("100g"), { label: "Egg" })], 1);
    expect(out.notCounted).toEqual([{ label: "Egg", why: "it is counted in pieces, and what one weighs is not stated" }]);
    expect(out.figures.energyKcal.value).toBeNull();
  });

  it("keeps a piece against figures per 100 ml not counted, even with weights stated", () => {
    const out = serveNutrition([nLine("each_milli", 1000, per100("100ml"), { label: "Cola", pieceGrams: 340, mlGrams: 1.04 })], 1);
    expect(out.notCounted).toEqual([{ label: "Cola", why: "it is counted in pieces, not by weight or volume" }]);
  });

  it("counts 30 ml of flour at 0.53 g a ml against figures per 100 g: 15.9 g, so 57.24 kcal of 360", () => {
    expect(kcal(nLine("ml10", 300, per100("100g", { energyKcal: 360 }), { mlGrams: 0.53 })).value).toBe(57.24);
    const out = serveNutrition([nLine("ml10", 300, per100("100g"), { label: "Flour" })], 1);
    expect(out.notCounted).toEqual([
      { label: "Flour", why: "it is measured by volume, but its figures are per 100 g and what one ml weighs is not stated" },
    ]);
  });

  it("counts 26 g of syrup at 1.3 g a ml against figures per 100 ml: 20 ml, so 52 kcal of 260", () => {
    expect(kcal(nLine("mg", 26_000, per100("100ml", { energyKcal: 260 }), { mlGrams: 1.3 })).value).toBe(52);
    const out = serveNutrition([nLine("mg", 26_000, per100("100ml"), { label: "Syrup" })], 1);
    expect(out.notCounted).toEqual([
      { label: "Syrup", why: "it is weighed, but its figures are per 100 ml and what one ml weighs is not stated" },
    ]);
  });

  it("counts a weighed line's alcohol through its stated ml weight: 47.5 g of 40% at 0.95 is 20 ml of alcohol", () => {
    const out = serveNutrition([nLine("mg", 47_500, per100("100ml", { alcoholMl: 40 }), { mlGrams: 0.95 })], 1);
    expect(out.figures.alcoholMl.value).toBe(20);
  });

  it("reads a stated weight of 0 or below as not stated", () => {
    expect(kcal(nLine("each_milli", 2000, per100("100g"), { pieceGrams: 0 })).value).toBeNull();
    expect(kcal(nLine("ml10", 300, per100("100g"), { mlGrams: -1 })).value).toBeNull();
  });

  it("leaves a line on the figures' own basis as it was", () => {
    expect(kcal(nLine("mg", 50_000, per100("100g"), { pieceGrams: 999, mlGrams: 3 })).value).toBe(50);
    expect(kcal(nLine("ml10", 500, per100("100ml"), { mlGrams: 3 })).value).toBe(50);
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

describe("the card reads a good's stated weights", () => {
  const eggs = (out: any) => out.whatIsIn.notCounted.find((n: any) => n.label === "Eggs");

  it("counts the eggs line on the card once one egg's weight is stated: 2 x 60 g at 143 kcal / 100 g over 8 serves", async () => {
    const out: any = await new RecipesService(fakeDb(houseWithEggs({ piece_grams: "60.000" })).db).getDishRecipe(HOUSE_A, TART, "owner");
    expect(eggs(out)).toBeUndefined();
    // Flour lines state nothing, so the figure is "at least": the eggs' share is 171.6 / 8.
    expect(out.whatIsIn.figures.energyKcal).toMatchObject({ value: 21.45, atLeast: true });
  });

  it("says what the eggs line waits for while no weight is stated", async () => {
    const out: any = await new RecipesService(fakeDb(houseWithEggs()).db).getDishRecipe(HOUSE_A, TART, "owner");
    expect(eggs(out)).toEqual({ label: "Eggs", why: "it is counted in pieces, and what one weighs is not stated" });
    expect(out.whatIsIn.figures.energyKcal.value).toBeNull();
  });

  it("counts the card for a role without money too: a weight is not money", async () => {
    const out: any = await new RecipesService(fakeDb(houseWithEggs({ piece_grams: 60 })).db).getDishRecipe(HOUSE_A, TART, "staff");
    expect(eggs(out)).toBeUndefined();
  });

  it("never reads another house's stated weight onto this house's card", async () => {
    const rows = houseWithEggs();
    rows.restaurant_inventory.push({ id: EGGS, restaurant_id: HOUSE_B, uom: "kg", piece_grams: 60, is_active: true, deleted_at: null });
    const out: any = await new RecipesService(fakeDb(rows).db).getDishRecipe(HOUSE_A, TART, "owner");
    expect(eggs(out)).toBeDefined();
  });

  it("says the card is unreadable, not that the line is uncounted, when the weights read fails; the cost still shows", async () => {
    const fake = fakeDb(houseWithEggs({ piece_grams: 60 }));
    const client: any = fake.db.getClient();
    const from = client.from;
    let n = 0;
    client.from = (t: string) => {
      const q = from(t);
      if (t === "restaurant_inventory") {
        const select = q.select;
        q.select = (c: string, o?: any) =>
          c === "id, piece_grams, ml_grams" ? ((n += 1), { eq: () => ({ in: async () => ({ data: null, error: { message: "boom" } }) }) }) : select(c, o);
      }
      return q;
    };
    const out: any = await new RecipesService({ getClient: () => client } as never).getDishRecipe(HOUSE_A, TART, "owner");
    expect(n).toBe(1);
    expect(out.whatIsIn.readable).toBe(false);
    expect(out.current.lines.find((l: any) => l.label === "Eggs").costPerServeExact).toBe(0.75);
  });
});

describe("stateWeights: the house says what one piece and one ml of a good weigh", () => {
  it("keeps a stated piece weight and leaves the ml weight as it was", async () => {
    const rows = houseWithEggs({ ml_grams: 1.03 });
    const svc = new RecipesService(fakeDb(rows).db);
    expect(await svc.stateWeights(HOUSE_A, EGGS, { pieceGrams: 60 })).toEqual({ id: EGGS, pieceGrams: 60, mlGrams: 1.03 });
    expect(rows.restaurant_inventory.find((r) => r.id === EGGS)).toMatchObject({ piece_grams: 60, ml_grams: 1.03 });
  });

  it("takes a statement off with null", async () => {
    const rows = houseWithEggs({ piece_grams: 60, ml_grams: 1.03 });
    const svc = new RecipesService(fakeDb(rows).db);
    expect(await svc.stateWeights(HOUSE_A, EGGS, { mlGrams: null })).toEqual({ id: EGGS, pieceGrams: 60, mlGrams: null });
  });

  it("never touches another house's good: not found", async () => {
    const rows = houseWithEggs();
    const svc = new RecipesService(fakeDb(rows).db);
    await expect(svc.stateWeights(HOUSE_A, B_FLOUR, { pieceGrams: 60 })).rejects.toThrow(new NotFoundException(WEIGHT_NOT_THIS_HOUSE));
    expect(rows.restaurant_inventory.find((r) => r.id === B_FLOUR)?.piece_grams).toBeUndefined();
  });

  it.each([
    [{ pieceGrams: 0 }, "One piece must weigh more than 0 g."],
    [{ pieceGrams: -3 }, "One piece must weigh more than 0 g."],
    [{ pieceGrams: 0.0004 }, "One piece must weigh more than 0 g."],
    [{ mlGrams: 0.00004 }, "One ml must weigh more than 0 g."],
    [{ pieceGrams: 50_001 }, "One piece can weigh at most 50000 g. Check the figure."],
    [{ mlGrams: 0 }, "One ml must weigh more than 0 g."],
    [{ mlGrams: 1030 }, "One ml can weigh at most 5 g. Check the figure."],
    [{}, "Say what one piece weighs, what one ml weighs, or both."],
  ])("refuses %p in words and writes nothing", async (dto, sentence) => {
    const rows = houseWithEggs();
    const fake = fakeDb(rows);
    const svc = new RecipesService(fake.db);
    await expect(svc.stateWeights(HOUSE_A, EGGS, dto as never)).rejects.toThrow(new BadRequestException(sentence));
    expect(fake.reads).toEqual([]);
  });

  it("accepts the bounds themselves: 50 kg a piece, 5 g a ml, and the smallest step each keeps", async () => {
    const svc = new RecipesService(fakeDb(houseWithEggs()).db);
    expect(await svc.stateWeights(HOUSE_A, EGGS, { pieceGrams: 50_000, mlGrams: 5 })).toEqual({ id: EGGS, pieceGrams: 50_000, mlGrams: 5 });
    expect(await svc.stateWeights(HOUSE_A, EGGS, { pieceGrams: 0.001, mlGrams: 0.0001 })).toEqual({ id: EGGS, pieceGrams: 0.001, mlGrams: 0.0001 });
  });

  it("says a failed write in words", async () => {
    const fake = fakeDb(houseWithEggs());
    const client: any = fake.db.getClient();
    const from = client.from;
    client.from = (t: string) => {
      const q = from(t);
      q.update = () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { message: "down" } }) }) }) }) });
      return q;
    };
    const svc = new RecipesService({ getClient: () => client } as never);
    await expect(svc.stateWeights(HOUSE_A, EGGS, { pieceGrams: 60 })).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("is an owner's or a manager's", () => {
    const handler = (RecipesController.prototype as any).stateWeights;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(["owner", "manager"]);
  });
});
