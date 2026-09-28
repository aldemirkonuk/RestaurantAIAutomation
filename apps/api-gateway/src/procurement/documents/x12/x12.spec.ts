import { computeMatch } from "../../invoice-match";
import { looksLikeX12, parseX12 } from "./index";
import { detectDelimiters, n2, real, x12Date } from "./x12-envelope";

/**
 * Builds a positionally valid 106-character ISA.
 *
 * Written as code rather than a hand-typed string because the ISA is fixed-width
 * and every delimiter this parser trusts is read by offset — a hand-counted
 * sample that is one character short would make the tests pass against a file no
 * real partner would send.
 */
function isa(
  opts: {
    element?: string;
    component?: string;
    segment?: string;
    version?: string;
    usage?: string;
  } = {},
): string {
  const e = opts.element ?? "*";
  const c = opts.component ?? ">";
  const s = opts.segment ?? "~";
  const pad = (v: string, n: number) => v.padEnd(n, " ").slice(0, n);
  return (
    "ISA" +
    e +
    "00" +
    e +
    pad("", 10) +
    e +
    "00" +
    e +
    pad("", 10) +
    e +
    "ZZ" +
    e +
    pad("SGWS", 15) +
    e +
    "ZZ" +
    e +
    pad("WINEOPS", 15) +
    e +
    "260715" +
    e +
    "1030" +
    e +
    "U" +
    e +
    (opts.version ?? "00401") +
    e +
    "000000001" +
    e +
    "0" +
    e +
    (opts.usage ?? "P") +
    e +
    c +
    s
  );
}

/** A two-line invoice: 24 bottles @ $22, and 2 cases of 12 @ $264, plus $48 freight. */
const INVOICE_810 =
  isa() +
  [
    "GS*IN*SGWS*WINEOPS*20260715*1030*1*X*004010",
    "ST*810*0001",
    "BIG*20260715*INV-88213*20260710*PO-4471",
    "N1*SE*SOUTHERN GLAZERS WINE AND SPIRITS",
    "N1*ST*ALDEMIR WINE BAR",
    "ITD*01*3*****30",
    "DTM*011*20260714",
    "IT1*1*24*BT*22.00**VN*SGW-11872",
    "PID*F****CAVALLOTTO BAROLO BRICCO BOSCHIS 2010",
    "IT1*2*2*CS*264.00**VN*SGW-20411",
    "PO4*12",
    "PID*F****SANCERRE LES BARONNES 2022",
    "SAC*C*D240***4800",
    "TDS*110400",
    "CTT*2",
    "SE*14*0001",
    "GE*1*1",
    "IEA*1*000000001",
  ].join("~") +
  "~";

/** The matching ship notice — but only 22 of the 24 bottles actually shipped. */
const SHIP_856 =
  isa() +
  [
    "GS*SH*SGWS*WINEOPS*20260714*0800*2*X*004010",
    "ST*856*0002",
    "BSN*00*ASN-55120*20260714*0800",
    "HL*1**S",
    "N1*SF*SOUTHERN GLAZERS WINE AND SPIRITS",
    "HL*2*1*O",
    "PRF*PO-4471",
    "HL*3*2*I",
    "LIN**VN*SGW-11872",
    "SN1**22*BT",
    "PID*F****CAVALLOTTO BAROLO BRICCO BOSCHIS 2010",
    "HL*4*2*I",
    "LIN**VN*SGW-20411",
    "SN1**2*CS",
    "PO4*12",
    "CTT*4",
    "SE*15*0002",
    "GE*1*2",
    "IEA*1*000000001",
  ].join("~") +
  "~";

const CREDIT_812 =
  isa() +
  [
    "GS*CD*SGWS*WINEOPS*20260722*0900*3*X*004010",
    "ST*812*0003",
    "BCD*20260722*CM-3391*01*4400*C*01*INV-88213*20260715",
    "N1*SE*SOUTHERN GLAZERS WINE AND SPIRITS",
    "IT1*1*2*BT*22.00**VN*SGW-11872",
    "CDD*01*C*2*BT",
    "SE*6*0003",
    "GE*1*3",
    "IEA*1*000000001",
  ].join("~") +
  "~";

