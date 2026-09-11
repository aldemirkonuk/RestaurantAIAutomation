/**
 * What a document seal is a seal OVER — the pure half, no database and no Nest.
 *
 * These are the properties that make the seal more than a second click. Each one
 * is a way the mechanism could be decorative if the arguments were chosen badly,
 * and each is stated as a hash comparison rather than as a claim about intent.
 */

import { hashCallArgs } from "../../common/seal/seal-token";
import {
  DOCUMENT_SEAL_ACTS,
  DOCUMENT_SEAL_SUBJECT_KIND,
  documentCurrencySealArgs,
  documentLineEditPatchArgs,
  documentLineEditSealArgs,
  documentSealLine,
  documentVerifySealArgs,
  isDocumentSealAct,
} from "./document-seal";
import { SEAL_SUBJECT_KINDS } from "../../common/seal/seal-subject";
import {
  DOCUMENT_SEAL_DOC_COLUMNS,
  DOCUMENT_SEAL_LINE_COLUMNS,
} from "./documents.controller";

const DOC = {
  id: "doc-1",
  status: "needs_review",
  currency: null,
  doc_number: "INV-1",
  doc_date: "2026-09-01",
  total: 120,
  freight: null,
  fuel_surcharge: null,
  split_case_fee: null,
  delivery_fee: null,
  deposit_total: null,
  tax: null,
  other_charges: null,
  discount_total: null,
};

const LINE_A = {
  id: "line-a",
  line_no: 1,
  qty: 12,
  uom: "bottle",
  pack_size: 1,
  qty_bottles: 12,
  free_goods_qty: 0,
  unit_price: 10,
  line_total: 120,
  allowance: null,
  description: "Kavaklidere Yakut",
  vintage: 2021,
  vendor_sku: "KY-21",
};

const LINE_B = { ...LINE_A, id: "line-b", line_no: 2, description: "Okuzgozu" };

describe("document-seal — the acts and the kind", () => {
  it("declares exactly the three acts the founder's decision names", () => {
    expect([...DOCUMENT_SEAL_ACTS]).toEqual([
      "verify",
      "line_edit",
      "currency_restate",
    ]);
  });

  it("names a kind the seal service actually admits", () => {
    // The literal in this module and the literal in the union have to be the
    // same characters, or the gateway declares a kind the database refuses.
    expect(SEAL_SUBJECT_KINDS as readonly string[]).toContain(
      DOCUMENT_SEAL_SUBJECT_KIND,
    );
  });

  it("recognises its own acts and nothing else", () => {
    expect(isDocumentSealAct("verify")).toBe(true);
    expect(isDocumentSealAct("currency_restate")).toBe(true);
    // An ORDER's acts are a different subject kind's vocabulary.
    expect(isDocumentSealAct("approve")).toBe(false);
    expect(isDocumentSealAct(undefined)).toBe(false);
  });
});

describe("document-seal — money is a fixed-precision string at both ends", () => {
  it("hashes a numeric string and a number to the same seal", () => {
    // PostgREST returns `numeric` as a string and `float` as a number. A seal
    // that hashed "10.00" at issue and 10 at redemption would refuse every
    // honest act — the defect `order-seal.ts` found and wrote down.
    const asNumber = documentSealLine(LINE_A);
    const asString = documentSealLine({
      ...LINE_A,
      qty: "12",
      unit_price: "10.00",
      line_total: "120",
    });
    expect(hashCallArgs(asString)).toBe(hashCallArgs(asNumber));
  });

  it("keeps an unreadable figure as 'unknown' rather than substituting zero", () => {
    const line = documentSealLine({ ...LINE_A, unit_price: null });
    expect(line.unitPrice).toBe("unknown");
    // And it CHANGES the moment the figure becomes readable, which is a change
    // worth refusing on. Substituting 0 would have hashed an unknown price as a
    // free one.
    expect(hashCallArgs(line)).not.toBe(hashCallArgs(documentSealLine(LINE_A)));
  });
});

