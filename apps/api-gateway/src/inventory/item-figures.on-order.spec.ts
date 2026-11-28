import { FakeDb } from "../notifications/producers/testing/fake-db";
import { ItemFiguresService } from "./item-figures.service";
import { ORDER_PAGE } from "./item-on-order";

const H = "house-1";
const OTHER = "house-2";
const I = "item-1";

function seed(uom: string | null = null) {
  const db = new FakeDb();
  db.tables.restaurant_inventory = [{ id: I, restaurant_id: H, kind: "wine", display_name: "Rioja", uom }];
  db.tables.inventory_lot_rollup = [];
  db.tables.inventory_transactions = [];
  db.tables.stock_counts = [];
  db.tables.procurement_orders = [];
  db.tables.procurement_order_items = [];
  db.tables.procurement_receipt_events = [];
  db.tables.procurement_conversations = [];
  return { db, svc: new ItemFiguresService({ supabase: db } as any) };
}

const head = (id: string, status: string, quantity: number, extra: Record<string, any> = {}) => ({
  id, order_number: `PO-${id}`, restaurant_id: H, inventory_id: I, status, quantity,
  unit_type: "bottle", bottles_total: quantity, accepted_quantity: null, quantity_received: null,
  expected_delivery_date: "2026-12-03", ...extra,
});
const line = (id: string, order_id: string, quantity: number, extra: Record<string, any> = {}) => ({
  id, order_id, restaurant_id: H, inventory_id: I, quantity, unit_type: "bottle", bottles_per_unit: 1,
  total_bottles: quantity, quantity_accepted: null, quantity_received: null, ...extra,
});

