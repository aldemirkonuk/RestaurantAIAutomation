/**
 * The door producer: what arrived, whether it was short, and whether it was
 * refused — stated once per receipt event, ever.
 */

import { DeliveryRecordedProducer } from "./delivery-recorded.producer";
import { ProducerLedgerService } from "./producer-ledger.service";
import { FakeDb, fakeDatabase, fakeNotifications } from "./testing/fake-db";

const TENANT = "rest-1";
const OTHER = "rest-2";
const MEMBERS = ["user-1", "user-2"];
const ZONE = "America/New_York";
const AUDIENCE = { ready: [...MEMBERS], deferred: [] as string[] };
const NOW = new Date("2026-09-03T12:00:00Z");

function build() {
  const db = new FakeDb();
  const database = fakeDatabase(db, MEMBERS);
  const notifications = fakeNotifications(MEMBERS);
  const ledger = new ProducerLedgerService(
    database as any,
    notifications as any,
  );
  const producer = new DeliveryRecordedProducer(database as any, ledger);
  return { db, notifications, producer };
}

function receipt(over: Record<string, any> = {}) {
  return {
    id: "receipt-1",
    restaurant_id: TENANT,
    order_id: "order-1",
    stage: "case_count",
    occurred_at: "2026-09-03T09:15:00Z",
    // Entered a minute after the tap: the ordinary, on-line case.
    created_at: "2026-09-03T09:16:00Z",
    client_captured_at: null,
    occurred_at_basis: null,
    outcome: "accepted",
    refusal_reason: null,
    counted_qty: 4,
    counted_uom: "case",
    counted_qty_bottles: 48,
    rejected_qty_bottles: 0,
    expected_qty_bottles: 48,
    driver_name: "Ravi",
    signed_by_initials: "AK",
    ...over,
  };
}

function order(db: FakeDb) {
  db.tables.procurement_orders.push({
    id: "order-1",
    restaurant_id: TENANT,
    order_number: "PO-1041",
  });
}

