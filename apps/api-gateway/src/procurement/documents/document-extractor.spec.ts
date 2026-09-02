import { ConfigService } from "@nestjs/config";
import {
  DocumentExtractorService,
  settledEventId,
} from "./document-extractor.service";
import { isDocumentLike } from "./document-intake.service";
import { NfEventRef } from "../../common/model-client/model-client.service";

const svc = new DocumentExtractorService(
  {
    get: () => undefined,
  } as unknown as ConfigService,
  // modelClient — these tests exercise normalize() only, never the transport.
  {} as any,
  // nfVerdicts — likewise unreached: the verdict is written by extract(), not
  // normalize(). reconciliation-verdict.spec.ts covers the grading rule itself.
  {} as any,
);

const json = (o: unknown) => JSON.stringify(o);

const INVOICE = {
  docType: "invoice",
  docNumber: "INV-88213",
  docDate: "2026-07-15",
  vendorName: "Southern Glazers",
  currency: "USD",
  freight: 48,
  total: 1104,
  lines: [
    {
      description: "Barolo",
      qty: 24,
      uom: "bottles",
      unitPrice: 22,
      lineTotal: 528,
    },
    {
      description: "Sancerre",
      qty: 2,
      uom: "CS",
      packSize: 12,
      unitPrice: 264,
      lineTotal: 528,
    },
  ],
};

describe("DocumentExtractorService.normalize", () => {
  it("normalises units and converts cases to bottles", () => {
    const d = svc.normalize(json(INVOICE), "test");

    expect(d.lines[0].uom).toBe("bottle"); // "bottles" plural from the model
    expect(d.lines[1].uom).toBe("case"); // "CS"
    expect(d.lines[1].packSize).toBe(12);
    expect(d.lines[1].qtyBottles).toBe(24);
  });

  it("ties out lines plus charges against the stated total", () => {
    const d = svc.normalize(json(INVOICE), "test");

    expect(d.computedLinesTotal).toBe(1056);
    expect(d.tiesOut).toBe(true);
    expect(d.warnings).toHaveLength(0);
  });

  it("drops confidence hard when the arithmetic breaks", () => {
    // A model that misreads a quantity or a price almost always breaks the sum.
    // This is the cheapest hallucination detector available and it costs nothing.
    const d = svc.normalize(json({ ...INVOICE, total: 9999 }), "test");

    expect(d.tiesOut).toBe(false);
    expect(d.confidence).toBeLessThanOrEqual(0.35);
    expect(d.warnings.join(" ")).toMatch(/off by/);
  });

  it("never infers free goods from a photograph", () => {
    // Netting quantity out of the billable comparison on a model's guess would
    // mask a real overbill — the expensive direction to be wrong.
    const d = svc.normalize(
      json({ ...INVOICE, lines: [{ qty: 11, uom: "bottle", unitPrice: 0 }] }),
      "test",
    );
    expect(d.lines[0].freeGoodsQty).toBe(0);
  });

  it("does not compute a line total the document did not print", () => {
    // The prompt says transcribe, never calculate. A computed total that
    // disagrees with the paper would defeat the tie-out check by construction.
    const d = svc.normalize(
      json({
        docType: "invoice",
        lines: [{ qty: 6, uom: "bottle", unitPrice: 450 }],
      }),
      "test",
    );
    expect(d.lines[0].lineTotal).toBeNull();
  });

  it("flags an invoice with no prices as probably a packing slip", () => {
    // Mislabelling a packing slip as an invoice destroys the evidence that makes
    // an overbilling claim self-proving.
    const d = svc.normalize(
      json({ docType: "invoice", lines: [{ qty: 24, uom: "bottle" }] }),
      "test",
    );
    expect(d.warnings.join(" ")).toMatch(/packing slip/i);
  });

  it("returns unknown rather than an empty invoice when the model returns prose", () => {
    // An empty invoice reads downstream as a vendor who billed nothing.
    const d = svc.normalize("I'm sorry, I can't read this image.", "test");

    expect(d.docType).toBe("unknown");
    expect(d.confidence).toBe(0);
    expect(d.lines).toHaveLength(0);
  });

  it("files an unrecognised document type as unknown instead of guessing", () => {
    const d = svc.normalize(
      json({ docType: "bill_of_lading", lines: [] }),
      "test",
    );

    expect(d.docType).toBe("unknown");
    expect(d.warnings.join(" ")).toMatch(/bill_of_lading/);
  });

  it("strips currency noise the prompt asked the model not to send", () => {
    const d = svc.normalize(
      json({ docType: "invoice", total: "$1,104.00", lines: [] }),
      "test",
    );
    expect(d.total).toBe(1104);
  });

  it("treats a missing total as untestable, not as a failed tie-out", () => {
    // Reporting "does not tie out" for a document with no stated total would
    // train people to ignore the flag.
    const d = svc.normalize(
      json({ docType: "packing_slip", lines: [{ qty: 24, uom: "bottle" }] }),
      "test",
    );
    expect(d.tiesOut).toBeNull();
  });

  it("keeps confidence below the EDI ceiling even on a clean read", () => {
    // EDI is structured data from the source system; this is a model reading a
    // photograph possibly taken in a stairwell, and the number should say so.
    const d = svc.normalize(json(INVOICE), "test");
    expect(d.confidence).toBeLessThan(0.9);
  });
});