describe("documentVerifySealArgs — the whole transcription", () => {
  it("does not depend on the order the lines came back in", () => {
    // PostgREST promises no order without an `order()`. Two reads that returned
    // the same rows in two orders must not produce two different seals.
    const a = documentVerifySealArgs(DOC, [LINE_A, LINE_B]);
    const b = documentVerifySealArgs(DOC, [LINE_B, LINE_A]);
    expect(hashCallArgs(a)).toBe(hashCallArgs(b));
  });

  it("changes when a line is corrected", () => {
    const before = documentVerifySealArgs(DOC, [LINE_A, LINE_B]);
    const after = documentVerifySealArgs(DOC, [
      { ...LINE_A, qty: 14 },
      LINE_B,
    ]);
    expect(hashCallArgs(after)).not.toBe(hashCallArgs(before));
  });

  it("changes when a line is ADDED or REMOVED, not only when one moves", () => {
    const two = documentVerifySealArgs(DOC, [LINE_A, LINE_B]);
    const one = documentVerifySealArgs(DOC, [LINE_A]);
    expect(hashCallArgs(one)).not.toBe(hashCallArgs(two));
    expect(two.lineCount).toBe(2);
  });

  it("changes when the document's own stated total moves", () => {
    const before = documentVerifySealArgs(DOC, [LINE_A]);
    const after = documentVerifySealArgs({ ...DOC, total: 130 }, [LINE_A]);
    expect(hashCallArgs(after)).not.toBe(hashCallArgs(before));
  });

  it("does NOT change when the matcher pairs a line to an order line", () => {
    // A pairing is a claim about which ORDER line this one answers. Verify
    // asserts nothing about that, and hashing it would make a seal refuse
    // because a background job ran.
    const before = documentVerifySealArgs(DOC, [LINE_A]);
    const after = documentVerifySealArgs(DOC, [
      { ...LINE_A, order_line_id: "ol-9", match_confidence: 0.99 },
    ]);
    expect(hashCallArgs(after)).toBe(hashCallArgs(before));
  });
});

describe("documentLineEditSealArgs — the line and the correction", () => {
  const base = { documentId: "doc-1", lineId: "line-a", status: "needs_review" };

  it("binds the patch, so a seal for qty 12 cannot be spent on 120", () => {
    const twelve = documentLineEditSealArgs({
      ...base,
      line: LINE_A,
      patch: { qty: 12 },
    });
    const hundred = documentLineEditSealArgs({
      ...base,
      line: LINE_A,
      patch: { qty: 120 },
    });
    expect(hashCallArgs(hundred)).not.toBe(hashCallArgs(twelve));
  });

  it("binds the line as it stands, so a second manager's edit refuses it", () => {
    const held = documentLineEditSealArgs({
      ...base,
      line: LINE_A,
      patch: { qty: 14 },
    });
    const moved = documentLineEditSealArgs({
      ...base,
      line: { ...LINE_A, unit_price: 99 },
      patch: { qty: 14 },
    });
    expect(hashCallArgs(moved)).not.toBe(hashCallArgs(held));
  });

  it("keeps ABSENT and NULL apart", () => {
    // A patch that does not mention unitPrice leaves it alone; one that sends
    // null CLEARS it. Collapsing the two would let a seal minted to change a
    // quantity be spent on a request that also wiped the price.
    const absent = documentLineEditPatchArgs({ qty: 14 });
    const cleared = documentLineEditPatchArgs({ qty: 14, unitPrice: null });
    expect(absent).not.toHaveProperty("unitPrice");
    expect(cleared.unitPrice).toBeNull();
    expect(hashCallArgs(cleared)).not.toBe(hashCallArgs(absent));
  });

  it("ignores a key outside the closed list, at both ends", () => {
    // The list is closed so a caller cannot add a key at the write that was not
    // there at the mint and still hash the same.
    const clean = documentLineEditPatchArgs({ qty: 14 });
    const smuggled = documentLineEditPatchArgs({
      qty: 14,
      orderLineId: "ol-9",
    } as Record<string, unknown>);
    expect(hashCallArgs(smuggled)).toBe(hashCallArgs(clean));
  });

  it("hashes a form's string and a number the same, for the same correction", () => {
    expect(hashCallArgs(documentLineEditPatchArgs({ qty: "14" }))).toBe(
      hashCallArgs(documentLineEditPatchArgs({ qty: 14 })),
    );
  });

  it("hashes a line that could not be read as null rather than inventing one", () => {
    const args = documentLineEditSealArgs({
      ...base,
      line: null,
      patch: { qty: 14 },
    });
    expect(args.line).toBeNull();
    expect(hashCallArgs(args)).not.toBe(
      hashCallArgs(
        documentLineEditSealArgs({ ...base, line: LINE_A, patch: { qty: 14 } }),
      ),
    );
  });
});

