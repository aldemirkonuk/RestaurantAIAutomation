import { makeMockDb, MockDb } from "../canonical/delivery-mock";
import { paperForTheDoor } from "./door-count-paper";

/** r24: a door count of a paper books by the paper's own lines, order and delivery. */
const REST = "11111111-1111-1111-1111-111111111111";
const PAPER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OIL = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const L1 = "10000000-0000-0000-0000-000000000001";
const L2 = "10000000-0000-0000-0000-000000000002";
const ORDER = "0bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const paperLines = [
  { id: L1, line_no: 3, inventory_id: OIL, uom: "liter", format_ml: null, pack_size: 1, vintage: null, description: "Zeytinyağı", vendor_sku: "ZY-5" },
  { id: L2, line_no: 4, inventory_id: null, uom: "bottle", format_ml: 200, pack_size: 1, vintage: null, description: "Tonik", vendor_sku: null },
];

describe("paperForTheDoor (r24)", () => {
  let db: MockDb;
  const client = () => db.client.getClient() as never;

  beforeEach(() => {
    db = makeMockDb();
    db.answers.procurement_documents = { data: { id: PAPER, doc_type: "invoice" }, error: null };
    db.answers.procurement_document_lines = { data: paperLines, error: null };
    db.answers.procurement_document_links = { data: [{ order_id: ORDER }], error: null };
    db.answers.document_deliveries = { data: [], error: null };
  });

  it("a counted line takes the paper's item, unit and line number, not the client's", async () => {
    const r = await paperForTheDoor(client(), REST, PAPER, [
      { lineNo: 1, qty: 5, uom: "bottle", inventoryId: "99999999-9999-9999-9999-999999999999", sourceLineId: L1 },
    ], null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.role).toBe("invoice");
    expect(r.value.orderId).toBe(ORDER);
    expect(r.value.lines).toEqual([
      { lineNo: 3, qty: 5, uom: "liter", description: "Zeytinyağı", vendorSku: "ZY-5", packSize: 1, inventoryId: OIL, sourceLineId: L1 },
    ]);
  });

  it("an unpaired paper line carries no item, and its size travels", async () => {
    const r = await paperForTheDoor(client(), REST, PAPER, [{ lineNo: 1, qty: 12, uom: "bottle", sourceLineId: L2 }], null);
    expect(r.ok && r.value.lines[0]).toEqual({ lineNo: 4, qty: 12, uom: "bottle", description: "Tonik", packSize: 1, formatMl: 200, sourceLineId: L2 });
  });

  it("a paper with no order is countable: the delivery names none", async () => {
    db.answers.procurement_document_links = { data: [], error: null };
    const r = await paperForTheDoor(client(), REST, PAPER, [{ lineNo: 1, qty: 5, uom: "liter", sourceLineId: L1 }], null);
    expect(r.ok && r.value.orderId).toBeNull();
  });

  it("a delivery note is counted as the despatch advice", async () => {
    db.answers.procurement_documents = { data: { id: PAPER, doc_type: "delivery_note" }, error: null };
    const r = await paperForTheDoor(client(), REST, PAPER, [{ lineNo: 1, qty: 5, uom: "liter", sourceLineId: L1 }], null);
    expect(r.ok && r.value.role).toBe("despatch_advice");
  });

  it("finds the open deliveries the paper already sits on, not the cancelled ones", async () => {
    db.answers.document_deliveries = { data: [{ delivery_id: "d1" }, { delivery_id: "d2" }], error: null };
    db.answers.deliveries = { data: [{ id: "d1", state: "DELIVERED" }, { id: "d2", state: "CANCELLED" }], error: null };
    const r = await paperForTheDoor(client(), REST, PAPER, [{ lineNo: 1, qty: 5, uom: "liter", sourceLineId: L1 }], null);
    expect(r.ok && r.value.openDeliveryIds).toEqual(["d1"]);
  });

  it.each([
    ["a line that names no paper line", [{ lineNo: 1, qty: 5, uom: "liter" }], 400, "does not say which line"],
    ["a line not on this paper", [{ lineNo: 1, qty: 5, uom: "liter", sourceLineId: "20000000-0000-0000-0000-000000000009" }], 400, "not on this paper"],
    ["one paper line counted twice", [{ lineNo: 1, qty: 5, uom: "liter", sourceLineId: L1 }, { lineNo: 2, qty: 1, uom: "liter", sourceLineId: L1 }], 400, "counted twice"],
  ])("refuses %s before anything is written", async (_why, lines, status, words) => {
    const r = await paperForTheDoor(client(), REST, PAPER, lines as never, null);
    expect(r).toMatchObject({ ok: false, status });
    if (!r.ok) expect(r.error).toContain(words);
    expect(db.writes).toEqual([]);
  });

  it("refuses a paper that is not counted at a door, and one not at this house", async () => {
    db.answers.procurement_documents = { data: { id: PAPER, doc_type: "credit_memo" }, error: null };
    const memo = await paperForTheDoor(client(), REST, PAPER, [{ lineNo: 1, qty: 1, uom: "bottle", sourceLineId: L1 }], null);
    expect(memo).toMatchObject({ ok: false, status: 400 });
    db.answers.procurement_documents = { data: null, error: null };
    const gone = await paperForTheDoor(client(), REST, PAPER, [{ lineNo: 1, qty: 1, uom: "bottle", sourceLineId: L1 }], null);
    expect(gone).toMatchObject({ ok: false, status: 404 });
  });

  it("several orders: asks which, and takes only one of the paper's own", async () => {
    db.answers.procurement_document_links = { data: [{ order_id: ORDER }, { order_id: "0ccccccc-cccc-cccc-cccc-cccccccccccc" }], error: null };
    const line = [{ lineNo: 1, qty: 5, uom: "liter", sourceLineId: L1 }];
    expect(await paperForTheDoor(client(), REST, PAPER, line, null)).toMatchObject({ ok: false, status: 409 });
    expect(await paperForTheDoor(client(), REST, PAPER, line, "0ddddddd-dddd-dddd-dddd-dddddddddddd")).toMatchObject({ ok: false, status: 400 });
    const picked = await paperForTheDoor(client(), REST, PAPER, line, ORDER);
    expect(picked.ok && picked.value.orderId).toBe(ORDER);
  });

  it("a failed read is a refusal, never an empty answer", async () => {
    db.answers.procurement_document_links = { data: null, error: { message: "boom" } };
    const r = await paperForTheDoor(client(), REST, PAPER, [{ lineNo: 1, qty: 5, uom: "liter", sourceLineId: L1 }], null);
    expect(r).toMatchObject({ ok: false, status: 503 });
  });
});
