/**
 * SYNTHETIC canonical documents — every value in this file is invented.
 *
 * NOT ONE OF THESE IS A REAL VENDOR DOCUMENT. They are hand-built to exercise
 * the arithmetic in `canonical-invariants.ts`, and they are the ONLY proof the
 * invariants have today: measured 2026-09-03, `procurement_documents` holds 0
 * rows and the `vendor-attachments` bucket holds 0 objects, so the corpus runner
 * of ADR 0104 D12 has nothing to read. That absence is recorded in the corpus
 * report rather than papered over with a seeded corpus — see
 * `scripts/canonical_corpus_run.py`.
 *
 * The names, VKNs, prices and numbers below are fictional. Two are shaped after
 * real market cases (a Turkish wine invoice with 20 % KDV and a returnable
 * container deposit; a Californian distributor invoice with CRV, freight, sales
 * tax and a case-based price base quantity) because those are the two
 * jurisdictions ADR 0103 must serve on one screen.
 */

import {
  AllowanceCharge,
  CanonicalDocument,
  Extracted,
  ExtractedLine,
  ExtractedParty,
  ExtractedTotals,
  FieldEnvelope,
  Source,
  VatBreakdownEntry,
  envelope,
} from "../canonical-types";

/** Short-hand: an extracted envelope with an optional printed literal. */
export function e<T>(
  value: T | null,
  asPrinted?: string,
  source: Source = "extracted",
): FieldEnvelope<T> {
  return envelope(value, source, {
    confidence: source === "extracted" ? 0.94 : null,
    ...(asPrinted !== undefined ? { as_printed: asPrinted } : {}),
  });
}

const emptyParty = (name: string, vat: string): ExtractedParty => ({
  name: e(name, name),
  vatIdentifier: e(vat, vat),
  identifier: e<string>(null),
  address: e<string>(null),
  electronicAddress: e<string>(null),
});

const blankTotals = (): ExtractedTotals => ({
  linesNetTotal: e<number>(null),
  allowancesTotal: e<number>(null),
  chargesTotal: e<number>(null),
  taxExclusiveAmount: e<number>(null),
  taxAmount: e<number>(null),
  taxInclusiveAmount: e<number>(null),
  paidAmount: e<number>(null),
  roundingAmount: e<number>(null),
  amountDue: e<number>(null),
});

export function line(opts: {
  lineId: string;
  description: string;
  quantity: number;
  unit: string;
  netPrice: number | null;
  netAmount: number | null;
  priceBaseQuantity?: number | null;
  priceBaseUnit?: string | null;
  vatCategory?: string | null;
  vatRate?: number | null;
  vintage?: number | null;
  formatMl?: number | null;
  freeGoodsQty?: number;
  allowancesCharges?: AllowanceCharge[];
  printedQuantity?: string;
}): ExtractedLine {
  return {
    lineId: e(opts.lineId, opts.lineId),
    description: e(opts.description, opts.description),
    sellerItemId: e<string>(null),
    quantity: e(opts.quantity, opts.printedQuantity ?? String(opts.quantity)),
    unit: e(opts.unit, opts.unit),
    netPrice: e(opts.netPrice),
    priceBaseQuantity: e(opts.priceBaseQuantity ?? null),
    priceBaseUnit: e(opts.priceBaseUnit ?? null),
    netAmount: e(opts.netAmount),
    allowancesCharges: opts.allowancesCharges ?? [],
    vatCategory: e(opts.vatCategory ?? null),
    vatRate: e(opts.vatRate ?? null),
    vintage: e(opts.vintage ?? null),
    lot: e<string>(null),
    formatMl: e(opts.formatMl ?? null),
    freeGoodsQty: e(opts.freeGoodsQty ?? 0),
  };
}

export function charge(opts: {
  amount: number;
  reason: string;
  /**
   * UNCL7161 for charges, UNCL5189 for allowances. The invariant asserts only
   * that a code is PRESENT — which code a vendor uses for a container deposit
   * varies, and inventing a canonical answer here would be exactly the kind of
   * confident wrong number this module exists to catch.
   */
  reasonCode: string | null;
  vatCategory?: string;
  vatRate?: number;
  isCharge?: boolean;
}): AllowanceCharge {
  return {
    isCharge: e(opts.isCharge ?? true),
    amount: e(opts.amount),
    reasonCode: e(opts.reasonCode),
    reason: e(opts.reason, opts.reason),
    vatCategory: e(opts.vatCategory ?? null),
    vatRate: e(opts.vatRate ?? null),
  };
}

export function vatRow(
  category: string,
  rate: number,
  taxableAmount: number,
  taxAmount: number,
): VatBreakdownEntry {
  return {
    category: e(category, category),
    rate: e(rate),
    taxableAmount: e(taxableAmount),
    taxAmount: e(taxAmount),
  };
}