describe("ItemFiguresService on order (r109 g1)", () => {
  it("an order with lines counts its lines, never its header as well", async () => {
    const { db, svc } = seed();
    db.tables.procurement_orders = [head("o1", "CONFIRMED", 6)];
    db.tables.procurement_order_items = [line("l1", "o1", 6)];
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder.readable).toBe(true);
    expect(onOrder.sent).toHaveLength(1);
    expect(onOrder.arrivingInBookUnit).toBe(6);
  });

  it("a header whose order has lines for other goods only adds nothing", async () => {
    const { db, svc } = seed();
    db.tables.procurement_orders = [head("o1", "CONFIRMED", 6)];
    db.tables.procurement_order_items = [line("l1", "o1", 6, { inventory_id: "item-9" })];
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder.sent).toEqual([]);
    expect(onOrder.arrivingInBookUnit).toBe(0);
  });

  const ledger = (id: string, order_id: string, quantity_change: number, extra: Record<string, any> = {}) => ({
    id, restaurant_id: H, order_id, inventory_id: I, quantity_change, stock_type: "live", idempotency_key: null, ...extra,
  });

  it("a part delivery leaves its ordered bottles less what the ledger booked, retired columns ignored", async () => {
    const { db, svc } = seed("bottle");
    db.tables.procurement_orders = [
      head("o1", "PARTIALLY_RECEIVED", 10, { accepted_quantity: 99, quantity_received: 99 }),
      head("o2", "PARTIALLY_RECEIVED", 5),
    ];
    db.tables.inventory_transactions = [ledger("t1", "o1", 4), ledger("t2", "o2", 2)];
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder.sent!.map((o) => o.openQty)).toEqual([6, 3]);
    expect(onOrder.arrivingInBookUnit).toBe(9);
  });

  it("a part delivery with NULL in the retired columns does not count the shelf bottles again", async () => {
    const { db, svc } = seed("bottle");
    db.tables.procurement_orders = [head("o1", "PARTIALLY_RECEIVED", 12)];
    db.tables.inventory_transactions = [ledger("t1", "o1", 5), ledger("t2", "o1", 3)];
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder.sent!.map((o) => o.openQty)).toEqual([4]);
    expect(onOrder.arrivingInBookUnit).toBe(4);
  });

  it("a part-delivered case order is taken off its bottle total, never below zero", async () => {
    const { db, svc } = seed("bottle");
    db.tables.procurement_orders = [
      head("o1", "PARTIALLY_RECEIVED", 5, { unit_type: "case", bottles_total: 60, quantity_received: 60 }),
      head("o2", "PARTIALLY_RECEIVED", 2, { unit_type: "case", bottles_total: 24 }),
    ];
    db.tables.inventory_transactions = [ledger("t1", "o1", 12), ledger("t2", "o2", 30)];
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder.sent!.map((o) => [o.id, o.openQty, o.unit])).toEqual([["o1", 48, "bottle"]]);
  });

  it("a part-delivered case order with no bottle total keeps the order, its figure unknown", async () => {
    const { db, svc } = seed("bottle");
    db.tables.procurement_orders = [head("o1", "PARTIALLY_RECEIVED", 3, { unit_type: "case", bottles_total: null })];
    db.tables.inventory_transactions = [ledger("t1", "o1", 6)];
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder.sent!.map((o) => [o.openQty, o.unit, o.inBookUnit])).toEqual([[3, "case", null]]);
    expect(onOrder.arrivingInBookUnit).toBeNull();
  });

  it("a ledger that cannot be read fails the card closed, never the whole order as open", async () => {
    const { db, svc } = seed("bottle");
    db.tables.procurement_orders = [head("o1", "PARTIALLY_RECEIVED", 6)];
    db.failures.inventory_transactions = "timeout";
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder).toMatchObject({ readable: false, sent: null, arrivingInBookUnit: null });
  });

  it("reads a lower-case status as its upper-case one, and splits sent from not yet sent", async () => {
    const { db, svc } = seed();
    db.tables.procurement_orders = [
      head("o1", "in_transit", 2),
      head("o2", "approved", 3),
      head("o3", "pending", 1),
      head("o4", "delivered", 9),
      head("o5", "cancelled", 9),
    ];
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder.sent!.map((o) => [o.id, o.status])).toEqual([["o1", "IN_TRANSIT"]]);
    expect(onOrder.unsent!.map((o) => o.id)).toEqual(["o2", "o3"]);
    // Only what the supplier has is arriving: the unsent orders are not added.
    expect(onOrder.arrivingInBookUnit).toBe(2);
  });

  it("an APPROVED order whose letter went out is sent and arriving; one with no letter stays not yet sent", async () => {
    const { db, svc } = seed("bottle");
    db.tables.procurement_orders = [head("o1", "APPROVED", 6), head("o2", "APPROVED", 4), head("o3", "APPROVED", 2)];
    db.tables.procurement_conversations = [
      { id: "c1", restaurant_id: H, order_id: "o1", direction: "outbound", status: "SENT" },
      { id: "c2", restaurant_id: H, order_id: "o2", direction: "outbound", status: "PENDING_APPROVAL" },
      { id: "c3", restaurant_id: OTHER, order_id: "o3", direction: "outbound", status: "SENT" },
    ];
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder.sent!.map((o) => [o.id, o.letterSent])).toEqual([["o1", true]]);
    expect(onOrder.unsent!.map((o) => o.id)).toEqual(["o2", "o3"]);
    expect(onOrder.arrivingInBookUnit).toBe(6);
  });

  it("a letter read that fails is unread, not a guess that nothing was sent", async () => {
    const { db, svc } = seed("bottle");
    db.tables.procurement_orders = [head("o1", "APPROVED", 6)];
    db.failures.procurement_conversations = "timeout";
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder.readable).toBe(false);
  });

  it("each open order says which vendor it is with, a line-bearing order by its header", async () => {
    const { db, svc } = seed("bottle");
    db.tables.procurement_orders = [
      head("o1", "IN_TRANSIT", 2, { provider_id: "v-1" }),
      head("o2", "PENDING", 3, { provider_id: "v-2", inventory_id: "item-9" }),
      head("o3", "PENDING", 1),
    ];
    db.tables.procurement_order_items = [line("l2", "o2", 3)];
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder.sent!.map((o) => o.providerId)).toEqual(["v-1"]);
    expect(Object.fromEntries(onOrder.unsent!.map((o) => [o.id, o.providerId]))).toEqual({ o2: "v-2", o3: null });
  });

  it("a line naming another house fails the whole read closed, never a figure", async () => {
    const { db, svc } = seed();
    db.tables.procurement_orders = [head("o1", "CONFIRMED", 6)];
    db.tables.procurement_order_items = [line("l1", "o1", 6, { restaurant_id: OTHER })];
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder).toMatchObject({ readable: false, sent: null, unsent: null, arrivingInBookUnit: null });
  });

  it("a line on another house's order fails closed too", async () => {
    const { db, svc } = seed();
    db.tables.procurement_orders = [{ ...head("o9", "CONFIRMED", 6), restaurant_id: OTHER, inventory_id: "x" }];
    db.tables.procurement_order_items = [line("l1", "o9", 6, { restaurant_id: null })];
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder.readable).toBe(false);
  });

  it("a good kept in grams is not summed from cases: arriving is null, the order still listed", async () => {
    const { db, svc } = seed("g");
    db.tables.procurement_orders = [head("o1", "CONFIRMED", 2, { unit_type: "case", bottles_total: 24 })];
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder.sent!.map((o) => [o.openQty, o.unit, o.inBookUnit])).toEqual([[2, "case", null]]);
    expect(onOrder.arrivingInBookUnit).toBeNull();
  });

  it("a case order into a book of bottles is not guessed either", async () => {
    const { db, svc } = seed(null);
    db.tables.procurement_orders = [head("o1", "IN_TRANSIT", 2, { unit_type: "case", bottles_total: 24 })];
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder.arrivingInBookUnit).toBeNull();
  });

  it("an each order into a book kept as each is summed", async () => {
    const { db, svc } = seed("each");
    db.tables.procurement_orders = [head("o1", "CONFIRMED", 7, { unit_type: "each", bottles_total: 0 })];
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder.arrivingInBookUnit).toBe(7);
  });

  it("reads more than one page of lines whole", async () => {
    const { db, svc } = seed();
    db.tables.procurement_orders = [head("o1", "CONFIRMED", 1)];
    db.tables.procurement_order_items = Array.from({ length: ORDER_PAGE + 1 }, (_, i) =>
      line(`l${String(i).padStart(5, "0")}`, "o1", 1),
    );
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder.arrivingInBookUnit).toBe(ORDER_PAGE + 1);
  });

  it("an order read that fails is unread, never nothing on order", async () => {
    const { db, svc } = seed();
    db.failures.procurement_orders = "timeout";
    const { onOrder } = await svc.figures(H, I, "shown");
    expect(onOrder).toMatchObject({ readable: false, sent: null });
  });

  it("carries no price, for any caller", async () => {
    const { db, svc } = seed();
    db.tables.procurement_orders = [head("o1", "CONFIRMED", 6, { final_price: 99, total_cost: 594 })];
    const { onOrder } = await svc.figures(H, I, "staff");
    expect(JSON.stringify(onOrder)).not.toMatch(/price|cost|594|99/);
  });
});
