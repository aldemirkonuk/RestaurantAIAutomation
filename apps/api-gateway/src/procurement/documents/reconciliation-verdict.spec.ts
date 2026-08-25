import { applyTieOut, ParsedDocument } from "./parsed-document";
import {
  reconciliationVerdict,
  RECONCILIATION_BASIS,
} from "./reconciliation-verdict";

/**
 * These tests pin the doneability verdict for `document_extraction` (OD-59).
 *
 * The rule they defend: a verdict may only ever say what the grader can prove.
 * Every case below distinguishes one of the four honest answers — success,
 * failure, "ran but untestable" (outcome null), and "not mine to judge" (no
 * row at all). Collapsing any two of those is how a narrow verdict turns into
 * a false definition of "done".
 */

const doc = (over: Partial<ParsedDocument> = {}): ParsedDocument =>
  applyTieOut({
    docType: "invoice",
    docNumber: "INV-1",
    docDate: "2026-08-25",
    referencesDocNumber: null,
    poNumber: null,
    vendorName: "Southern Glazers",
    vendorAccount: null,
    currency: "USD",
    subtotal: null,
    freight: null,
    fuelSurcharge: null,
    splitCaseFee: null,
    deliveryFee: null,
    depositTotal: null,
    tax: null,
    otherCharges: null,
    discountTotal: null,
    total: 100,
    lines: [
      {
        vendorSku: "A",
        description: "Chablis",
        vintage: null,
        formatMl: 750,
        qty: 2,
        uom: "bottle",
        packSize: null,
        unitPrice: 50,
        lineTotal: 100,
        allowance: null,
        deposit: null,
      },
    ],
    computedLinesTotal: null,
    tieOutDelta: null,
    tiesOut: null,
    confidence: 0.8,
    warnings: [],
    ...over,
  } as ParsedDocument);

describe("reconciliationVerdict", () => {
  it("grades a balancing invoice as success", () => {
    const v = reconciliationVerdict(doc());
    expect(v?.outcome).toBe("success");
    expect(v?.evidence?.tie_out_delta).toBe(0);
  });

  it("grades an invoice that does not balance as failure", () => {
    // Lines say 100, the document claims 250. One of those was misread.
    const v = reconciliationVerdict(doc({ total: 250 }));
    expect(v?.outcome).toBe("failure");
    expect(v?.evidence?.stated_total).toBe(250);
    expect(v?.evidence?.computed_lines_total).toBe(100);
  });

  it("returns outcome null — not failure — when there is no stated total", () => {
    // The grader RAN and the case is untestable. Calling this a failure would
    // train people to ignore the flag, which is the same reasoning applyTieOut
    // uses for tiesOut = null.
    const v = reconciliationVerdict(doc({ total: null }));
    expect(v).not.toBeNull();
    expect(v?.outcome).toBeNull();
    expect(v?.evidence?.untestable).toBe("no_total");
  });

  it("returns no verdict at all for a non-invoice", () => {
    // Founder decision, OD-59: invoices only. A credit memo runs the same
    // arithmetic but is a different job, and must read as ungraded rather than
    // be folded into the invoice figure.
    expect(reconciliationVerdict(doc({ docType: "credit_memo" }))).toBeNull();
    expect(reconciliationVerdict(doc({ docType: "unknown" }))).toBeNull();
  });

  it("records the tolerance it actually judged against", () => {
    // The tolerance is per-line, so evidence citing a fixed value would be a
    // lie on any invoice longer than one line.
    const v = reconciliationVerdict(doc());
    expect(v?.evidence?.tolerance_cents).toBe(1);
    expect(v?.evidence?.line_count).toBe(1);
  });

  it("accepts rounding inside tolerance but not outside it", () => {
    // One cent per line: at 1 line the tolerance is 1 cent.
    expect(reconciliationVerdict(doc({ total: 100.01 }))?.outcome).toBe(
      "success",
    );
    expect(reconciliationVerdict(doc({ total: 100.05 }))?.outcome).toBe(
      "failure",
    );
  });

  it("names the basis so a narrow verdict cannot pass as a broad one", () => {
    // The version suffix is the mechanism, not decoration: a stricter grader
    // must be able to land beside this one rather than silently replace it.
    expect(RECONCILIATION_BASIS).toBe("reconciliation_v1");
  });
});
