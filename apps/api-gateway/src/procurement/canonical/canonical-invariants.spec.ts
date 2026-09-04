import {
  amountDue,
  asPrintedNotMutated,
  creditMemoReferencesInvoice,
  currencyPresentWhenMoney,
  depositsAreCodedAndExcluded,
  documentLinesTotal,
  freeGoodsCarryZeroNet,
  INVARIANTS,
  lineNetAmount,
  priceBaseQuantity,
  receivedIsNeverAssumed,
  runInvariants,
  summarise,
  totalWithoutVat,
  totalWithVat,
  vatCategoryTaxableBase,
  vatCategoryTaxAmount,
  vatTotalMatchesBreakdown,
} from "./canonical-invariants";
import { InvariantResult } from "./canonical-types";
import {
  ALL_SYNTHETIC_DOCUMENTS,
  CA_DISTRIBUTOR_INVOICE,
  CREDIT_MEMO_ORPHAN,
  CREDIT_MEMO_WITH_REFERENCE,
  DELIVERY_NOTE_NO_MONEY,
  DEPOSIT_AS_GOODS_LINE,
  FREE_GOODS_BILLED_ANYWAY,
  FREE_GOODS_INVOICE,
  LINES_DO_NOT_TIE,
  TR_CASE_PRICED_INVOICE,
  TR_WINE_INVOICE,
} from "./__fixtures__/synthetic-documents";

/**
 * Every fixture here is SYNTHETIC (see __fixtures__/synthetic-documents.ts).
 * They are the only proof these invariants have: measured 2026-09-03,
 * procurement_documents holds 0 rows, so the corpus runner of ADR 0104 D12 has
 * nothing real to read yet.
 */

const holds = (rs: InvariantResult[]) => rs.map((r) => r.holds);
const failures = (rs: InvariantResult[]) => rs.filter((r) => r.holds === false);

describe("canonical invariants — the two jurisdictions that must share one screen", () => {
  it("passes every arithmetic rule on a synthetic TR wine invoice with 20% KDV and a deposit", () => {
    const results = runInvariants(TR_WINE_INVOICE);
    expect(failures(results)).toEqual([]);
    // and it actually TESTED something — a suite of untestables is not a pass
    expect(summarise(results).holds).toBeGreaterThanOrEqual(8);
  });

  it("passes on a synthetic CA invoice with CRV, freight, sales tax and a 1 cs × 12 price base", () => {
    const results = runInvariants(CA_DISTRIBUTOR_INVOICE);
    expect(failures(results)).toEqual([]);
    expect(summarise(results).holds).toBeGreaterThanOrEqual(8);
  });

  it("divides by the price base quantity: 24 bottles at 264 per case of 12 is 528, not 6336", () => {
    const [first] = lineNetAmount(CA_DISTRIBUTOR_INVOICE);
    expect(first.holds).toBe(true);
    expect(first.expected).toBe(528);
    expect(first.rule).toBe("PEPPOL-EN16931-R120");
  });

  it("names the line, the expected number and the found number when a line does not tie", () => {
    const lineResults = lineNetAmount(LINES_DO_NOT_TIE);
    const bad = lineResults.find((r) => r.holds === false);
    expect(bad).toBeDefined();
    expect(bad?.path).toBe("lines[1]");
    expect(bad?.expected).toBe(1440);
    expect(bad?.found).toBe(1340);
    expect(bad?.explanation).toContain("1440.00");

    const total = documentLinesTotal(LINES_DO_NOT_TIE)[0];
    expect(total.holds).toBe(false);
    expect(total.expected).toBe(3500);
    expect(total.found).toBe(3600);
    expect(total.rule).toBe("BR-CO-10");
  });
});

