/**
 * r28 recipes audit, gap 5: a line says how much of what is bought it uses.
 * 180 g of salmon fillet on the plate is about 400 g of whole fish bought; a
 * recipe that costs the 180 g says the dish is cheaper than it is. A line may
 * carry a usable share (45 %), and its cost is taken over what is bought for
 * it (180 g / 0.45 = 400 g).
 *
 * part 1  boughtPerUsed + recipeCost: the share grosses the amount up; none,
 *         null and 100 are all of it; a share outside 1 to 100 is unknown,
 *         never a guess;
 * part 2  the service: the sheet, the preview and the dish list cost through
 *         it, the sheet says it, and a save sends it on or refuses it in words.
 */
import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { boughtPerUsed, recipeCost } from "./recipe-cost";
import { RecipesService } from "./recipes.service";
import { DishesService } from "./dishes.service";
import { PreviewLineDto, RecipeLineDto } from "./dto/recipes.dto";
import { HOUSE_A, TART, V_TART_2, fakeDb, twoHouses } from "./dishes.testing";

/* ── part 1: cost ─────────────────────────────────────────────────────── */

describe("boughtPerUsed: what one unit on the plate takes of what is bought", () => {
  it.each([
    [null, 1],
    [undefined, 1],
    ["", 1],
    [100, 1],
    ["100.00", 1],
    [50, 2],
    [1, 100],
  ])("%p is %p", (share, want) => {
    expect(boughtPerUsed(share as any)).toBe(want);
  });

  it("reads the database's text form", () => {
    expect(boughtPerUsed("45.00")).toBeCloseTo(100 / 45, 12);
  });

  it.each([0.5, 0, -10, 100.01, 150, "x", Number.NaN, Number.POSITIVE_INFINITY])("%p is not a share", (share) => {
    expect(boughtPerUsed(share as any)).toBeNaN();
  });
});

const lot = { has_invoice_cost: true, wac: 20, wac_qty: 5, live_qty: 5 };
const salmon = (usablePct: number | string | null | undefined, qtyBase = 180_000) =>
  ({ role: "stocked" as const, inventoryId: "s", qtyBase, baseUnit: "mg" as const, item: { uom: "kg" }, lot, usablePct });

describe("recipeCost: a line is costed by what is bought for it", () => {
  it("prices 180 g of fillet at 45 % as the 400 g bought: 8.00, not 3.60", () => {
    const c = recipeCost([salmon(45)], 1);
    expect(c.lines[0]).toMatchObject({ status: "linked", costPerServe: 8, costPerServeExact: 8 });
    expect(c).toMatchObject({ perServe: 8, complete: true });
  });

  it("divides by the serves after the gross-up", () => {
    expect(recipeCost([salmon(45)], 2).lines[0].costPerServe).toBe(4);
  });

  it("prices a line with no share, a null share or 100 from the amount itself", () => {
    for (const share of [undefined, null, 100]) expect(recipeCost([salmon(share)], 1).lines[0].costPerServe).toBe(3.6);
  });

  it("grosses up only the line that has a share", () => {
    const c = recipeCost([salmon(45), salmon(null, 10_000)], 1);
    expect(c.lines.map((l) => l.costPerServe)).toEqual([8, 0.2]);
    expect(c.perServe).toBe(8.2);
  });

  it("leaves a share outside 1 to 100 unknown, and the dish incomplete", () => {
    const c = recipeCost([salmon(0.5), salmon(null, 10_000)], 1);
    expect(c.lines[0]).toMatchObject({ status: "linked", costPerServe: null, costBasis: "unknown" });
    expect(c).toMatchObject({ perServe: null, complete: false, priced: 1, of: 2 });
  });
});

/* ── part 2: the service ──────────────────────────────────────────────── */

/** The tart made of flour only (250 g + 50 g at 2 a kg), for one serve; the first line 50 % usable. */
function tartAtHalf(share: unknown = "50.00") {
  const rows = twoHouses();
  rows.recipe_lines = rows.recipe_lines.filter((l) => l.version_id !== V_TART_2 || l.label !== "Lemons");
  for (const l of rows.recipe_lines) if (l.id === "l2") l.usable_pct = share;
  for (const v of rows.recipe_versions) if (v.id === V_TART_2) v.yield_serves = 1;
  rows.item_nutrition = [];
  rows.item_allergens = [];
  rows.inventory_lot_agreed_cost = [];
  rows.inventory_lot_invoice_cost = [];
  return rows;
}

