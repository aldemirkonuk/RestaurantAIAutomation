import { ReceivingService } from "./receiving.service";
import { DatabaseService } from "../database/database.service";

/**
 * Door-stage receiving.
 *
 * The two behaviours worth guarding are both about not being confidently wrong:
 * pack size is never guessed, and a retried tap never books stock twice.
 */

type Row = Record<string, any>;

/** Minimal Supabase stub — enough to observe what the service tries to write. */
function makeDb(opts: {
  order?: Row | null;
  eventInsertError?: { code: string; message: string } | null;
  events?: Row[];
  orders?: Row[];
}) {
  const calls = {
    rpc: [] as any[],
    eventInserts: [] as any[],
    orderUpdates: [] as any[],
  };

  const client: any = {
    from(table: string) {
      const q: any = {
        _table: table,
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          if (table === "procurement_orders")
            return { data: opts.order ?? null, error: null };
          return { data: null, error: null };
        },
        insert(payload: Row) {
          calls.eventInserts.push(payload);
          const chain: any = {
            select: () => chain,
            maybeSingle: async () =>
              opts.eventInsertError
                ? { data: null, error: opts.eventInsertError }
                : {
                    data: {
                      id: "evt-1",
                      occurred_at: new Date().toISOString(),
                    },
                    error: null,
                  },
          };
          return chain;
        },
        update(payload: Row) {
          calls.orderUpdates.push(payload);
          const chain: any = { eq: () => chain };
          return chain;
        },
        then: undefined,
      };
      // Terminal awaits for list queries.
      if (table === "procurement_receipt_events")
        (q as any).limit = async () => ({
          data: opts.events ?? [],
          error: null,
        });
      if (table === "procurement_orders" && opts.orders)
        (q as any).in = async () => ({ data: opts.orders, error: null });
      return q;
    },
    rpc: async (name: string, args: Row) => {
      calls.rpc.push({ name, args });
      return { data: null, error: null };
    },
    storage: { from: () => ({}) },
  };

  return {
    db: { getClient: () => client } as unknown as DatabaseService,
    calls,
  };
}

describe("recordDoorReceipt", () => {
  const base = {
    restaurantId: "r1",
    orderId: "o1",
    userId: "u1",
  };

  it("converts a case count to bottles using the order's own pack size", () => {
    const { db, calls } = makeDb({
      // 2 cases ordered, 24 bottles total -> pack of 12.
      order: {
        id: "o1",
        order_number: "PO-1",
        inventory_id: "inv1",
        quantity: 2,
        bottles_total: 24,
        quantity_received: 0,
      },
    });
    return new ReceivingService(db)
      .recordDoorReceipt({ ...base, countedQty: 2, countedUom: "case" })
      .then((r) => {
        expect(r.countedQtyBottles).toBe(24);
        expect(calls.rpc[0].args.p_delta).toBe(24);
      });
  });

  it("never guesses a pack size of 12", async () => {
    // A guessed pack multiplies a delivery twelvefold in the ledger — far worse
    // than under-counting, and it surfaces as a phantom overage, not as a bug.
    const { db, calls } = makeDb({
      order: {
        id: "o1",
        inventory_id: "inv1",
        quantity: null,
        bottles_total: null,
        quantity_received: 0,
      },
    });
    const r = await new ReceivingService(db).recordDoorReceipt({
      ...base,
      countedQty: 2,
      countedUom: "case",
    });

    expect(r.countedQtyBottles).toBe(2);
    expect(calls.rpc[0].args.p_delta).toBe(2);
  });

  it("writes no unit cost, because nobody has seen an invoice yet", async () => {
    // Guessing a cost here puts an unverified price into the books wearing the
    // authority of a real one. The lot stays 'estimated' until verifyReceipt.
    const { db, calls } = makeDb({
      order: {
        id: "o1",
        inventory_id: "inv1",
        quantity: 24,
        bottles_total: 24,
        quantity_received: 0,
      },
    });
    await new ReceivingService(db).recordDoorReceipt({
      ...base,
      countedQty: 24,
      countedUom: "bottle",
    });

    expect(calls.rpc[0].args.p_unit_cost).toBeUndefined();
  });

  it("books only the difference when stock was already booked", async () => {
    // A door count following markDelivered must correct, not double.
    const { db, calls } = makeDb({
      order: {
        id: "o1",
        inventory_id: "inv1",
        quantity: 24,
        bottles_total: 24,
        quantity_received: 24,
      },
    });
    await new ReceivingService(db).recordDoorReceipt({
      ...base,
      countedQty: 22,
      countedUom: "bottle",
    });

    expect(calls.rpc[0].args.p_delta).toBe(-2);
  });

  it("subtracts visibly damaged units from what goes on the shelf", async () => {
    const { db, calls } = makeDb({
      order: {
        id: "o1",
        inventory_id: "inv1",
        quantity: 24,
        bottles_total: 24,
        quantity_received: 0,
      },
    });
    await new ReceivingService(db).recordDoorReceipt({
      ...base,
      countedQty: 24,
      countedUom: "bottle",
      rejectedQty: 2,
    });

    expect(calls.rpc[0].args.p_delta).toBe(22);
  });

  it("treats a retried tap as already recorded rather than booking twice", async () => {
    // The door flow retries over bad signal. 23505 on the idempotency index is
    // the dedupe working, not a failure.
    const { db, calls } = makeDb({
      order: {
        id: "o1",
        inventory_id: "inv1",
        quantity: 24,
        bottles_total: 24,
        quantity_received: 0,
      },
      eventInsertError: { code: "23505", message: "duplicate key" },
    });
    const r = await new ReceivingService(db).recordDoorReceipt({
      ...base,
      countedQty: 24,
      idempotencyKey: "tap-1",
    });

    expect(r.alreadyRecorded).toBe(true);
    expect(calls.rpc).toHaveLength(0);
  });

  it("leaves the order open rather than completing it on a case count", async () => {
    // Closing here would strand the bottle count that catches the short case.
    const { db, calls } = makeDb({
      order: {
        id: "o1",
        inventory_id: "inv1",
        quantity: 24,
        bottles_total: 24,
        quantity_received: 0,
      },
    });
    await new ReceivingService(db).recordDoorReceipt({
      ...base,
      countedQty: 24,
      countedUom: "bottle",
    });

    expect(calls.orderUpdates[0].status).toBe("PARTIALLY_RECEIVED");
    expect(calls.orderUpdates[0].status).not.toBe("COMPLETED");
  });
});