describe("the money chain — BT-106 → BT-109 → BT-112 → BT-115", () => {
  it("BT-109 = BT-106 − allowances + charges (BR-CO-13)", () => {
    const r = totalWithoutVat(TR_WINE_INVOICE)[0];
    expect(r.holds).toBe(true);
    expect(r.expected).toBe(3660);
  });

  it("BT-112 = BT-109 + BT-110 (BR-CO-15)", () => {
    expect(totalWithVat(TR_WINE_INVOICE)[0].holds).toBe(true);
    expect(totalWithVat(CA_DISTRIBUTOR_INVOICE)[0].expected).toBe(772.56);
  });

  it("BT-115 = BT-112 − paid (+ rounding) (BR-CO-16)", () => {
    const r = amountDue(CA_DISTRIBUTOR_INVOICE)[0];
    expect(r.holds).toBe(true);
    expect(r.rule).toBe("BR-CO-16");
  });

  it("catches a total-with-VAT that does not follow from its parts", () => {
    const broken = {
      ...CA_DISTRIBUTOR_INVOICE,
      layer1: {
        ...CA_DISTRIBUTOR_INVOICE.layer1,
        totals: {
          ...CA_DISTRIBUTOR_INVOICE.layer1.totals,
          taxInclusiveAmount: {
            ...CA_DISTRIBUTOR_INVOICE.layer1.totals.taxInclusiveAmount,
            value: 800,
          },
        },
      },
    };
    const r = totalWithVat(broken)[0];
    expect(r.holds).toBe(false);
    expect(r.expected).toBe(772.56);
    expect(r.found).toBe(800);
  });
});

describe("VAT breakdown", () => {
  it("BT-110 equals the sum of the breakdown rows (BR-CO-14)", () => {
    expect(vatTotalMatchesBreakdown(TR_WINE_INVOICE)[0].holds).toBe(true);
  });

  it("each category's taxable base is the sum of its own lines and charges (BR-S-08)", () => {
    const rows = vatCategoryTaxableBase(CA_DISTRIBUTOR_INVOICE);
    expect(holds(rows)).toEqual([true]);
    expect(rows[0].expected).toBe(710.4);
  });

  it("each category's tax is its base times its rate (BR-CO-17)", () => {
    const rows = vatCategoryTaxAmount(TR_WINE_INVOICE);
    expect(rows[0].holds).toBe(true);
    expect(rows[0].expected).toBe(732);
  });

  it("catches a category whose base does not cover its lines", () => {
    const broken = {
      ...TR_WINE_INVOICE,
      layer1: {
        ...TR_WINE_INVOICE.layer1,
        vatBreakdown: [
          {
            ...TR_WINE_INVOICE.layer1.vatBreakdown[0],
            taxableAmount: {
              ...TR_WINE_INVOICE.layer1.vatBreakdown[0].taxableAmount,
              value: 3000,
            },
          },
        ],
      },
    };
    const r = vatCategoryTaxableBase(broken)[0];
    expect(r.holds).toBe(false);
    expect(r.expected).toBe(3660);
    expect(r.found).toBe(3000);
  });
});

describe("a delivery note with no money reports UNTESTABLE, never a pass", () => {
  it("returns holds === null on every money rule, and never true", () => {
    const results = runInvariants(DELIVERY_NOTE_NO_MONEY);
    const moneyRules = results.filter((r) =>
      [
        "line_net_amount",
        "document_lines_total",
        "total_without_vat",
        "total_with_vat",
        "amount_due",
        "vat_total_matches_breakdown",
        "vat_category_taxable_base",
        "vat_category_tax_amount",
        "currency_present_when_money",
      ].includes(r.id),
    );
    expect(moneyRules.length).toBeGreaterThan(0);
    expect(moneyRules.every((r) => r.holds === null)).toBe(true);
  });

  it("summarise counts untestable separately from holds — a stack of delivery notes is not a clean bill", () => {
    const s = summarise(runInvariants(DELIVERY_NOTE_NO_MONEY));
    expect(s.fails).toBe(0);
    expect(s.untestable).toBeGreaterThan(5);
    // The whole point: it did NOT report a pile of passes.
    expect(s.holds).toBeLessThan(s.untestable);
  });

  it("still demands a currency the moment any money appears (BR-5)", () => {
    const withMoneyNoCurrency = {
      ...DELIVERY_NOTE_NO_MONEY,
      layer1: {
        ...DELIVERY_NOTE_NO_MONEY.layer1,
        lines: [
          {
            ...DELIVERY_NOTE_NO_MONEY.layer1.lines[0],
            netAmount: {
              ...DELIVERY_NOTE_NO_MONEY.layer1.lines[0].netAmount,
              value: 2160,
            },
          },
        ],
      },
    };
    const r = currencyPresentWhenMoney(withMoneyNoCurrency)[0];
    expect(r.holds).toBe(false);
    expect(r.rule).toBe("BR-5");
  });
});