function doc(
  id: string,
  docType: string,
  layer1: Extracted,
  overrides: Partial<CanonicalDocument> = {},
): CanonicalDocument {
  return {
    documentId: id,
    restaurantId: "00000000-0000-0000-0000-0000000000ff",
    docType,
    direction: "issued_by_vendor",
    jurisdiction: null,
    revision: 1,
    layer1,
    layer2: { providerId: null, lines: [] },
    layer3: { lines: [], tiesOut: null, tieOutDeltaCents: null, verdicts: [] },
    ...overrides,
  };
}

function header(partial: Partial<Extracted>): Extracted {
  return {
    documentNumber: e<string>(null),
    issueDate: e<string>(null),
    typeCode: e<string>(null),
    currency: e<string>(null),
    paymentDueDate: e<string>(null),
    paymentTerms: e<string>(null),
    seller: emptyParty("SYNTHETIC Seller", "0000000000"),
    buyer: emptyParty("SYNTHETIC Meyhane", "1111111111"),
    purchaseOrderReference: e<string>(null),
    despatchAdviceReference: e<string>(null),
    precedingInvoiceReference: e<string>(null),
    actualDeliveryDate: e<string>(null),
    deliveryLocation: e<string>(null),
    lines: [],
    allowancesCharges: [],
    totals: blankTotals(),
    vatBreakdown: [],
    ...partial,
  };
}

/**
 * SYNTHETIC 1 — Turkish wine invoice, KDV %20, one returnable-deposit charge.
 *
 *   2 lines            12 × ₺180,00 = 2.160,00 · 6 × ₺240,00 = 1.440,00
 *   BT-106  3.600,00
 *   BG-21     60,00   depozito (returnable container deposit), coded
 *   BT-109  3.660,00
 *   BT-110    732,00  (%20 of 3.660,00)
 *   BT-112  4.392,00
 *
 * `as_printed` carries the Turkish `1.234,56` grouping on purpose: it is the
 * literal the screen must be able to show beside our parsed number.
 */
export const TR_WINE_INVOICE: CanonicalDocument = doc(
  "synthetic-tr-invoice",
  "invoice",
  header({
    documentNumber: e("SYN2026000000123", "SYN2026000000123"),
    issueDate: e("2026-08-14", "14.08.2026"),
    typeCode: e("380", "380"),
    currency: e("TRY", "TRY"),
    actualDeliveryDate: e("2026-08-13", "13.08.2026"),
    lines: [
      line({
        lineId: "1",
        description: "SYNTHETIC Öküzgözü 2022",
        quantity: 12,
        unit: "bottle",
        netPrice: 180,
        netAmount: 2160,
        priceBaseQuantity: 1,
        priceBaseUnit: "bottle",
        vatCategory: "S",
        vatRate: 20,
        vintage: 2022,
        formatMl: 750,
        printedQuantity: "12",
      }),
      line({
        lineId: "2",
        description: "SYNTHETIC Narince 2023",
        quantity: 6,
        unit: "bottle",
        netPrice: 240,
        netAmount: 1440,
        priceBaseQuantity: 1,
        priceBaseUnit: "bottle",
        vatCategory: "S",
        vatRate: 20,
        vintage: 2023,
        formatMl: 750,
      }),
    ],
    allowancesCharges: [
      charge({
        amount: 60,
        reason: "Depozito (returnable container deposit)",
        reasonCode: "ABK",
        vatCategory: "S",
        vatRate: 20,
      }),
    ],
    totals: {
      ...blankTotals(),
      linesNetTotal: e(3600, "3.600,00"),
      allowancesTotal: e(0),
      chargesTotal: e(60, "60,00"),
      taxExclusiveAmount: e(3660, "3.660,00"),
      taxAmount: e(732, "732,00"),
      taxInclusiveAmount: e(4392, "4.392,00"),
      paidAmount: e(0),
      roundingAmount: e(0),
      amountDue: e(4392, "4.392,00"),
    },
    vatBreakdown: [vatRow("S", 20, 3660, 732)],
  }),
  { jurisdiction: "TR" },
);

/**
 * SYNTHETIC 2 — Californian distributor invoice: CRV, freight, sales tax, and a
 * `1 cs × 12 × 750 ml` price base.
 *
 * Line 1 is the case-priced case: 24 BOTTLES invoiced, priced at $264 PER CASE
 * OF 12 (BT-146 = 264, BT-149 = 12, BT-150 = bottle) — 24 × 264 ÷ 12 = 528. Get
 * the base quantity wrong and this line is out by a factor of twelve, which is
 * the single most expensive silent error in beverage receiving (§A1).
 */