describe("x12 envelope", () => {
  it("reads delimiters from the ISA rather than assuming them", () => {
    const weird = isa({ element: "|", component: "^", segment: "\n" });
    const d = detectDelimiters(weird).delimiters;

    expect(d.element).toBe("|");
    expect(d.component).toBe("^");
    expect(d.segment).toBe("\n");
  });

  it("does not treat ISA11 as a repetition separator in 4010", () => {
    // In 4010 ISA11 is the standards identifier, the literal letter "U".
    // Treating it as a delimiter shreds every element in the file.
    expect(
      detectDelimiters(isa({ version: "00401" })).delimiters.repetition,
    ).toBeNull();
  });

  it("flags a test interchange so it cannot post against real money", () => {
    const r = parseX12(
      isa({ usage: "T" }) +
        "GS*IN*A*B*20260715*1030*1*X*004010~ST*810*1~BIG*20260715*X~SE*3*1~",
    );
    expect(r.documents[0].warnings.join(" ")).toMatch(/TEST/i);
  });

  it("survives segment terminators followed by newlines", () => {
    const withCrlf = INVOICE_810.split("~").join("~\r\n");
    const r = parseX12(withCrlf);
    expect(r.documents[0].docNumber).toBe("INV-88213");
    expect(r.documents[0].lines).toHaveLength(2);
  });
});

describe("numeric conversion", () => {
  it("expands implied decimals (N2)", () => {
    // The bug this prevents: TDS*110400 read as a plain number is $110,400
    // rather than $1,104.00 — a hundredfold overstatement on every invoice.
    expect(n2("110400")).toBe(1104);
    expect(n2("4800")).toBe(48);
    expect(n2("-2500")).toBe(-25);
  });

  it("leaves an already-decimal value alone even in an N2 field", () => {
    // Partners do send "528.00" in N2 fields. Re-scaling would turn a correct
    // number into $5.28.
    expect(n2("528.00")).toBe(528);
  });

  it("keeps explicit decimals as written (R)", () => {
    expect(real("22.00")).toBe(22);
  });

  it("pivots two-digit years at 30", () => {
    expect(x12Date("290101")).toBe("2029-01-01");
    expect(x12Date("300101")).toBe("1930-01-01");
    expect(x12Date("20260715")).toBe("2026-07-15");
    expect(x12Date("20261332")).toBeNull();
  });
});

/**
 * The house this fixture's 810 arrived at, and it now has to be STATED.
 *
 * `INVOICE_810` carries no `CUR` segment — which is the ordinary case for a
 * domestic 810 and was, until 2026-09-06, filed as `USD` by
 * `x12-invoice.ts`'s `?? "USD"` whoever sent it and whoever received it. Rule 1
 * of the founder's currency decision replaced that default with the HOUSE'S
 * OWN stated currency, so a fixture that wants its money read has to say what
 * the house answered. Passing nothing is now a document whose money is REFUSED,
 * which is asserted directly in `../invoice-currency.spec.ts`.
 *
 * The value is `USD` because this fixture is a Southern Glazer's invoice to a
 * US bar. It is an ANSWER here, not a default: the test states it.
 *
 * `CREDIT_812` takes it too. An 812 carries a real `totalCredit` (BCD04) and it
 * settles AGAINST the 810 above, so a credit read in one currency and an
 * invoice in another is the disagreement the decision exists to prevent.
 */
const HOUSE = { houseCurrency: "USD" } as const;

