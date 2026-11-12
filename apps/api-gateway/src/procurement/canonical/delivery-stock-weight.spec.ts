import { DatabaseService } from "../../database/database.service";
import { makeMockDb, MockDb } from "./delivery-mock";
import { DeliveryStockService, shelfQuantity } from "./delivery-stock.service";

/**
 * R8: a weighed line goes on the shelf, and is costed, in the unit its house
 * item is kept in (ADR 0070: integer quantities, the unit belongs to the item).
 */
const REST = "11111111-1111-1111-1111-111111111111";
const DEL = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const DOC = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ITEM = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

describe("shelfQuantity (R8)", () => {
  it.each([
    [{ qty_bottles: 3, uom: "kg" }, "g", 3000],
    [{ qty_bottles: 2.5, uom: "kg" }, "g", 2500],
    [{ qty_bottles: 3, uom: "kg" }, "kg", 3],
    [{ qty_bottles: 750, uom: "g" }, "g", 750],
    [{ qty_bottles: 10, uom: "bottle" }, "bottle", 10],
    [{ qty_bottles: 10, uom: "bottle" }, undefined, 10],
    [{ qty_bottles: 2, uom: "keg" }, "keg", 2],
    // A plain count into an item kept by weight is that many of the item's
    // unit, as before R8: the door cannot state a weight (fix round, #1109).
    [{ qty_bottles: 12, uom: null }, "kg", 12],
    [{ qty_bottles: 12 }, "kg", 12],
    [{ qty_bottles: 12, uom: "bottle" }, "kg", 12],
    [{ qty_bottles: 3, uom: "each" }, "g", 3],
  ])("%j into an item kept in %s puts %d on the shelf", (line, unit, want) => {
    expect(shelfQuantity(line, unit)).toEqual({ ok: true, qty: want });
  });

  it.each([
    [{ qty_bottles: 2.5, uom: "kg" }, "kg", "not a whole number of kg"],
    [{ qty_bottles: 250, uom: "g" }, "kg", "not a whole number of kg"],
    [{ qty_bottles: 3, uom: "kg" }, "bottle", "kept in bottles"],
    [{ qty_bottles: 3, uom: "kg" }, null, "states no unit"],
    [{ qty_bottles: 2, uom: "case" }, "kg", "what one weighs is not known"],
    [{ qty_bottles: 1, uom: "keg" }, "g", "what one weighs is not known"],
    [{ qty_bottles: 4, uom: "split_case" }, "kg", "split cases"],
    [{ qty_bottles: "x", uom: "kg" }, "g", "not a number"],
  ])("%j into an item kept in %s is refused: %s", (line, unit, why) => {
    const r = shelfQuantity(line, unit as string | null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(why);
  });
});

describe("DeliveryStockService — a weighed door count and its invoice (R8)", () => {
  let db: MockDb;
  let service: DeliveryStockService;

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    service = new DeliveryStockService(db.client as unknown as DatabaseService);
    db.answers["restaurant_inventory[]"] = { data: [{ id: ITEM, uom: "g" }], error: null };
  });

  it("the door books 3 kg of a cheese kept in g as 3000", async () => {
    db.answers.deliveries = { data: { id: DEL, state: "DELIVERED", order_id: null }, error: null };
    db.answers.procurement_document_lines = {
      data: [{ document_id: DOC, line_no: 1, inventory_id: ITEM, qty_bottles: 3, uom: "kg", unit_price: null, description: "Ezine peyniri", vendor_sku: null }],
      error: null,
    };
    db.answers.inventory_transactions = { data: [], error: null };
    db.rpcAnswers.apply_stock_movement = { data: "txn-1", error: null };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, "u1");
    expect(res.ok).toBe(true);
    const call = db.rpcCalls.find((c) => c.fn === "apply_stock_movement");
    expect(call?.args).toMatchObject({ p_inventory_id: ITEM, p_delta: 3000 });
    // 3000 g are not 3000 bottles (browser walk 2026-11-12 read "2506").
    if (res.ok) expect(res.value.bottlesMoved).toBe(0);
    // The units were read for this house only.
    expect(db.verbs).toContain("restaurant_inventory.in");
  });

  it("the door refuses 3 kg into an item kept in bottles, by name, and moves nothing", async () => {
    db.answers["restaurant_inventory[]"] = { data: [{ id: ITEM, uom: "bottle" }], error: null };
    db.answers.deliveries = { data: { id: DEL, state: "DELIVERED", order_id: null }, error: null };
    db.answers.procurement_document_lines = {
      data: [{ document_id: DOC, line_no: 1, inventory_id: ITEM, qty_bottles: 3, uom: "kg", unit_price: null, description: "Ezine peyniri", vendor_sku: null }],
      error: null,
    };
    db.answers.inventory_transactions = { data: [], error: null };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, "u1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.notBooked).toEqual([expect.objectContaining({ lineNo: 1, reason: expect.stringContaining("kept in bottles") })]);
    expect(db.rpcCalls.filter((c) => c.fn === "apply_stock_movement")).toEqual([]);
  });

  it("the door books a plain count of 12 into an item kept in kg as 12 (an unlabelled line is not refused)", async () => {
    db.answers["restaurant_inventory[]"] = { data: [{ id: ITEM, uom: "kg" }], error: null };
    db.answers.deliveries = { data: { id: DEL, state: "DELIVERED", order_id: null }, error: null };
    db.answers.procurement_document_lines = {
      data: [{ document_id: DOC, line_no: 1, inventory_id: ITEM, qty_bottles: 12, uom: "bottle", unit_price: null, description: "Beyaz peynir", vendor_sku: null }],
      error: null,
    };
    db.answers.inventory_transactions = { data: [], error: null };
    db.rpcAnswers.apply_stock_movement = { data: "txn-1", error: null };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, "u1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.notBooked).toEqual([]);
    const call = db.rpcCalls.find((c) => c.fn === "apply_stock_movement");
    expect(call?.args).toMatchObject({ p_inventory_id: ITEM, p_delta: 12 });
  });

  it("an unreadable item unit stops the door; it is never read as no unit", async () => {
    db.answers["restaurant_inventory[]"] = { data: null, error: { message: "connection reset" } };
    db.answers.deliveries = { data: { id: DEL, state: "DELIVERED", order_id: null }, error: null };
    db.answers.procurement_document_lines = {
      data: [{ document_id: DOC, line_no: 1, inventory_id: ITEM, qty_bottles: 3, uom: "kg", unit_price: null, description: "x", vendor_sku: null }],
      error: null,
    };
    db.answers.inventory_transactions = { data: [], error: null };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, "u1");
    expect(res).toMatchObject({ ok: false, status: 500 });
    expect(db.rpcCalls.filter((c) => c.fn === "apply_stock_movement")).toEqual([]);
  });

  it("VERIFIED posts 0.45 a gram onto the 3000 g the door booked, and the lot meets the paper's 1350", async () => {
    db.answers.deliveries = { data: { id: DEL, state: "AGREED", order_id: null }, error: null };
    db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 3000 }], error: null };
    db.answers.document_deliveries = { data: [{ document_id: "inv-1", role: "invoice" }], error: null };
    db.answers.delivery_proposals = { data: [], error: null };
    db.answers.procurement_documents = { data: [{ id: "inv-1", doc_number: "A-1" }], error: null };
    db.answers.procurement_document_lines = {
      data: [{ document_id: "inv-1", line_no: 1, inventory_id: ITEM, qty_bottles: 3, unit_price: 450, uom: "kg", pack_size: 1, line_total: 1350, description: "Ezine peyniri", vendor_sku: null }],
      error: null,
    };
    db.rpcAnswers.finalise_delivery_cost = { data: { lots_matched: 1, lots_finalised: 1, bottles_finalised: 3000 }, error: null };
    const res = await service.finaliseAtVerified(REST, DEL, "u1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const call = db.rpcCalls.find((c) => c.fn === "finalise_delivery_cost");
    expect(call?.args).toMatchObject({ p_inventory_id: ITEM, p_unit_cost: 0.45 });
    expect(Number(call?.args.p_unit_cost) * 3000).toBeCloseTo(1350, 6);
  });

  it("VERIFIED holds a weighed line whose item is kept in bottles; it posts no cost", async () => {
    db.answers["restaurant_inventory[]"] = { data: [{ id: ITEM, uom: "bottle" }], error: null };
    db.answers.deliveries = { data: { id: DEL, state: "AGREED", order_id: null }, error: null };
    db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 3 }], error: null };
    db.answers.document_deliveries = { data: [{ document_id: "inv-1", role: "invoice" }], error: null };
    db.answers.delivery_proposals = { data: [], error: null };
    db.answers.procurement_documents = { data: [{ id: "inv-1", doc_number: "A-1" }], error: null };
    db.answers.procurement_document_lines = {
      data: [{ document_id: "inv-1", line_no: 1, inventory_id: ITEM, qty_bottles: 3, unit_price: 450, uom: "kg", pack_size: 1, line_total: 1350, description: "Ezine peyniri", vendor_sku: null }],
      error: null,
    };
    const res = await service.finaliseAtVerified(REST, DEL, "u1");
    expect(db.rpcCalls.filter((c) => c.fn === "finalise_delivery_cost")).toEqual([]);
    expect(JSON.stringify(res)).toContain("kept in bottles");
  });
});
