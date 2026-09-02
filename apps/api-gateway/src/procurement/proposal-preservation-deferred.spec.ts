import { readFileSync } from "fs";
import { join } from "path";
import { ReceivingService } from "./receiving.service";
import { DatabaseService } from "../database/database.service";

/**
 * ADR 0059 — L3 and L4, DEFERRED AND FAILING BY DESIGN.
 *
 * Both tests below are `it.skip`, and both FAIL when un-skipped. That is the
 * point of them: they are the unfinished half of this change, written down as
 * an executable statement rather than a comment someone can read past.
 *
 * WHY THEY ARE DEFERRED
 * ---------------------
 * `receiving.service.ts` (L3) and `procurement.service.ts` (L4) were owned by
 * two concurrent sessions when this landed. Editing them would have collided.
 * Everything on this side of those two files is done — the browser sends the
 * label, the DTO validates it, the migration adds the columns — so the
 * remaining work is a handful of lines in each service, and each test says
 * exactly which ones.
 *
 * WHAT IS STILL BROKEN UNTIL THEY PASS
 * ------------------------------------
 * The door's label and the verify form's correction now reach the gateway and
 * are dropped THERE instead of in the browser. That is a shorter fall, not a
 * fix. Do not read the green suite as "ADR 0059 is done": it is done for L1,
 * L2, L5 and L6, and staged for L3 and L4.
 *
 * TO FINISH: make the change each test names, delete the `.skip`, run.
 */

// ---------------------------------------------------------------------------
// L3 — the door's paper reading
// ---------------------------------------------------------------------------

function makeDb() {
  const eventInserts: any[] = [];
  const client: any = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () =>
          table === "procurement_orders"
            ? {
                data: {
                  id: "o1",
                  order_number: "PO-1",
                  inventory_id: "inv1",
                  quantity: 2,
                  bottles_total: 24,
                  quantity_received: 0,
                },
                error: null,
              }
            : { data: null, error: null },
        insert(payload: any) {
          if (table === "procurement_receipt_events") eventInserts.push(payload);
          const chain: any = {
            select: () => chain,
            maybeSingle: async () => ({
              data: { id: "evt-1", occurred_at: new Date().toISOString() },
              error: null,
            }),
          };
          return chain;
        },
        update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  return {
    db: { getClient: () => client } as unknown as DatabaseService,
    eventInserts,
  };
}

describe("ADR 0059 L3 — the door records whether the paper's reading was accepted", () => {
  /**
   * TO MAKE THIS PASS (three edits, all in receiving.service.ts):
   *
   *   1. add `suggestedQtyInCountedUom?: number | null` and
   *      `suggestionAccepted?: boolean | null` to `DoorReceiptInput`;
   *   2. add `suggested_qty: input.suggestedQtyInCountedUom ?? null` and
   *      `suggestion_accepted: input.suggestionAccepted ?? null` to the
   *      `procurement_receipt_events` insert;
   *   3. uncomment the two forwarding lines in `receiving.controller.ts`,
   *      marked `TODO(ADR 0059, L3)`.
   *
   * The columns already exist —
   * supabase/migrations/20260901200000_receiving_preserves_the_pair.sql.
   */
  it.skip("stores suggested_qty and suggestion_accepted on the receipt event", async () => {
    const { db, eventInserts } = makeDb();

    await new ReceivingService(db).recordDoorReceipt({
      restaurantId: "r1",
      orderId: "o1",
      userId: "u1",
      countedQty: 3,
      countedUom: "case",
      // The receiver was shown 2 and sealed 3: the machine misread the packing
      // slip and a person standing in front of the pallet corrected it. That is
      // the label, and it is worth more than a hundred agreements.
      suggestedQtyInCountedUom: 2,
      suggestionAccepted: false,
    } as any);

    expect(eventInserts).toHaveLength(1);
    expect(eventInserts[0]).toMatchObject({
      suggested_qty: 2,
      suggestion_accepted: false,
    });
  });

  it.skip("absence of a suggestion is NULL, never false", async () => {
    const { db, eventInserts } = makeDb();

    await new ReceivingService(db).recordDoorReceipt({
      restaurantId: "r1",
      orderId: "o1",
      userId: "u1",
      countedQty: 3,
      countedUom: "case",
    } as any);

    // `false` here would claim the receiver overrode a number that was never
    // offered — a fabricated negative label, which is worse than no label.
    expect(eventInserts[0].suggested_qty).toBeNull();
    expect(eventInserts[0].suggestion_accepted).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// L4 — the verify form's pre-fill
// ---------------------------------------------------------------------------

describe("ADR 0059 L4 — verifyReceipt persists what the form proposed", () => {
  /**
   * A SOURCE-LEVEL assertion, deliberately, and weaker than the behavioural
   * tests above. `verifyReceipt` sits on ProcurementService with a long
   * constructor and a match engine in the middle; standing that up to observe
   * four columns would be a large fixture whose failure mode is "the fixture
   * drifted", not "the write is missing". The write either appears in that
   * update payload or it does not, and this says which — precisely, in the file
   * that has to change.
   *
   * TO MAKE THIS PASS: add the four lines named in the `TODO(ADR 0059, L4)`
   * block in `dto/procurement.dto.ts` to the `Object.assign(update, {...})` in
   * `procurement.service.ts` `verifyReceipt`, beside `invoice_quantity`.
   */
  it.skip("writes the four prefilled_* columns on the order", () => {
    const src = readFileSync(join(__dirname, "procurement.service.ts"), "utf8");

    for (const column of [
      "prefilled_invoice_quantity",
      "prefilled_invoice_unit_price",
      "prefilled_shipped_quantity",
      "prefilled_free_goods_quantity",
    ]) {
      expect(src).toContain(column);
    }

    // And the source must read them from the DTO rather than deriving them —
    // a derived pre-fill is not what the machine proposed, it is a guess about
    // what the machine proposed.
    expect(src).toContain("body.prefilledInvoiceQuantity");
  });
});
