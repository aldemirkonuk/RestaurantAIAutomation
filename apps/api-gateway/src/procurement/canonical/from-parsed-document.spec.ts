import { ConfigService } from "@nestjs/config";
import { DocumentExtractorService } from "../documents/document-extractor.service";
import { runInvariants, summarise } from "./canonical-invariants";
import { canonicalFromParsedDocument } from "./from-parsed-document";

/**
 * The mapper, tested against a REAL-SHAPED ParsedDocument rather than a
 * hand-written one: the JSON below is the same fixture shape
 * `document-extractor.spec.ts` uses, run through the extractor's own
 * `normalize()`, so the object under test is what intake genuinely produces —
 * plural units coerced, `CS` resolved, pack sizes applied, tie-out computed.
 *
 * All values are SYNTHETIC.
 */

const svc = new DocumentExtractorService(
  { get: () => undefined } as unknown as ConfigService,
  {} as never,
  {} as never,
);

const RAW_INVOICE = {
  docType: "invoice",
  docNumber: "SYN-88213",
  docDate: "2026-07-15",
  vendorName: "SYNTHETIC Glazers",
  currency: "USD",
  freight: 48,
  total: 1104,
  lines: [
    {
      description: "SYNTHETIC Barolo",
      qty: 24,
      uom: "bottles",
      unitPrice: 22,
      lineTotal: 528,
    },
    {
      description: "SYNTHETIC Sancerre",
      qty: 2,
      uom: "CS",
      packSize: 12,
      unitPrice: 264,
      lineTotal: 528,
    },
  ],
};

const parsed = svc.normalize(JSON.stringify(RAW_INVOICE), "test");

const canonical = canonicalFromParsedDocument(parsed, {
  documentId: "doc-1",
  restaurantId: "rest-1",
});

