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

  it("a corrected line kind is laid on the snapshot entry of that line_no, not on array position (r110)", () => {
    const snap = [
      { lineNo: 2, lineKind: "goods", description: "Nakliye" },
      { lineNo: 1, lineKind: "goods" },
    ];
    const out = overlayCorrections({ id: "d", extracted_lines: snap }, rows, [
      { revision: 2, kind: "correction", field_path: "lines[1].lineKind", after: env("fee") },
    ]);
    expect(out.header.extracted_lines).toEqual([{ lineNo: 2, lineKind: "fee", description: "Nakliye" }, { lineNo: 1, lineKind: "goods" }]);
    expect(out.lines[0]).toBe(rows[0]);
    expect(out.lines[1]).toBe(rows[1]);
    expect(snap[0].lineKind).toBe("goods");
  });

  it("a line the snapshot lacks gets an entry; a kind no line has is not written", () => {
    const snap = [{ lineNo: 1, lineKind: "goods" }];
    const added = overlayCorrections({ id: "d", extracted_lines: snap }, rows, [
      { revision: 2, kind: "correction", field_path: "lines[1].lineKind", after: env("deposit") },
    ]);
    expect(added.header.extracted_lines).toEqual([{ lineNo: 1, lineKind: "goods" }, { lineNo: 2, lineKind: "deposit" }]);
    const junk = overlayCorrections({ id: "d", extracted_lines: snap }, rows, [
      { revision: 2, kind: "correction", field_path: "lines[0].lineKind", after: env("freight") },
      { revision: 3, kind: "correction", field_path: "lines[5].lineKind", after: env("fee") },
    ]);
    expect(junk.header.extracted_lines).toBe(snap);
  });

  it("movesCost names the money fields and nothing else", () => {
    expect(["lines[0].netPrice", "lines[2].quantity", "lines[1].unit", "lines[0].priceBaseQuantity", "lines[0].priceBaseUnit", "lines[0].netAmount", "currency", "lines[3].lineKind"].every(movesCost)).toBe(true);
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

  describe("a line corrected into or out of a charge (r110)", () => {
    const freight = (kind: string) => {
      db.answers.procurement_documents = {
        data: [{ id: "inv-1", doc_number: "A-1", freight: 50, extracted_lines: [{ lineNo: 1, lineKind: "goods" }, { lineNo: 2, lineKind: kind }] }],
        error: null,
      };
      db.answers.procurement_document_lines = {
        data: [
          { document_id: "inv-1", line_no: 1, inventory_id: ITEM, qty: 10, qty_bottles: 10, uom: "bottle", pack_size: 1, unit_price: 60, line_total: 600 },
          { document_id: "inv-1", line_no: 2, inventory_id: null, qty: 1, qty_bottles: null, uom: null, pack_size: null, unit_price: 50, line_total: 50, description: "Nakliye" },
        ],
        error: null,
      };
    };
    // The paper prints freight 50 in its header and again as line 2. A fee
    // line is not stock, so the item carries all 50: (600 + 50) / 10.
    it("as read, a fee line is not stock and the item carries the freight", async () => {
      freight("fee");
      corrected();
      await service.finaliseAtVerified(REST, DEL, "u1");
      expect(posted()).toEqual([65]);
    });
    it("a goods line corrected to a fee is costed like one", async () => {
      freight("goods");
      corrected([2, "lines[1].lineKind", "fee"]);
      await service.finaliseAtVerified(REST, DEL, "u1");
      expect(posted()).toEqual([65]);
    });
    // A stock line naming no item cannot take its share of the freight, so
    // the paper's charges are held and nothing is posted on a guess.
    it("a fee corrected to goods is stock again, and its charge share holds the cost", async () => {
      freight("fee");
      corrected([2, "lines[1].lineKind", "goods"]);
      await service.finaliseAtVerified(REST, DEL, "u1");
      expect(posted()).toEqual([]);
    });
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