describe("the sheet, the preview and the list cost through the usable share", () => {
  it("says the share on the sheet and prices the line over what is bought", async () => {
    const out: any = await new RecipesService(fakeDb(tartAtHalf()).db).getDishRecipe(HOUSE_A, TART, "owner");
    const [half, base] = out.current.lines;
    expect(half).toMatchObject({ label: "Flour", usablePct: 50, costPerServe: 1 });
    expect(base).toMatchObject({ label: "Flour for the base", usablePct: null, costPerServe: 0.1 });
  });

  it("gives a line with no share null, and prices it from its amount", async () => {
    const out: any = await new RecipesService(fakeDb(tartAtHalf(null)).db).getDishRecipe(HOUSE_A, TART, "owner");
    expect(out.current.lines[0]).toMatchObject({ usablePct: null, costPerServe: 0.5 });
  });

  it("costs the dish list's plate through it", async () => {
    const rows = tartAtHalf();
    const fake = fakeDb(rows);
    const list = await new DishesService(fake.db, new RecipesService(fake.db)).listDishes(HOUSE_A, "owner");
    expect(list.find((d) => d.id === TART)!.cost).toMatchObject({ complete: true, perServeExact: 1.1 });
  });

  it("costs a preview line through the share it is sent, and an uncounted line never", async () => {
    const rpc = (_n: string, a: any) => ({ data: [{ qty_base: Math.round(a.p_qty * 1000), base_unit: "mg" }] });
    const svc = new RecipesService(fakeDb(tartAtHalf(null), { rpc }).db);
    const FLOUR = "f0000000-0000-4000-8000-0000000000a1";
    const dto = {
      yieldServes: 1,
      lines: [
        { role: "stocked", inventoryId: FLOUR, qtyEntered: 250, unitCode: "g", usablePct: 50 },
        { role: "stocked", inventoryId: FLOUR, qtyEntered: 250, unitCode: "g" },
        { role: "untracked", qtyEntered: 1, unitCode: "g", usablePct: 50 },
      ],
    } as any;
    const out: any = await svc.previewDishCost(HOUSE_A, TART, dto);
    expect(out.lines.map((l: any) => l.costPerServe)).toEqual([1, 0.5, null]);
  });
});

describe("a save sends the share on, or refuses it in words", () => {
  const save = (lines: unknown[]) => {
    const rpcCalls: any[] = [];
    const rpc = (name: string, args: any) => {
      rpcCalls.push({ name, args });
      return { data: { version_id: "v3", version: 3, lines: [] } };
    };
    const svc = new RecipesService(fakeDb(twoHouses(), { rpc }).db);
    const dto = { expectedVersionId: V_TART_2, yieldServes: 1, lines } as any;
    return { rpcCalls, dish: () => svc.saveDishRecipe(HOUSE_A, TART, "u", dto), drink: () => svc.saveRecipe(HOUSE_A, "c", "u", dto) };
  };

  it("sends the share on both saves, and null for a line without one", async () => {
    for (const which of ["dish", "drink"] as const) {
      const s = save([
        { role: "stocked", label: "Salmon", qty: 180, unit: "g", usablePct: 45 },
        { role: "stocked", label: "Dill", qty: 2, unit: "g" },
        { role: "stocked", label: "Lemon", qty: 1, unit: "each", usablePct: 99.99 },
        { role: "untracked", label: "Water", qty: 1, unit: "ml", usablePct: 100 },
      ]);
      await s[which]();
      expect(s.rpcCalls[0].args.p_lines.map((l: any) => l.usablePct)).toEqual([45, null, 99.99, 100]);
    }
  });

  it.each([
    [0.5, "Ingredient 1 (Salmon): the usable share is a number of percent, from 1 to 100."],
    [0, "Ingredient 1 (Salmon): the usable share is a number of percent, from 1 to 100."],
    [100.5, "Ingredient 1 (Salmon): the usable share is a number of percent, from 1 to 100."],
    [45.555, "Ingredient 1 (Salmon): the usable share is a number of percent, from 1 to 100."],
  ])("refuses %p in a sentence and sends nothing", async (share, sentence) => {
    const s = save([{ role: "stocked", label: "Salmon", qty: 180, unit: "g", usablePct: share }]);
    await expect(s.dish()).rejects.toThrow(new BadRequestException(sentence));
    await expect(s.drink()).rejects.toThrow(sentence);
    expect(s.rpcCalls).toEqual([]);
  });

  it("keeps a share of exactly 1 and 100, and two decimals, even where 64.1 × 100 is not exact in floating point", async () => {
    for (const share of [1, 100, 37.25, 45.55, 64.1]) {
      const s = save([{ role: "stocked", label: "Salmon", qty: 180, unit: "g", usablePct: share }]);
      await expect(s.dish()).resolves.toMatchObject({ versionId: "v3" });
    }
  });

  it("refuses a share on a line that is not counted", async () => {
    const s = save([
      { role: "stocked", label: "Salmon", qty: 180, unit: "g" },
      { role: "untracked", label: "Parsley", qty: 2, unit: "g", usablePct: 50 },
    ]);
    await expect(s.dish()).rejects.toThrow("Ingredient 2 (Parsley) is not counted, so it has no usable share.");
    expect(s.rpcCalls).toEqual([]);
  });
});

describe("the request shape", () => {
  const errors = (cls: any, body: object) => validateSync(plainToInstance(cls, body)).map((e) => e.property);
  const line = { role: "stocked", label: "Salmon", qty: 180, unit: "g" };
  const preview = { role: "stocked", qtyEntered: 180, unitCode: "g" };

  it("takes a number or null on a saved line, and no text", () => {
    expect(errors(RecipeLineDto, { ...line, usablePct: 45 })).toEqual([]);
    expect(errors(RecipeLineDto, { ...line, usablePct: null })).toEqual([]);
    expect(errors(RecipeLineDto, line)).toEqual([]);
    expect(errors(RecipeLineDto, { ...line, usablePct: "45" })).toEqual(["usablePct"]);
  });

  it("bounds a preview line's share to 1 to 100, two decimals", () => {
    expect(errors(PreviewLineDto, { ...preview, usablePct: 45.5 })).toEqual([]);
    expect(errors(PreviewLineDto, { ...preview, usablePct: null })).toEqual([]);
    for (const bad of [0.5, 101, 45.555, "45"]) expect(errors(PreviewLineDto, { ...preview, usablePct: bad })).toEqual(["usablePct"]);
  });
});