describe("listUnverified", () => {
  const hoursAgo = (h: number) =>
    new Date(Date.now() - h * 3_600_000).toISOString();

  it("escalates by age, oldest first", async () => {
    const { db } = makeDb({
      events: [
        {
          order_id: "o1",
          stage: "case_count",
          counted_qty_bottles: 24,
          occurred_at: hoursAgo(2),
        },
        {
          order_id: "o2",
          stage: "case_count",
          counted_qty_bottles: 12,
          occurred_at: hoursAgo(20),
        },
        {
          order_id: "o3",
          stage: "case_count",
          counted_qty_bottles: 6,
          occurred_at: hoursAgo(72),
        },
      ],
      orders: [
        { id: "o1", order_number: "PO-1", status: "PARTIALLY_RECEIVED" },
        { id: "o2", order_number: "PO-2", status: "PARTIALLY_RECEIVED" },
        { id: "o3", order_number: "PO-3", status: "PARTIALLY_RECEIVED" },
      ],
    });

    const items = await new ReceivingService(db).listUnverified("r1");

    expect(items.map((i) => i.orderId)).toEqual(["o3", "o2", "o1"]);
    expect(items.map((i) => i.severity)).toEqual(["overdue", "stale", "fresh"]);
  });

  it("drops a delivery once its bottles have been counted", async () => {
    const { db } = makeDb({
      events: [
        {
          order_id: "o1",
          stage: "case_count",
          counted_qty_bottles: 24,
          occurred_at: hoursAgo(30),
        },
        {
          order_id: "o1",
          stage: "bottle_count",
          counted_qty_bottles: 22,
          occurred_at: hoursAgo(1),
        },
      ],
      orders: [
        { id: "o1", order_number: "PO-1", status: "PARTIALLY_RECEIVED" },
      ],
    });

    expect(await new ReceivingService(db).listUnverified("r1")).toHaveLength(0);
  });

  it("does not chase an order that was closed through the one-shot path", async () => {
    const { db } = makeDb({
      events: [
        {
          order_id: "o1",
          stage: "case_count",
          counted_qty_bottles: 24,
          occurred_at: hoursAgo(30),
        },
      ],
      orders: [{ id: "o1", order_number: "PO-1", status: "COMPLETED" }],
    });

    expect(await new ReceivingService(db).listUnverified("r1")).toHaveLength(0);
  });
});
