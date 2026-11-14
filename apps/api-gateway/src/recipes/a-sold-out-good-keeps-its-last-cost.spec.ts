import {
  mergeInvoiceLotCost,
  mergeLastKnownLotCost,
  resolveUnitCost,
  summarizeCostBasis,
} from "../analytics/inventory-cost";
import { DishesService } from "./dishes.service";
import { recipeCost } from "./recipe-cost";
import { RecipesService } from "./recipes.service";
import { FLOUR, HOUSE_A, HOUSE_B, TART, V_TART_2, fakeDb, line, twoHouses } from "./dishes.testing";

/**
 * A sold-out good keeps its last cost (r36 recipes audit, gap 1).
 *
 * The invoice and agreed cost views read live lots with stock only, and the
 * recipe never falls back to the rollup once it has read them. So the moment
 * the last kilo of flour was used, every dish with flour in it read "Not
 * known", although the last delivery's price is on its lot. The recipe now
 * also reads `inventory_lot_last_known_cost` and prices the line at that,
 * after anything priced on hand, and says so (`last_known_lot_cost`).
 *
 * Lemon tart v2: 250 g + 50 g of flour, 8 plates = 37.5 g a plate. At 100 a
 * kg that is 3.75 a plate; at 80 a kg, 3.00.
 */

const INVOICE = "inventory_lot_invoice_cost";
const LAST = "inventory_lot_last_known_cost";
const inv = (o: Record<string, unknown>) => ({ inventory_id: FLOUR, restaurant_id: HOUSE_A, ...o });
const lastAt = (cost: number, house = HOUSE_A) => ({
  inventory_id: FLOUR,
  restaurant_id: house,
  last_unit_cost: cost,
  last_received_at: "2026-11-01T09:00:00+00:00",
});

function rows(extra: { invoice?: any[]; agreed?: any[]; last?: any[]; purchase?: number | null } = {}) {
  const r = twoHouses();
  r.restaurant_inventory = r.restaurant_inventory.map((i) =>
    i.id === FLOUR ? { ...i, uom: "kg", last_purchase_price: extra.purchase ?? null } : i,
  );
  r.recipe_lines = [
    line("l2", V_TART_2, HOUSE_A, 1, "Flour", FLOUR),
    line("l4", V_TART_2, HOUSE_A, 2, "Flour for the base", FLOUR, { qty_entered: 50, qty_base: 50_000 }),
  ];
  // The rollup still holds a blended figure; it must never be read.
  r.inventory_lot_rollup = [{ inventory_id: FLOUR, restaurant_id: HOUSE_A, live_qty: 0, wac: 64, has_invoice_cost: true, wac_qty: 0 }];
  r.inventory_lot_agreed_cost = extra.agreed ?? [];
  r[INVOICE] = extra.invoice ?? [];
  r[LAST] = extra.last ?? [];
  return r;
}

function service(data: Record<string, any[]>, failLast = false) {
  const fake = fakeDb(data);
  const client = fake.db.getClient() as any;
  const failing: any = {
    select: () => failing,
    eq: () => failing,
    in: () => failing,
    then: (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "relation is not readable" } }),
  };
  const db = {
    getClient: () => ({ ...client, from: (t: string) => (failLast && t === LAST ? failing : client.from(t)) }),
  } as any;
  return { svc: new DishesService(db, new RecipesService(db)), reads: fake.reads };
}

const tart = async (data: Record<string, any[]>) =>
  (await service(data).svc.dishesUsingItem(HOUSE_A, FLOUR, "owner")).dishes[0];