describe("810 invoice", () => {
  const doc = parseX12(INVOICE_810, HOUSE).documents[0];

  it("reads the invoice number from BIG02, not BIG01", () => {
    // Off-by-one on a 1-based spec yields a date where a number belongs —
    // plausible garbage that no type checker catches.
    expect(doc.docNumber).toBe("INV-88213");
    expect(doc.docDate).toBe("2026-07-15");
    expect(doc.poNumber).toBe("PO-4471");
  });

  it("identifies the seller a human would recognise", () => {
    expect(doc.vendorName).toBe("SOUTHERN GLAZERS WINE AND SPIRITS");
  });

  it("does not divide explicit unit prices by a hundred", () => {
    expect(doc.lines[0].unitPrice).toBe(22);
  });

  it("converts cases to bottles using PO4 pack size", () => {
    const cases = doc.lines[1];
    expect(cases.qty).toBe(2);
    expect(cases.uom).toBe("case");
    expect(cases.packSize).toBe(12);
    // The whole reason UOM exists: 2 cases and 24 bottles are the same delivery.
    expect(cases.qtyBottles).toBe(24);
  });

  it("classifies freight into its own bucket, not into other charges", () => {
    expect(doc.freight).toBe(48);
    expect(doc.otherCharges).toBeNull();
  });

  it("ties out lines plus charges against the stated total", () => {
    expect(doc.computedLinesTotal).toBe(1056);
    expect(doc.total).toBe(1104);
    expect(doc.tiesOut).toBe(true);
    expect(doc.warnings).toHaveLength(0);
  });

  it("fails the tie-out when a total is inconsistent", () => {
    const broken = INVOICE_810.replace("TDS*110400", "TDS*120000");
    const d = parseX12(broken, HOUSE).documents[0];
    expect(d.tiesOut).toBe(false);
    expect(d.warnings.join(" ")).toMatch(/off by/);
  });

  it("warns rather than guessing when a charge code is unmapped", () => {
    const odd = INVOICE_810.replace("SAC*C*D240***4800", "SAC*C*Z999***4800");
    const d = parseX12(odd, HOUSE).documents[0];
    expect(d.otherCharges).toBe(48);
    expect(d.warnings.join(" ")).toMatch(/Z999/);
  });

  it("flags a zero-priced line instead of assuming it is free goods", () => {
    // Inferring free goods would net the quantity out of the billable
    // comparison and hide a real overbill — the expensive direction to be wrong.
    const freebie = INVOICE_810.replace("IT1*1*24*BT*22.00", "IT1*1*24*BT*0");
    const d = parseX12(freebie, HOUSE).documents[0];
    expect(d.lines[0].freeGoodsQty).toBe(0);
    expect(d.warnings.join(" ")).toMatch(/billed at zero/);
  });
});

describe("856 ship notice", () => {
  const doc = parseX12(SHIP_856).documents[0];

  it("inherits the PO number from the ancestor order level", () => {
    // Items do not restate their PO; parsing HLs as a flat list orphans them.
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines[0].poNumber).toBe("PO-4471");
    expect(doc.lines[1].poNumber).toBe("PO-4471");
  });

  it("reads shipped quantity from SN1", () => {
    expect(doc.lines[0].qtyBottles).toBe(22);
    expect(doc.lines[1].qtyBottles).toBe(24); // 2 cases x 12
  });

  it("carries no prices and no total", () => {
    // A packing slip states no money. Zero here would tie out to a free
    // delivery and could zero a cost basis if ever treated as an invoice.
    expect(doc.lines[0].unitPrice).toBeNull();
    expect(doc.total).toBeNull();
    expect(doc.tiesOut).toBeNull();
  });

  it("does not hang on a cyclic HL parent chain", () => {
    const cyclic = SHIP_856.replace("HL*2*1*O", "HL*2*3*O").replace(
      "HL*3*2*I",
      "HL*3*2*I",
    );
    const d = parseX12(cyclic).documents[0];
    expect(d.lines.length).toBeGreaterThan(0);
  });
});

