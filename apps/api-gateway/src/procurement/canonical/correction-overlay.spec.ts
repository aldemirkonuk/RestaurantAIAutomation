/**
 * r109 (DD-r108-20): costing reads the CORRECTED paper. Fixtures are SYNTHETIC.
 */
import { DatabaseService } from "../../database/database.service";
import { makeMockDb, MockDb } from "./delivery-mock";
import { DeliveryStockService } from "./delivery-stock.service";
import { movesCost, overlayCorrections } from "./correction-overlay";

const REST = "11111111-1111-1111-1111-111111111111";
const DEL = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ITEM = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const env = (value: unknown) => ({ value, source: "human_corrected", revision: 2 });

describe("overlayCorrections", () => {
  const rows = [
    { document_id: "d", line_no: 2, qty: 1, qty_bottles: 1, uom: "bottle", unit_price: 9, line_total: 9, pack_size: 1 },
    { document_id: "d", line_no: 1, qty: 1, qty_bottles: 1, uom: "bottle", unit_price: 5, line_total: 5, pack_size: 1 },
  ];

  it("lines[n] is the n-th line by line_no, and an untouched line comes back as stored", () => {
    const out = overlayCorrections({ id: "d" }, rows, [
      { revision: 2, kind: "correction", field_path: "lines[1].netPrice", after: env(8) },
    ]);
    expect(out.lines[0]).toEqual({ ...rows[0], unit_price: 8 });
    expect(out.lines[1]).toBe(rows[1]);
    expect(out.touched).toBe(true);
  });

  it("a later revision wins, a tick changes nothing, a header total is laid over", () => {
    const out = overlayCorrections({ id: "d", total: 14 }, rows, [
      { revision: 3, kind: "correction", field_path: "lines[0].netPrice", after: env(4) },
      { revision: 2, kind: "correction", field_path: "lines[0].netPrice", after: env(6) },
      { revision: 4, kind: "verification", field_path: "lines[0].netPrice", after: env(99) },
      { revision: 5, kind: "correction", field_path: "totals.taxInclusiveAmount", after: env(13) },
    ]);
    expect(out.lines[1]).toMatchObject({ unit_price: 4 });
    expect(out.header).toMatchObject({ total: 13 });
  });

  it("a corrected quantity re-derives the bottles; a field that moves no cost is not laid over", () => {
    const cases = [{ document_id: "d", line_no: 1, qty: 2, qty_bottles: 12, uom: "case", pack_size: 6, unit_price: 60, line_total: 120 }];
    const out = overlayCorrections({ id: "d" }, cases, [
      { revision: 2, kind: "correction", field_path: "lines[0].quantity", after: env(3) },
      { revision: 3, kind: "correction", field_path: "lines[0].description", after: env("x") },
    ]);
    expect(out.lines[0]).toEqual({ ...cases[0], qty: 3, qty_bottles: 18 });
  });

  it("movesCost names the money fields and nothing else", () => {
    expect(["lines[0].netPrice", "lines[2].quantity", "lines[1].unit", "lines[0].priceBaseQuantity", "lines[0].priceBaseUnit", "lines[0].netAmount", "currency"].every(movesCost)).toBe(true);
    expect(["lines[0].description", "documentNumber", "lines[0].vintage", "nope"].some(movesCost)).toBe(false);
  });
});

describe("verify costs the corrected paper (r109)", () => {
  let db: MockDb;
  let service: DeliveryStockService;
  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    service = new DeliveryStockService(db.client as unknown as DatabaseService);
    db.answers.deliveries = { data: { id: DEL, state: "AGREED", order_id: null }, error: null };
    db.answers.document_deliveries = { data: [{ document_id: "inv-1", role: "invoice" }], error: null };
    db.answers.delivery_proposals = { data: [], error: null };
    db.answers.procurement_documents = { data: [{ id: "inv-1", doc_number: "A-1" }], error: null };
    db.answers.procurement_document_lines = {
      data: [{ document_id: "inv-1", line_no: 1, inventory_id: ITEM, qty: 10, qty_bottles: 10, uom: "bottle", pack_size: 1, unit_price: 60, line_total: 600 }],
      error: null,
    };
    db.answers.inventory_transactions = { data: [{ inventory_id: ITEM, quantity_change: 10 }], error: null };
  });
  const posted = () => db.rpcCalls.filter((c) => c.fn === "finalise_delivery_cost").map((c) => c.args.p_unit_cost);
  const corrected = (...c: [number, string, unknown][]) =>
    (db.answers.document_corrections = {
      data: c.map(([revision, field_path, v]) => ({ document_id: "inv-1", revision, kind: "correction", field_path, after: env(v) })),
      error: null,
    });

  it("a corrected price and total are what the lot costs, not the first read", async () => {
    corrected([2, "lines[0].netPrice", 55], [3, "lines[0].netAmount", 550]);
    await service.finaliseAtVerified(REST, DEL, "u1");
    expect(posted()).toEqual([55]);
  });

  it("a paper with no corrections costs as stored", async () => {
    corrected();
    await service.finaliseAtVerified(REST, DEL, "u1");
    expect(posted()).toEqual([60]);
  });

  it("a failed read of the corrections posts nothing (ADR 0067)", async () => {
    db.answers.document_corrections = { data: null, error: { message: "boom" } };
    const r = await service.finaliseAtVerified(REST, DEL, "u1");
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(posted()).toEqual([]);
  });
});
