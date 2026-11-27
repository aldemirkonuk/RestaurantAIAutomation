import { DatabaseService } from "../../database/database.service";
import { makeMockDb, MockDb } from "./delivery-mock";
import { DeliveryStockService, shelfQuantity } from "./delivery-stock.service";
import { perBottleLotCost } from "./lot-unit-cost";

/** r21: litres and sized bottles book and cost in the ml (or l) their item is kept in. */
const REST = "11111111-1111-1111-1111-111111111111";
const DEL = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const DOC = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ITEM = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

describe("shelfQuantity by volume (r21)", () => {
  it.each([
    // Worked: 5 l of olive oil is 5,000 ml on the shelf.
    [{ qty_bottles: 5, uom: "liter" }, "ml", 5000],
    [{ qty_bottles: 5, uom: "liter" }, "l", 5],
    // Worked: 12 bottles of 200 ml tonic are 2,400 ml.
    [{ qty_bottles: 12, uom: "bottle", format_ml: 200 }, "ml", 2400],
    // Worked: 2 cases of 6 x 1 l juice — qty_bottles already 12 — are 12,000 ml.
    [{ qty_bottles: 12, uom: "case", format_ml: 1000 }, "ml", 12000],
    [{ qty_bottles: 1, uom: "keg", format_ml: 20000 }, "ml", 20000],
    [{ qty_bottles: 4, uom: "bottle", format_ml: "1000" }, "l", 4],
    // The door's rule: a plain count with no size is the item's own unit.
    [{ qty_bottles: 750, uom: "bottle" }, "ml", 750],
    [{ qty_bottles: 6, uom: "bottle", format_ml: 750 }, "bottle", 6],
  ])("%j into an item kept in %s puts %d on the shelf", (line, unit, want) => {
    expect(shelfQuantity(line, unit)).toEqual({ ok: true, qty: want });
  });

  it.each([
    [{ qty_bottles: 30, uom: "liter" }, "keg", "a liter is not a number of kegs"],
    [{ qty_bottles: 5, uom: "liter" }, "bottle", "a liter is not a number of bottles"],
    [{ qty_bottles: 5, uom: "liter" }, null, "states no unit"],
    [{ qty_bottles: 2, uom: "case" }, "ml", "does not say how much one holds"],
    [{ qty_bottles: 1, uom: "keg" }, "ml", "does not say how much one holds"],
    [{ qty_bottles: 6, uom: "bottle", format_ml: 750 }, "l", "not a whole number of l"],
    [{ qty_bottles: 3, uom: "kg" }, "ml", "a weight is not a volume"],
  ])("%j into an item kept in %s is refused: %s", (line, unit, why) => {
    const r = shelfQuantity(line, unit as string | null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(why);
  });
});

describe("perBottleLotCost by volume (r21): worked examples", () => {
  it("5 liter @ 120 into an item kept in ml is 0.12 a ml, and 5,000 ml make the paper's 600", () => {
    const c = perBottleLotCost({ unit_price: 120, uom: "liter", qty_bottles: 5, line_total: 600 }, { uom: "ml" });
    expect(c).toMatchObject({ ok: true, unitCost: 0.12, per: "ml", bottles: 1000 });
    if (c.ok) {
      expect(c.unitCost * 5000).toBeCloseTo(600, 6);
      // A 30 ml pour costs 3.60, not 3,600.
      expect(c.unitCost * 30).toBeCloseTo(3.6, 6);
      expect(c.basis).toBe("invoice price 120 per liter = 0.12 per ml");
    }
  });

  it("12 bottle @ 30 of 200 ml tonic into ml is 0.15 a ml; 2,400 ml make 360", () => {
    const c = perBottleLotCost({ unit_price: 30, uom: "bottle", qty_bottles: 12, line_total: 360, format_ml: 200 }, { uom: "ml" });
    expect(c).toMatchObject({ ok: true, unitCost: 0.15, per: "ml", bottles: 200 });
    if (c.ok) expect(c.unitCost * 2400).toBeCloseTo(360, 6);
  });

  it("2 case @ 90 per case of 6 x 1 l juice into ml is 0.015 a ml; 12,000 ml make 180", () => {
    const c = perBottleLotCost(
      { unit_price: 90, uom: "case", pack_size: 6, qty_bottles: 12, line_total: 180, format_ml: 1000 },
      { uom: "ml" },
    );
    expect(c).toMatchObject({ ok: true, unitCost: 0.015, per: "ml", bottles: 6000 });
    if (c.ok) expect(c.unitCost * 12000).toBeCloseTo(180, 6);
  });

  it("a 20 l keg @ 2,400 into ml is 0.12 a ml", () => {
    const c = perBottleLotCost({ unit_price: 2400, uom: "keg", qty_bottles: 1, line_total: 2400, format_ml: 20000 }, { uom: "ml" });
    expect(c).toMatchObject({ ok: true, unitCost: 0.12, per: "ml", bottles: 20000 });
  });

  it("a price per 5 liters (base) into an item kept in l is a fifth of it a litre", () => {
    const c = perBottleLotCost({ unit_price: 500, uom: "liter", price_base_qty: 5, price_base_uom: "liter", qty_bottles: 10, line_total: 1000 }, { uom: "l" });
    expect(c).toMatchObject({ ok: true, unitCost: 100, per: "l" });
  });

  it.each([
    [{ unit_price: 30, uom: "bottle", qty_bottles: 12, line_total: 360 }, "ml", "does not say how much one bottle holds"],
    [{ unit_price: 120, uom: "liter", qty_bottles: 5, line_total: 6000 }, "ml", "the price's unit is not what the line says"],
    [{ unit_price: 120, uom: "liter", qty_bottles: 5 }, "bottle", "a liter is not a number of bottles"],
    [{ unit_price: 120, uom: "liter", qty_bottles: 30 }, "keg", "a liter is not a number of kegs"],
    [{ unit_price: 450, uom: "kg", qty_bottles: 3 }, "ml", "a weight is not a volume"],
    [{ unit_price: 30, uom: "bottle", price_base_uom: "liter", qty_bottles: 12 }, "ml", "a liter is not a number of bottles"],
  ])("%j into an item kept in %s is refused: %s", (line, unit, why) => {
    const c = perBottleLotCost(line, { uom: unit });
    expect(c.ok).toBe(false);
    if (!c.ok && c.kind === "refused") expect(c.reason).toContain(why);
  });

  it("an item kept in bottles is costed per bottle as before, whatever the size", () => {
    const c = perBottleLotCost({ unit_price: 264, uom: "case", pack_size: 12, qty_bottles: 24, line_total: 528, format_ml: 750 }, { uom: "bottle" });
    expect(c).toMatchObject({ ok: true, unitCost: 22, per: "bottle" });
  });
});

describe("DeliveryStockService — a volume door count and its invoice (r21)", () => {
  let db: MockDb;
  let service: DeliveryStockService;

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    service = new DeliveryStockService(db.client as unknown as DatabaseService);
    db.answers["restaurant_inventory[]"] = { data: [{ id: ITEM, uom: "ml" }], error: null };
  });

  it("the door books 5 liter into ml as 5000; no bottle moved", async () => {
    db.answers.deliveries = { data: { id: DEL, state: "DELIVERED", order_id: null }, error: null };
    db.answers.procurement_document_lines = {
      data: [{ document_id: DOC, line_no: 1, inventory_id: ITEM, qty_bottles: 5, uom: "liter", unit_price: null, description: "Zeytinyağı", vendor_sku: null }],
      error: null,
    };
    db.answers.inventory_transactions = { data: [], error: null };
    db.rpcAnswers.apply_stock_movement = { data: "txn-1", error: null };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, "u1");
    expect(res.ok).toBe(true);
    const call = db.rpcCalls.find((c) => c.fn === "apply_stock_movement");
    expect(call?.args).toMatchObject({ p_inventory_id: ITEM, p_delta: 5000 });
    if (res.ok) expect(res.value.bottlesMoved).toBe(0);
  });

  it("the door reads the line's size: 12 bottles of 200 ml tonic book 2400", async () => {
    db.answers.deliveries = { data: { id: DEL, state: "DELIVERED", order_id: null }, error: null };
    db.answers.procurement_document_lines = {
      data: [{ document_id: DOC, line_no: 1, inventory_id: ITEM, qty_bottles: 12, uom: "bottle", format_ml: 200, unit_price: null, description: "Tonik 200 ml", vendor_sku: null }],
      error: null,
    };
    db.answers.inventory_transactions = { data: [], error: null };
    db.rpcAnswers.apply_stock_movement = { data: "txn-1", error: null };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, "u1");
    expect(res.ok).toBe(true);
    const call = db.rpcCalls.find((c) => c.fn === "apply_stock_movement");
    expect(call?.args).toMatchObject({ p_inventory_id: ITEM, p_delta: 2400 });
  });

  it("VERIFIED posts 0.12 a ml onto the 5000 ml the door booked, and the lot meets the paper's 600", async () => {
    db.answers.deliveries = { data: { id: DEL, state: "AGREED", order_id: null }, error: null };
    db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 5000 }], error: null };
    db.answers.document_deliveries = { data: [{ document_id: "inv-1", role: "invoice" }], error: null };
    db.answers.delivery_proposals = { data: [], error: null };
    db.answers.procurement_documents = { data: [{ id: "inv-1", doc_number: "A-1" }], error: null };
    db.answers.procurement_document_lines = {
      data: [{ document_id: "inv-1", line_no: 1, inventory_id: ITEM, qty_bottles: 5, unit_price: 120, uom: "liter", pack_size: 1, line_total: 600, description: "Zeytinyağı", vendor_sku: null }],
      error: null,
    };
    db.rpcAnswers.finalise_delivery_cost = { data: { lots_matched: 1, lots_finalised: 1, bottles_finalised: 5000 }, error: null };
    const res = await service.finaliseAtVerified(REST, DEL, "u1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const call = db.rpcCalls.find((c) => c.fn === "finalise_delivery_cost");
    expect(call?.args).toMatchObject({ p_inventory_id: ITEM, p_unit_cost: 0.12 });
    expect(Number(call?.args.p_unit_cost) * 5000).toBeCloseTo(600, 6);
  });

  it("a free 1 liter line beside a paid 5 liter one dilutes the cost: 600 over 6000 ml = 0.10, not held as two units", async () => {
    db.answers.deliveries = { data: { id: DEL, state: "AGREED", order_id: null }, error: null };
    db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 6000 }], error: null };
    db.answers.document_deliveries = { data: [{ document_id: "inv-1", role: "invoice" }], error: null };
    db.answers.delivery_proposals = { data: [], error: null };
    db.answers.procurement_documents = { data: [{ id: "inv-1", doc_number: "A-1" }], error: null };
    db.answers.procurement_document_lines = {
      data: [
        { document_id: "inv-1", line_no: 1, inventory_id: ITEM, qty_bottles: 5, unit_price: 120, uom: "liter", pack_size: 1, line_total: 600, description: "Zeytinyağı", vendor_sku: null },
        { document_id: "inv-1", line_no: 2, inventory_id: ITEM, qty_bottles: 1, unit_price: 0, uom: "liter", pack_size: 1, line_total: 0, description: "Zeytinyağı (bedelsiz)", vendor_sku: null },
      ],
      error: null,
    };
    db.rpcAnswers.finalise_delivery_cost = { data: { lots_matched: 1, lots_finalised: 1, bottles_finalised: 6000 }, error: null };
    const res = await service.finaliseAtVerified(REST, DEL, "u1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.stillProvisional).toEqual([]);
    const call = db.rpcCalls.find((c) => c.fn === "finalise_delivery_cost");
    expect(call?.args).toMatchObject({ p_inventory_id: ITEM, p_unit_cost: 0.1 });
  });

  it("VERIFIED reads the size: 12 x 200 ml @ 30 with 2 free posts 360 over 2400 ml = 0.15", async () => {
    db.answers.deliveries = { data: { id: DEL, state: "AGREED", order_id: null }, error: null };
    db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 2400 }], error: null };
    db.answers.document_deliveries = { data: [{ document_id: "inv-1", role: "invoice" }], error: null };
    db.answers.delivery_proposals = { data: [], error: null };
    db.answers.procurement_documents = { data: [{ id: "inv-1", doc_number: "A-1" }], error: null };
    db.answers.procurement_document_lines = {
      // 12 listed, 2 of them free: 10 paid at 36 = 360 over 2,400 ml.
      data: [{ document_id: "inv-1", line_no: 1, inventory_id: ITEM, qty_bottles: 12, free_goods_qty: 2, unit_price: 36, uom: "bottle", pack_size: 1, line_total: 360, format_ml: 200, description: "Tonik 200 ml", vendor_sku: null }],
      error: null,
    };
    db.rpcAnswers.finalise_delivery_cost = { data: { lots_matched: 1, lots_finalised: 1, bottles_finalised: 2400 }, error: null };
    const res = await service.finaliseAtVerified(REST, DEL, "u1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const call = db.rpcCalls.find((c) => c.fn === "finalise_delivery_cost");
    expect(call?.args).toMatchObject({ p_inventory_id: ITEM, p_unit_cost: 0.15 });
    expect(Number(call?.args.p_unit_cost) * 2400).toBeCloseTo(360, 6);
  });
});