describe("documentCurrencySealArgs — the pair of codes", () => {
  it("distinguishes a restatement from a confirmation", () => {
    const restate = documentCurrencySealArgs({
      documentId: "doc-1",
      status: "needs_review",
      previous: null,
      next: "EUR",
    });
    const confirm = documentCurrencySealArgs({
      documentId: "doc-1",
      status: "needs_review",
      previous: "EUR",
      next: "EUR",
    });
    expect(hashCallArgs(restate)).not.toBe(hashCallArgs(confirm));
  });

  it("refuses a seal held open while somebody else filed the document", () => {
    const held = documentCurrencySealArgs({
      documentId: "doc-1",
      status: "needs_review",
      previous: null,
      next: "EUR",
    });
    const after = documentCurrencySealArgs({
      documentId: "doc-1",
      status: "needs_review",
      previous: "USD",
      next: "EUR",
    });
    expect(hashCallArgs(after)).not.toBe(hashCallArgs(held));
  });

  it("does not bind the free-text reason", () => {
    // The reason is what a person types ABOUT the decision, not the decision.
    // Binding it would refuse an honest approval because a typo was fixed.
    const args = documentCurrencySealArgs({
      documentId: "doc-1",
      status: "needs_review",
      previous: null,
      next: "EUR",
    });
    expect(Object.keys(args)).not.toContain("reason");
  });
});

/**
 * THE TWO HALVES CANNOT DRIFT.
 *
 * The `.select()` lists live on the controller (so `check_read_columns_exist.py`
 * can read them) and the normalisation lives here. A field added to
 * `documentSealLine` but not to the list would be `undefined` at BOTH ends and
 * hash identically — a seal that silently stopped covering something, which is
 * the absence-reported-as-health shape wearing the seal's own badge.
 *
 * So the fields are MEASURED rather than asserted: a recording Proxy reports
 * every property the function actually touched.
 */
function touched(fn: (row: Record<string, unknown>) => unknown): string[] {
  const seen = new Set<string>();
  const probe = new Proxy(
    {},
    {
      get(_t, key) {
        if (typeof key === "string") seen.add(key);
        return undefined;
      },
      has: () => true,
    },
  ) as Record<string, unknown>;
  fn(probe);
  return [...seen];
}

const columnSet = (list: string) => new Set(list.split(",").map((c) => c.trim()));

describe("the seal's fields and the controller's .select() lists", () => {
  it("reads no line column the controller does not select", () => {
    const selected = columnSet(DOCUMENT_SEAL_LINE_COLUMNS);
    const read = touched((row) => documentSealLine(row));
    expect(read.length).toBeGreaterThan(0);
    expect(read.filter((c) => !selected.has(c))).toEqual([]);
  });

  it("reads no document column the controller does not select", () => {
    const selected = columnSet(DOCUMENT_SEAL_DOC_COLUMNS);
    const read = touched((row) => documentVerifySealArgs(row, []));
    expect(read.length).toBeGreaterThan(0);
    expect(read.filter((c) => !selected.has(c))).toEqual([]);
  });

  it("selects no line column the seal ignores, so the list stays honest", () => {
    // The converse. A column selected and never hashed reads, to somebody
    // maintaining this, like part of what a verification stands behind.
    const read = new Set(touched((row) => documentSealLine(row)));
    expect(
      [...columnSet(DOCUMENT_SEAL_LINE_COLUMNS)].filter((c) => !read.has(c)),
    ).toEqual([]);
  });
});
