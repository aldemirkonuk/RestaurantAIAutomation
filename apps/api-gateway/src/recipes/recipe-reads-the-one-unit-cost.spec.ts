import { DishesService } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { FLOUR, HOUSE_A, HOUSE_B, V_TART_2, fakeDb, line, twoHouses } from "./dishes.testing";

/**
 * What a unit of a good costs now is one answer (r23 walk: the flour drawer
 * read ₺1,20 a kg while the dish said "no price yet"). The recipe reader
 * hands `resolveUnitCost` the same lot row the inventory list does: the
 * rollup, with the settled cost from `inventory_lot_agreed_cost` merged in.
 * Through the real services, on the dish card (`dishesUsingItem`), which
 * prices by `RecipesService.readPricing` like the recipe sheet and preview.
 *
 * Lemon tart v2 here: 250 g + 50 g of flour, 8 plates. At 1.20 a kg that is
 * 0.36 for the batch, 0.045 a plate.
 */

const AGREED = "inventory_lot_agreed_cost";

function rows(extra: { rollup?: any[]; agreed?: any[]; invoice?: any[] } = {}) {
  const r = twoHouses();
  // No last purchase price: the only way to a price is the lots.
  r.restaurant_inventory = r.restaurant_inventory.map((i) => (i.id === FLOUR ? { ...i, last_purchase_price: null } : i));
  // The tart's current version without its unlinked lemon line, so a priced
  // flour makes the whole plate priced.
  r.recipe_lines = [
    line("l2", V_TART_2, HOUSE_A, 1, "Flour", FLOUR),
    line("l4", V_TART_2, HOUSE_A, 2, "Flour for the base", FLOUR, { qty_entered: 50, qty_base: 50_000 }),
  ];
  // A hand-costed flour: no invoiced lot, so the rollup has no invoice cost.
  // Its blended `wac` is deliberately not the settled price: it must never be read.
  r.inventory_lot_rollup = extra.rollup ?? [
    { inventory_id: FLOUR, restaurant_id: HOUSE_A, live_qty: 10, wac: 9.99, has_invoice_cost: false, wac_qty: 10 },
  ];
  r[AGREED] = extra.agreed ?? [];
  r.inventory_lot_invoice_cost = extra.invoice ?? [];
  return r;
}

function dishes(data: Record<string, any[]>, failAgreed = false) {
  const fake = fakeDb(data);
  const client = fake.db.getClient() as any;
  const failing: any = {
    select: () => failing,
    eq: () => failing,
    in: () => failing,
    then: (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "relation is not readable" } }),
  };
  const db = {
    getClient: () => ({ ...client, from: (t: string) => (failAgreed && t === AGREED ? failing : client.from(t)) }),
  } as any;
  return { svc: new DishesService(db, new RecipesService(db)), reads: fake.reads };
}

const tart = async (data: Record<string, any[]>, role = "owner") =>
  (await dishes(data).svc.dishesUsingItem(HOUSE_A, FLOUR, role as any)).dishes[0];

describe("a recipe reads the one unit cost", () => {
  it("a cost the house settled by hand prices the dish, as the inventory list reads it", async () => {
    const d = await tart(rows({ agreed: [{ inventory_id: FLOUR, restaurant_id: HOUSE_A, has_agreed_cost: true, agreed_wac: 1.2, agreed_qty: 10 }] }));
    expect(d.cost).toMatchObject({ complete: true, priced: 2, of: 2, perServeExact: 0.045, perServe: 0.05 });
  });

  it("with no settled cost the dish says it is not known, never the rollup's blended average", async () => {
    const d = await tart(rows());
    expect(d.cost).toMatchObject({ complete: false, priced: 0, of: 2, perServe: null, perServeExact: null });
  });

  it("an invoiced lot still comes first", async () => {
    // The invoice figure is read from inventory_lot_invoice_cost (r28 gap 3);
    // the rollup's blended `wac` beside it is never read.
    const d = await tart(
      rows({
        rollup: [{ inventory_id: FLOUR, restaurant_id: HOUSE_A, live_qty: 10, wac: 9.99, has_invoice_cost: true, wac_qty: 10 }],
        invoice: [{ inventory_id: FLOUR, restaurant_id: HOUSE_A, invoice_wac: 2.4, invoice_qty: 10, settled_qty: 10, stock_qty: 10 }],
        agreed: [{ inventory_id: FLOUR, restaurant_id: HOUSE_A, has_agreed_cost: true, agreed_wac: 1.2, agreed_qty: 10 }],
      }),
    );
    expect(d.cost).toMatchObject({ complete: true, perServeExact: 0.09 });
  });

  it("another house's settled cost of the same id never prices this house's dish", async () => {
    const d = await tart(rows({ agreed: [{ inventory_id: FLOUR, restaurant_id: HOUSE_B, has_agreed_cost: true, agreed_wac: 50, agreed_qty: 1 }] }));
    expect(d.cost).toMatchObject({ complete: false, priced: 0, perServe: null });
  });

  it("a settled cost that cannot be read refuses, rather than reading as no price", async () => {
    await expect(dishes(rows(), true).svc.dishesUsingItem(HOUSE_A, FLOUR, "owner")).rejects.toThrow();
  });

  it("staff never read either cost view", async () => {
    const { svc, reads } = dishes(rows({ agreed: [{ inventory_id: FLOUR, restaurant_id: HOUSE_A, has_agreed_cost: true, agreed_wac: 1.2, agreed_qty: 10 }] }));
    const out = await svc.dishesUsingItem(HOUSE_A, FLOUR, "staff");
    expect(out.dishes[0].cost).toBeNull();
    expect(reads).not.toContain(AGREED);
    expect(reads).not.toContain("inventory_lot_rollup");
  });

  it("a read without money (the staff recipe sheet) reads neither cost view and carries no lot", async () => {
    const fake = fakeDb(rows({ agreed: [{ inventory_id: FLOUR, restaurant_id: HOUSE_A, has_agreed_cost: true, agreed_wac: 1.2, agreed_qty: 10 }] }));
    const read = await new RecipesService(fake.db).readPricing(HOUSE_A, [FLOUR], false);
    expect(read.lots.size).toBe(0);
    expect(fake.reads).toEqual(["restaurant_inventory"]);
  });
});