describe("812 credit memo", () => {
  const doc = parseX12(CREDIT_812, HOUSE).documents[0];

  it("references the invoice it settles", () => {
    // Without BCD07 a credit cannot be tied to the claim it resolves, and
    // "dollars recovered" stays unverifiable.
    expect(doc.docType).toBe("credit_memo");
    expect(doc.referencesDocNumber).toBe("INV-88213");
    expect(doc.total).toBe(44);
  });

  it("refuses to count a debit adjustment as recovery", () => {
    const debit = CREDIT_812.replace("*4400*C*01*", "*4400*D*01*");
    const d = parseX12(debit).documents[0];
    expect(d.docType).not.toBe("credit_memo");
    expect(d.warnings.join(" ")).toMatch(/DEBIT/);
  });

  it("warns when there is no invoice to tie the credit to", () => {
    const orphan = CREDIT_812.replace("*INV-88213*20260715", "**20260715");
    const d = parseX12(orphan).documents[0];
    expect(d.warnings.join(" ")).toMatch(/cannot be matched/);
  });
});

describe("routing", () => {
  it("parses a mixed interchange into one document per transaction set", () => {
    const both = INVOICE_810 + SHIP_856;
    const r = parseX12(both);
    expect(r.documents.map((d) => d.docType)).toEqual([
      "invoice",
      "packing_slip",
    ]);
  });

  it("recognises our own 850/855/997 without reporting them as noise", () => {
    const ack = isa() + "GS*FA*A*B*20260715*1030*1*X*004010~ST*997*1~SE*2*1~";
    const r = parseX12(ack);
    expect(r.documents).toHaveLength(0);
    expect(r.skipped[0].setType).toBe("997");
  });

  it("does not mistake a PDF mentioning ISA for an EDI file", () => {
    // Coerced through the parser, this would come back as an invoice with no
    // lines and no total — which reads downstream as a vendor who billed nothing.
    expect(looksLikeX12("%PDF-1.7 ... ISA certification ... invoice")).toBe(
      false,
    );
    expect(looksLikeX12(INVOICE_810)).toBe(true);
  });
});

/**
 * The point of the whole exercise.
 *
 * Two documents from the same distributor, parsed independently, fed to the
 * match: their ship notice says 22 bottles left the warehouse, their invoice
 * bills 24. Nothing we counted is involved, so there is nothing for their AR
 * desk to dispute.
 */
describe("810 against 856 — the self-evidencing claim", () => {
  it("proves the overbill from the vendor's own two documents", () => {
    const invoice = parseX12(INVOICE_810, HOUSE).documents[0];
    const ship = parseX12(SHIP_856).documents[0];

    const invoiceLine = invoice.lines[0];
    const shipLine = ship.lines[0];
    expect(invoiceLine.vendorSku).toBe(shipLine.vendorSku);

    const r = computeMatch({
      orderedQty: 24,
      poUnitPrice: 22,
      shippedQty: shipLine.qtyBottles,
      invoiceQty: invoiceLine.qtyBottles,
      invoiceUnitPrice: invoiceLine.unitPrice,
      acceptedQty: 22,
    });

    expect(r.verdict).toBe("overbilled_vs_ship");
    expect(r.selfEvidenced).toBe(true);
    expect(r.creditAmount).toBe(44);
    // And the 812 that settles it agrees to the penny.
    expect(parseX12(CREDIT_812, HOUSE).documents[0].total).toBe(r.creditAmount);
  });

  it("reports a clean match on the case line despite the unit mismatch", () => {
    const invoice = parseX12(INVOICE_810, HOUSE).documents[0];
    const ship = parseX12(SHIP_856).documents[0];

    // Invoice says 2 CS, ship notice says 2 CS, both 24 bottles. Compared as
    // bare numbers against a 24-bottle order this is a 22-unit shortfall.
    const r = computeMatch({
      orderedQty: 24,
      poUnitPrice: 22,
      shippedQty: ship.lines[1].qtyBottles,
      invoiceQty: invoice.lines[1].qtyBottles,
      invoiceUnitPrice: 22,
      acceptedQty: 24,
    });

    expect(r.verdict).toBe("matched");
  });
});
