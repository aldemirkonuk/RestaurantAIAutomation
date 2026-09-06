import {
  applyCurrencyRules,
  currencyAgreement,
  documentMoneyState,
  filingCurrency,
  orderDisagreement,
  planRefile,
  receivingPriceRefusal,
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

/**
 * The money columns of the `procurement_documents` ROW, as they stand — which
 * is where a restatement reads from now. Distinct from `extracted()` on
 * purpose: the two diverge the moment anybody corrects a line, and BLOCKER 2
 * was that only the second one was read.
 */
function moneyRow(over: Record<string, unknown> = {}) {
  return {
    subtotal: 9172,
    freight: 120,
    fuel_surcharge: null,
    split_case_fee: null,
    delivery_fee: null,
    deposit_total: 180,
    tax: 1834.4,
    other_charges: null,
    discount_total: null,
    total: 11306.4,
    ...over,
  };
}

/** Every money column null — exactly what a hold leaves on the row. */
function heldRow() {
  return {
    subtotal: null,
    freight: null,
    fuel_surcharge: null,
    split_case_fee: null,
    delivery_fee: null,
    deposit_total: null,
    tax: null,
    other_charges: null,
    discount_total: null,
    total: null,
  };
}

/** The lines as `procurement_document_lines` holds them. */
function lineRows(over: Record<string, unknown> = {}) {
  return [
    {
      line_no: 1,
      qty: 12,
      uom: "bottle",
      pack_size: 1,
      unit_price: 142,
      line_total: 1704,
      allowance: null,
      deposit: 60,
      ...over,
    },
  ];
}

/** The same lines with their money stripped, as a hold leaves them. */
function heldLineRows() {
  return lineRows({
    unit_price: null,
    line_total: null,
    allowance: null,
    deposit: null,
  });
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
// BLOCKER 1 — a currency code has to NAME a currency.
//
// Every gate in this module asked `/^[A-Z]{3}$/` and called it ISO 4217, which
// is a shape and not a list. Proved pre-fix against `git show HEAD:` in a probe
// spec, deleted after it ran: `filingCurrency({ fileStated: "ZZZ", … })`
// returned `{ kind: "file", code: "ZZZ" }` and filed the invoice's whole total
// under it, silently, with no hold and no warning.
// ---------------------------------------------------------------------------
describe("a well-formed code that is not a currency is not money", () => {
  it("filingCurrency REFUSES a fake file currency and falls through", () => {
    const filed = filingCurrency({
      fileStated: "ZZZ",
      houseStated: "TRY",
      fileField: "CUR02",
    });
    // It does NOT become the filing currency. The house's real one answers.
    expect(filed).toEqual({
      kind: "house",
      code: "TRY",
      from: expect.stringContaining("restaurants.currency"),
    });
  });

  it("refuses when EVERY rung is a fake code, and quotes each one", () => {
    const filed = filingCurrency({
      fileStated: "ZZZ",
      orderStated: "XTS",
      hasMatchedOrder: true,
      houseStated: "ABC",
      fileField: "CUR02",
    });
    expect(filed.kind).toBe("none");
    if (filed.kind !== "none") return;
    expect(filed.because).toContain('"ZZZ"');
    expect(filed.because).toContain('"XTS"');
    expect(filed.because).toContain('"ABC"');
    // And it says WHY they failed, which is not the same as "wrong shape".
    expect(filed.because).toContain("three letters but names no currency");
  });

  it("still says 'not an ISO 4217 alpha-3 code' for the wrong SHAPE", () => {
    const filed = filingCurrency({
      fileStated: "TL",
      houseStated: null,
      fileField: "CUR02",
    });
    expect(filed.kind).toBe("none");
    if (filed.kind !== "none") return;
    expect(filed.because).toContain("not an ISO 4217 alpha-3 code");
  });

  it("applyCurrencyRules withholds the money rather than filing it under a fake", () => {
    const doc = applyCurrencyRules({
      doc: extracted({ currency: "ZZZ" }),
      houseCurrency: null,
      fileField: "CUR02",
    });
    expect(doc.currency).toBe("");
    expect(doc.total).toBeNull();
    expect(doc.moneyHeld).toContain("ZZZ");
  });

  it("seenCodes does not believe a model that answers a fake code", () => {
    // It used to return `["ZZZ"]`, which then DISAGREED with every real filing
    // currency and held the money over a code that does not exist.
    expect(
      seenCodes({ code: "ZZZ", asPrinted: "ZZZ", where: "the total" }),
    ).toBeNull();
    // The glyph path still works when the model's own code is unusable.
    expect(
      seenCodes({ code: "ZZZ", asPrinted: "₺", where: "the total" }),
    ).toEqual(["TRY"]);
  });

  it("a fake sighting is EVIDENCE, never a hold", () => {
    const doc = applyCurrencyRules({
      doc: extracted({
        currency: "",
        currencySeen: { code: "ZZZ", asPrinted: "ZZZ", where: "the total" },
      }),
      houseCurrency: "TRY",
      fileField: "printed currency",
    });
    // Filed under the house's real currency; the unreadable sighting is a
    // warning, not a reason to hold an invoice.
    expect(doc.currency).toBe("TRY");
    expect(doc.total).toBe(11306.4);
    expect(doc.moneyHeld).toBeUndefined();
  });

  it("orderDisagreement never holds a document over a fake code", () => {
    expect(
      orderDisagreement({
        fileStated: "ZZZ",
        orderStated: "TRY",
        fileField: "CUR02",
      }),
    ).toBeNull();
    expect(
      orderDisagreement({
        fileStated: "TRY",
        orderStated: "ZZZ",
        fileField: "CUR02",
      }),
    ).toBeNull();
  });

  it("documentMoneyState refuses a row filed under a fake, and SAYS what is there", () => {
    // Rows can hold one: `ZZZ` was writable everywhere in this module until
    // 2026-09-06. "The currency is not recorded" would be false about this row.
    const state = documentMoneyState({ currency: "ZZZ" });
    expect(state.priced).toBe(false);
    if (state.priced) return;
    expect(state.reason).toContain("ZZZ");
    expect(state.reason).toContain("names no currency");
  });
});

// ---------------------------------------------------------------------------
// RULE 3 — the deliberate change puts the money back.
// ---------------------------------------------------------------------------
describe("rule 3: a deliberate change re-files the money and says what moved", () => {
  it("restores the withheld figures when the ROW carries none", () => {
    // What the intake actually stores for a held document: the row's money
    // columns and its lines are null, and the reading survives on
    // `extracted.moneyWithheld`.
    const held = withholdMoney(extracted(), "held for the test");
    expect(held.total).toBeNull();
    expect(held.moneyWithheld?.total).toBe(11306.4);

    const plan = planRefile({
      row: heldRow(),
      lines: heldLineRows(),
      extracted: held,
    });
    expect(plan).not.toBeNull();
    expect(plan!.source).toBe("withheld_snapshot");
    expect(plan!.document.total).toBe(11306.4);
    expect(plan!.document.tax).toBe(1834.4);
    expect(plan!.lines[0].unit_price).toBe(142);
    expect(plan!.lines[0].deposit).toBe(60);
  });

  it("recomputes the tie-out rather than carrying a stale one over", () => {
    // The row's own tie-out columns are not even an input here — they describe
    // the figures BEFORE the re-filing, and one of the two sources has none.
    const plan = planRefile({
      row: moneyRow(),
      lines: lineRows(),
      extracted: null,
    });
    // 1704 goods + 120 freight + 180 deposit + 1834.40 tax = 3838.40 against a
    // stated 11306.40, so it does NOT tie out.
    expect(plan!.document.computed_lines_total).toBe(1704);
    expect(plan!.document.ties_out).toBe(false);
  });

  it("returns null rather than zeroes when there is nothing to put back", () => {
    expect(
      planRefile({ row: heldRow(), lines: heldLineRows(), extracted: null }),
    ).toBeNull();
    expect(
      planRefile({
        row: heldRow(),
        lines: heldLineRows(),
        extracted: "not a parse",
      }),
    ).toBeNull();
    expect(
      planRefile({
        row: heldRow(),
        lines: heldLineRows(),
        extracted: { docType: "invoice" },
      }),
    ).toBeNull();
    expect(planRefile({ row: null, lines: null, extracted: null })).toBeNull();
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

// ---------------------------------------------------------------------------
// B3 — the invoice takes the ORDER's currency when the file states none, and is
// HELD when it states a different one (founder, 2026-09-06 batch 65).
// ---------------------------------------------------------------------------
describe("B3: the order's currency sits between the file's and the house's", () => {
  const FIELD = "CUR02 currency segment";

  it("takes the FILE's own currency over the order's and the house's", () => {
    const filed = filingCurrency({
      fileStated: "EUR",
      orderStated: "TRY",
      hasMatchedOrder: true,
      houseStated: "USD",
      fileField: FIELD,
    });
    expect(filed).toMatchObject({ kind: "file", code: "EUR" });
  });

  it("takes the ORDER's currency when the file states none", () => {
    const filed = filingCurrency({
      fileStated: "",
      orderStated: "EUR",
      hasMatchedOrder: true,
      houseStated: "USD",
      fileField: FIELD,
    });
    expect(filed).toMatchObject({ kind: "order", code: "EUR" });
  });

  it("falls to the HOUSE only when the matched order names no currency, and says so", () => {
    const filed = filingCurrency({
      fileStated: "",
      orderStated: null,
      hasMatchedOrder: true,
      houseStated: "TRY",
      fileField: FIELD,
    });
    expect(filed).toMatchObject({ kind: "house", code: "TRY" });
    if (filed.kind === "house")
      expect(filed.from).toContain("names none");
  });

  it("falls to the HOUSE with a DIFFERENT sentence when there is no order at all", () => {
    const filed = filingCurrency({
      fileStated: "",
      hasMatchedOrder: false,
      houseStated: "TRY",
      fileField: FIELD,
    });
    expect(filed).toMatchObject({ kind: "house", code: "TRY" });
    if (filed.kind === "house")
      expect(filed.from).toContain("matched to no order");
  });

  it("refuses, naming EVERY absence including the order's", () => {
    const filed = filingCurrency({
      fileStated: "",
      orderStated: null,
      hasMatchedOrder: true,
      houseStated: null,
      fileField: FIELD,
    });
    expect(filed.kind).toBe("none");
    if (filed.kind === "none") {
      expect(filed.because).toContain("states no CUR02");
      expect(filed.because).toContain("the order it is matched to names no currency");
      expect(filed.because).toContain("never stated its own currency");
      expect(filed.because).toContain("no USD default");
    }
  });

  it("an unreadable order currency is not a currency, and the refusal quotes it", () => {
    const filed = filingCurrency({
      fileStated: "",
      orderStated: "TL",
      hasMatchedOrder: true,
      houseStated: null,
      fileField: FIELD,
    });
    expect(filed.kind).toBe("none");
    if (filed.kind === "none") expect(filed.because).toContain('"TL"');
  });

  it("HOLDS the money when the file's currency disagrees with the order's, naming both", () => {
    const doc = applyCurrencyRules({
      doc: extracted({ currency: "USD" }),
      houseCurrency: "TRY",
      orderCurrency: "EUR",
      hasMatchedOrder: true,
      orderLabel: "PO-1042",
      fileField: "printed currency",
    });
    expect(doc.moneyHeld).toContain("MONEY HELD, NOT FILED");
    expect(doc.moneyHeld).toContain("EUR");
    expect(doc.moneyHeld).toContain("USD");
    expect(doc.moneyHeld).toContain("PO-1042");
    expect(doc.total).toBeNull();
    expect(doc.lines[0].unitPrice).toBeNull();
  });

  it("does NOT hold when the file agrees with the order", () => {
    const doc = applyCurrencyRules({
      doc: extracted({ currency: "EUR" }),
      houseCurrency: "TRY",
      orderCurrency: "EUR",
      hasMatchedOrder: true,
      fileField: "printed currency",
    });
    expect(doc.moneyHeld).toBeFalsy();
    expect(doc.currency).toBe("EUR");
    expect(doc.total).toBe(11306.4);
  });

  it("a document FILED FROM the order can never disagree with it", () => {
    const doc = applyCurrencyRules({
      doc: extracted({ currency: "" }),
      houseCurrency: "TRY",
      orderCurrency: "EUR",
      hasMatchedOrder: true,
      fileField: "printed currency",
    });
    expect(doc.currency).toBe("EUR");
    expect(doc.moneyHeld).toBeFalsy();
    expect(doc.currencyFiledFrom).toContain("order");
  });

  it("prefers the ORDER disagreement over the model's, because a person recorded it", () => {
    const doc = applyCurrencyRules({
      doc: extracted({
        currency: "USD",
        currencySeen: { code: null, asPrinted: "₺", where: "the total" },
      }),
      houseCurrency: "TRY",
      orderCurrency: "EUR",
      hasMatchedOrder: true,
      orderLabel: "PO-7",
      fileField: "printed currency",
    });
    expect(doc.moneyHeld).toContain("PO-7");
    expect(doc.moneyHeld).toContain("was placed in EUR");
  });
});

// ---------------------------------------------------------------------------
// The figures a hold strips are KEPT, so the act that clears the hold can put
// them back. Pins the defect this pass found and corrected.
// ---------------------------------------------------------------------------
describe("moneyWithheld: a hold keeps what it strips", () => {
  it("withholdMoney keeps every header figure and every line's money", () => {
    const held = withholdMoney(extracted({ currency: "USD" }), "because");
    expect(held.total).toBeNull();
    expect(held.lines[0].unitPrice).toBeNull();
    // and yet:
    expect(held.moneyWithheld?.total).toBe(11306.4);
    expect(held.moneyWithheld?.tax).toBe(1834.4);
    expect(held.moneyWithheld?.lines[0]).toMatchObject({
      lineNo: 1,
      unitPrice: 142,
      lineTotal: 1704,
    });
  });

  it("planRefile puts back what the hold took, not the nulls it wrote", () => {
    // The snapshot as `procurement_documents.extracted` actually stores it: the
    // ruled document, money already stripped. Before `moneyWithheld` existed
    // this came back all-null while the sentence announced a re-filing.
    const stored = applyCurrencyRules({
      doc: extracted({ currency: "USD" }),
      houseCurrency: "TRY",
      orderCurrency: "EUR",
      hasMatchedOrder: true,
      fileField: "printed currency",
    });
    expect(stored.total).toBeNull();

    const plan = planRefile({
      row: heldRow(),
      lines: heldLineRows(),
      extracted: stored,
    });
    expect(plan).not.toBeNull();
    expect(plan!.source).toBe("withheld_snapshot");
    expect(plan!.document.total).toBe(11306.4);
    expect(plan!.document.tax).toBe(1834.4);
    expect(plan!.lines[0].unit_price).toBe(142);
    // The tie-out is re-derived over the RESTORED figures, not over the nulls.
    expect(plan!.document.computed_lines_total).not.toBeNull();
  });

  it("a document that was never held re-files from the figures on its own rows", () => {
    const plan = planRefile({
      row: moneyRow(),
      lines: lineRows(),
      extracted: extracted({ currency: "TRY" }),
    });
    expect(plan!.source).toBe("current_rows");
    expect(plan!.document.total).toBe(11306.4);
    expect(plan!.lines[0].unit_price).toBe(142);
  });
});

// ---------------------------------------------------------------------------
// BLOCKER 2 — a restatement re-files from the CURRENT lines, never from the
// stale extraction.
//
// `procurement_documents.extracted` is written only at intake and `editLine`
// never touches it, so re-deriving from it silently reverted a hand-corrected
// price and announced the revert as a re-filing. Proved pre-fix against
// `git show HEAD:` in a probe spec, deleted after it ran.
// ---------------------------------------------------------------------------
describe("a restatement never reverts a hand-corrected line", () => {
  /** What the row and the lines look like after a manager fixed a price. */
  const corrected = {
    row: moneyRow({ total: 11800.4, subtotal: 9666 }),
    lines: lineRows({ unit_price: 194, line_total: 2328 }),
    /** The parse as it was at INTAKE — the OCR'd 142, now stale. */
    extracted: extracted(),
  };

  it("keeps the edited amount instead of the extraction's", () => {
    const plan = planRefile(corrected);
    expect(plan!.source).toBe("current_rows");
    expect(plan!.lines[0].unit_price).toBe(194);
    expect(plan!.lines[0].line_total).toBe(2328);
    expect(plan!.document.total).toBe(11800.4);
    // The stale figure is nowhere in the plan.
    expect(plan!.lines[0].unit_price).not.toBe(142);
  });

  it("recomputes the tie-out FROM the edited figures", () => {
    const plan = planRefile(corrected);
    // 2328 goods, not 1704: the arithmetic describes the row as it stands.
    expect(plan!.document.computed_lines_total).toBe(2328);
    expect(plan!.document.tie_out_delta).toBe(
      Math.round((11800.4 - (2328 + 120 + 180 + 1834.4)) * 100) / 100,
    );
  });

  it("prefers the current rows even when `moneyWithheld` is also present", () => {
    // A document held once, restated, then edited: both readings exist and the
    // row's is the true one. Reading the snapshot first would undo the edit.
    const stale = withholdMoney(extracted(), "held earlier");
    const plan = planRefile({ ...corrected, extracted: stale });
    expect(plan!.source).toBe("current_rows");
    expect(plan!.lines[0].unit_price).toBe(194);
  });

  it("reaches for the snapshot only when the row carries no money at all", () => {
    const held = withholdMoney(extracted(), "held for the test");
    const plan = planRefile({
      row: heldRow(),
      lines: heldLineRows(),
      extracted: held,
    });
    expect(plan!.source).toBe("withheld_snapshot");
    expect(plan!.lines[0].unit_price).toBe(142);
  });

  it("counts a line-only price as money on the row", () => {
    // A document whose header states nothing but whose lines are priced is NOT
    // held, and must not be re-filed from a snapshot.
    const plan = planRefile({
      row: heldRow(),
      lines: lineRows(),
      extracted: withholdMoney(extracted(), "held earlier"),
    });
    expect(plan!.source).toBe("current_rows");
    expect(plan!.lines[0].unit_price).toBe(142);
    expect(plan!.document.total).toBeNull();
    // No stated total is an UNTESTABLE tie-out, never a failed one.
    expect(plan!.document.ties_out).toBeNull();
    expect(plan!.document.computed_lines_total).toBe(1704);
  });

  it("says which reading it used, in words", () => {
    expect(planRefile(corrected)!.sourceSaid).toContain("as it stands now");
    expect(
      planRefile({
        row: heldRow(),
        lines: heldLineRows(),
        extracted: withholdMoney(extracted(), "held"),
      })!.sourceSaid,
    ).toContain("moneyWithheld");
  });

  it("writes to the lines that EXIST, not to the ones the snapshot remembers", () => {
    // A line deleted since intake has no row to write to; resurrecting it from
    // the snapshot would write a price against a line_no nobody holds.
    const held = withholdMoney(
      extracted({
        lines: [
          ...extracted().lines,
          { ...extracted().lines[0], lineNo: 2, unitPrice: 99, lineTotal: 99 },
        ],
      }),
      "held",
    );
    const plan = planRefile({
      row: heldRow(),
      lines: heldLineRows(),
      extracted: held,
    });
    expect(plan!.lines).toHaveLength(1);
    expect(plan!.lines[0].line_no).toBe(1);
  });

  it("reads a numeric that arrived as a string, rather than erasing it", () => {
    // Postgres `numeric` reaches this gateway as a number or a string depending
    // on the path. A string silently becoming null here would erase a real
    // price on a restatement — the same defect through a different door.
    const plan = planRefile({
      row: moneyRow({ total: "11800.40" }),
      lines: lineRows({ unit_price: "194.0000", line_total: "2328.00" }),
      extracted: null,
    });
    expect(plan!.source).toBe("current_rows");
    expect(plan!.document.total).toBe(11800.4);
    expect(plan!.lines[0].unit_price).toBe(194);
  });
});

// ---------------------------------------------------------------------------
// ITEM A — the receiving door reads the same verdict the gate enforces.
// ---------------------------------------------------------------------------
describe("documentMoneyState / receivingPriceRefusal", () => {
  it("a document with an ISO currency is priced", () => {
    expect(documentMoneyState({ currency: "TRY" })).toEqual({ priced: true });
  });

  it("a document with no currency is not, and carries the hold's own sentence", () => {
    const held = applyCurrencyRules({
      doc: extracted({ currency: "USD" }),
      houseCurrency: "TRY",
      orderCurrency: "EUR",
      hasMatchedOrder: true,
      fileField: "printed currency",
    });
    const state = documentMoneyState({ currency: null, extracted: held });
    expect(state.priced).toBe(false);
    if (!state.priced) {
      expect(state.reason).toContain("MONEY HELD, NOT FILED");
      expect(state.reason).toContain("EUR");
    }
  });

  it("a REFUSED document (neither states one) is not priced either", () => {
    const refused = applyCurrencyRules({
      doc: extracted({ currency: "" }),
      houseCurrency: null,
      hasMatchedOrder: false,
      fileField: "printed currency",
    });
    const state = documentMoneyState({ currency: null, extracted: refused });
    expect(state.priced).toBe(false);
    if (!state.priced) expect(state.reason).toContain("REFUSED");
  });

  it("says so rather than falling silent when the reading gives no reason", () => {
    const state = documentMoneyState({ currency: null, extracted: null });
    expect(state.priced).toBe(false);
    if (!state.priced) expect(state.reason).toContain("not filed under any currency");
  });

  it("a lowercase or symbolic currency is NOT a filed currency", () => {
    expect(documentMoneyState({ currency: "usd" }).priced).toBe(true); // trimmed+uppercased
    expect(documentMoneyState({ currency: "$" }).priced).toBe(false);
    expect(documentMoneyState({ currency: "TL" }).priced).toBe(false);
  });

  it("the refusal names the reason, what still works, and the act that clears it", () => {
    const s = receivingPriceRefusal({
      reason: "MONEY HELD, NOT FILED. order PO-3 was placed in EUR…",
      docNumber: "F-2026-441",
      documentId: "doc-9",
    });
    expect(s).toContain("was NOT accepted");
    expect(s).toContain("F-2026-441");
    expect(s).toContain("MONEY HELD");
    // stock proceeds
    expect(s).toContain("stock movement are unaffected");
    expect(s).toContain("submit them now without a price");
    // and the act
    expect(s).toContain("restate the invoice's currency");
    expect(s).toContain("confirm");
    expect(s).toContain("doc-9");
  });
});
