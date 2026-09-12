import { ConfigService } from "@nestjs/config";
import { DocumentExtractorService } from "../documents/document-extractor.service";
import {
  asPrintedNotMutated,
  runInvariants,
  summarise,
} from "./canonical-invariants";
import { canonicalFromParsedDocument } from "./from-parsed-document";
import { applyTieOut, ParsedDocument } from "../documents/parsed-document";

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

  it("leaves per-field confidence NULL rather than restating a document heuristic", () => {
    // ADR 0104 D1: `confidence` is null when the source has no per-field notion
    // of one. The extractor's number is `0.8 − 0.1 × warnings` — a
    // DOCUMENT-level heuristic about how many things looked odd overall. Copying
    // it onto every field would render as though the model had graded each
    // number individually, which is the fabrication D1 exists to prevent.
    expect(canonical.layer1.lines[0].quantity.confidence).toBeNull();
    expect(canonical.layer1.documentNumber.confidence).toBeNull();
    expect(canonical.layer1.totals.amountDue.confidence).toBeNull();
    // The document-level heuristic still exists, where it always did.
    expect(parsed.confidence).toBeGreaterThan(0);
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

  /**
   * v3.0-TECH-DEBT 2026-09-06, finding 3. Measured on `/documents/54de12fb`:
   * the counted 10, 24 and 6 rendered under **Billed** and `received` read
   * "not counted" on every line — the page telling a receiver the delivery was
   * not counted moments after they counted it.
   */
  it("puts OUR OWN door count in RECEIVED and leaves BILLED null (ADR 0103 A6)", () => {
    const count = canonicalFromParsedDocument(
      { ...parsed, docType: "receiving_advice" },
      { documentId: "d", restaurantId: "r", direction: "issued_by_us" },
    );
    for (const l of count.layer3.lines) {
      expect(l.received).not.toBe("not_counted");
      expect(typeof l.received).toBe("number");
      // Nothing has billed us for a line of our own receiving advice, and a
      // number here is the mis-column this test exists to hold shut.
      expect(l.billed).toBeNull();
    }
    // The vendor's invoice is untouched: its quantities are BILLED, and nobody
    // counted at the door unless a door count was supplied.
    expect(canonical.layer3.lines[0].billed).not.toBeNull();
    expect(canonical.layer3.lines[0].received).toBe("not_counted");
  });

  it("still lets a supplied door-count spine win on our own document", () => {
    const count = canonicalFromParsedDocument(
      { ...parsed, docType: "receiving_advice" },
      {
        documentId: "d",
        restaurantId: "r",
        spine: [{ received: 3 }],
      },
    );
    expect(count.layer3.lines[0].received).toBe(3);
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

/**
 * Gaps 2 and 3 of the slice-1 tech-debt list, at the mapper.
 */

const RAW_TR_CASE_PRICED = {
  docType: "invoice",
  docNumber: "SYN2026000000456",
  docDate: "2026-08-30",
  currency: "TRY",
  total: 142,
  printed: { total: "142,00" },
  lines: [
    {
      description: "SYNTHETIC Öküzgözü 2022",
      qty: 1,
      // The prompt asks for the seven canonical unit literals, not the vendor's
      // own words — `KS` and `şişe` survive in `printed`, where they belong.
      uom: "case",
      packSize: 12,
      unitPrice: 142,
      lineTotal: 142,
      priceBaseQty: 12,
      priceBaseUom: "bottle",
      printed: {
        qty: "1 KS",
        unitPrice: "142,00 / KS(12)",
        lineTotal: "142,00",
      },
    },
  ],
};

describe("canonicalFromParsedDocument — BT-149/BT-150 from a real extraction", () => {
  const trParsed = svc.normalize(JSON.stringify(RAW_TR_CASE_PRICED), "test");
  const tr = canonicalFromParsedDocument(trParsed, {
    documentId: "doc-tr",
    restaurantId: "rest-1",
  });

  it("populates BT-149 and BT-150 from what the document printed", () => {
    expect(tr.layer1.lines[0].priceBaseQuantity.value).toBe(12);
    expect(tr.layer1.lines[0].priceBaseUnit.value).toBe("bottle");
  });

  it("still writes a base of 1 in the invoiced unit when none was printed", () => {
    // The pre-existing behaviour, now stated rather than assumed: `unitPrice` is
    // per invoiced unit unless the paper said otherwise.
    expect(canonical.layer1.lines[1].priceBaseQuantity.value).toBe(1);
    expect(canonical.layer1.lines[1].priceBaseUnit.value).toBe("case");
  });

  it("makes the line arithmetic hold across the case/bottle boundary", () => {
    const lineResults = runInvariants(tr).filter(
      (r) => r.id === "line_net_amount",
    );
    expect(lineResults.map((r) => r.holds)).toEqual([true]);
    expect(lineResults[0].expected).toBe(142);
  });
});

describe("canonicalFromParsedDocument — as_printed on numbers", () => {
  const trParsed = svc.normalize(JSON.stringify(RAW_TR_CASE_PRICED), "test");
  const tr = canonicalFromParsedDocument(trParsed, {
    documentId: "doc-tr",
    restaurantId: "rest-1",
  });

  it("threads the printed money and quantity literals into the envelopes", () => {
    expect(tr.layer1.lines[0].netPrice.as_printed).toBe("142,00 / KS(12)");
    expect(tr.layer1.lines[0].netAmount.as_printed).toBe("142,00");
    expect(tr.layer1.lines[0].quantity.as_printed).toBe("1 KS");
    expect(tr.layer1.totals.taxInclusiveAmount.as_printed).toBe("142,00");
  });

  it("never reformats them — the Turkish grouping survives untouched", () => {
    expect(tr.layer1.lines[0].netAmount.as_printed).not.toContain(".0");
    expect(tr.layer1.lines[0].netAmount.value).toBe(142);
    expect(asPrintedNotMutated(tr)[0].holds).toBe(true);
  });

  it("keeps as_printed NULL when the parse kept no literal, never an empty string", () => {
    // Null means "we did not keep it"; "" would read as "the paper was blank".
    expect(canonical.layer1.lines[0].netAmount.as_printed).toBeNull();
  });
});

/**
 * The first render against real documents, closed (findings 2–7 of
 * `v3.0-TECH-DEBT.md`, 2026-09-04). Every value SYNTHETIC.
 */
describe("canonicalFromParsedDocument — the parties (finding 2)", () => {
  it("carries the extraction's vendorName into BG-4 as EXTRACTED", () => {
    expect(canonical.layer1.seller.name.value).toBe("SYNTHETIC Glazers");
    expect(canonical.layer1.seller.name.source).toBe("extracted");
    // Read off the page, so the glyphs are kept.
    expect(canonical.layer1.seller.name.as_printed).toBe("SYNTHETIC Glazers");
  });

  it("prefers a resolved provider, and does NOT let it claim it was printed", () => {
    const withProvider = canonicalFromParsedDocument(parsed, {
      documentId: "d",
      restaurantId: "r",
      seller: {
        name: "SYNTHETIC Glazers Wine & Spirits",
        source: "human_entered",
      },
      buyer: { name: "SYNTHETIC Meyhane", source: "human_entered" },
    });
    expect(withProvider.layer1.seller.name.value).toBe(
      "SYNTHETIC Glazers Wine & Spirits",
    );
    expect(withProvider.layer1.seller.name.source).toBe("human_entered");
    // The document never printed this name, so there is no literal to show.
    expect(withProvider.layer1.seller.name.as_printed).toBeNull();
    expect(withProvider.layer1.buyer.name.value).toBe("SYNTHETIC Meyhane");
    expect(withProvider.layer1.buyer.name.source).toBe("human_entered");
  });

  it("leaves BOTH parties null only when neither the page nor our records name one", () => {
    const anonymous = canonicalFromParsedDocument(
      { ...parsed, vendorName: null },
      { documentId: "d", restaurantId: "r" },
    );
    expect(anonymous.layer1.seller.name.value).toBeNull();
    expect(anonymous.layer1.buyer.name.value).toBeNull();
  });
});

describe("canonicalFromParsedDocument — BT-72 and BG-23 (findings 3, 4)", () => {
  const withDates = canonicalFromParsedDocument(
    {
      ...parsed,
      deliveredDate: "2026-08-12",
      taxBreakdown: [
        { rate: 20, taxableBase: 1056, amount: 211.2, category: "S" },
      ],
      tax: 211.2,
    },
    { documentId: "d", restaurantId: "r" },
  );

  it("maps a printed delivery date onto BG-13 / BT-72", () => {
    expect(withDates.layer1.actualDeliveryDate.value).toBe("2026-08-12");
    expect(withDates.layer1.actualDeliveryDate.as_printed).toBe("2026-08-12");
  });

  it("maps the printed rate onto BG-23, so the VAT rules stop being untestable", () => {
    expect(withDates.layer1.vatBreakdown).toHaveLength(1);
    expect(withDates.layer1.vatBreakdown[0].rate.value).toBe(20);
    expect(withDates.layer1.vatBreakdown[0].taxableAmount.value).toBe(1056);
    expect(withDates.layer1.vatBreakdown[0].taxAmount.value).toBe(211.2);

    const present = withDates.layer3.verdicts.find(
      (v) => v.id === "vat_breakdown_present",
    );
    expect(present?.holds).toBe(true);
    const matches = withDates.layer3.verdicts.find(
      (v) => v.id === "vat_total_matches_breakdown",
    );
    expect(matches?.holds).toBe(true);
  });

  it("still leaves BG-23 empty when the page printed no rate", () => {
    expect(canonical.layer1.vatBreakdown).toEqual([]);
  });
});

describe("canonicalFromParsedDocument — the totals ladder (finding 5)", () => {
  it("sums BG-20/BG-21 into BT-107/BT-108 instead of leaving a hole under them", () => {
    // The parse carries freight 48 and nothing else, so the ladder is
    // 1056 − 0 + 48 = 1104 — and "Charges —" beneath "Freight + 48" is gone.
    expect(canonical.layer1.totals.chargesTotal.value).toBe(48);
    expect(canonical.layer1.totals.chargesTotal.source).toBe("computed");
    expect(canonical.layer1.totals.allowancesTotal.value).toBe(0);
    expect(canonical.layer1.totals.taxExclusiveAmount.value).toBe(1104);
  });

  it("refuses to grade its own arithmetic: a COMPUTED BT-109 is untestable", () => {
    // BR-CO-13 is `BT-109 = BT-106 − BT-107 + BT-108`, which is the formula
    // that produced the number. Reporting `true` there would be a rule that
    // can never fail — a green tick proving nothing.
    const withoutVat = canonical.layer3.verdicts.find(
      (v) => v.id === "total_without_vat",
    );
    expect(withoutVat?.holds).toBeNull();
    expect(withoutVat?.explanation).toMatch(/prove nothing/);
  });

  it("leaves BT-109 null when there is no BT-106 to build it on", () => {
    const noLines = canonicalFromParsedDocument(
      { ...parsed, subtotal: null, computedLinesTotal: null },
      { documentId: "d", restaurantId: "r" },
    );
    expect(noLines.layer1.totals.taxExclusiveAmount.value).toBeNull();
  });
});

describe("canonicalFromParsedDocument — deposits (findings 6, 7)", () => {
  const TR_DEPOSIT: ParsedDocument = {
    docType: "invoice",
    currency: "TRY",
    subtotal: 1704,
    depositTotal: 180,
    total: 1884,
    lines: [
      {
        lineNo: 1,
        description: "SYNTHETIC Okuzgozu",
        qty: 12,
        uom: "bottle",
        packSize: 1,
        qtyBottles: 12,
        freeGoodsQty: 0,
        unitPrice: 142,
        lineTotal: 1704,
        priceBaseQty: null,
        priceBaseUom: null,
      },
      {
        lineNo: 2,
        description: "SYNTHETIC Depozito (kasa)",
        qty: 2,
        uom: "each",
        packSize: 1,
        qtyBottles: 0,
        freeGoodsQty: 0,
        unitPrice: 90,
        lineTotal: 180,
        // The paper printed the deposit as this line AND as a subtotal row.
        // The transcription of 2026-09-04 recorded both on the line too.
        deposit: 180,
        lineKind: "deposit",
        priceBaseQty: null,
        priceBaseUom: null,
      },
    ],
    computedLinesTotal: null,
    tieOutDelta: null,
    tiesOut: null,
    confidence: 0.8,
    warnings: [],
  };

  const depositDoc = canonicalFromParsedDocument(applyTieOut(TR_DEPOSIT), {
    documentId: "d",
    restaurantId: "r",
  });

  it("codes the deposit UNCL7161 and carries it as a BG-21 charge", () => {
    const deposit = depositDoc.layer1.allowancesCharges.find(
      (ac) => ac.reasonCode.value === "7161",
    );
    expect(deposit).toBeDefined();
    expect(deposit?.isCharge.value).toBe(true);
    expect(deposit?.amount.value).toBe(180);
    expect(deposit?.reason.value).toBe("Returnable container / deposit");
  });

  it("keeps the deposit line OUT of BT-106 goods, and counts it once", () => {
    expect(depositDoc.layer1.totals.linesNetTotal.value).toBe(1704);
    expect(depositDoc.layer1.totals.chargesTotal.value).toBe(180);
    expect(depositDoc.layer1.totals.taxExclusiveAmount.value).toBe(1884);
  });

  it("holds `deposits_coded_and_excluded` on the document that used to fail it", () => {
    const results = depositDoc.layer3.verdicts.filter(
      (v) => v.id === "deposits_coded_and_excluded",
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.holds === true)).toBe(true);
  });

  it("does not add a line's own deposit when the line IS the deposit", () => {
    // Expected 360 against a stated 180 — the named failure of 2026-09-04.
    const line = depositDoc.layer1.lines[1];
    expect(line.lineKind?.value).toBe("deposit");
    expect(line.allowancesCharges).toEqual([]);
    const nets = depositDoc.layer3.verdicts.filter(
      (v) => v.id === "line_net_amount",
    );
    expect(nets.every((n) => n.holds !== false)).toBe(true);
  });

  it("DOES add it when it is a deposit charged ON a goods line", () => {
    const perLine = canonicalFromParsedDocument(
      applyTieOut({
        ...TR_DEPOSIT,
        depositTotal: null,
        subtotal: 1764,
        total: 1764,
        lines: [
          {
            ...TR_DEPOSIT.lines[0],
            // 12 × 142 = 1704, plus a 60 crate charge on the same line.
            deposit: 60,
            lineTotal: 1764,
            lineKind: "goods" as const,
          },
        ],
      }),
      { documentId: "d", restaurantId: "r" },
    );
    const line = perLine.layer1.lines[0];
    expect(line.allowancesCharges).toHaveLength(1);
    expect(line.allowancesCharges[0].amount.value).toBe(60);
    expect(line.allowancesCharges[0].reasonCode.value).toBe("7161");
    const net = perLine.layer3.verdicts.find((v) => v.id === "line_net_amount");
    expect(net?.holds).toBe(true);
  });

  it("names a deposit whose line and subtotal disagree, rather than picking one", () => {
    const mismatch = canonicalFromParsedDocument(
      applyTieOut({ ...TR_DEPOSIT, depositTotal: 200 }),
      { documentId: "d", restaurantId: "r" },
    );
    const disagreement = mismatch.layer3.verdicts.find(
      (v) =>
        v.id === "deposits_coded_and_excluded" &&
        v.path === "allowancesCharges",
    );
    expect(disagreement?.holds).toBe(false);
    expect(disagreement?.explanation).toMatch(
      /only one of them is being carried/,
    );
  });
});