export const CA_DISTRIBUTOR_INVOICE: CanonicalDocument = doc(
  "synthetic-ca-invoice",
  "invoice",
  header({
    documentNumber: e("SYN-88213", "SYN-88213"),
    issueDate: e("2026-08-20", "08/20/2026"),
    typeCode: e("380", "380"),
    currency: e("USD", "USD"),
    purchaseOrderReference: e("PO-4471", "PO-4471"),
    actualDeliveryDate: e("2026-08-20", "08/20/2026"),
    lines: [
      line({
        lineId: "1",
        description: "SYNTHETIC Sancerre 2023",
        quantity: 24,
        unit: "bottle",
        netPrice: 264,
        netAmount: 528,
        priceBaseQuantity: 12,
        priceBaseUnit: "bottle",
        vatCategory: "S",
        vatRate: 8.75,
        vintage: 2023,
        formatMl: 750,
        printedQuantity: "2 CS",
      }),
      line({
        lineId: "2",
        description: "SYNTHETIC Barolo 2019",
        quantity: 6,
        unit: "bottle",
        netPrice: 22,
        netAmount: 132,
        priceBaseQuantity: 1,
        priceBaseUnit: "bottle",
        vatCategory: "S",
        vatRate: 8.75,
        vintage: 2019,
        formatMl: 750,
      }),
    ],
    allowancesCharges: [
      charge({
        amount: 48,
        reason: "Freight",
        reasonCode: "FC",
        vatCategory: "S",
        vatRate: 8.75,
      }),
      charge({
        amount: 2.4,
        reason: "CRV container redemption",
        reasonCode: "ABK",
        vatCategory: "S",
        vatRate: 8.75,
      }),
    ],
    totals: {
      ...blankTotals(),
      linesNetTotal: e(660, "660.00"),
      allowancesTotal: e(0),
      chargesTotal: e(50.4, "50.40"),
      taxExclusiveAmount: e(710.4, "710.40"),
      taxAmount: e(62.16, "62.16"),
      taxInclusiveAmount: e(772.56, "772.56"),
      paidAmount: e(0),
      roundingAmount: e(0),
      amountDue: e(772.56, "772.56"),
    },
    vatBreakdown: [vatRow("S", 8.75, 710.4, 62.16)],
  }),
  { jurisdiction: "US-CA" },
);

/** SYNTHETIC 3 — a credit memo (BT-3 381) that cites the invoice it credits. */
export const CREDIT_MEMO_WITH_REFERENCE: CanonicalDocument = doc(
  "synthetic-credit-memo",
  "credit_memo",
  header({
    documentNumber: e("SYN-CM-4402", "SYN-CM-4402"),
    issueDate: e("2026-08-25", "08/25/2026"),
    typeCode: e("381", "381"),
    currency: e("USD", "USD"),
    precedingInvoiceReference: e("SYN-88213", "SYN-88213"),
    lines: [
      line({
        lineId: "1",
        description: "SYNTHETIC Barolo 2019 — 2 bottles broken in transit",
        quantity: 2,
        unit: "bottle",
        netPrice: 22,
        netAmount: 44,
        priceBaseQuantity: 1,
        priceBaseUnit: "bottle",
        vatCategory: "S",
        vatRate: 8.75,
      }),
    ],
    totals: {
      ...blankTotals(),
      linesNetTotal: e(44, "44.00"),
      allowancesTotal: e(0),
      chargesTotal: e(0),
      taxExclusiveAmount: e(44, "44.00"),
      taxAmount: e(3.85, "3.85"),
      taxInclusiveAmount: e(47.85, "47.85"),
      paidAmount: e(0),
      roundingAmount: e(0),
      amountDue: e(47.85, "47.85"),
    },
    vatBreakdown: [vatRow("S", 8.75, 44, 3.85)],
  }),
  { jurisdiction: "US-CA" },
);

/** SYNTHETIC 4 — the same credit memo with BT-25 missing: an ORPHAN. */
export const CREDIT_MEMO_ORPHAN: CanonicalDocument = doc(
  "synthetic-credit-memo-orphan",
  "credit_memo",
  {
    ...CREDIT_MEMO_WITH_REFERENCE.layer1,
    precedingInvoiceReference: e<string>(null),
  },
  { jurisdiction: "US-CA" },
);

/**
 * SYNTHETIC 5 — a Turkish delivery note (irsaliye) with NO money at all.
 *
 * This is the fixture that stops the invariants reporting absence as health: it
 * must produce `null` (untestable), never `true`, on every money rule.
 */
