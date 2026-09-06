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
