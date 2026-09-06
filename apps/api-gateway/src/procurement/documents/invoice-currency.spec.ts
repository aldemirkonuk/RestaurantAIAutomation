import {
  applyCurrencyRules,
  currencyAgreement,
  filingCurrency,
  refiledMoney,
  refilingSentence,
  seenCodes,
  withholdMoney,
} from "./invoice-currency";
import { ParsedDocument } from "./parsed-document";
import { parseX12 } from "./x12";

/**
 * An 810 with no CUR takes the house's own currency, the model reads the
 * invoice's money, and neither of them decides — founder, 2026-09-06.
 *
 * The three rules are pinned separately, and the FIRST describe block pins the
 * defect: `x12-invoice.ts:254-257` read `el(CUR, 2) ?? "USD"`, so a Turkish
 * house's 810 with no CUR segment filed its totals as dollars, silently. The
 * pre-fix behaviour is proved against `git show HEAD:` in
 * `invoice-currency-prefix.probe.spec.ts`, which is deleted after it is run —
 * this file asserts the tree as it stands.
 */

/** The 810 from `x12.spec.ts`, with the CUR segment as a parameter. */
function isa(): string {
  const pad = (v: string, n: number) => v.padEnd(n, " ").slice(0, n);
  return (
    "ISA*00*" +
    pad("", 10) +
    "*00*" +
    pad("", 10) +
    "*ZZ*" +
    pad("SGWS", 15) +
    "*ZZ*" +
    pad("WINEOPS", 15) +
    "*260715*1030*U*00401*000000001*0*P*>~"
  );
}

function invoice810(cur: string | null): string {
  return (
    isa() +
    [
      "GS*IN*SGWS*WINEOPS*20260715*1030*1*X*004010",
      "ST*810*0001",
      "BIG*20260715*INV-88213*20260710*PO-4471",
      ...(cur ? [`CUR*SE*${cur}`] : []),
      "N1*SE*SOUTHERN GLAZERS WINE AND SPIRITS",
      "IT1*1*24*BT*22.00**VN*SGW-11872",
      "PID*F****CAVALLOTTO BAROLO BRICCO BOSCHIS 2010",
      "TDS*52800",
      "CTT*1",
      "SE*9*0001",
      "GE*1*1",
      "IEA*1*000000001",
    ].join("~") +
    "~"
  );
}