describe("canonicalFromParsedDocument", () => {
  it("does not mutate ParsedDocument", () => {
    const before = JSON.stringify(parsed);
    canonicalFromParsedDocument(parsed, {
      documentId: "doc-1",
      restaurantId: "rest-1",
    });
    expect(JSON.stringify(parsed)).toBe(before);
  });

  it("wraps every layer-1 field in an envelope carrying its source and revision", () => {
    expect(canonical.layer1.documentNumber).toMatchObject({
      value: "SYN-88213",
      source: "extracted",
      revision: 1,
    });
    expect(canonical.layer1.currency.value).toBe("USD");
    expect(canonical.layer1.lines).toHaveLength(2);
    for (const line of canonical.layer1.lines) {
      expect(line.quantity.source).toBe("extracted");
      expect(line.netAmount).toHaveProperty("confidence");
    }
  });

  it("carries the document's extraction confidence onto the fields", () => {
    expect(canonical.layer1.lines[0].quantity.confidence).toBe(
      parsed.confidence,
    );
  });

  it("preserves as_printed for the values the parser kept as text", () => {
    expect(canonical.layer1.documentNumber.as_printed).toBe("SYN-88213");
    expect(canonical.layer1.issueDate.as_printed).toBe("2026-07-15");
    expect(canonical.layer1.lines[0].description.as_printed).toBe(
      "SYNTHETIC Barolo",
    );
    // The unit as normalised IS what we keep; the plural "bottles" the model
    // returned is lost one layer earlier, in the extractor.
    expect(canonical.layer1.lines[0].unit.as_printed).toBe("bottle");
  });

  it("leaves as_printed null on numbers, because ParsedDocument keeps no raw strings", () => {
    expect(canonical.layer1.lines[0].netAmount.as_printed).toBeNull();
    expect(canonical.layer1.totals.taxInclusiveAmount.as_printed).toBeNull();
  });

  it("maps freight into a BG-21 charge with a reason, not into the goods total", () => {
    const freight = canonical.layer1.allowancesCharges.find(
      (ac) => ac.reason.value === "Freight",
    );
    expect(freight?.isCharge.value).toBe(true);
    expect(freight?.amount.value).toBe(48);
  });

  it("puts the UNCL1001 type code on an invoice and refuses to guess one otherwise", () => {
    expect(canonical.layer1.typeCode.value).toBe("380");
    const note = canonicalFromParsedDocument(
      { ...parsed, docType: "packing_slip" },
      { documentId: "d", restaurantId: "r" },
    );
    expect(note.layer1.typeCode.value).toBeNull();
  });

  it("routes referencesDocNumber to BT-25 on a credit memo and BT-16 otherwise", () => {
    const memo = canonicalFromParsedDocument(
      {
        ...parsed,
        docType: "credit_memo",
        referencesDocNumber: "SYN-88213",
      },
      { documentId: "d", restaurantId: "r" },
    );
    expect(memo.layer1.precedingInvoiceReference.value).toBe("SYN-88213");
    expect(memo.layer1.despatchAdviceReference.value).toBeNull();

    const inv = canonicalFromParsedDocument(
      { ...parsed, referencesDocNumber: "ASN-11" },
      { documentId: "d", restaurantId: "r" },
    );
    expect(inv.layer1.despatchAdviceReference.value).toBe("ASN-11");
    expect(inv.layer1.precedingInvoiceReference.value).toBeNull();
  });

  it("keeps the case conversion in layer 2, where it belongs", () => {
    expect(canonical.layer2.lines[1].canonicalUom).toBe("case");
    expect(canonical.layer2.lines[1].packSize).toBe(12);
    expect(canonical.layer2.lines[1].qtyBottles).toBe(24);
  });

  it('sets received to "not_counted" when no door count was supplied (ADR 0103 A6)', () => {
    expect(canonical.layer3.lines.map((l) => l.received)).toEqual([
      "not_counted",
      "not_counted",
    ]);
  });

  it("accepts a door count when one exists, and keeps it distinct from billed", () => {
    const withDoor = canonicalFromParsedDocument(parsed, {
      documentId: "d",
      restaurantId: "r",
      spine: { 0: { ordered: 24, shipped: 24, received: 22 } },
    });
    expect(withDoor.layer3.lines[0].received).toBe(22);
    expect(withDoor.layer3.lines[0].billed).toBe(24);
    expect(withDoor.layer3.lines[1].received).toBe("not_counted");
  });

  it("runs the invariants and folds the reconciliation grader in as one verdict list", () => {
    const ids = canonical.layer3.verdicts.map((v) => v.id);
    expect(ids).toContain("line_net_amount");
    expect(ids).toContain("reconciliation_v1");
    expect(canonical.layer3.tiesOut).toBe(parsed.tiesOut);
  });

  it("holds the line arithmetic that the extractor's own tie-out holds", () => {
    const lineResults = runInvariants(canonical).filter(
      (r) => r.id === "line_net_amount",
    );
    expect(lineResults.map((r) => r.holds)).toEqual([true, true]);
  });

  it("leaves the VAT breakdown EMPTY rather than inventing a row that would pass", () => {
    expect(canonical.layer1.vatBreakdown).toEqual([]);
    const vat = canonical.layer3.verdicts.filter((v) =>
      v.id.startsWith("vat_"),
    );
    expect(vat.length).toBeGreaterThan(0);
    expect(vat.every((v) => v.holds === null)).toBe(true);
  });

  it("counts untestable rules separately, so a sparse parse is not a clean bill", () => {
    const s = summarise(canonical.layer3.verdicts);
    expect(s.untestable).toBeGreaterThan(0);
    expect(s.holds + s.fails + s.untestable).toBe(
      canonical.layer3.verdicts.length,
    );
  });

  it("defaults source to `extracted` and honours an explicit one", () => {
    const edi = canonicalFromParsedDocument(parsed, {
      documentId: "d",
      restaurantId: "r",
      source: "edi",
    });
    expect(edi.layer1.documentNumber.source).toBe("edi");
    expect(canonical.layer1.documentNumber.source).toBe("extracted");
  });
});
