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
        order: (col: string, ordOpts: { ascending: boolean }) => {
          q._orderCol = col;
          q._ascending = ordOpts?.ascending ?? true;
          return q;
        },
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
      // Terminal awaits for list queries. Mirrors real Supabase: sort by the
      // requested column/direction, then cap — so a test that supplies more
      // rows than the cap actually exercises which end of the table survives.
      if (table === "procurement_receipt_events")
        (q as any).limit = async (n: number) => {
          const rows = [...(opts.events ?? [])];
          const dir = q._ascending === false ? -1 : 1;
          rows.sort(
            (a, b) =>
              dir *
              (new Date(a.occurred_at).getTime() -
                new Date(b.occurred_at).getTime()),
          );
          return { data: rows.slice(0, n), error: null };
        };
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
      // Was omitted, and used to fall through to "case" — the multiplying unit.
      // The unit is now stated because it must be; see the refusal tests below.
      countedUom: "bottle",
      idempotencyKey: "tap-1",
    });

    expect(r.alreadyRecorded).toBe(true);
    expect(calls.rpc).toHaveLength(0);
  });

  // ==========================================================================
  // Fail closed on the unit (ADR 0011 applied to the door).
  //
  // These are the regression tests for `normalizeUom(input.countedUom) ?? "case"`.
  // `"case"` is the unit that MULTIPLIES, so the fallback turned an absent or
  // misspelt unit into the worst possible answer: 24 counted against a 12-pack
  // booked 288 bottles of live stock, silently.
  // ==========================================================================

  const twelvePackOrder = {
    id: "o1",
    order_number: "PO-1",
    inventory_id: "inv1",
    // 2 cases ordered, 24 bottles total -> the door derives a pack of 12.
    quantity: 2,
    bottles_total: 24,
    quantity_received: 0,
  };

  it("refuses a count with no unit instead of assuming the one that multiplies", async () => {
    const { db, calls } = makeDb({ order: twelvePackOrder });

    await expect(
      new ReceivingService(db).recordDoorReceipt({
        ...base,
        countedQty: 24,
      }),
    ).rejects.toThrow(/not a unit this delivery can be counted in/);

    // The point is not the exception, it is that NOTHING happened: no stock
    // moved, no receipt event was written, the order was not touched. Booking
    // 24 as cases against a 12-pack would have put 288 bottles on the shelf.
    expect(calls.rpc).toHaveLength(0);
    expect(calls.eventInserts).toHaveLength(0);
    expect(calls.orderUpdates).toHaveLength(0);
  });

  it("refuses a unit it cannot read instead of assuming the one that multiplies", async () => {
    const { db, calls } = makeDb({ order: twelvePackOrder });

    await expect(
      new ReceivingService(db).recordDoorReceipt({
        ...base,
        countedQty: 24,
        countedUom: "bxs",
      }),
    ).rejects.toThrow(/bxs/);

    expect(calls.rpc).toHaveLength(0);
    expect(calls.eventInserts).toHaveLength(0);
  });

  it("names the units a receiver may use, so the refusal is answerable", async () => {
    // A refusal a caller cannot act on just moves the guessing to them.
    const { db } = makeDb({ order: twelvePackOrder });
    await expect(
      new ReceivingService(db).recordDoorReceipt({
        ...base,
        countedQty: 24,
        countedUom: "",
      }),
    ).rejects.toThrow(/bottle, case, keg, pack, split_case, each, liter/);
  });

  it("still books a stated unit, so the refusal is not a blanket stop", async () => {
    const { db, calls } = makeDb({ order: twelvePackOrder });
    const r = await new ReceivingService(db).recordDoorReceipt({
      ...base,
      countedQty: 24,
      countedUom: "bottle",
    });
    expect(r.countedQtyBottles).toBe(24);
    expect(calls.rpc[0].args.p_delta).toBe(24);
  });

  it("uses transaction_type/source values that apply_stock_movement's enums actually accept", async () => {
    // Regression guard: 'receipt'/'receiving' are not in inventory_transaction_type
    // / inventory_transaction_source (baseline migration lines 126-153). The RPC
    // throws on the enum cast, and the failure was previously swallowed by a
    // warn-level log — every door receipt booked zero stock while reporting
    // success. Valid values, from the baseline enums:
    const VALID_TRANSACTION_TYPES = [
      "sale",
      "purchase",
      "adjustment",
      "transfer",
      "waste",
      "return",
      "comp",
      "reconciliation",
      "initial",
      "correction",
    ];
    const VALID_SOURCES = [
      "pos",
      "manual",
      "order",
      "mobile_count",
      "reconciliation",
      "system",
      "import",
      "api",
    ];
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

    expect(calls.rpc[0].args.p_transaction_type).toBeDefined();
    expect(VALID_TRANSACTION_TYPES).toContain(
      calls.rpc[0].args.p_transaction_type,
    );
    expect(calls.rpc[0].args.p_source).toBeDefined();
    expect(VALID_SOURCES).toContain(calls.rpc[0].args.p_source);
  });

  it("actually books stock on a door receipt (delta and inventory target are non-null)", async () => {
    // The bug this guards: the event row, quantity_received, and
    // PARTIALLY_RECEIVED status all wrote successfully even when the stock RPC
    // failed, so the UI looked correct while zero bottles reached the shelf.
    const { db, calls } = makeDb({
      order: {
        id: "o1",
        inventory_id: "inv1",
        quantity: 12,
        bottles_total: 12,
        quantity_received: 0,
      },
    });
    const result = await new ReceivingService(db).recordDoorReceipt({
      ...base,
      countedQty: 12,
      countedUom: "bottle",
    });

    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("apply_stock_movement");
    expect(calls.rpc[0].args.p_inventory_id).toBe("inv1");
    expect(calls.rpc[0].args.p_delta).toBe(12);
    expect(result.stockDelta).toBe(12);
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

  it("still surfaces a brand-new delivery once a restaurant has 500+ lifetime receipt events", async () => {
    // 500 old, already-closed events padding out the table, plus one fresh
    // unverified case count. The 500-row cap must keep the newest window —
    // if it keeps the oldest 500 instead, the new delivery never appears.
    const padding = Array.from({ length: 500 }, (_, i) => ({
      order_id: `pad-${i}`,
      stage: "reconciled",
      counted_qty_bottles: 0,
      occurred_at: hoursAgo(5000 - i),
    }));
    const { db } = makeDb({
      events: [
        ...padding,
        {
          order_id: "new-order",
          stage: "case_count",
          counted_qty_bottles: 18,
          occurred_at: hoursAgo(1),
        },
      ],
      orders: [
        { id: "new-order", order_number: "PO-NEW", status: "PARTIALLY_RECEIVED" },
      ],
    });

    const items = await new ReceivingService(db).listUnverified("r1");

    expect(items.map((i) => i.orderId)).toEqual(["new-order"]);
  });

  it("keeps the latest case count when a delivery was recounted, regardless of fetch order", async () => {
    const { db } = makeDb({
      events: [
        {
          order_id: "o1",
          stage: "case_count",
          counted_qty_bottles: 99,
          occurred_at: hoursAgo(50),
        },
        {
          order_id: "o1",
          stage: "case_count",
          counted_qty_bottles: 10,
          occurred_at: hoursAgo(1),
        },
      ],
      orders: [{ id: "o1", order_number: "PO-1", status: "PARTIALLY_RECEIVED" }],
    });

    const items = await new ReceivingService(db).listUnverified("r1");

    expect(items).toHaveLength(1);
    expect(items[0].countedQtyBottles).toBe(10);
  });
});