describe("isDocumentLike", () => {
  it("accepts the formats distributors actually send", () => {
    expect(isDocumentLike("application/pdf", "invoice_88213.pdf")).toBe(true);
    expect(isDocumentLike("image/jpeg", "IMG_4471.jpg")).toBe(true);
    expect(isDocumentLike(null, "SGWS_810.edi")).toBe(true);
  });

  it("rejects the images that ride along on every vendor email", () => {
    // Running each of these through a vision model costs money per message and
    // fills the review queue with noise, which teaches people to ignore it.
    expect(isDocumentLike("image/png", "company-logo.png")).toBe(false);
    expect(isDocumentLike("image/png", "email_signature.png")).toBe(false);
    expect(isDocumentLike("image/gif", "footer-banner.gif")).toBe(false);
  });

  it("rejects unrelated file types", () => {
    expect(isDocumentLike("application/zip", "archive.zip")).toBe(false);
    expect(isDocumentLike("text/calendar", "invite.ics")).toBe(false);
  });
});

/**
 * ADR 0059 (L6) — the footprint id is carried out with the document so the
 * extraction can be attributed to a model.
 *
 * The wait is BOUNDED, and that is the whole substance of these tests.
 * `model-client.service.ts:326` states that emission latency never rides a user
 * path: the emit is `void`ed on purpose, and the ref settles only when that
 * background insert finishes. A plain `await ref.id` would have handed the
 * instrument the power to hang the extraction it measures — the exact inversion
 * the module forbids — on a path where the user is a receiver standing at a
 * door with a driver waiting.
 */
describe("settledEventId — attribution never blocks the extraction", () => {
  it("returns the id when the emit lands", async () => {
    const ref = new NfEventRef();
    ref.settle("evt-1");
    await expect(settledEventId(ref, 50)).resolves.toBe("evt-1");
  });

  it("returns null when the emit was dropped", async () => {
    const ref = new NfEventRef();
    // A dropped emit settles with null rather than hanging — the model client
    // guarantees this in its `.finally()`. Attribution is lost; nothing else is.
    ref.settle(null);
    await expect(settledEventId(ref, 50)).resolves.toBeNull();
  });

  it("gives up rather than waiting on a ref that never settles", async () => {
    const started = Date.now();
    // Never settled: a footprint insert that stalled. Before the bound, this
    // hung the extraction — and therefore the HTTP request — forever.
    const out = await settledEventId(new NfEventRef(), 20);
    expect(out).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
