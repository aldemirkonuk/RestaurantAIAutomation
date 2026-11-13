import { makeMockDb, MockDb } from "../canonical/delivery-mock";
import { DocumentsController } from "./documents.controller";

/**
 * r24: `POST /procurement/documents/door-count` with `forDocumentId`. The r23
 * walk counted R23-VOL-1 (5 liter @ 120, linked to an order) at its door: 201,
 * 0 lots, and a delivery holding only the count. These pin what the route now
 * hands on: the paper's lines, the paper and its order on the delivery.
 */
const HOUSE = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const PAPER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LINE = "10000000-0000-4000-8000-000000000001";
const OIL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ORDER = "0bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const user = { userId: PERSON, restaurantId: HOUSE, role: "staff" };

function harness() {
  const db: MockDb = makeMockDb();
  db.answers.procurement_documents = { data: { id: PAPER, doc_type: "invoice" }, error: null };
  db.answers.procurement_document_lines = {
    data: [{ id: LINE, line_no: 1, inventory_id: OIL, uom: "liter", format_ml: null, pack_size: 1, vintage: null, description: "Zeytinyağı", vendor_sku: null }],
    error: null,
  };
  db.answers.procurement_document_links = { data: [{ order_id: ORDER }], error: null };
  db.answers.document_deliveries = { data: [], error: null };
  const calls: Record<string, unknown[]> = { record: [], create: [], link: [], book: [] };
  const intake = {
    recordDoorCount: async (input: unknown) => {
      calls.record.push(input);
      return { documentId: "door-1", parsed: {}, duplicate: false };
    },
  };
  const deliveries = {
    create: async (_r: string, _u: string, input: unknown) => {
      calls.create.push(input);
      return { ok: true, value: { delivery: { id: "del-new" }, differsOnLines: 0 } };
    },
    linkDocument: async (_r: string, deliveryId: string, documentId: string, role: string) => {
      calls.link.push({ deliveryId, documentId, role });
      return { ok: true, value: { delivery: { id: deliveryId }, alreadyLinked: documentId === PAPER } };
    },
  };
  const deliveryStock = {
    bookAtTheDoor: async (_r: string, deliveryId: string, documentId: string) => {
      calls.book.push({ deliveryId, documentId });
      return { ok: true, value: { deliveryId, documentId, booked: [], notBooked: [], bottlesMoved: 0 } };
    },
  };
  const none = {} as never;
  const controller = new DocumentsController(
    intake as never, db.client as never, none, none, none, none, none,
    deliveries as never, deliveryStock as never, none, none,
  );
  return { controller, db, calls };
}

const body = (extra: Record<string, unknown> = {}) =>
  ({ forDocumentId: PAPER, createDelivery: true, lines: [{ lineNo: 1, qty: 5, uom: "bottle", sourceLineId: LINE }], ...extra }) as never;

describe("door count of a paper (r24)", () => {
  it("records the paper's line, and makes a delivery holding the count, the paper and its order, then books it", async () => {
    const h = harness();
    const out = (await h.controller.doorCount(body(), user as never)) as Record<string, unknown>;
    expect(h.calls.record[0]).toMatchObject({
      countedFor: PAPER,
      lines: [{ lineNo: 1, qty: 5, uom: "liter", inventoryId: OIL, sourceLineId: LINE }],
    });
    expect(h.calls.create[0]).toMatchObject({
      orderId: ORDER,
      documents: [
        { documentId: "door-1", role: "door_count" },
        { documentId: PAPER, role: "invoice" },
      ],
    });
    expect(h.calls.book).toEqual([{ deliveryId: "del-new", documentId: "door-1" }]);
    expect(out.countedFor).toEqual({ documentId: PAPER, orderId: ORDER });
  });

  it("a paper already on one open delivery is counted onto it, and stays on it", async () => {
    const h = harness();
    h.db.answers.document_deliveries = { data: [{ delivery_id: "del-old" }], error: null };
    h.db.answers.deliveries = { data: [{ id: "del-old", state: "DELIVERED" }], error: null };
    await h.controller.doorCount(body(), user as never);
    expect(h.calls.create).toEqual([]);
    expect(h.calls.link).toEqual([
      { deliveryId: "del-old", documentId: "door-1", role: "door_count" },
      { deliveryId: "del-old", documentId: PAPER, role: "invoice" },
    ]);
    expect(h.calls.book).toEqual([{ deliveryId: "del-old", documentId: "door-1" }]);
  });

  it("a paper on two open deliveries is refused before the count is written", async () => {
    const h = harness();
    h.db.answers.document_deliveries = { data: [{ delivery_id: "a" }, { delivery_id: "b" }], error: null };
    h.db.answers.deliveries = { data: [{ id: "a", state: "DELIVERED" }, { id: "b", state: "AGREED" }], error: null };
    await expect(h.controller.doorCount(body(), user as never)).rejects.toMatchObject({ status: 409 });
    expect(h.calls.record).toEqual([]);
  });

  it("a count with no paper is recorded as before, with the body's own lines", async () => {
    const h = harness();
    await h.controller.doorCount(
      { createDelivery: true, lines: [{ lineNo: 1, qty: 2, uom: "case" }] } as never,
      user as never,
    );
    expect(h.calls.record[0]).toMatchObject({ countedFor: null, lines: [{ lineNo: 1, qty: 2, uom: "case" }] });
    expect(h.calls.create[0]).toMatchObject({ orderId: null, documents: [{ documentId: "door-1", role: "door_count" }] });
  });
});

describe("the paper's own sheet reads its door count (r24)", () => {
  it("GET :id/canonical asks the builder for the door", async () => {
    const calls: unknown[][] = [];
    const canonical = {
      buildFromDocumentId: async (...a: unknown[]) => {
        calls.push(a);
        return { ok: false, error: "document not found" };
      },
    };
    const none = {} as never;
    const controller = new DocumentsController(
      none, none, canonical as never, none, none, none, none, none, none, none, none,
    );
    await expect(controller.canonicalDocument(PAPER, user as never)).rejects.toMatchObject({ status: 404 });
    expect(calls).toEqual([[HOUSE, PAPER, { door: true }]]);
  });
});
