/**
 * r104 drinks gap 1 (ADR 0397): a drink drawing a component that is priced from
 * partly invoiced stock keeps the "invoice only" hedge. The component's batch
 * counted `partial`; the drink's made line dropped it, so the drawer said a
 * firm "all ingredients priced" where the same sugar as a direct line hedged.
 */
import { recipeCost, componentPerBase } from "./recipe-cost";
import { RecipesService } from "./recipes.service";
import { HOUSE_A, TART, fakeDb } from "./dishes.testing";
import { SYRUP, partlyInvoiced, withSyrup } from "./made.testing";

// 5 kg invoiced of 100 kg on hand: partly invoiced.
const lot = { has_invoice_cost: true, wac: 2, wac_qty: 5, live_qty: 100 };
const sugar = { role: "stocked" as const, inventoryId: "s", qtyBase: 500_000, baseUnit: "mg" as const, item: { uom: "kg" }, lot };

describe("a made line carries its component's partial", () => {
  it("counts one partial in the drink when the component's batch counted one", () => {
    const batch = recipeCost([sugar], 1);
    expect(batch.partial).toBe(1);
    const perBase = componentPerBase(batch, 7000);
    const drink = recipeCost([{ role: "made", inventoryId: null, qtyBase: 400, baseUnit: "ml10", item: null, lot: null, made: { name: "Syrup", perBase, partial: batch.partial > 0 } }], 1);
    expect(drink).toMatchObject({ complete: true, partial: 1 });
    expect(drink.lines[0]).toMatchObject({ costBasis: "component", partial: true });
  });

  it("counts none when the component is wholly invoiced", () => {
    const drink = recipeCost([{ role: "made", inventoryId: null, qtyBase: 400, baseUnit: "ml10", item: null, lot: null, made: { name: "Syrup", perBase: 0.1, partial: false } }], 1);
    expect(drink.partial).toBe(0);
    expect(drink.lines[0]).not.toHaveProperty("partial");
  });
});

describe("the sheet keeps the hedge through a component", () => {
  const read = async (rows: ReturnType<typeof withSyrup>) =>
    (await new RecipesService(fakeDb(rows).db).getDishRecipe(HOUSE_A, TART, "owner")) as any;

  it("says one ingredient is priced from partly invoiced stock", async () => {
    const out = await read(partlyInvoiced(withSyrup()));
    expect(out.current.lines[0]).toMatchObject({ componentId: SYRUP, costBasis: "component" });
    expect(out.cost).toMatchObject({ complete: true, partial: 1 });
  });
});