describe("a sold-out good keeps its last cost", () => {
  it("a good with nothing on hand is priced at what it was last bought at, and says so", async () => {
    const d = await tart(rows({ last: [lastAt(100)] }));
    expect(d.cost).toMatchObject({ complete: true, priced: 2, of: 2, partial: 0, lastBought: 2, perServeExact: 3.75 });
  });

  it("the sheet's line says when the price it was priced at came in; staff get no date", async () => {
    const owner: any = await new RecipesService(fakeDb(rows({ last: [lastAt(100)] })).db).getDishRecipe(HOUSE_A, TART, "owner");
    expect(owner.current.lines[0]).toMatchObject({ costBasis: "last_known_lot_cost", boughtAt: "2026-11-01T09:00:00+00:00" });
    const staff: any = await new RecipesService(fakeDb(rows({ last: [lastAt(100)] })).db).getDishRecipe(HOUSE_A, TART, "staff");
    expect(staff.current.lines[0].boughtAt).toBeNull();
  });

  it("stock on hand with an invoice speaks first", async () => {
    const d = await tart(
      rows({ invoice: [inv({ invoice_wac: 80, invoice_qty: 10, settled_qty: 10, stock_qty: 10 })], last: [lastAt(100)] }),
    );
    expect(d.cost).toMatchObject({ complete: true, lastBought: 0, perServeExact: 3 });
  });

  it("a cost settled on hand without an invoice speaks before the last one", async () => {
    const d = await tart(
      rows({
        agreed: [{ inventory_id: FLOUR, restaurant_id: HOUSE_A, has_agreed_cost: true, agreed_wac: 80, agreed_qty: 10 }],
        last: [lastAt(100)],
      }),
    );
    expect(d.cost).toMatchObject({ complete: true, lastBought: 0, perServeExact: 3 });
  });

  it("the last lot's cost speaks before the item's last purchase price", async () => {
    const d = await tart(rows({ last: [lastAt(100)], purchase: 40 }));
    expect(d.cost).toMatchObject({ complete: true, lastBought: 2, perServeExact: 3.75 });
  });

  it("with no known cost anywhere the serve is still not known", async () => {
    const d = await tart(rows());
    expect(d.cost).toMatchObject({ complete: false, priced: 0, perServe: null, lastBought: 0 });
  });

  it("another house's last cost for the same id never prices this house's serve", async () => {
    const d = await tart(rows({ last: [lastAt(100, HOUSE_B)] }));
    expect(d.cost).toMatchObject({ complete: false, priced: 0, perServe: null });
  });

  it("a last cost that cannot be read refuses, rather than reading as no price", async () => {
    await expect(service(rows({ last: [lastAt(100)] }), true).svc.dishesUsingItem(HOUSE_A, FLOUR, "owner")).rejects.toThrow();
  });

  it("a read without money never reads the last cost", async () => {
    const fake = fakeDb(rows({ last: [lastAt(100)] }));
    const read = await new RecipesService(fake.db).readPricing(HOUSE_A, [FLOUR], false);
    expect(read.lots.size).toBe(0);
    expect(fake.reads).not.toContain(LAST);
  });
});

describe("resolveUnitCost with the last known cost merged", () => {
  const read = (o: Record<string, unknown>, invoice: Record<string, unknown> | null = null) => {
    const lots = new Map<string, any>();
    mergeInvoiceLotCost(lots, ["x"], invoice ? [{ inventory_id: "x", ...invoice }] : []);
    mergeLastKnownLotCost(lots, [{ inventory_id: "x", ...o }]);
    return lots.get("x");
  };

  it("carries when the lot came in", () => {
    expect(resolveUnitCost(null, read({ last_unit_cost: "12.500000", last_received_at: "2026-11-01" }))).toEqual({
      unitCost: 12.5,
      costBasis: "last_known_lot_cost",
      boughtAt: "2026-11-01",
    });
  });

  it("a last cost of 0, below 0 or unreadable is no price", () => {
    for (const bad of [0, -3, "abc", null]) {
      expect(resolveUnitCost(null, read({ last_unit_cost: bad, last_received_at: "2026-11-01" }))).toEqual({
        unitCost: null,
        costBasis: "unknown",
      });
    }
  });

  it("an invoice cost on hand wins over it", () => {
    expect(
      resolveUnitCost(null, read({ last_unit_cost: 12.5 }, { invoice_wac: 9, invoice_qty: 3, settled_qty: 3, stock_qty: 3 })),
    ).toEqual({ unitCost: 9, costBasis: "invoice_lot_wac" });
  });

  it("an unknown date is said as unknown, not made up", () => {
    expect(resolveUnitCost(null, read({ last_unit_cost: 12.5 })).boughtAt).toBeNull();
  });

  it("a line priced from it says when, and only such a line does", () => {
    const item = { uom: "kg" } as any;
    const lineAt = (lot: any) => ({ role: "stocked" as const, inventoryId: "x", qtyBase: 37_500, baseUnit: "mg" as const, item, lot });
    const c = recipeCost(
      [lineAt(read({ last_unit_cost: 100, last_received_at: "2026-11-01" })), lineAt(read({}, { invoice_wac: 80, invoice_qty: 1, settled_qty: 1, stock_qty: 1 }))],
      1,
    );
    expect(c.lines[0]).toMatchObject({ costBasis: "last_known_lot_cost", costPerServeExact: 3.75, boughtAt: "2026-11-01" });
    expect(c.lines[1]).not.toHaveProperty("boughtAt");
    expect(c).toMatchObject({ complete: true, lastBought: 1, partial: 0 });
  });

  it("is counted under its own basis", () => {
    expect(summarizeCostBasis([{ unitCost: 1, costBasis: "last_known_lot_cost" }]).byBasis.last_known_lot_cost).toBe(1);
  });
});