describe("DeliveryRecordedProducer", () => {
  it("reports an accepted delivery once, with what was counted", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_receipt_events.push(receipt());
    order(db);

    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(tally.emitted).toBe(2);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.title).toBe("Order PO-1041 was received at the door");
    expect(call.message).toContain("Counted 4 cases (48 bottles)");
    expect(call.message).toContain("The count matched what was expected.");
    expect(call.priority).toBe("medium");
    expect(call.type).toBe("order_delivered");
  });

  it("[REVERT-FAILS] a second sweep over the same receipt writes nothing", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_receipt_events.push(receipt());
    order(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const second = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    expect(second.alreadyClaimed).toBe(1);
    expect(second.emitted).toBe(0);
  });

  it("[REVERT-FAILS] never reads another restaurant's receipts", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_receipt_events.push(
      receipt({ id: "theirs", restaurant_id: OTHER, order_id: null }),
    );
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/No delivery has been counted/);
  });

  it("states a short ship with its arithmetic", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_receipt_events.push(
      receipt({ outcome: "short", counted_qty: 3, counted_qty_bottles: 36 }),
    );
    order(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.title).toBe("Order PO-1041 arrived short");
    expect(call.message).toContain("12 bottles short of the 48 expected");
    expect(call.metadata.shortBottles).toBe(12);
  });

  it("states a refusal with its reason, and raises the priority", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_receipt_events.push(
      receipt({ outcome: "refused", refusal_reason: "broken_case" }),
    );
    order(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.title).toBe("Order PO-1041 was refused at the door");
    expect(call.message).toContain("The receiver refused it: broken case.");
    expect(call.priority).toBe("high");
  });

  it("[REVERT-FAILS] a missing expected quantity is unknown, never zero short", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_receipt_events.push(
      receipt({ expected_qty_bottles: null, outcome: null }),
    );
    order(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.metadata.shortBottles).toBeNull();
    expect(call.metadata.expectedBottles).toBeNull();
    expect(call.message).toContain("whether it was short is unknown");
  });

  it("ignores stages the door does not write", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_receipt_events.push(
      receipt({ id: "recon", stage: "reconciled" }),
    );
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
  });

  it("throws when the receipt table cannot be read — never 'no deliveries'", async () => {
    const { db, producer } = build();
    db.failures.procurement_receipt_events = "connection reset";
    await expect(
      producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW),
    ).rejects.toThrow(/procurement_receipt_events/);
  });

  it("still reports the delivery when the order number cannot be read", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_receipt_events.push(receipt());
    db.failures.procurement_orders = "permission denied";
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.title).toBe("An unlinked delivery was received at the door");
    expect(call.metadata.orderNumber).toBeNull();
  });

  /**
   * ADR 0286: a receipt that synced late is dated by the phone's tap, so its
   * `occurred_at` can be older than the sweep's window the moment it lands.
   * The window is on entry (`created_at`), or the bell never says it.
   */
  describe("a receipt that synced late (ADR 0286)", () => {
    it("[REVERT-FAILS] is reported when it was DATED 60 hours ago but ENTERED an hour ago", async () => {
      const { db, notifications, producer } = build();
      db.tables.procurement_receipt_events.push(
        receipt({
          occurred_at: "2026-09-01T00:00:00Z",
          client_captured_at: "2026-09-01T00:00:00Z",
          occurred_at_basis: "sent",
          created_at: "2026-09-03T11:00:00Z",
        }),
      );
      order(db);
      const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
      expect(tally.emitted).toBe(2);
      const call = notifications.persistForRestaurant.calls[0][1];
      // The fact's time, in the restaurant's words (8 PM on the 31st in New York).
      expect(call.message).toContain("on Monday, August 31 at 8:00 PM");
      // A sent time inside the 72 hours is ordinary and says nothing more.
      expect(call.message).not.toMatch(/Back-dated|72 hours|ahead of ours/);
      expect(call.metadata.occurredAtBasis).toBe("sent");
      expect(call.metadata.enteredAt).toBe("2026-09-03T11:00:00Z");
    });

    it("[REVERT-FAILS] is not re-reported when it was ENTERED before the window, however recent its date", async () => {
      const { db, notifications, producer } = build();
      db.tables.procurement_receipt_events.push(
        receipt({
          occurred_at: "2026-09-03T09:15:00Z",
          created_at: "2026-09-01T09:00:00Z",
        }),
      );
      const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
      expect(notifications.persistForRestaurant.calls).toHaveLength(0);
      expect(tally.withheldReason).toMatch(/No delivery has been counted/);
    });

    it("[REVERT-FAILS] says a back-dated receipt was back-dated, and when it was entered", async () => {
      const { db, notifications, producer } = build();
      db.tables.procurement_receipt_events.push(
        receipt({
          occurred_at: "2026-08-20T14:00:00Z",
          client_captured_at: "2026-08-20T14:00:00Z",
          occurred_at_basis: "back_dated",
          created_at: "2026-09-03T11:00:00Z",
        }),
      );
      order(db);
      await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
      const call = notifications.persistForRestaurant.calls[0][1];
      expect(call.message).toContain("on Thursday, August 20 at 10:00 AM");
      expect(call.message).toContain(
        "Back-dated by an owner or a manager; entered on Thursday, September 3 at 7:00 AM.",
      );
      expect(call.metadata.occurredAtBasis).toBe("back_dated");
    });

    it("[REVERT-FAILS] says a refused sent time was refused, and that the arrival dates it", async () => {
      const { db, notifications, producer } = build();
      db.tables.procurement_receipt_events.push(
        receipt({
          occurred_at: "2026-09-03T11:00:00Z",
          client_captured_at: "2026-08-25T14:00:00Z",
          occurred_at_basis: "server",
          created_at: "2026-09-03T11:00:00Z",
        }),
      );
      order(db);
      await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
      const call = notifications.persistForRestaurant.calls[0][1];
      expect(call.message).toContain(
        "The phone took it on Tuesday, August 25 at 10:00 AM, more than 72 hours before it reached us, so it is dated when it arrived.",
      );
      expect(call.metadata.clientCapturedAt).toBe("2026-08-25T14:00:00Z");
    });

    it("says a phone clock that ran ahead was not trusted", async () => {
      const { db, notifications, producer } = build();
      db.tables.procurement_receipt_events.push(
        receipt({
          occurred_at: "2026-09-03T11:00:00Z",
          client_captured_at: "2026-09-03T15:00:00Z",
          occurred_at_basis: "server",
          created_at: "2026-09-03T11:00:00Z",
        }),
      );
      order(db);
      await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
      const call = notifications.persistForRestaurant.calls[0][1];
      expect(call.message).toContain(
        "ahead of ours, so it is dated when it reached us.",
      );
      expect(call.message).not.toContain("72 hours");
    });
  });

  it("[REVERT-FAILS] writes no emoji", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_receipt_events.push(
      receipt({ outcome: "refused", refusal_reason: "temperature" }),
    );
    order(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    const emoji =
      /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{20E3})/u;
    expect(emoji.test(call.title)).toBe(false);
    expect(emoji.test(call.message)).toBe(false);
  });
});
