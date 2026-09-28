/**
 * The certification producer, and the one sentence it is not allowed to exceed:
 * verify "asserts only that the transcription is right — it does not accept the
 * charges, apply anything to stock, or settle a discrepancy"
 * (documents.controller.ts:305-310).
 */

import { InvoiceConfirmedProducer } from "./invoice-confirmed.producer";
import { ProducerLedgerService } from "./producer-ledger.service";
import { FakeDb, fakeDatabase, fakeNotifications } from "./testing/fake-db";

const TENANT = "rest-1";
const OTHER = "rest-2";
const MEMBERS = ["user-1", "user-2"];
const ZONE = "America/New_York";
const AUDIENCE = { ready: [...MEMBERS], deferred: [] as string[] };
const NOW = new Date("2026-09-03T18:00:00Z");

function build() {
  const db = new FakeDb();
  const database = fakeDatabase(db, MEMBERS);
  const notifications = fakeNotifications(MEMBERS);
  const ledger = new ProducerLedgerService(
    database as any,
    notifications as any,
  );
  const producer = new InvoiceConfirmedProducer(database as any, ledger);
  return { db, notifications, producer };
}

function doc(over: Record<string, any> = {}) {
  return {
    id: "doc-1",
    restaurant_id: TENANT,
    doc_type: "invoice",
    doc_number: "INV-88213",
    doc_date: "2026-09-01",
    provider_id: "prov-1",
    total: 1240.5,
    currency: "USD",
    ties_out: true,
    tie_out_delta: 0,
    status: "verified",
    verified_at: "2026-09-03T14:20:00Z",
    verified_by: "user-1",
    ...over,
  };
}

function vendor(db: FakeDb, over: Record<string, any> = {}) {
  db.tables.providers.push({
    id: "prov-1",
    name: "Terroir Selections",
    restaurant_id: null,
    ...over,
  });
}

describe("InvoiceConfirmedProducer", () => {
  it("reports a certified invoice with its amount and vendor", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_documents.push(doc());
    vendor(db);

    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(tally.emitted).toBe(2);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.title).toBe("Invoice INV-88213 certified — Terroir Selections");
    expect(call.message).toContain("$1,240.50 from Terroir Selections.");
    expect(call.message).toContain("The lines tie out to the stated total.");
    expect(call.metadata.total).toBe(1240.5);
    expect(call.metadata.vendorName).toBe("Terroir Selections");
    expect(call.type).toBe("invoice_received");
  });

  it("[REVERT-FAILS] never says approved, accepted or paid", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_documents.push(doc());
    vendor(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    const text = `${call.title} ${call.message}`.toLowerCase();
    expect(text).not.toMatch(/\bapproved\b|\bpaid\b|\bsettled\b/);
    expect(call.message).toContain("not as an acceptance of the charges");
    expect(call.metadata.assertion).toMatch(/faithful to the paper/);
  });

  it("[REVERT-FAILS] a second sweep writes nothing", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_documents.push(doc());
    vendor(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const second = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    expect(second.alreadyClaimed).toBe(1);
  });

  it("[REVERT-FAILS] never reads another restaurant's documents", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_documents.push(
      doc({ id: "theirs", restaurant_id: OTHER }),
    );
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/No document has been certified/);
  });

  it("[REVERT-FAILS] never names another restaurant's private vendor row", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_documents.push(doc());
    vendor(db, { restaurant_id: OTHER });
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.metadata.vendorName).toBeNull();
    expect(call.message).toContain("an unnamed vendor");
  });

  it("distinguishes a tie-out that failed from one nobody computed", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_documents.push(
      doc({ id: "d1", ties_out: false, tie_out_delta: -18.4 }),
    );
    db.tables.procurement_documents.push(
      doc({
        id: "d2",
        doc_number: "INV-88214",
        ties_out: null,
        tie_out_delta: null,
        verified_at: "2026-09-03T14:25:00Z",
      }),
    );
    vendor(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const [first, second] = notifications.persistForRestaurant.calls.map(
      (c: any[]) => c[1],
    );
    expect(first.message).toContain("$18.40 apart from the stated total");
    expect(second.message).toContain(
      "The tie-out was not computed for this document.",
    );
  });

  it("[REVERT-FAILS] a document with no extracted total is not a zero-dollar invoice", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_documents.push(doc({ total: null }));
    vendor(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.metadata.total).toBeNull();
    expect(call.message).toContain("carries no extracted total");
    expect(call.message).not.toContain("$0.00");
  });

  it("reports a certified credit memo, not only invoices", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_documents.push(
      doc({ doc_type: "credit_memo", doc_number: "CM-12", total: -80 }),
    );
    vendor(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls[0][1].title).toBe(
      "Credit memo CM-12 certified — Terroir Selections",
    );
  });

  it("throws when the document table cannot be read", async () => {
    const { db, producer } = build();
    db.failures.procurement_documents = "statement timeout";
    await expect(
      producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW),
    ).rejects.toThrow(/procurement_documents/);
  });

  it("[REVERT-FAILS] writes no emoji", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_documents.push(doc());
    vendor(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    const emoji =
      /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{20E3})/u;
    expect(emoji.test(call.title)).toBe(false);
    expect(emoji.test(call.message)).toBe(false);
  });
});
