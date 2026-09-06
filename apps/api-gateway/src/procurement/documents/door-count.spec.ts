import { DatabaseService } from "../../database/database.service";
import { DocumentIntakeService } from "./document-intake.service";
import { DocumentExtractorService } from "./document-extractor.service";
import { CanonicalDocumentService } from "../canonical/canonical-document.service";
import { makeMockDb, MockDb } from "../canonical/delivery-mock";

/**
 * The door count — a document we AUTHOR (ADR 0104 D2/D11, S6; ADR 0103 A6, D3).
 * All ids and numbers are SYNTHETIC.
 *
 * Four rules, and every one of them is about not claiming something nobody said:
 *
 *   1. `extraction_confidence` is NULL, not 0. Nothing read this document, so
 *      there is no such number — a zero would be a confidence somebody computed.
 *   2. `direction` is `issued_by_us`. A receiving advice is OURS; reading it as a
 *      vendor document would put our own count behind the vendor's authority in
 *      every comparison the delivery makes.
 *   3. NO MONEY AT THE DOOR, and absent rather than zero: a unit price of 0.00 on
 *      a receiving advice is a claim that the goods were free.
 *   4. A line nobody counted is ABSENT from the submission, never a zero — which
 *      is what keeps `received: "not counted"` meaning what it says.
 */

describe("DocumentIntakeService.recordDoorCount", () => {
  let db: MockDb;
  let service: DocumentIntakeService;

  const line = (over: Record<string, unknown> = {}) => ({
    lineNo: 1,
    description: "SYNTHETIC Öküzgözü",
    qty: 10,
    uom: "bottle",
    ...over,
  });

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    db.insertAnswers.procurement_documents = {
      data: { id: "doc-count" },
      error: null,
    };
    db.insertAnswers.procurement_document_lines = { data: null, error: null };
    service = new DocumentIntakeService(
      db.client as unknown as DatabaseService,
      {} as unknown as DocumentExtractorService,
      {} as unknown as CanonicalDocumentService,
    );
  });

  const docWrite = () =>
    db.writes.find((w) => w.table === "procurement_documents")
      ?.payload as Record<string, unknown>;

  it("writes a receiving_advice that is OURS, with no confidence and no money", async () => {
    const res = await service.recordDoorCount({
      restaurantId: "rest-1",
      providerId: "prov-1",
      countedBy: "u1",
      countedAt: "2026-08-14T07:41:00Z",
      lines: [line()],
    });
    expect(res.error).toBeUndefined();
    expect(res.documentId).toBe("doc-count");

    const doc = docWrite();
    expect(doc.doc_type).toBe("receiving_advice");
    expect(doc.direction).toBe("issued_by_us");
    expect(doc.source_channel).toBe("manual");
    // NULL, NOT 0 — nothing read this document, so there is no confidence.
    expect(doc.extraction_confidence).toBeNull();
    expect(doc.extraction_model).toBeNull();
    // No money at the door (D11), and absent rather than zero.
    expect(doc.currency).toBeNull();
    expect(doc.total).toBeNull();
    expect(doc.subtotal).toBeNull();
    // Nobody printed a number on a count, and the partial unique index on
    // (restaurant, provider, type, number) would make a second count a
    // duplicate-key error if this invented one.
    expect(doc.doc_number).toBeNull();
    // Not `verified`: one person typed it and nobody else has checked it.
    expect(doc.status).toBe("received");
  });

  it("puts no price on any line — a 0.00 would say the goods were free", async () => {
    await service.recordDoorCount({
      restaurantId: "rest-1",
      countedBy: "u1",
      lines: [line(), line({ lineNo: 2, qty: 3, uom: "case", packSize: 12 })],
    });
    const lines = db.writes.find(
      (w) => w.table === "procurement_document_lines",
    )?.payload as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.unit_price).toBeNull();
      expect(l.line_total).toBeNull();
    }
    // Bottle-equivalents ARE computed: 3 cases of 12 is 36 bottles, and every
    // quantity comparison downstream uses that, never the counted number.
    expect(lines[1].qty).toBe(3);
    expect(lines[1].qty_bottles).toBe(36);
  });

  it("reads a Turkish unit rather than falling back to bottles", async () => {
    await service.recordDoorCount({
      restaurantId: "rest-1",
      countedBy: "u1",
      lines: [line({ qty: 2, uom: "koli", packSize: 6 })],
    });
    const lines = db.writes.find(
      (w) => w.table === "procurement_document_lines",
    )?.payload as Record<string, unknown>[];
    expect(lines[0].uom).toBe("case");
    expect(lines[0].qty_bottles).toBe(12);
  });

  it("refuses a count with no lines — an empty count is not a count (A6)", async () => {
    const res = await service.recordDoorCount({
      restaurantId: "rest-1",
      countedBy: "u1",
      lines: [],
    });
    expect(res.documentId).toBeNull();
    expect(res.error).toMatch(/not a count/i);
    expect(db.writes).toEqual([]);
  });

  it("carries the signature into the snapshot, because D3 rule B reads it there", async () => {
    await service.recordDoorCount({
      restaurantId: "rest-1",
      countedBy: "u1",
      countedAt: "2026-08-14T07:41:00Z",
      lines: [line()],
      signedBy: "Ayşe",
    });
    const doc = docWrite();
    const snap = doc.extracted as { signature: { signedBy: string } | null };
    expect(snap.signature?.signedBy).toBe("Ayşe");
  });

  it("records NO signature rather than an empty one when nobody signed", async () => {
    await service.recordDoorCount({
      restaurantId: "rest-1",
      countedBy: "u1",
      lines: [line()],
    });
    const snap = (docWrite().extracted as { signature: unknown }).signature;
    // `null` is a fact about the door — nobody signed — and D3 rule B cannot
    // fire on it. An `{}` would look like a signature with a missing name.
    expect(snap).toBeNull();
  });

  it("hashes the moment as well as the numbers, so a re-count is not a duplicate", async () => {
    await service.recordDoorCount({
      restaurantId: "rest-1",
      countedBy: "u1",
      countedAt: "2026-08-14T07:41:00Z",
      lines: [line()],
    });
    const first = docWrite().sha256 as string;
    db.writes.length = 0;
    await service.recordDoorCount({
      restaurantId: "rest-1",
      countedBy: "u1",
      countedAt: "2026-08-14T08:55:00Z",
      lines: [line()],
    });
    expect(docWrite().sha256).not.toBe(first);
  });

  it("says the document landed and its LINES did not, rather than 'the count failed'", async () => {
    db.insertAnswers.procurement_document_lines = {
      data: null,
      error: { message: "deadlock detected" },
    };
    const res = await service.recordDoorCount({
      restaurantId: "rest-1",
      countedBy: "u1",
      lines: [line()],
    });
    // The row exists. Reporting a plain failure would send a receiver to type
    // the whole count again on top of a document that is already there.
    expect(res.documentId).toBe("doc-count");
    expect(res.error).toMatch(/was written but its lines were not/);
  });

  it("writes no stock", async () => {
    await service.recordDoorCount({
      restaurantId: "rest-1",
      countedBy: "u1",
      lines: [line()],
    });
    expect(
      db.writes.filter(
        (w) =>
          w.table === "inventory_lots" ||
          w.table === "inventory_transactions" ||
          w.table === "restaurant_inventory",
      ),
    ).toEqual([]);
  });
});