describe("free goods", () => {
  it("a wholly free bonus line nets to zero", () => {
    const r = freeGoodsCarryZeroNet(FREE_GOODS_INVOICE).find(
      (x) => x.path === "lines[1]",
    );
    expect(r?.holds).toBe(true);
  });

  it("a line marked free but billed anyway is a named failure", () => {
    const r = freeGoodsCarryZeroNet(FREE_GOODS_BILLED_ANYWAY).find(
      (x) => x.path === "lines[1]",
    );
    expect(r?.holds).toBe(false);
    expect(r?.explanation).toContain("free goods");
  });

  it("reports untestable when nothing on the document is free", () => {
    expect(freeGoodsCarryZeroNet(TR_WINE_INVOICE)[0].holds).toBeNull();
  });
});

describe("deposits and CRV", () => {
  it("accepts a coded document-level deposit charge", () => {
    const rs = depositsAreCodedAndExcluded(TR_WINE_INVOICE);
    expect(rs.some((r) => r.holds === true)).toBe(true);
  });

  it("fails a deposit charge that carries no reason code", () => {
    const uncoded = {
      ...TR_WINE_INVOICE,
      layer1: {
        ...TR_WINE_INVOICE.layer1,
        allowancesCharges: [
          {
            ...TR_WINE_INVOICE.layer1.allowancesCharges[0],
            reasonCode: {
              ...TR_WINE_INVOICE.layer1.allowancesCharges[0].reasonCode,
              value: null,
            },
          },
        ],
      },
    };
    expect(depositsAreCodedAndExcluded(uncoded)[0].holds).toBe(false);
  });

  it("fails a CRV billed as a goods line, because it is inside BT-106", () => {
    const rs = depositsAreCodedAndExcluded(DEPOSIT_AS_GOODS_LINE);
    const bad = rs.find((r) => r.holds === false);
    expect(bad?.path).toBe("lines[1]");
    expect(bad?.explanation).toContain("inflate beverage cost");
  });
});

describe("credit memos", () => {
  it("accepts one that references the invoice it credits", () => {
    const r = creditMemoReferencesInvoice(CREDIT_MEMO_WITH_REFERENCE)[0];
    expect(r.holds).toBe(true);
    expect(r.found).toBe("SYN-88213");
  });

  it("names an orphan credit memo", () => {
    const r = creditMemoReferencesInvoice(CREDIT_MEMO_ORPHAN)[0];
    expect(r.holds).toBe(false);
    expect(r.explanation).toContain("cannot be matched");
  });

  it("says untestable, not pass, on a document that is not a credit memo", () => {
    expect(creditMemoReferencesInvoice(TR_WINE_INVOICE)[0].holds).toBeNull();
  });
});

describe("received is never silently equal to shipped (ADR 0103 A6)", () => {
  it('accepts "not_counted" when nobody counted at the door', () => {
    const withSpine = {
      ...TR_WINE_INVOICE,
      layer3: {
        ...TR_WINE_INVOICE.layer3,
        lines: [
          {
            lineIndex: 0,
            ordered: 12,
            shipped: 12,
            received: "not_counted" as const,
            billed: 12,
            verdict: "ok",
            reason: null,
            moneyAtRisk: null,
          },
        ],
      },
    };
    const r = receivedIsNeverAssumed(withSpine)[0];
    expect(r.holds).toBe(true);
    expect(r.found).toBe("not_counted");
  });

  it("reports untestable when nothing has been adjudicated", () => {
    expect(receivedIsNeverAssumed(TR_WINE_INVOICE)[0].holds).toBeNull();
  });
});

