/**
 * The manager's receiving queue states what is still owed from the LEDGER,
 * in bottles (ADR 0192 amendment, founder answer 8, 2026-09-21) — no longer
 * from the order row's retired backorder column, which a later truck never
 * moved. A failed read is an error, never an empty queue.
 *
 * Real: ReceivingService.managerQueue and the shelf reader it calls. The
 * store is an in-memory fake that APPLIES every filter it is given, so a read
 * that forgot its house returns rows it should not.
 */
import { ReceivingService } from "./receiving.service";

type Row = Record<string, any>;
const REST = "rest-1";

function fakeDb(tables: Record<string, Row[]>, errors: Record<string, string> = {}) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let lim = Infinity;
    let from_ = 0;
    let to_ = Infinity;
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      not: (c: string, op: string, v: unknown) => (
        filters.push((r) => (op === "is" ? (r[c] ?? null) !== v : r[c] !== v)), q
      ),
      order: () => q,
      limit: (n: number) => ((lim = n), q),
      range: (a: number, b: number) => ((from_ = a), (to_ = b), q),
      then: (resolve: (v: any) => void) => {
        if (errors[table]) return resolve({ data: null, error: { message: errors[table] } });
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        return resolve({ data: rows.slice(from_, Math.min(to_ + 1, lim)), error: null });
      },
    };
    return q;
  };
  return { getClient: () => ({ from }) } as any;
}

const order = (over: Row = {}): Row => ({
  id: "ord-1",
  restaurant_id: REST,
  order_number: "ORD-1",
  match_status: "partial",
  discrepancy_notes: "58 of 60 accepted",
  quantity: 5,
  unit_type: "case",
  bottles_total: 60,
  inventory_id: "inv-1",
  match_verified_at: "2026-09-21T10:00:00.000Z",
  provider_id: "prov-1",
  // The retired column still holds a number in production; it must be ignored.
  backorder_quantity: 99,
  ...over,
});

const base = (): Record<string, Row[]> => ({
  procurement_orders: [order(), order({ id: "ord-x", restaurant_id: "rest-2" })],
  procurement_credits: [],
  procurement_receipt_events: [],
  inventory_transactions: [
    { id: "t1", restaurant_id: REST, order_id: "ord-1", inventory_id: "inv-1", stock_type: "live", quantity_change: 58, idempotency_key: "order-delivered-live:ord-1" },
  ],
  restaurant_inventory: [{ id: "inv-1", restaurant_id: REST, uom: "bottle" }],
  procurement_order_items: [{ id: "l1", restaurant_id: REST, order_id: "ord-1", unit_type: "case", bottles_per_unit: 12 }],
});

describe("the receiving queue's backorder comes from the ledger", () => {
  it("states ordered bottles less the shelf, in bottles, and ignores the retired column", async () => {
    const svc = new ReceivingService(fakeDb(base()));
    const out = await svc.managerQueue(REST);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ orderId: "ord-1", backorderBottles: 2, backorderWhy: null });
    expect(out.items[0]).not.toHaveProperty("backorderQty");
  });

  it("a later truck moves it to zero", async () => {
    const t = base();
    t.inventory_transactions.push({ id: "t2", restaurant_id: REST, order_id: "ord-1", inventory_id: "inv-1", stock_type: "live", quantity_change: 2, idempotency_key: "door-receipt:ev-2" });
    const out = await new ReceivingService(fakeDb(t)).managerQueue(REST);
    expect(out.items[0].backorderBottles).toBe(0);
  });

  it("an unreadable ledger reads as unknown on the row, with the reason — never as nothing owed", async () => {
    const out = await new ReceivingService(fakeDb(base(), { inventory_transactions: "connection reset" })).managerQueue(REST);
    expect(out.items[0].backorderBottles).toBeNull();
    expect(out.items[0].backorderWhy).toMatch(/connection reset/);
  });

  it("a failed read of the queue itself is an error, not an empty queue", async () => {
    await expect(
      new ReceivingService(fakeDb(base(), { procurement_orders: "permission denied" })).managerQueue(REST),
    ).rejects.toThrow(/could not be read \(permission denied\)/);
    await expect(
      new ReceivingService(fakeDb(base(), { procurement_credits: "permission denied" })).managerQueue(REST),
    ).rejects.toThrow(/claims could not be read/);
  });
});
