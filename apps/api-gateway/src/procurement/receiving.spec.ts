import { ReceivingService } from "./receiving.service";
import { DatabaseService } from "../database/database.service";

/**
 * Door-stage receiving.
 *
 * The two behaviours worth guarding are both about not being confidently wrong:
 * pack size is never guessed, and a retried tap never books stock twice.
 */

type Row = Record<string, any>;

/**
 * Minimal Supabase stub — enough to observe what the service tries to write.
 *
 * The receipt-events table is a real (in-memory) TABLE rather than a canned
 * response, because `recordDoorReceipt` now SUMS its own event rows to get the
 * running total for an order. A stub that always returned the same fixed list
 * could not tell a first truck from a second one, which is the behaviour under
 * test. Inserts land in the table; the unique index on `idempotency_key` is
 * modelled, so a retried tap really does collide.
 */
function makeDb(opts: {
  order?: Row | null;
  eventInsertError?: { code: string; message: string } | null;
  events?: Row[];
  orders?: Row[];
  /** Fail apply_stock_movement, to prove a failed booking is not reported. */
  rpcError?: { message: string } | null;
}) {
  const calls = {
    rpc: [] as any[],
    eventInserts: [] as any[],
    orderUpdates: [] as any[],
  };

  // The stored table. Seeded from `opts.events` so listUnverified's fixtures
  // keep working unchanged, and appended to by recordDoorReceipt's inserts.
  const table: Row[] = (opts.events ?? []).map((e, i) => ({
    id: e.id ?? `seed-${i}`,
    ...e,
  }));
  let nextId = 1;
  let rpcError = opts.rpcError ?? null;

  const client: any = {
    from(tableName: string) {
      const filters: Array<[string, any]> = [];
      const q: any = {
        _table: tableName,
        select: () => q,
        eq: (col: string, val: any) => {
          filters.push([col, val]);
          return q;
        },
        in: () => q,
        order: (col: string, ordOpts: { ascending: boolean }) => {
          q._orderCol = col;
          q._ascending = ordOpts?.ascending ?? true;
          return q;
        },
        limit: () => q,
        maybeSingle: async () => {
          if (tableName === "procurement_orders")
            return { data: opts.order ?? null, error: null };
          if (tableName === "procurement_receipt_events") {
            // The idempotency-key read-back on the 23505 path.
            const hit = table.find((r) =>
              filters.every(([c, v]) => c === "restaurant_id" || r[c] === v),
            );
            return { data: hit ?? null, error: null };
          }
          return { data: null, error: null };
        },
        insert(payload: Row) {
          calls.eventInserts.push(payload);
          const chain: any = {
            select: () => chain,
            maybeSingle: async () => {
              if (opts.eventInsertError)
                return { data: null, error: opts.eventInsertError };
              // The real unique index on idempotency_key, modelled.
              if (
                payload.idempotency_key &&
                table.some(
                  (r) => r.idempotency_key === payload.idempotency_key,
                )
              )
                return {
                  data: null,
                  error: { code: "23505", message: "duplicate key" },
                };
              const row = { id: `evt-${nextId++}`, ...payload };
              table.push(row);
              return {
                data: { id: row.id, occurred_at: new Date().toISOString() },
                error: null,
              };
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
      if (tableName === "procurement_receipt_events") {
        (q as any).limit = async (n: number) => {
          const rows = [...table];
          const dir = q._ascending === false ? -1 : 1;
          rows.sort(
            (a, b) =>
              dir *
              (new Date(a.occurred_at).getTime() -
                new Date(b.occurred_at).getTime()),
          );
          return { data: rows.slice(0, n), error: null };
        };
        // `doorTotals` awaits the builder directly, with no .limit(). Filters
        // are applied so a sum is scoped to one order and one stage, exactly as
        // the real query is.
        (q as any).then = (resolve: (v: any) => void) =>
          resolve({
            data: table.filter((r) =>
              filters.every(([c, v]) => r[c] === undefined || r[c] === v),
            ),
            error: null,
          });
      }
      if (tableName === "procurement_orders" && opts.orders)
        (q as any).in = async () => ({ data: opts.orders, error: null });
      return q;
    },
    rpc: async (name: string, args: Row) => {
      calls.rpc.push({ name, args });
      return rpcError ? { data: null, error: rpcError } : { data: null, error: null };
    },
    storage: { from: () => ({}) },
  };

  return {
    db: { getClient: () => client } as unknown as DatabaseService,
    calls,
    table,
    /** Clear or set the stock-movement fault mid-test, to model a transient one. */
    setRpcError: (e: { message: string } | null) => {
      rpcError = e;
    },
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
      rejectedQtyInCountedUom: 2,
    });

    expect(calls.rpc[0].args.p_delta).toBe(22);
  });

  // ==========================================================================
  // D1 — A REFUSED DELIVERY MUST NOT BOOK STOCK.
  //
  // THE TEST ABOVE, AND ITS FOUR SIBLINGS, COULD NOT CATCH THIS. Every one of
  // them passes `countedUom: "bottle"`, where the derived pack size is 1 and
  // `toBottles` is the identity — so `countedBottles - rejectedQty` and
  // `countedBottles - toBottles(rejectedQty)` are the same number and the
  // conversion is untestable. The bug lived for as long as it did because the
  // only test covering the path was arithmetically incapable of failing.
  //
  // Everything below is at packSize 12, where the two differ.
  // ==========================================================================

  const packTwelve = {
    id: "o1",
    order_number: "PO-1",
    inventory_id: "inv1",
    // 16 cases ordered, 192 bottles total -> a pack of 12.
    quantity: 16,
    bottles_total: 192,
    unit_type: "case",
    quantity_received: 0,
  };

  it("books NOTHING when the whole delivery is refused, at a real pack size", async () => {
    // THE HEADLINE. The door sends both numbers in BOXES; the server converted
    // only one. `countedBottles(36) - rejectedQty(3)` = 33 bottles of live stock
    // for wine that was turned away at the door and never entered the building.
    const { db, calls } = makeDb({ order: packTwelve });

    const r = await new ReceivingService(db).recordDoorReceipt({
      ...base,
      countedQty: 3,
      countedUom: "case",
      rejectedQtyInCountedUom: 3,
      outcome: "refused",
      refusalReason: "temperature",
    });

    expect(r.countedQtyBottles).toBe(36);
    // Zero delta means apply_stock_movement is not called at all — it returns
    // early on a zero delta anyway, so not calling it is the same outcome said
    // out loud.
    expect(calls.rpc).toHaveLength(0);
    expect(r.receivedQtyBottles).toBe(0);
    expect(r.stockDelta).toBe(0);
  });

  it("converts a broken box through the same conversion as the count", async () => {
    // One broken box out of fourteen at pack 12: 168 - 12 = 156 on the shelf.
    // Unconverted, `168 - 1` booked 167 — eleven bottles that do not exist,
    // which reads later as a phantom overage against the invoice.
    const { db, calls } = makeDb({ order: packTwelve });

    const r = await new ReceivingService(db).recordDoorReceipt({
      ...base,
      countedQty: 14,
      countedUom: "case",
      rejectedQtyInCountedUom: 1,
      outcome: "short",
    });

    expect(r.countedQtyBottles).toBe(168);
    expect(calls.rpc[0].args.p_delta).toBe(156);
    expect(r.receivedQtyBottles).toBe(156);
  });

  it("stores the rejected quantity in BOTH units, never mixed", async () => {
    // The event row used to hold counted_qty_bottles (bottles) beside
    // rejected_qty (boxes) with nothing saying so. The pair now matches the
    // counted pair: `*_qty` in counted_uom, `*_qty_bottles` in bottles.
    const { db, calls } = makeDb({ order: packTwelve });

    await new ReceivingService(db).recordDoorReceipt({
      ...base,
      countedQty: 14,
      countedUom: "case",
      rejectedQtyInCountedUom: 1,
    });

    const row = calls.eventInserts[0];
    expect(row.counted_qty).toBe(14);
    expect(row.counted_qty_bottles).toBe(168);
    expect(row.rejected_qty).toBe(1);
    expect(row.rejected_qty_bottles).toBe(12);
  });

  it("still honours the old unitless rejectedQty, so a queued refusal is not lost", async () => {
    // A receipt written by the pre-fix client is sitting in a phone's outbox
    // with `rejectedQty` in boxes. Ignoring that field would make the fix worse
    // than the bug: the queued refusal would arrive with nothing rejected and
    // book the whole refused delivery into live stock.
    const { db, calls } = makeDb({ order: packTwelve });

    await new ReceivingService(db).recordDoorReceipt({
      ...base,
      countedQty: 3,
      countedUom: "case",
      rejectedQty: 3,
    });

    expect(calls.rpc).toHaveLength(0);
    expect(calls.eventInserts[0].rejected_qty_bottles).toBe(36);
  });

  // ==========================================================================
  // D2 — a stock movement that did not happen is never reported as one.
  // ==========================================================================

  it("refuses to report a receipt whose stock movement failed", async () => {
    // This used to warn, fall through, write quantity_received / status /
    // delivered_at, and return `stockDelta` as though the bottles were on the
    // shelf. 503 rather than a 200 body because a retry fixes this one and now
    // converges — and the receiver never sees it: doorOutbox queues a non-4xx
    // and the screen says "saved on this phone".
    const { db, calls } = makeDb({
      order: packTwelve,
      rpcError: { message: "stock would go negative: 0 + -5" },
    });

    await expect(
      new ReceivingService(db).recordDoorReceipt({
        ...base,
        countedQty: 2,
        countedUom: "case",
      }),
    ).rejects.toThrow(/shelf count could not be updated/);

    // The event row stays — it is the durable record and what makes the retry
    // idempotent — but NOTHING claims the order was received.
    expect(calls.eventInserts).toHaveLength(1);
    expect(calls.orderUpdates).toHaveLength(0);
  });

  it("says so, rather than reporting a delta, when the order has no shelf", async () => {
    // `if (delta !== 0 && order.inventory_id)` skipped the RPC and returned
    // `stockDelta: delta` regardless. Not a throw: no number of retries links an
    // order to a shelf, and a permanently stuck outbox item is how the next real
    // failure hides.
    const { db, calls } = makeDb({
      order: { ...packTwelve, inventory_id: null },
    });

    const r = await new ReceivingService(db).recordDoorReceipt({
      ...base,
      countedQty: 2,
      countedUom: "case",
    });

    expect(calls.rpc).toHaveLength(0);
    expect(r.stockBooked).toBe(false);
    expect(r.stockDelta).toBeNull();
    expect(r.stockIssue).toMatch(/not linked to a shelf/);
    // And the order is not told it received anything.
    expect(calls.orderUpdates[0].quantity_received).toBeUndefined();
  });

  it("re-attempts the stock movement when a retry follows a failed booking", async () => {
    // The old 23505 branch returned "already recorded" immediately, so the retry
    // that was meant to repair a failed movement instead certified the absence
    // of it. apply_stock_movement is idempotent on p_idempotency_key, so
    // re-attempting is free when it already applied.
    const shared = makeDb({
      order: packTwelve,
      rpcError: { message: "deadlock detected" },
    });
    const service = new ReceivingService(shared.db);

    await expect(
      service.recordDoorReceipt({
        ...base,
        countedQty: 2,
        countedUom: "case",
        idempotencyKey: "tap-retry",
      }),
    ).rejects.toThrow();

    // Same table, same key — the event row is already there, so the retry's
    // insert really does collide the way it would in production. Only the
    // transient fault has cleared.
    shared.setRpcError(null);
    const r = await service.recordDoorReceipt({
      ...base,
      countedQty: 2,
      countedUom: "case",
      idempotencyKey: "tap-retry",
    });

    expect(r.alreadyRecorded).toBe(true);
    expect(r.stockBooked).toBe(true);
    expect(r.stockDelta).toBe(24);
    expect(shared.calls.orderUpdates[0].quantity_received).toBe(24);
  });

  // ==========================================================================
  // D3 — the door accumulates. It does not overwrite.
  // ==========================================================================

  it("adds a second truck to the first instead of replacing it", async () => {
    // Truck one brings 8 boxes, truck two brings 6. The order used to record 6
    // received, not 14, because quantity_received was set ABSOLUTELY — and the
    // match line called truck two short against the full PO while the driver
    // waited.
    const shared = makeDb({ order: packTwelve });
    const service = new ReceivingService(shared.db);

    const first = await service.recordDoorReceipt({
      ...base,
      countedQty: 8,
      countedUom: "case",
      idempotencyKey: "truck-1",
    });
    expect(first.receivedQtyBottles).toBe(96);
    expect(shared.calls.rpc[0].args.p_delta).toBe(96);
    expect(shared.calls.orderUpdates[0].quantity_received).toBe(96);

    const second = await service.recordDoorReceipt({
      ...base,
      countedQty: 6,
      countedUom: "case",
      idempotencyKey: "truck-2",
    });
    expect(second.receivedQtyBottles).toBe(168);
    // The ledger gets this truck's own bottles, once, under its own event key.
    expect(shared.calls.rpc[1].args.p_delta).toBe(72);
    expect(shared.calls.rpc[1].args.p_idempotency_key).not.toBe(
      shared.calls.rpc[0].args.p_idempotency_key,
    );
    expect(shared.calls.orderUpdates[1].quantity_received).toBe(168);
  });

  it("does not swallow a second truck that happens to bring the same count", async () => {
    // The fallback key was `door:{orderId}:{countedBottles}`, so a genuine
    // second delivery of the same size collided with the first and vanished.
    const shared = makeDb({ order: packTwelve });
    const service = new ReceivingService(shared.db);

    await service.recordDoorReceipt({
      ...base,
      countedQty: 4,
      countedUom: "case",
      clientCapturedAt: "2026-09-01T08:00:00.000Z",
    });
    const second = await service.recordDoorReceipt({
      ...base,
      countedQty: 4,
      countedUom: "case",
      clientCapturedAt: "2026-09-01T15:30:00.000Z",
    });

    expect(second.alreadyRecorded).toBe(false);
    expect(second.receivedQtyBottles).toBe(96);
  });

  it("books a retried tap once, however many times it is sent", async () => {
    const shared = makeDb({ order: packTwelve });
    const service = new ReceivingService(shared.db);

    const first = await service.recordDoorReceipt({
      ...base,
      countedQty: 5,
      countedUom: "case",
      idempotencyKey: "one-tap",
    });
    const retry = await service.recordDoorReceipt({
      ...base,
      countedQty: 5,
      countedUom: "case",
      idempotencyKey: "one-tap",
    });

    expect(first.receivedQtyBottles).toBe(60);
    // The total does not grow on a retry — the sum is over a SET of events.
    expect(retry.receivedQtyBottles).toBe(60);
    expect(retry.alreadyRecorded).toBe(true);
    // Both movements carry the SAME event key, which is what makes the second
    // one a no-op inside apply_stock_movement rather than a second booking.
    expect(shared.calls.rpc).toHaveLength(2);
    expect(shared.calls.rpc[1].args.p_idempotency_key).toBe(
      shared.calls.rpc[0].args.p_idempotency_key,
    );
  });

  // ==========================================================================
  // D4 — the door's structured facts are columns, not prose.
  // ==========================================================================

  it("writes the door's facts as columns", async () => {
    const { db, calls } = makeDb({ order: packTwelve });

    await new ReceivingService(db).recordDoorReceipt({
      ...base,
      countedQty: 3,
      countedUom: "case",
      rejectedQtyInCountedUom: 3,
      outcome: "refused",
      refusalReason: "broken_case",
      signedByInitials: "AK",
      driverName: "Giancarlo Fernandes-Oliveira",
      expectedQtyInCountedUom: 16,
    });

    const row = calls.eventInserts[0];
    expect(row.outcome).toBe("refused");
    expect(row.refusal_reason).toBe("broken_case");
    expect(row.signed_by_initials).toBe("AK");
    expect(row.driver_name).toBe("Giancarlo Fernandes-Oliveira");
    // Expected arrives in BOXES and is stored in BOTTLES, through the same
    // conversion as every other quantity on this row.
    expect(row.expected_qty_bottles).toBe(192);
  });

  it("drops a refusal reason that has no refusal, rather than storing a contradiction", async () => {
    // A reason without a refusal reads as a refusal to anything filtering on
    // `refusal_reason is not null`. The database CHECK says the same thing; this
    // makes sure the service never has to be refused by it.
    const { db, calls } = makeDb({ order: packTwelve });

    await new ReceivingService(db).recordDoorReceipt({
      ...base,
      countedQty: 14,
      countedUom: "case",
      outcome: "short",
      refusalReason: "wrong_wine",
    });

    expect(calls.eventInserts[0].outcome).toBe("short");
    expect(calls.eventInserts[0].refusal_reason).toBeNull();
  });

  it("treats a retried tap as already recorded rather than booking twice", async () => {
    // The door flow retries over bad signal. 23505 on the idempotency index is
    // the dedupe working, not a failure.
    //
    // What changed: this used to assert that the retry made NO stock call at
    // all, because the 23505 branch returned before reaching it. That early
    // return is exactly why a failed movement could never be repaired — the
    // retry certified the absence of the booking. The retry now re-attempts
    // under the SAME event key, which apply_stock_movement dedupes, so "not
    // twice" is enforced by the key rather than by not asking.
    const { db, calls } = makeDb({
      order: {
        id: "o1",
        inventory_id: "inv1",
        quantity: 24,
        bottles_total: 24,
        quantity_received: 0,
      },
      events: [
        {
          id: "evt-existing",
          restaurant_id: "r1",
          order_id: "o1",
          stage: "case_count",
          idempotency_key: "tap-1",
          counted_qty_bottles: 24,
          rejected_qty_bottles: 0,
          occurred_at: new Date().toISOString(),
        },
      ],
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
    // One event, one movement, keyed to that event — not two.
    expect(r.receivedQtyBottles).toBe(24);
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].args.p_idempotency_key).toBe(
      "door-receipt:evt-existing",
    );
  });

  it("books nothing when a key collides but the event cannot be read back", async () => {
    // The unique index fired and the row is not visible. That is a
    // contradiction, not a retry, and reporting a receipt off the back of it
    // would be a guess about stock.
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

    await expect(
      new ReceivingService(db).recordDoorReceipt({
        ...base,
        countedQty: 24,
        countedUom: "bottle",
        idempotencyKey: "tap-1",
      }),
    ).rejects.toThrow(/could not be read back/);

    expect(calls.rpc).toHaveLength(0);
    expect(calls.orderUpdates).toHaveLength(0);
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