export const DELIVERY_NOTE_NO_MONEY: CanonicalDocument = doc(
  "synthetic-delivery-note",
  "delivery_note",
  header({
    documentNumber: e("SYN-IRS-9901", "SYN-IRS-9901"),
    issueDate: e("2026-08-13", "13.08.2026"),
    actualDeliveryDate: e("2026-08-13", "13.08.2026"),
    lines: [
      line({
        lineId: "1",
        description: "SYNTHETIC Öküzgözü 2022",
        quantity: 12,
        unit: "bottle",
        netPrice: null,
        netAmount: null,
        vintage: 2022,
        formatMl: 750,
      }),
    ],
  }),
  { jurisdiction: "TR" },
);

/** SYNTHETIC 6 — a wholly free bonus case, correctly billed at zero. */
export const FREE_GOODS_INVOICE: CanonicalDocument = doc(
  "synthetic-free-goods",
  "invoice",
  header({
    documentNumber: e("SYN-FG-77", "SYN-FG-77"),
    issueDate: e("2026-08-21"),
    typeCode: e("380"),
    currency: e("USD", "USD"),
    lines: [
      line({
        lineId: "1",
        description: "SYNTHETIC Barolo 2019",
        quantity: 12,
        unit: "bottle",
        netPrice: 22,
        netAmount: 264,
        priceBaseQuantity: 1,
        priceBaseUnit: "bottle",
      }),
      line({
        lineId: "2",
        description: "SYNTHETIC Barolo 2019 — bonus",
        quantity: 1,
        unit: "bottle",
        netPrice: 0,
        netAmount: 0,
        priceBaseQuantity: 1,
        priceBaseUnit: "bottle",
        freeGoodsQty: 1,
      }),
    ],
    totals: {
      ...blankTotals(),
      linesNetTotal: e(264, "264.00"),
      taxExclusiveAmount: e(264, "264.00"),
      taxInclusiveAmount: e(264, "264.00"),
      amountDue: e(264, "264.00"),
    },
  }),
);

/** SYNTHETIC 7 — the same invoice with the bonus line billed anyway. */
export const FREE_GOODS_BILLED_ANYWAY: CanonicalDocument = doc(
  "synthetic-free-goods-billed",
  "invoice",
  {
    ...FREE_GOODS_INVOICE.layer1,
    lines: [
      FREE_GOODS_INVOICE.layer1.lines[0],
      {
        ...FREE_GOODS_INVOICE.layer1.lines[1],
        netPrice: e(22),
        netAmount: e(22),
      },
    ],
  },
);

/**
 * SYNTHETIC 8 — a document whose lines do not tie.
 * BT-106 states 3.600,00; the lines add to 3.500,00. This is the failure the
 * arithmetic exists to name, and the corpus report must print it with the
 * document id and both numbers.
 */
export const LINES_DO_NOT_TIE: CanonicalDocument = doc(
  "synthetic-does-not-tie",
  "invoice",
  {
    ...TR_WINE_INVOICE.layer1,
    lines: [
      TR_WINE_INVOICE.layer1.lines[0],
      {
        ...TR_WINE_INVOICE.layer1.lines[1],
        quantity: e(6, "6"),
        netPrice: e(240),
        netAmount: e(1340), // the vendor's own arithmetic slip
      },
    ],
  },
  { jurisdiction: "TR" },
);

/** SYNTHETIC 9 — a deposit billed as a goods LINE instead of a BG-21 charge. */
export const DEPOSIT_AS_GOODS_LINE: CanonicalDocument = doc(
  "synthetic-deposit-as-line",
  "invoice",
  header({
    documentNumber: e("SYN-DEP-12"),
    currency: e("USD", "USD"),
    lines: [
      line({
        lineId: "1",
        description: "SYNTHETIC Barolo 2019",
        quantity: 12,
        unit: "bottle",
        netPrice: 22,
        netAmount: 264,
        priceBaseQuantity: 1,
        priceBaseUnit: "bottle",
      }),
      line({
        lineId: "2",
        description: "CRV deposit 12 × 750ml",
        quantity: 12,
        unit: "each",
        netPrice: 0.1,
        netAmount: 1.2,
        priceBaseQuantity: 1,
        priceBaseUnit: "each",
      }),
    ],
    totals: {
      ...blankTotals(),
      linesNetTotal: e(265.2, "265.20"),
      taxExclusiveAmount: e(265.2, "265.20"),
      taxInclusiveAmount: e(265.2, "265.20"),
      amountDue: e(265.2, "265.20"),
    },
  }),
);

export const ALL_SYNTHETIC_DOCUMENTS: CanonicalDocument[] = [
  TR_WINE_INVOICE,
  CA_DISTRIBUTOR_INVOICE,
  CREDIT_MEMO_WITH_REFERENCE,
  CREDIT_MEMO_ORPHAN,
  DELIVERY_NOTE_NO_MONEY,
  FREE_GOODS_INVOICE,
  FREE_GOODS_BILLED_ANYWAY,
  LINES_DO_NOT_TIE,
  DEPOSIT_AS_GOODS_LINE,
];
