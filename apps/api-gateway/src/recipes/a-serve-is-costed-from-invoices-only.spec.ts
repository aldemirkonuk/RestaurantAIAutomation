import { mergeInvoiceLotCost, resolveUnitCost } from "../analytics/inventory-cost";
import { DishesService } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { FLOUR, HOUSE_A, HOUSE_B, V_TART_2, fakeDb, line, twoHouses } from "./dishes.testing";

/**
 * "Cost a serve" is costed from invoices only (r28 recipes audit, gap 3).
 *
 * The rollup's `wac` averages every priced lot, estimates included, and the
 * recipe took it as "the invoiced lot WAC" as soon as one lot was invoiced:
 * 10 kg invoiced at 100 beside 90 kg estimated at 60 read 64 a kg, with every
 * line "priced". The recipe now reads `inventory_lot_invoice_cost`.
 *
 * Lemon tart v2: 250 g + 50 g of flour, 8 plates = 37.5 g a plate. At 100 a
 * kg that is 3.75 a plate; at the blended 64 it would be 2.40.
 */

const INVOICE = "inventory_lot_invoice_cost";
const BLENDED = { inventory_id: FLOUR, restaurant_id: HOUSE_A, live_qty: 100, wac: 64, has_invoice_cost: true, wac_qty: 100 };
const inv = (o: Record<string, unknown>) => ({ inventory_id: FLOUR, restaurant_id: HOUSE_A, ...o });

function rows(invoice: any[], extra: { agreed?: any[]; last?: number | null } = {}) {
  const r = twoHouses();
  r.restaurant_inventory = r.restaurant_inventory.map((i) =>
    i.id === FLOUR ? { ...i, uom: "kg", last_purchase_price: extra.last ?? null } : i,
  );
  r.recipe_lines = [
    line("l2", V_TART_2, HOUSE_A, 1, "Flour", FLOUR),
    line("l4", V_TART_2, HOUSE_A, 2, "Flour for the base", FLOUR, { qty_entered: 50, qty_base: 50_000 }),
  ];
  r.inventory_lot_rollup = [BLENDED];
  r.inventory_lot_agreed_cost = extra.agreed ?? [];
  r[INVOICE] = invoice;
  return r;
}

function service(data: Record<string, any[]>, failInvoice = false) {
  const fake = fakeDb(data);
  const client = fake.db.getClient() as any;
  const failing: any = {
    select: () => failing,
    eq: () => failing,
    in: () => failing,
    then: (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "relation is not readable" } }),
  };
  const db = {
    getClient: () => ({ ...client, from: (t: string) => (failInvoice && t === INVOICE ? failing : client.from(t)) }),
  } as any;
  return { svc: new DishesService(db, new RecipesService(db)), reads: fake.reads };
}

const tart = async (data: Record<string, any[]>) =>
  (await service(data).svc.dishesUsingItem(HOUSE_A, FLOUR, "owner")).dishes[0];

describe("a serve is costed from invoices only", () => {
  it("an estimate beside an invoice never blends in, and the serve says it is partly invoiced", async () => {
    const d = await tart(rows([inv({ invoice_wac: 100, invoice_qty: 10, settled_qty: 10, stock_qty: 100 })]));
    expect(d.cost).toMatchObject({ complete: true, priced: 2, of: 2, partial: 2, perServeExact: 3.75 });
  });

  it("stock wholly on verified invoices is a whole invoice cost", async () => {
    const d = await tart(rows([inv({ invoice_wac: 100, invoice_qty: 100, settled_qty: 100, stock_qty: 100 })]));
    expect(d.cost).toMatchObject({ complete: true, partial: 0, perServeExact: 3.75 });
  });

  it("a delivery not yet verified still prices the serve, as partial", async () => {
    const d = await tart(rows([inv({ invoice_wac: 100, invoice_qty: 100, settled_qty: 40, stock_qty: 100 })]));
    expect(d.cost).toMatchObject({ complete: true, partial: 2, perServeExact: 3.75 });
  });

  it("a good with no priced invoice never reads the rollup's blended average", async () => {
    const d = await tart(rows([inv({ invoice_wac: null, invoice_qty: 0, settled_qty: 0, stock_qty: 100 })]));
    expect(d.cost).toMatchObject({ complete: false, priced: 0, perServe: null, perServeExact: null });
  });

  it("a good with no row in the view (no live stock) never reads the rollup's blended average", async () => {
    const d = await tart(rows([]));
    expect(d.cost).toMatchObject({ complete: false, priced: 0, perServe: null });
  });

  it("with no priced invoice, the agreed cost and then the last price still price the serve", async () => {
    const agreed = await tart(
      rows([], { agreed: [{ inventory_id: FLOUR, restaurant_id: HOUSE_A, has_agreed_cost: true, agreed_wac: 80, agreed_qty: 100 }] }),
    );
    expect(agreed.cost).toMatchObject({ complete: true, perServeExact: 3 });
    const last = await tart(rows([], { last: 40 }));
    expect(last.cost).toMatchObject({ complete: true, perServeExact: 1.5 });
  });

  it("another house's invoice figure for the same id never prices this house's serve", async () => {
    const d = await tart(rows([{ ...inv({ invoice_wac: 100, invoice_qty: 10, settled_qty: 10, stock_qty: 10 }), restaurant_id: HOUSE_B }]));
    expect(d.cost).toMatchObject({ complete: false, priced: 0, perServe: null });
  });

  it("an invoice cost that cannot be read refuses, rather than reading as no price", async () => {
    await expect(service(rows([]), true).svc.dishesUsingItem(HOUSE_A, FLOUR, "owner")).rejects.toThrow();
  });

  it("a read without money never reads the invoice cost", async () => {
    const fake = fakeDb(rows([inv({ invoice_wac: 100, invoice_qty: 10, settled_qty: 10, stock_qty: 10 })]));
    const read = await new RecipesService(fake.db).readPricing(HOUSE_A, [FLOUR], false);
    expect(read.lots.size).toBe(0);
    expect(fake.reads).not.toContain(INVOICE);
  });
});

describe("resolveUnitCost with the invoice view read", () => {
  const read = (o: Record<string, unknown>) =>
    mergeInvoiceLotCost(new Map<string, any>([["x", { ...BLENDED, inventory_id: "x" }]]), ["x"], [{ inventory_id: "x", ...o }]).get("x");

  it("unreadable counts are partial, never whole", () => {
    expect(resolveUnitCost(null, read({ invoice_wac: 100, invoice_qty: 10, settled_qty: null, stock_qty: 10 }))).toEqual({
      unitCost: 100,
      costBasis: "invoice_lot_wac_partial",
    });
  });

  it("an invoice average of 0 is no price", () => {
    expect(resolveUnitCost(null, read({ invoice_wac: 0, invoice_qty: 10, settled_qty: 10, stock_qty: 10 }))).toEqual({
      unitCost: null,
      costBasis: "unknown",
    });
  });

  it("a caller that never read the view keeps the rollup's answer", () => {
    expect(resolveUnitCost(null, BLENDED)).toEqual({ unitCost: 64, costBasis: "invoice_lot_wac" });
  });
});