/** A parse the way the model path hands one over, minimal but real-shaped. */
function extracted(over: Partial<ParsedDocument> = {}): ParsedDocument {
  return {
    docType: "invoice",
    docNumber: "F-2026-441",
    docDate: "2026-09-01",
    referencesDocNumber: null,
    poNumber: null,
    vendorName: "Bir Tedarikci",
    vendorAccount: null,
    currency: "",
    subtotal: 9172,
    freight: 120,
    fuelSurcharge: null,
    splitCaseFee: null,
    deliveryFee: null,
    depositTotal: 180,
    tax: 1834.4,
    otherCharges: null,
    discountTotal: null,
    total: 11306.4,
    lines: [
      {
        lineNo: 1,
        description: "Kavaklidere Ancyra Kalecik Karasi",
        qty: 12,
        uom: "bottle",
        packSize: 1,
        qtyBottles: 12,
        freeGoodsQty: 0,
        unitPrice: 142,
        lineTotal: 1704,
        allowance: null,
        deposit: 60,
        priceBaseQty: null,
        priceBaseUom: null,
      },
    ],
    computedLinesTotal: 1704,
    tieOutDelta: null,
    tiesOut: null,
    confidence: 0.8,
    warnings: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// RULE 1 — no CUR takes the house's own currency, and never USD.
// ---------------------------------------------------------------------------
describe("rule 1: an 810 with no CUR takes the house's own currency", () => {
  it("files a Turkish house's CUR-less 810 as TRY, not as USD", () => {
    const [doc] = parseX12(invoice810(null), { houseCurrency: "TRY" }).documents;

    expect(doc.currency).toBe("TRY");
    expect(doc.currency).not.toBe("USD");
    // The money is FILED, not withheld: the house answered the question.
    expect(doc.total).toBe(528);
    expect(doc.lines[0].unitPrice).toBe(22);
    expect(doc.moneyHeld ?? null).toBeNull();
    // And the row says where the answer came from, so a screen can tell the
    // vendor's statement from the house's own row.
    // The provenance is a SENTENCE on `currencyFiledFrom`, not a warning: a
    // warning would send every domestic CUR-less 810 to the review queue
    // (`document-intake.service.ts`'s `needsReview` keys on any warning), which
    // is where the genuinely doubtful ones would then be buried.
    expect(doc.currencyFiledFrom).toContain(
      "filed under this house's own stated currency, TRY",
    );
    expect(doc.warnings).toHaveLength(0);
  });

  it("refuses the money when neither the file nor the house states one", () => {
    const [doc] = parseX12(invoice810(null), { houseCurrency: null }).documents;

    expect(doc.currency).toBe("");
    expect(doc.moneyHeld).toBeTruthy();
    // BOTH absences are named in one sentence, per the founder's rule.
    expect(doc.moneyHeld).toContain("states no CUR02");
    expect(doc.moneyHeld).toContain("never stated its own currency");
    // Every money figure is gone — header, lines and the tie-out alike.
    expect(doc.total).toBeNull();
    expect(doc.subtotal).toBeNull();
    expect(doc.lines[0].unitPrice).toBeNull();
    expect(doc.lines[0].lineTotal).toBeNull();
    expect(doc.computedLinesTotal).toBeNull();
    expect(doc.tiesOut).toBeNull();
    // The QUANTITIES stay: what shipped is real evidence and is unaffected.
    expect(doc.lines[0].qty).toBe(24);
    expect(doc.lines[0].qtyBottles).toBe(24);
  });

  it("lets the file's own CUR win over the house's currency", () => {
    const [doc] = parseX12(invoice810("EUR"), { houseCurrency: "TRY" })
      .documents;

    expect(doc.currency).toBe("EUR");
    expect(doc.total).toBe(528);
    expect(doc.currencyFiledFrom).toContain("CUR02");
  });

  it("refuses a file-stated currency that is not an ISO 4217 code, and falls to the house", () => {
    const [doc] = parseX12(invoice810("TL"), { houseCurrency: "TRY" }).documents;
    // `TL` is how a Turkish invoice writes it and it is not a code. The house's
    // own TRY answers instead — never the two-letter string, which a
    // varchar(3) would happily hold as a fourth kind of lira.
    expect(doc.currency).toBe("TRY");
    expect(doc.currencyFiledFrom).toContain("own stated currency, TRY");
  });

  it("never invents USD when nothing is passed at all", () => {
    const [doc] = parseX12(invoice810(null)).documents;
    expect(doc.currency).toBe("");
    expect(doc.total).toBeNull();
  });

  it("names both halves of the absence in filingCurrency", () => {
    const none = filingCurrency({
      fileStated: null,
      houseStated: null,
      fileField: "CUR02 currency segment",
    });
    expect(none.kind).toBe("none");
    if (none.kind === "none") {
      expect(none.because).toContain("no USD default");
      expect(none.because).toContain("quantities were kept");
    }
  });
});

// ---------------------------------------------------------------------------
// RULE 2 — the model states what it SAW, and a disagreement holds the money.
// ---------------------------------------------------------------------------
describe("rule 2: the model reads the invoice's money and a disagreement holds it", () => {
  it("holds the money when the sighting disagrees, naming both and the place", () => {
    const doc = applyCurrencyRules({
      doc: extracted({
        currencySeen: {
          code: null,
          asPrinted: "₺",
          where: "beside the grand total",
        },
      }),
      houseCurrency: "USD",
      fileField: "printed currency",
    });

    expect(doc.moneyHeld).toBeTruthy();
    // WHICH currency the file would take, WHICH the model saw, and WHERE.
    expect(doc.moneyHeld).toContain("USD");
    expect(doc.moneyHeld).toContain("TRY");
    expect(doc.moneyHeld).toContain("beside the grand total");
    expect(doc.moneyHeld).toContain("MONEY HELD, NOT FILED");
    // Nothing may be filed under EITHER.
    expect(doc.total).toBeNull();
    expect(doc.tax).toBeNull();
    expect(doc.lines[0].unitPrice).toBeNull();
    expect(doc.lines[0].deposit).toBeNull();
    // It sorts to the top of the review queue rather than sitting mid-list.
    expect(doc.confidence).toBeLessThanOrEqual(0.3);
  });

  it("files when the sighting agrees", () => {
    const doc = applyCurrencyRules({
      doc: extracted({
        currency: "TRY",
        currencySeen: { code: "TRY", asPrinted: "₺", where: "the KDV row" },
      }),
      houseCurrency: "USD",
      fileField: "printed currency",
    });

    expect(doc.currency).toBe("TRY");
    expect(doc.moneyHeld ?? null).toBeNull();
    expect(doc.total).toBe(11306.4);
    expect(doc.lines[0].unitPrice).toBe(142);
  });

  it("files under rule 1 when the model saw none, and says it saw none", () => {
    const doc = applyCurrencyRules({
      doc: extracted({ currencySeen: null }),
      houseCurrency: "TRY",
      fileField: "printed currency",
    });

    expect(doc.currency).toBe("TRY");
    expect(doc.moneyHeld ?? null).toBeNull();
    expect(doc.total).toBe(11306.4);
    expect(doc.currencySeen ?? null).toBeNull();
  });

  it("records an unreadable glyph as evidence and does NOT hold on it", () => {
    const doc = applyCurrencyRules({
      doc: extracted({
        currencySeen: { code: null, asPrinted: "¤", where: "the header" },
      }),
      houseCurrency: "TRY",
      fileField: "printed currency",
    });

    expect(doc.moneyHeld ?? null).toBeNull();
    expect(doc.total).toBe(11306.4);
    expect(doc.warnings.join(" ")).toContain("Evidence, not a verdict");
  });

  it("never lets a dollar sign resolve to USD on its own", () => {
    // `$` is the symbol of seven currencies in this table. It can REFUTE a
    // filing currency outside that set and it can never CHOOSE one.
    expect(seenCodes({ code: null, asPrinted: "$", where: "x" })).toContain(
      "CAD",
    );
    expect(currencyAgreement("USD", { code: null, asPrinted: "$", where: "x" }))
      .toEqual({ kind: "agrees" });
    const refutes = currencyAgreement("TRY", {
      code: null,
      asPrinted: "$",
      where: "the totals column",
    });
    expect(refutes.kind).toBe("disagrees");
  });

  it("prefers the model's own stated code over the glyph", () => {
    expect(
      seenCodes({ code: "eur", asPrinted: "$", where: "x" }),
    ).toEqual(["EUR"]);
  });

  it("reads Türk Lirası, TL and ₺ as the same currency", () => {
    for (const printed of ["₺", "TL", "T.L.", "Türk Lirası", "TRY"])
      expect(seenCodes({ code: null, asPrinted: printed, where: "x" })).toEqual([
        "TRY",
      ]);
  });

  it("the sighting can never SET the currency, only hold it", () => {
    const doc = applyCurrencyRules({
      doc: extracted({
        currency: "",
        currencySeen: { code: "EUR", asPrinted: "€", where: "the total" },
      }),
      houseCurrency: "TRY",
      fileField: "printed currency",
    });
    // The model saw EUR and the document is emphatically NOT filed as EUR.
    // Nor is it left claiming TRY: there is no money on the row to denominate,
    // so the currency column says nothing either (`''` -> NULL on the write).
    // What names both is the SENTENCE, which is the founder's own wording:
    // "which currency the file would take and which the model saw and where".
    expect(doc.currency).toBe("");
    expect(doc.moneyHeld).toContain("filed under TRY");
    expect(doc.moneyHeld).toContain("EUR");
    expect(doc.moneyHeld).toContain("the total");
    expect(doc.total).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RULE 3 — the deliberate change puts the money back.
// ---------------------------------------------------------------------------
describe("rule 3: a deliberate change re-files the money and says what moved", () => {
  it("restores the withheld figures off the stored reading", () => {
    const held = withholdMoney(extracted(), "held for the test");
    expect(held.total).toBeNull();

    // The SNAPSHOT is the un-withheld parse — what
    // `procurement_documents.extracted` holds.
    const refiled = refiledMoney(extracted());
    expect(refiled).not.toBeNull();
    expect(refiled!.document.total).toBe(11306.4);
    expect(refiled!.document.tax).toBe(1834.4);
    expect(refiled!.lines[0].unit_price).toBe(142);
    expect(refiled!.lines[0].deposit).toBe(60);
  });

  it("recomputes the tie-out rather than carrying a stale one over", () => {
    const refiled = refiledMoney(
      extracted({ computedLinesTotal: 999999, tiesOut: true }),
    );
    // 1704 goods + 120 freight + 180 deposit + 1834.40 tax = 3838.40 against a
    // stated 11306.40, so it does NOT tie out — and the stale `true` is gone.
    expect(refiled!.document.computed_lines_total).toBe(1704);
    expect(refiled!.document.ties_out).toBe(false);
  });

  it("returns null rather than zeroes when the stored reading is unusable", () => {
    expect(refiledMoney(null)).toBeNull();
    expect(refiledMoney("not a parse")).toBeNull();
    expect(refiledMoney({ docType: "invoice" })).toBeNull();
  });

  it("says what moved, and says nothing was converted", () => {
    const s = refilingSentence({
      previous: null,
      next: "TRY",
      wasHeld: true,
      documentTotal: 11306.4,
      lineCount: 1,
      pricedLines: 1,
    });
    expect(s).toContain("from NOT RECORDED");
    expect(s).toContain("11306.40 is now TRY");
    expect(s).toContain("no exchange rate");
  });
});
