import { DatabaseService } from "../../database/database.service";
import { makeMockDb, MockDb } from "./delivery-mock";
import { DeliveryStockService } from "./delivery-stock.service";

/**
 * r24: a paper's door count now books onto a delivery that names the paper's
 * order. When that order's OWN door (`/receiving/:orderId/door`) already put the
 * goods on the shelf, booking the paper's count too would count one truck twice.
 */
const REST = "11111111-1111-1111-1111-111111111111";
const DEL = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const DOC = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ITEM = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const ORDER = "0bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("bookAtTheDoor and the order's own door (r24)", () => {
  let db: MockDb;
  let service: DeliveryStockService;

  beforeEach(() => {
    db = makeMockDb();
    service = new DeliveryStockService(db.client as unknown as DatabaseService);
    db.answers["restaurant_inventory[]"] = { data: [{ id: ITEM, uom: "ml" }], error: null };
    db.answers.procurement_orders = { data: { inventory_id: ITEM }, error: null };
    db.answers.deliveries = { data: { id: DEL, state: "DELIVERED", order_id: ORDER }, error: null };
    db.answers.procurement_document_lines = {
      data: [{ document_id: DOC, line_no: 1, inventory_id: ITEM, qty_bottles: 5, uom: "liter", unit_price: null, description: "Zeytinyağı", vendor_sku: null }],
      error: null,
    };
    db.rpcAnswers.apply_stock_movement = { data: "txn-1", error: null };
  });

  it("refuses by name an item the order's door already booked, and moves nothing", async () => {
    db.answers.inventory_transactions = {
      data: [{ inventory_id: ITEM, quantity_change: 5, delivery_id: null }],
      error: null,
    };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, "u1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(db.rpcCalls.filter((c) => c.fn === "apply_stock_movement")).toEqual([]);
    expect(res.value.notBooked).toHaveLength(1);
    expect(res.value.notBooked[0].reason).toContain("already put on the shelf at the order's own door (5 there)");
    expect(db.verbs).toContain("inventory_transactions.is");
  });

  it("books 5 liter as 5000 ml when the order's door booked nothing", async () => {
    db.answers.inventory_transactions = { data: [], error: null };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, "u1");
    expect(res.ok && res.value.notBooked).toEqual([]);
    const call = db.rpcCalls.find((c) => c.fn === "apply_stock_movement");
    expect(call?.args).toMatchObject({ p_inventory_id: ITEM, p_delta: 5000, p_order_id: ORDER });
  });

  it("the delivery's own earlier bookings are not the order's door", async () => {
    db.answers.inventory_transactions = {
      data: [{ inventory_id: ITEM, quantity_change: 5000, delivery_id: DEL }],
      error: null,
    };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, "u1");
    expect(res.ok && res.value.notBooked).toEqual([]);
    // A retry: the delivery already holds 5000, so nothing more moves.
    expect(res.ok && res.value.booked[0].delta).toBe(0);
  });

  it("a failed read of the order's door books nothing", async () => {
    db.answers.inventory_transactions = { data: null, error: { message: "boom" } };
    const res = await service.bookAtTheDoor(REST, DEL, DOC, "u1");
    expect(res).toMatchObject({ ok: false });
    expect(db.rpcCalls.filter((c) => c.fn === "apply_stock_movement")).toEqual([]);
  });

  it("a delivery with no order does not read the order's door at all", async () => {
    db.answers.deliveries = { data: { id: DEL, state: "DELIVERED", order_id: null }, error: null };
    db.answers.inventory_transactions = { data: [], error: null };
    await service.bookAtTheDoor(REST, DEL, DOC, "u1");
    expect(db.verbs).not.toContain("inventory_transactions.is");
  });
});
