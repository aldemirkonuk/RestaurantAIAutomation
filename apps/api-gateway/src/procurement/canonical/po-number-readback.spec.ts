import { parsedFromDocumentRows, readSnapshot } from "./from-document-rows";
import { canonicalFromParsedDocument } from "./from-parsed-document";

/**
 * BT-13 THROUGH THE READ-BACK (walk-through RECEIPTS-W41, 2026-10-01).
 *
 * The paper printed "Sipariş No: SYN-PO-0001", the reader kept it in the
 * intake snapshot, intake used it to link the order — and the sheet said
 * "Order reference —", because the read-back hard-coded `poNumber: null`.
 * `procurement_documents` has no order-number column, so the snapshot is the
 * only place it lives, exactly as for the seller's name.
 *
 * Every name and number below is SYNTHETIC.
 */

const DOC_ROW = {
  id: "doc-1",
  restaurant_id: "rest-1",
  doc_type: "invoice",
  doc_number: "SYN-TR-0001",
  doc_date: "2026-08-14",
  references_doc_number: "SYN-IRS-0001",
  currency: "TRY",
  total: 1704,
  extracted: { poNumber: "SYN-PO-0001", vendorName: "SENTETİK A.Ş." },
};

const LINE = {
  line_no: 1,
  description: "SYNTHETIC Öküzgözü 2021",
  qty: "12",
  uom: "bottle",
  pack_size: 1,
  qty_bottles: 12,
  unit_price: "142",
  line_total: "1704",
};

const canon = (row: Record<string, unknown>) =>
  canonicalFromParsedDocument(parsedFromDocumentRows(row, [LINE]), {
    documentId: "doc-1",
    restaurantId: "rest-1",
  });

describe("the order number the paper printed reaches the sheet (BT-13)", () => {
  it("is read from the snapshot, not set to nothing", () => {
    expect(readSnapshot(DOC_ROW.extracted).poNumber).toBe("SYN-PO-0001");
    expect(parsedFromDocumentRows(DOC_ROW, [LINE]).poNumber).toBe("SYN-PO-0001");
  });

  it("lands on the canonical order reference with its printed glyphs", () => {
    const ref = canon(DOC_ROW).layer1.purchaseOrderReference;
    expect(ref.value).toBe("SYN-PO-0001");
    expect(ref.as_printed).toBe("SYN-PO-0001");
  });

  it("stays NULL when the page printed none, and a model's \"null\" is not a number", () => {
    expect(canon({ ...DOC_ROW, extracted: {} }).layer1.purchaseOrderReference.value).toBeNull();
    expect(
      canon({ ...DOC_ROW, extracted: { poNumber: "null" } }).layer1.purchaseOrderReference.value,
    ).toBeNull();
    expect(canon({ ...DOC_ROW, extracted: null }).layer1.purchaseOrderReference.value).toBeNull();
  });

  it("does not borrow a line's order number as the document's", () => {
    const row = { ...DOC_ROW, extracted: { lines: [{ lineNo: 1, poNumber: "SYN-PO-0009" }] } };
    expect(canon(row).layer1.purchaseOrderReference.value).toBeNull();
  });
});
