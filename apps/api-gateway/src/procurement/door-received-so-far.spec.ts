/**
 * What earlier trucks brought, as the door is told it — ADR 0192.
 *
 * `doorReceivedSoFar` used to answer `Math.round(bottles / packSize)`, so five
 * cases and seven loose bottles read "6 earlier" on the match line and in the
 * vendor's credit letter. It now answers whole boxes and the loose bottles
 * beside them. The running total is the door's OWN events (ADR 0062 D3,
 * founder-decided) — the model the door books by — with the stock ledger's
 * reading (ADR 0192) beside it and supplying the exact pack. Every fixture is
 * a case of 12: at pack 1 a box and a bottle are the same number and nothing
 * here could fail.
 */
import { ReceivingService } from "./receiving.service";

type Row = Record<string, any>;
const REST = "rest-1";

function fakeDb(tables: Record<string, Row[]>, errors: Record<string, string> = {}) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const run = () =>
      errors[table]
        ? { data: null, error: { message: errors[table] } }
        : { data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null };
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      order: () => q,
      range: async () => run(),
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: data?.[0] ?? null, error };
      },
      then: (resolve: (v: any) => void) => resolve(run()),
    };
    return q;
  };
  const client = { from };
  return { getClient: () => client, supabase: client } as any;
}

const order = (over: Row = {}): Row => ({
  id: "o1",
  restaurant_id: REST,
  inventory_id: "inv1",
  quantity: 10,
  bottles_total: 120,
  unit_type: "case",
  ...over,
});
const booked = (change: number, key: string): Row => ({
  id: `tx-${key}`,
  restaurant_id: REST,
  order_id: "o1",
  inventory_id: "inv1",
  stock_type: "live",
  quantity_change: change,
  idempotency_key: key,
});
const doorEvent = (id: string, counted: number, rejected = 0): Row => ({
  id,
  restaurant_id: REST,
  order_id: "o1",
  stage: "case_count",
  counted_qty_bottles: counted,
  rejected_qty_bottles: rejected,
});
const base = (over: Record<string, Row[]> = {}) => ({
  procurement_orders: [order()],
  restaurant_inventory: [{ id: "inv1", restaurant_id: REST, uom: "bottle" }],
  procurement_order_items: [
    { id: "l1", restaurant_id: REST, order_id: "o1", unit_type: "case", bottles_per_unit: 12 },
  ],
  inventory_transactions: [],
  procurement_receipt_events: [],
  ...over,
});

describe("doorReceivedSoFar — whole boxes and loose bottles, never rounded", () => {
  it("five cases and seven bottles are 5 + 7, not 6", async () => {
    const svc = new ReceivingService(
      fakeDb(
        base({
          inventory_transactions: [booked(67, "door-receipt:e1")],
          procurement_receipt_events: [doorEvent("e1", 67)],
        }),
      ),
    );
    const r = await svc.doorReceivedSoFar(REST, "o1");
    expect(r.receivedQtyBottles).toBe(67);
    expect(r.receivedBoxes).toBe(5);
    expect(r.receivedLooseBottles).toBe(7);
    expect(r.packSize).toBe(12);
  });

  it("counts a truck the door recorded but the ledger has not booked yet", async () => {
    // Truck one's movement failed and is still queued in the outbox. It HAS
    // arrived; a match line that ignored it would call truck two short.
    const svc = new ReceivingService(
      fakeDb(
        base({
          inventory_transactions: [booked(24, "door-receipt:e1")],
          procurement_receipt_events: [doorEvent("e1", 24), doorEvent("e2", 36)],
        }),
      ),
    );
    const r = await svc.doorReceivedSoFar(REST, "o1");
    expect(r.onShelfBottles).toBe(24);
    expect(r.countedNotBookedBottles).toBe(36);
    expect(r.receivedQtyBottles).toBe(60);
    expect(r.receivedBoxes).toBe(5);
    expect(r.receivedLooseBottles).toBe(0);
  });

  it("does not call a one-tap booking an earlier truck — the door's first count reconciles against it", async () => {
    // recordDoorReceipt books its FIRST count as `accepted - alreadyBooked`, so
    // the truck the one-tap "delivered" is the truck the door is counting. A
    // running total that added the one-tap's 60 would read "10 of 10 with the
    // earlier 5" for a 5-case count and hide a short truck. ADR 0062 D3.
    const svc = new ReceivingService(
      fakeDb(base({ inventory_transactions: [booked(60, "order-delivered-live:o1")] })),
    );
    const r = await svc.doorReceivedSoFar(REST, "o1");
    expect(r.receivedQtyBottles).toBe(0);
    expect(r.receivedBoxes).toBe(0);
    // The ledger's reading still travels beside it.
    expect(r.onShelfBottles).toBe(60);
  });

  it("states no boxes — null, never 0 — when the order states no pack", async () => {
    const svc = new ReceivingService(
      fakeDb(
        base({
          procurement_orders: [order({ quantity: 6, bottles_total: 65 })],
          procurement_order_items: [],
          inventory_transactions: [booked(65, "a")],
          procurement_receipt_events: [doorEvent("e1", 65)],
        }),
      ),
    );
    const r = await svc.doorReceivedSoFar(REST, "o1");
    expect(r.receivedQtyBottles).toBe(65);
    expect(r.receivedBoxes).toBeNull();
    expect(r.receivedLooseBottles).toBeNull();
  });

  it("a ledger it cannot read is said beside the door's own total, never a zero", async () => {
    const svc = new ReceivingService(
      fakeDb(base({ procurement_receipt_events: [doorEvent("e1", 24)] }), {
        inventory_transactions: "connection reset",
      }),
    );
    const r = await svc.doorReceivedSoFar(REST, "o1");
    expect(r.receivedQtyBottles).toBe(24);
    expect(r.onShelfBottles).toBeNull();
    expect(r.received.readable).toBe(false);
    expect(r.received.why).toContain("connection reset");
    // No exact pack without the order lines: no boxes, never a guessed 2.
    expect(r.receivedBoxes).toBeNull();
  });

  it("door counts it cannot read are an error, never an 'earlier 0'", async () => {
    const svc = new ReceivingService(
      fakeDb(base(), { procurement_receipt_events: "connection reset" }),
    );
    await expect(svc.doorReceivedSoFar(REST, "o1")).rejects.toThrow("connection reset");
  });
});