describe("as_printed is never rewritten by formatting (ADR 0104 D1)", () => {
  it("keeps the Turkish 1.234,56 grouping beside the parsed number", () => {
    expect(TR_WINE_INVOICE.layer1.totals.taxInclusiveAmount.as_printed).toBe(
      "4.392,00",
    );
    expect(asPrintedNotMutated(TR_WINE_INVOICE)[0].holds).toBe(true);
  });

  it("fails when a formatter has emptied a printed value", () => {
    const emptied = {
      ...TR_WINE_INVOICE,
      layer1: {
        ...TR_WINE_INVOICE.layer1,
        totals: {
          ...TR_WINE_INVOICE.layer1.totals,
          taxInclusiveAmount: {
            ...TR_WINE_INVOICE.layer1.totals.taxInclusiveAmount,
            as_printed: "",
          },
        },
      },
    };
    const r = asPrintedNotMutated(emptied)[0];
    expect(r.holds).toBe(false);
    expect(r.explanation).toContain("formatting");
  });
});

describe("the shape of every result", () => {
  it("never returns a bare boolean: every result carries id, expected, found and a sentence", () => {
    for (const doc of ALL_SYNTHETIC_DOCUMENTS) {
      for (const r of runInvariants(doc)) {
        expect(typeof r.id).toBe("string");
        expect(r.id.length).toBeGreaterThan(0);
        expect(r).toHaveProperty("expected");
        expect(r).toHaveProperty("found");
        expect(typeof r.explanation).toBe("string");
        expect(r.explanation.length).toBeGreaterThan(10);
        expect([true, false, null]).toContain(r.holds);
      }
    }
  });

  it("runs every registered invariant on every document", () => {
    expect(INVARIANTS.length).toBe(16);
    for (const doc of ALL_SYNTHETIC_DOCUMENTS) {
      const ids = new Set(runInvariants(doc).map((r) => r.id));
      expect(ids.size).toBe(16);
    }
  });

  it("price base quantity of zero is a failure, not a division", () => {
    const zeroBase = {
      ...TR_WINE_INVOICE,
      layer1: {
        ...TR_WINE_INVOICE.layer1,
        lines: [
          {
            ...TR_WINE_INVOICE.layer1.lines[0],
            priceBaseQuantity: {
              ...TR_WINE_INVOICE.layer1.lines[0].priceBaseQuantity,
              value: 0,
            },
          },
        ],
      },
    };
    expect(priceBaseQuantity(zeroBase)[0].holds).toBe(false);
    expect(lineNetAmount(zeroBase)[0].holds).toBe(false);
  });
});

/**
 * BT-149 with the quantity in a DIFFERENT unit from the price base — the
 * `1 ks × 12 şişe` case ADR 0104 D1 names, and the one the mapper could not
 * produce until BT-149/BT-150 round-tripped through `ParsedDocument`.
 */
describe("line net amount across a case quantity and a bottle price base", () => {
  it("holds on the TR 1 ks × 12 şişe invoice", () => {
    const [first] = lineNetAmount(TR_CASE_PRICED_INVOICE);
    expect(first.expected).toBe(142);
    expect(first.holds).toBe(true);
  });

  it("passes every rule on that invoice, and tests something while doing it", () => {
    const results = runInvariants(TR_CASE_PRICED_INVOICE);
    expect(failures(results)).toEqual([]);
    expect(summarise(results).holds).toBeGreaterThanOrEqual(8);
  });

  it("refuses rather than guessing when layer 2 has no pack size to convert with", () => {
    // 1 ÷ 12 × 142 = 11,83 is the confident wrong answer available here. The
    // invariant must report UNTESTABLE instead — a wrong "fails" would send a
    // bookkeeper to argue a line that is in fact correct.
    const noPack = {
      ...TR_CASE_PRICED_INVOICE,
      layer2: { providerId: null, lines: [] },
    };
    const [first] = lineNetAmount(noPack);
    expect(first.holds).toBeNull();
    expect(first.explanation).toMatch(/pack size/i);
  });

  it("keeps the Turkish price basis as printed, untouched", () => {
    expect(TR_CASE_PRICED_INVOICE.layer1.lines[0].netPrice.as_printed).toBe(
      "142,00 / KS(12)",
    );
    const printed = asPrintedNotMutated(TR_CASE_PRICED_INVOICE);
    expect(printed[0].holds).toBe(true);
  });
});
