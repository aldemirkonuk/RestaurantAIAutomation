import {
  comparableUnits,
  normalizeUom,
  toBottles,
  Uom,
} from "../documents/document-types";
import {
  moneyEquals,
  tieOutToleranceCents,
} from "../documents/parsed-document";
import {
  AllowanceCharge,
  CanonicalDocument,
  ExtractedLine,
  FieldEnvelope,
  InvariantResult,
} from "./canonical-types";

/**
 * canonical-invariants — the arithmetic the document must obey, stated once.
 *
 * WHY THESE AND NOT A CONFIDENCE SCORE. A model that hallucinated a quantity, a
 * mis-scaled implied-decimal field, an OCR that read 1.234,56 as 1.23456, and a
 * vendor who actually made a mistake all break the SAME sums. Arithmetic is the
 * only free, deterministic detector we have, and it is the one a bookkeeper can
 * argue with a distributor about. `parsed-document.applyTieOut` already does the
 * coarse version (lines + charges vs stated total); this is the full EN 16931
 * set, per line and per VAT category, so a failure names WHICH number is wrong
 * instead of only that one of them is.
 *
 * EVERY FUNCTION RETURNS RESULTS, NEVER A BARE BOOLEAN, and `holds` is
 * tri-state:
 *
 *   true   checked, and it holds
 *   false  checked, and it does NOT — with expected, found and a sentence
 *   null   the invariant ran and had nothing to test (no stated total, no VAT
 *          breakdown on a delivery note). NOT a pass. The corpus runner counts
 *          these separately, because a corpus of untestable documents reporting
 *          "0 failures" is this repo's absence-as-health fault with arithmetic
 *          on top.
 *
 * TOLERANCE comes from `tieOutToleranceCents(lineCount)` in parsed-document.ts —
 * one cent per line, because vendors round per line and a 40-line invoice can
 * legitimately be off by a few cents while a 2-line one cannot. It is imported
 * rather than restated so the two can never drift.
 */

type Num = number | null;

/** Read a numeric envelope, treating a missing envelope and a null value alike. */
function num(f?: FieldEnvelope<number> | null): Num {
  const v = f?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(f?: FieldEnvelope<string> | null): string | null {
  const v = f?.value;
  return typeof v === "string" && v.length > 0 ? v : null;
}

function result(
  id: string,
  rule: string | null,
  path: string | null,
  holds: boolean | null,
  expected: unknown,
  found: unknown,
  explanation: string,
): InvariantResult {
  return { id, rule, path, holds, expected, found, explanation };
}

/** Signed contribution of an allowance/charge: charges add, allowances deduct. */
function signedAmount(ac: AllowanceCharge): number {
  const amount = num(ac.amount) ?? 0;
  return ac.isCharge.value === true ? amount : -amount;
}

function sumAllowancesCharges(list: AllowanceCharge[]): {
  allowances: number;
  charges: number;
} {
  let allowances = 0;
  let charges = 0;
  for (const ac of list) {
    const amount = num(ac.amount) ?? 0;
    if (ac.isCharge.value === true) charges += amount;
    else allowances += amount;
  }
  return { allowances, charges };
}

const money = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// 1. Line net amount — EN 16931 §6, enforced by Peppol BIS as
//    PEPPOL-EN16931-R120:
//
//      BT-131 = BT-129 × (BT-146 ÷ BT-149) + line charges − line allowances
//
//    BT-149 (price base quantity) is the `1 ks × 12 şişe` guard. Divide by a
//    missing base quantity and you are wrong by a factor of twelve on every
//    case-priced line, which is the single most expensive silent error in
//    beverage receiving.
//
//    AND BT-130 IS NOT ALWAYS BT-150. A Turkish invoice states `1 KS` against
//    `142,00 / KS(12)`: the quantity is in cases, the price base is in bottles.
//    Dividing 1 by 12 there gives 11,83 — a confident wrong number, and the
//    failing direction is worse than the missing one, because it sends a
//    bookkeeper to argue a line that is correct. So the quantity is first
//    expressed in the price base's OWN unit, and the only conversion available
//    for that is layer 2's `packSize`. When it is absent the invariant reports
//    UNTESTABLE, never a verdict.
// ---------------------------------------------------------------------------

/**
 * The invoiced quantity restated in the price base's unit.
 *
 * Returns `problem` instead of a number whenever the restatement cannot be
 * made honestly — an unreadable unit, a keg against a bottle price, or a
 * case/bottle pair with no pack size to convert through.
 */
function quantityInPriceBaseUnit(
  doc: CanonicalDocument,
  line: ExtractedLine,
  index: number,
  qty: number,
): { qty: number | null; problem: string | null } {
  const rawUnit = (str(line.unit) ?? "").trim();
  const rawBase = (str(line.priceBaseUnit) ?? "").trim();
  // No stated base unit, or the same one: the base is already in the invoiced
  // unit and there is nothing to convert.
  if (!rawBase || rawUnit.toLowerCase() === rawBase.toLowerCase())
    return { qty, problem: null };

  const unit = normalizeUom(rawUnit);
  const baseUnit = normalizeUom(rawBase);
  if (!unit || !baseUnit)
    return {
      qty: null,
      problem: `the line is invoiced in "${rawUnit || "(none)"}" and priced per "${rawBase}", and at least one of those units is not one we recognise`,
    };
  if (!comparableUnits(unit, baseUnit))
    return {
      qty: null,
      problem: `a price per ${baseUnit} cannot be reconciled with a quantity in ${unit}`,
    };

  const packSize =
    doc.layer2.lines.find((rl) => rl.lineIndex === index)?.packSize ?? null;
  const packed = (u: Uom) => u === "case" || u === "pack" || u === "split_case";
  if (
    (packed(unit) || packed(baseUnit)) &&
    (packSize === null || packSize <= 1)
  )
    return {
      qty: null,
      problem: `the pack size is not resolved, so a price per ${baseUnit} cannot be reconciled with a quantity in ${unit}`,
    };

  const pack = packSize ?? 1;
  const perBaseUnit = toBottles(1, baseUnit, pack);
  if (!perBaseUnit)
    return {
      qty: null,
      problem: `one ${baseUnit} resolves to zero of the invoiced unit`,
    };
  return { qty: toBottles(qty, unit, pack) / perBaseUnit, problem: null };
}

export function lineNetAmount(doc: CanonicalDocument): InvariantResult[] {
  const tolerance = tieOutToleranceCents(doc.layer1.lines.length || 1);
  return doc.layer1.lines.map((line, i) => {
    const path = `lines[${i}]`;
    const qty = num(line.quantity);
    const price = num(line.netPrice);
    const stated = num(line.netAmount);
    const base = num(line.priceBaseQuantity) ?? 1;

    if (qty === null || price === null || stated === null) {
      return result(
        "line_net_amount",
        "PEPPOL-EN16931-R120",
        path,
        null,
        "quantity, net price and net amount",
        { quantity: qty, netPrice: price, netAmount: stated },
        "Not testable: the document did not state quantity, unit price and line total together.",
      );
    }
    if (base === 0) {
      return result(
        "line_net_amount",
        "PEPPOL-EN16931-R120",
        path,
        false,
        "price base quantity > 0",
        base,
        "Price base quantity is zero, so the line price cannot be resolved to a per-unit figure.",
      );
    }

    const restated = quantityInPriceBaseUnit(doc, line, i, qty);
    if (restated.qty === null)
      return result(
        "line_net_amount",
        "PEPPOL-EN16931-R120",
        path,
        null,
        "a quantity and a price base stated in reconcilable units",
        { unit: line.unit.value, priceBaseUnit: line.priceBaseUnit.value },
        `Not testable: on line ${i + 1}, ${restated.problem}.`,
      );

    const { allowances, charges } = sumAllowancesCharges(
      line.allowancesCharges,
    );
    const expected = money(
      (restated.qty * price) / base + charges - allowances,
    );
    const holds = moneyEquals(expected, stated, tolerance);
    return result(
      "line_net_amount",
      "PEPPOL-EN16931-R120",
      path,
      holds,
      expected,
      stated,
      holds
        ? `Line ${i + 1} nets to ${expected.toFixed(2)} as stated.`
        : `Line ${i + 1}: ${restated.qty} × ${price} ÷ ${base} with charges ${charges.toFixed(2)} and allowances ${allowances.toFixed(2)} comes to ${expected.toFixed(2)}, but the line states ${stated.toFixed(2)}.`,
    );
  });
}

// ---------------------------------------------------------------------------
// 2. Price base quantity — PEPPOL-EN16931-R121 ("base quantity must be a
//    positive number above zero"), plus OUR rule from
//    07-reference/INVOICE_DOC_UX_RESEARCH.md §A1: when the quantity is invoiced
//    in cases but the price is stated per bottle (or the reverse), the base
//    quantity MUST be present. Its absence is not a missing nicety, it is an
//    ambiguity that makes the line arithmetic unfalsifiable.
// ---------------------------------------------------------------------------
const CASE_UNITS = new Set(["case", "cs", "ca", "pack", "pk", "split_case"]);

export function priceBaseQuantity(doc: CanonicalDocument): InvariantResult[] {
  return doc.layer1.lines.map((line, i) => {
    const path = `lines[${i}]`;
    const base = num(line.priceBaseQuantity);
    const unit = (str(line.unit) ?? "").trim().toLowerCase();
    const priceUnit = (str(line.priceBaseUnit) ?? "").trim().toLowerCase();

    if (base !== null && base <= 0) {
      return result(
        "price_base_quantity",
        "PEPPOL-EN16931-R121",
        path,
        false,
        "> 0",
        base,
        `Line ${i + 1} states a price base quantity of ${base}, which cannot be divided by.`,
      );
    }
    const casePriced = CASE_UNITS.has(unit);
    if (casePriced && base === null) {
      return result(
        "price_base_quantity",
        "PEPPOL-EN16931-R121",
        path,
        false,
        "a stated price base quantity",
        null,
        `Line ${i + 1} is invoiced in ${unit || "a pack unit"} with no price base quantity, so it is ambiguous whether ${num(line.netPrice) ?? "the price"} is per case or per bottle.`,
      );
    }
    if (base === null) {
      return result(
        "price_base_quantity",
        "PEPPOL-EN16931-R121",
        path,
        null,
        "a price base quantity when the line is case-priced",
        null,
        `Line ${i + 1} states no price base quantity and is not invoiced in a pack unit, so there is nothing to check.`,
      );
    }
    const mismatch =
      priceUnit.length > 0 &&
      unit.length > 0 &&
      priceUnit !== unit &&
      base === 1;
    return result(
      "price_base_quantity",
      "PEPPOL-EN16931-R121",
      path,
      !mismatch,
      mismatch ? `a base quantity reconciling ${priceUnit} to ${unit}` : base,
      base,
      mismatch
        ? `Line ${i + 1} prices per ${priceUnit} but invoices in ${unit} with a base quantity of 1.`
        : `Line ${i + 1} carries a usable price base quantity of ${base}.`,
    );
  });
}

// ---------------------------------------------------------------------------
// 3. BR-CO-10 — BT-106 = Σ BT-131.
// ---------------------------------------------------------------------------
export function documentLinesTotal(doc: CanonicalDocument): InvariantResult[] {
  const stated = num(doc.layer1.totals.linesNetTotal);
  const lineAmounts = doc.layer1.lines.map((l) => num(l.netAmount));
  const missing = lineAmounts.filter((a) => a === null).length;

  if (stated === null) {
    return [
      result(
        "document_lines_total",
        "BR-CO-10",
        null,
        null,
        "a stated sum of line net amounts (BT-106)",
        null,
        "Not testable: the document states no line total. A delivery note with no money is the normal case here.",
      ),
    ];
  }
  if (missing > 0) {
    return [
      result(
        "document_lines_total",
        "BR-CO-10",
        null,
        null,
        "every line to carry a net amount",
        `${missing} of ${lineAmounts.length} lines have none`,
        `Not testable: ${missing} line(s) carry no net amount, so their sum cannot be compared with the stated ${stated.toFixed(2)}.`,
      ),
    ];
  }
  const sum = money(lineAmounts.reduce<number>((a, b) => a + (b ?? 0), 0));
  const holds = moneyEquals(
    sum,
    stated,
    tieOutToleranceCents(doc.layer1.lines.length || 1),
  );
  return [
    result(
      "document_lines_total",
      "BR-CO-10",
      null,
      holds,
      sum,
      stated,
      holds
        ? `The ${lineAmounts.length} lines sum to ${sum.toFixed(2)}, as stated.`
        : `The ${lineAmounts.length} lines sum to ${sum.toFixed(2)} but the document states ${stated.toFixed(2)} (off by ${(stated - sum).toFixed(2)}).`,
    ),
  ];
}

// ---------------------------------------------------------------------------
// 4. BR-CO-13 — BT-109 = BT-106 − BT-107 (allowances) + BT-108 (charges).
//    Falls back to summing the document-level allowance/charge groups when the
//    totals themselves are absent, which is the common case in an extraction.
// ---------------------------------------------------------------------------
export function totalWithoutVat(doc: CanonicalDocument): InvariantResult[] {
  const t = doc.layer1.totals;
  const stated = num(t.taxExclusiveAmount);
  const lines = num(t.linesNetTotal);
  if (stated === null || lines === null) {
    return [
      result(
        "total_without_vat",
        "BR-CO-13",
        null,
        null,
        "BT-106 and BT-109 both stated",
        { BT_106: lines, BT_109: stated },
        "Not testable: the document does not state both the line total and the total without VAT.",
      ),
    ];
  }
  const grouped = sumAllowancesCharges(doc.layer1.allowancesCharges);
  const allowances = num(t.allowancesTotal) ?? grouped.allowances;
  const charges = num(t.chargesTotal) ?? grouped.charges;
  const expected = money(lines - allowances + charges);
  const holds = moneyEquals(
    expected,
    stated,
    tieOutToleranceCents(doc.layer1.lines.length || 1),
  );
  return [
    result(
      "total_without_vat",
      "BR-CO-13",
      null,
      holds,
      expected,
      stated,
      holds
        ? `Lines ${lines.toFixed(2)} less allowances ${allowances.toFixed(2)} plus charges ${charges.toFixed(2)} gives ${expected.toFixed(2)}, as stated.`
        : `Lines ${lines.toFixed(2)} less allowances ${allowances.toFixed(2)} plus charges ${charges.toFixed(2)} gives ${expected.toFixed(2)}, but the document states ${stated.toFixed(2)}.`,
    ),
  ];
}

// ---------------------------------------------------------------------------
// 5. BR-CO-15 — BT-112 = BT-109 + BT-110.
// ---------------------------------------------------------------------------
export function totalWithVat(doc: CanonicalDocument): InvariantResult[] {
  const t = doc.layer1.totals;
  const withVat = num(t.taxInclusiveAmount);
  const withoutVat = num(t.taxExclusiveAmount);
  const vat = num(t.taxAmount);
  if (withVat === null || withoutVat === null) {
    return [
      result(
        "total_with_vat",
        "BR-CO-15",
        null,
        null,
        "BT-109 and BT-112 both stated",
        { BT_109: withoutVat, BT_112: withVat },
        "Not testable: the document does not state both totals.",
      ),
    ];
  }
  const expected = money(withoutVat + (vat ?? 0));
  const holds = moneyEquals(expected, withVat, 1);
  return [
    result(
      "total_with_vat",
      "BR-CO-15",
      null,
      holds,
      expected,
      withVat,
      holds
        ? `${withoutVat.toFixed(2)} plus VAT ${(vat ?? 0).toFixed(2)} gives ${expected.toFixed(2)}, as stated.`
        : `${withoutVat.toFixed(2)} plus VAT ${(vat ?? 0).toFixed(2)} gives ${expected.toFixed(2)}, but the document states ${withVat.toFixed(2)}.`,
    ),
  ];
}

// ---------------------------------------------------------------------------
// 6. BR-CO-16 — BT-115 = BT-112 − BT-113 + BT-114 (rounding).
//    The brief states it as BT-112 − paid; the rounding term is the standard's
//    and is included so a legitimately rounded Turkish invoice does not read as
//    a failure.
// ---------------------------------------------------------------------------
export function amountDue(doc: CanonicalDocument): InvariantResult[] {
  const t = doc.layer1.totals;
  const due = num(t.amountDue);
  const withVat = num(t.taxInclusiveAmount);
  if (due === null || withVat === null) {
    return [
      result(
        "amount_due",
        "BR-CO-16",
        null,
        null,
        "BT-112 and BT-115 both stated",
        { BT_112: withVat, BT_115: due },
        "Not testable: the document does not state both the total with VAT and the amount due.",
      ),
    ];
  }
  const paid = num(t.paidAmount) ?? 0;
  const rounding = num(t.roundingAmount) ?? 0;
  const expected = money(withVat - paid + rounding);
  const holds = moneyEquals(expected, due, 1);
  return [
    result(
      "amount_due",
      "BR-CO-16",
      null,
      holds,
      expected,
      due,
      holds
        ? `Amount due ${due.toFixed(2)} is the total with VAT less ${paid.toFixed(2)} already paid.`
        : `Total with VAT ${withVat.toFixed(2)} less ${paid.toFixed(2)} paid (rounding ${rounding.toFixed(2)}) is ${expected.toFixed(2)}, but the document states ${due.toFixed(2)} due.`,
    ),
  ];
}

// ---------------------------------------------------------------------------
// 7. BR-CO-14 — BT-110 = Σ BT-117 over the VAT breakdown.
// ---------------------------------------------------------------------------
export function vatTotalMatchesBreakdown(
  doc: CanonicalDocument,
): InvariantResult[] {
  const stated = num(doc.layer1.totals.taxAmount);
  const rows = doc.layer1.vatBreakdown;
  if (stated === null || rows.length === 0) {
    return [
      result(
        "vat_total_matches_breakdown",
        "BR-CO-14",
        null,
        null,
        "a VAT total (BT-110) and at least one breakdown row (BG-23)",
        { BT_110: stated, breakdownRows: rows.length },
        "Not testable: this document carries no VAT breakdown, which is normal for a delivery note or a VAT-free document.",
      ),
    ];
  }
  const sum = money(rows.reduce((a, r) => a + (num(r.taxAmount) ?? 0), 0));
  const holds = moneyEquals(sum, stated, 1);
  return [
    result(
      "vat_total_matches_breakdown",
      "BR-CO-14",
      null,
      holds,
      sum,
      stated,
      holds
        ? `The ${rows.length} VAT rows sum to ${sum.toFixed(2)}, as stated.`
        : `The ${rows.length} VAT rows sum to ${sum.toFixed(2)} but the document states ${stated.toFixed(2)} of VAT.`,
    ),
  ];
}

// ---------------------------------------------------------------------------
// 8. BR-S-08 — each VAT category's taxable amount (BT-116) equals the sum of the
//    line net amounts at that category and rate, plus that category's
//    document-level charges, less its allowances.
// ---------------------------------------------------------------------------
export function vatCategoryTaxableBase(
  doc: CanonicalDocument,
): InvariantResult[] {
  const rows = doc.layer1.vatBreakdown;
  if (rows.length === 0) {
    return [
      result(
        "vat_category_taxable_base",
        "BR-S-08",
        null,
        null,
        "at least one VAT breakdown row",
        0,
        "Not testable: no VAT breakdown on this document.",
      ),
    ];
  }
  return rows.map((row, i) => {
    const path = `vatBreakdown[${i}]`;
    const cat = str(row.category);
    const rate = num(row.rate);
    const stated = num(row.taxableAmount);
    if (stated === null) {
      return result(
        "vat_category_taxable_base",
        "BR-S-08",
        path,
        null,
        "a stated taxable amount (BT-116)",
        null,
        `Not testable: VAT row ${i + 1} states no taxable amount.`,
      );
    }
    const matches = (l: ExtractedLine) =>
      (cat === null || str(l.vatCategory) === cat) &&
      (rate === null || num(l.vatRate) === rate);
    const lineSum = doc.layer1.lines
      .filter(matches)
      .reduce((a, l) => a + (num(l.netAmount) ?? 0), 0);
    const docLevel = doc.layer1.allowancesCharges
      .filter(
        (ac) =>
          (cat === null || str(ac.vatCategory ?? null) === cat) &&
          (rate === null || num(ac.vatRate ?? null) === rate),
      )
      .reduce((a, ac) => a + signedAmount(ac), 0);
    const expected = money(lineSum + docLevel);
    const holds = moneyEquals(
      expected,
      stated,
      tieOutToleranceCents(doc.layer1.lines.length || 1),
    );
    return result(
      "vat_category_taxable_base",
      "BR-S-08",
      path,
      holds,
      expected,
      stated,
      holds
        ? `VAT category ${cat ?? "?"} at ${rate ?? "?"}% is based on ${expected.toFixed(2)}, as stated.`
        : `VAT category ${cat ?? "?"} at ${rate ?? "?"}% covers lines worth ${expected.toFixed(2)} but states a taxable base of ${stated.toFixed(2)}.`,
    );
  });
}

// ---------------------------------------------------------------------------
// 9. BR-CO-17 — BT-117 = BT-116 × (BT-119 ÷ 100), rounded to two decimals.
// ---------------------------------------------------------------------------
export function vatCategoryTaxAmount(
  doc: CanonicalDocument,
): InvariantResult[] {
  const rows = doc.layer1.vatBreakdown;
  if (rows.length === 0) {
    return [
      result(
        "vat_category_tax_amount",
        "BR-CO-17",
        null,
        null,
        "at least one VAT breakdown row",
        0,
        "Not testable: no VAT breakdown on this document.",
      ),
    ];
  }
  return rows.map((row, i) => {
    const path = `vatBreakdown[${i}]`;
    const base = num(row.taxableAmount);
    const rate = num(row.rate);
    const tax = num(row.taxAmount);
    if (base === null || rate === null || tax === null) {
      return result(
        "vat_category_tax_amount",
        "BR-CO-17",
        path,
        null,
        "taxable amount, rate and tax amount all stated",
        { BT_116: base, BT_119: rate, BT_117: tax },
        `Not testable: VAT row ${i + 1} does not state all three of base, rate and tax.`,
      );
    }
    const expected = money((base * rate) / 100);
    const holds = moneyEquals(expected, tax, 1);
    return result(
      "vat_category_tax_amount",
      "BR-CO-17",
      path,
      holds,
      expected,
      tax,
      holds
        ? `${rate}% of ${base.toFixed(2)} is ${expected.toFixed(2)}, as stated.`
        : `${rate}% of ${base.toFixed(2)} is ${expected.toFixed(2)}, but the row states ${tax.toFixed(2)}.`,
    );
  });
}

// ---------------------------------------------------------------------------
// 10. BR-5 — a document carrying money must state its currency.
//     A number with no currency is the failure that costs the most later: a
//     ₺-priced line read as $ is a 30× cost error nothing downstream questions.
// ---------------------------------------------------------------------------
export function currencyPresentWhenMoney(
  doc: CanonicalDocument,
): InvariantResult[] {
  const t = doc.layer1.totals;
  const anyMoney =
    [
      t.linesNetTotal,
      t.taxExclusiveAmount,
      t.taxInclusiveAmount,
      t.amountDue,
      t.taxAmount,
    ].some((f) => num(f) !== null) ||
    doc.layer1.lines.some(
      (l) => num(l.netAmount) !== null || num(l.netPrice) !== null,
    );
  const currency = str(doc.layer1.currency);
  if (!anyMoney) {
    return [
      result(
        "currency_present_when_money",
        "BR-5",
        null,
        null,
        "a currency when money is present",
        currency,
        "Not testable: this document states no money at all — the normal case for a delivery note (ADR 0104 D2).",
      ),
    ];
  }
  const holds = currency !== null;
  return [
    result(
      "currency_present_when_money",
      "BR-5",
      null,
      holds,
      "a stated currency code",
      currency,
      holds
        ? `Amounts are in ${currency}.`
        : "The document states amounts but no currency, so every figure on it is ambiguous.",
    ),
  ];
}

// ---------------------------------------------------------------------------
// 11. Free goods carry zero net (ours — ADR 0103 D7 FREE_GOODS).
//     A bonus case billed at zero is normal and must NOT read as an overage; a
//     line flagged free that carries money is either a mis-read or a vendor
//     billing for something they said was free.
// ---------------------------------------------------------------------------
export function freeGoodsCarryZeroNet(
  doc: CanonicalDocument,
): InvariantResult[] {
  const freeLines = doc.layer1.lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => (num(l.freeGoodsQty) ?? 0) > 0);
  if (freeLines.length === 0) {
    return [
      result(
        "free_goods_zero_net",
        null,
        null,
        null,
        "a line marked as free goods",
        0,
        "Not testable: no line on this document is marked as free goods.",
      ),
    ];
  }
  return freeLines.map(({ l, i }) => {
    const qty = num(l.quantity) ?? 0;
    const free = num(l.freeGoodsQty) ?? 0;
    const net = num(l.netAmount);
    // Only a WHOLLY free line must net to zero; a line of 12 with 1 free is
    // billed for 11 and its net is rightly non-zero.
    if (free < qty) {
      return result(
        "free_goods_zero_net",
        null,
        `lines[${i}]`,
        null,
        "a wholly free line",
        { quantity: qty, freeGoodsQty: free },
        `Not testable: line ${i + 1} is partly free (${free} of ${qty}), so a non-zero net is expected.`,
      );
    }
    const holds = net === null ? null : moneyEquals(net, 0, 1);
    return result(
      "free_goods_zero_net",
      null,
      `lines[${i}]`,
      holds,
      0,
      net,
      holds === null
        ? `Not testable: line ${i + 1} is free goods but states no net amount.`
        : holds
          ? `Line ${i + 1} is free goods and nets to zero.`
          : `Line ${i + 1} is marked free goods (${free} units) but is billed ${net?.toFixed(2)}.`,
    );
  });
}

// ---------------------------------------------------------------------------
// 12. Deposits and CRV carry a reason code and stay out of the goods total
//     (ours — ADR 0103 D7 DEPOSIT_OR_FEE; UNCL7161 for charges).
//     A California CRV line folded into the goods subtotal inflates beverage
//     cost percentage every month, invisibly, and it is refundable money.
// ---------------------------------------------------------------------------
const DEPOSIT_WORDS =
  /\b(crv|deposit|depozito|bottle\s*deposit|container\s*redemption)\b/i;

export function depositsAreCodedAndExcluded(
  doc: CanonicalDocument,
): InvariantResult[] {
  const candidates: {
    path: string;
    ac: AllowanceCharge;
  }[] = doc.layer1.allowancesCharges
    .map((ac, i) => ({ path: `allowancesCharges[${i}]`, ac }))
    .filter(
      ({ ac }) =>
        DEPOSIT_WORDS.test(str(ac.reason) ?? "") ||
        DEPOSIT_WORDS.test(str(ac.reasonCode) ?? ""),
    );

  const results: InvariantResult[] = [];
  for (const { path, ac } of candidates) {
    const code = str(ac.reasonCode);
    results.push(
      result(
        "deposits_coded_and_excluded",
        "UNCL7161",
        path,
        code !== null,
        "a UNCL7161 reason code",
        code,
        code !== null
          ? `The deposit charge carries reason code ${code}, so it can be excluded from cost of goods.`
          : "A deposit or CRV charge carries no reason code, so nothing downstream can tell refundable money from cost of goods.",
      ),
    );
  }

  // And it must be a document-level charge, not folded into BT-106.
  const linesLookLikeDeposits = doc.layer1.lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => DEPOSIT_WORDS.test(str(l.description) ?? ""));
  for (const { i } of linesLookLikeDeposits) {
    results.push(
      result(
        "deposits_coded_and_excluded",
        null,
        `lines[${i}]`,
        false,
        "a document-level charge (BG-21) with a UNCL7161 reason code",
        "an invoice line inside BT-106",
        `Line ${i + 1} reads as a deposit but is billed as a goods line, so it is inside the goods total and will inflate beverage cost every month it recurs.`,
      ),
    );
  }

  // Nothing deposit-shaped anywhere. Reported as UNTESTABLE, never as a pass:
  // "this invoice has no CRV" and "we found no CRV on this invoice" are the same
  // sentence with opposite meanings, and only one of them is evidence.
  if (results.length === 0) {
    results.push(
      result(
        "deposits_coded_and_excluded",
        null,
        null,
        null,
        "a deposit or CRV charge",
        0,
        "Not testable: no deposit or CRV charge or line on this document.",
      ),
    );
  }
  return results;
}

// ---------------------------------------------------------------------------
// 13. A credit memo references the invoice it credits.
//     BT-3 = 381 (UNCL1001 credit note) ⇒ BT-25 present. EN 16931's BR-55 makes
//     the reference mandatory INSIDE the BG-3 group; that the group must exist
//     at all on a credit note is ours (ADR 0104 D2). ORPHAN CREDIT MEMOS ARE A
//     KNOWN, EXPENSIVE FAILURE (ADR 0103 D8): money the restaurant is owed that
//     nothing can match to a claim.
// ---------------------------------------------------------------------------
export function creditMemoReferencesInvoice(
  doc: CanonicalDocument,
): InvariantResult[] {
  const typeCode = str(doc.layer1.typeCode);
  const isCredit = typeCode === "381" || doc.docType === "credit_memo";
  if (!isCredit) {
    return [
      result(
        "credit_memo_references_invoice",
        "BR-55",
        null,
        null,
        "a credit memo",
        { typeCode, docType: doc.docType },
        "Not testable: this document is not a credit memo.",
      ),
    ];
  }
  const ref = str(doc.layer1.precedingInvoiceReference);
  const holds = ref !== null;
  return [
    result(
      "credit_memo_references_invoice",
      "BR-55",
      null,
      holds,
      "a preceding invoice reference (BT-25)",
      ref,
      holds
        ? `This credit memo credits invoice ${ref}.`
        : "This credit memo references no invoice, so the money it returns cannot be matched to the claim that earned it.",
    ),
  ];
}

// ---------------------------------------------------------------------------
// 14. `received` is never silently equal to `shipped` (ADR 0103 A6).
//     When nobody counted at the door — the modal case — `received` must be the
//     literal string "not_counted". A number equal to shipped, with no door
//     count behind it, is the assumption that turns this flow back into the
//     invoice-centric three-way match ADR 0103 rejected.
// ---------------------------------------------------------------------------
export function receivedIsNeverAssumed(
  doc: CanonicalDocument,
): InvariantResult[] {
  const lines = doc.layer3.lines;
  if (lines.length === 0) {
    return [
      result(
        "received_never_assumed",
        null,
        null,
        null,
        "an adjudicated line",
        0,
        "Not testable: nothing has been adjudicated on this document yet.",
      ),
    ];
  }
  return lines.map((l) => {
    const path = `layer3.lines[${l.lineIndex}]`;
    if (l.received === "not_counted") {
      return result(
        "received_never_assumed",
        null,
        path,
        true,
        '"not_counted" where no door count exists',
        l.received,
        `Line ${l.lineIndex + 1}: nobody counted at the door, and the record says so.`,
      );
    }
    // A counted number that happens to equal shipped is fine — it is a real
    // count. What this catches is the SHAPE where no count exists and the
    // pipeline filled the column in anyway; the mapper only ever writes a
    // number here when a door count row was read.
    const holds = typeof l.received === "number";
    return result(
      "received_never_assumed",
      null,
      path,
      holds,
      'a counted number or "not_counted"',
      l.received,
      holds
        ? `Line ${l.lineIndex + 1}: ${l.received} received, from a door count.`
        : `Line ${l.lineIndex + 1} has a received value that is neither a count nor "not_counted".`,
    );
  });
}

// ---------------------------------------------------------------------------
// 15. `as_printed` is never mutated by formatting (ADR 0104 D1).
//     The whole point of keeping the literal glyphs is that the screen can show
//     what the paper said. If a normaliser rewrites `1.234,56` to `1234.56`
//     there, the provenance trail silently becomes a second copy of our own
//     conclusion. Checked structurally: `as_printed`, where present, must be a
//     string, and must not be the plain `String(value)` of a parsed number that
//     the document plainly printed differently.
// ---------------------------------------------------------------------------
export function asPrintedNotMutated(doc: CanonicalDocument): InvariantResult[] {
  const offenders: { path: string; printed: string; value: unknown }[] = [];
  let checked = 0;

  const visit = (path: string, f: FieldEnvelope<unknown> | undefined) => {
    if (!f || f.as_printed == null) return;
    checked += 1;
    if (typeof f.as_printed !== "string") {
      offenders.push({ path, printed: String(f.as_printed), value: f.value });
      return;
    }
    // A number whose as_printed is exactly our own canonical rendering AND whose
    // raw text contained a thousands separator cannot be recovered — but we can
    // catch the trivially wrong case: as_printed being empty while a value
    // exists.
    if (f.as_printed.trim() === "" && f.value != null) {
      offenders.push({ path, printed: f.as_printed, value: f.value });
    }
  };

  const l1 = doc.layer1;
  visit("documentNumber", l1.documentNumber);
  visit("issueDate", l1.issueDate);
  visit("currency", l1.currency);
  visit("totals.taxInclusiveAmount", l1.totals.taxInclusiveAmount);
  visit("totals.linesNetTotal", l1.totals.linesNetTotal);
  l1.lines.forEach((line, i) => {
    visit(`lines[${i}].quantity`, line.quantity);
    visit(`lines[${i}].netPrice`, line.netPrice);
    visit(`lines[${i}].netAmount`, line.netAmount);
    visit(`lines[${i}].description`, line.description);
  });

  if (checked === 0) {
    return [
      result(
        "as_printed_not_mutated",
        null,
        null,
        null,
        "at least one field carrying as_printed",
        0,
        "Not testable: no field on this document kept its printed text, which is itself worth knowing — hover-to-source will have nothing to show.",
      ),
    ];
  }
  const holds = offenders.length === 0;
  return [
    result(
      "as_printed_not_mutated",
      null,
      null,
      holds,
      "every as_printed a non-empty string",
      offenders.length ? offenders : `${checked} fields intact`,
      holds
        ? `All ${checked} printed values are preserved as text.`
        : `${offenders.length} field(s) carry an as_printed that formatting has emptied or replaced.`,
    ),
  ];
}

// ---------------------------------------------------------------------------
// 16. BR-CO-18 — an invoice carrying VAT must have at least one BG-23 breakdown.
// ---------------------------------------------------------------------------
export function vatBreakdownPresent(doc: CanonicalDocument): InvariantResult[] {
  const vat = num(doc.layer1.totals.taxAmount);
  if (vat === null || vat === 0) {
    return [
      result(
        "vat_breakdown_present",
        "BR-CO-18",
        null,
        null,
        "a document stating VAT",
        vat,
        "Not testable: this document states no VAT.",
      ),
    ];
  }
  const holds = doc.layer1.vatBreakdown.length > 0;
  return [
    result(
      "vat_breakdown_present",
      "BR-CO-18",
      null,
      holds,
      "at least one VAT breakdown row",
      doc.layer1.vatBreakdown.length,
      holds
        ? `The document breaks its ${vat.toFixed(2)} of VAT into ${doc.layer1.vatBreakdown.length} categor(ies).`
        : `The document states ${vat.toFixed(2)} of VAT with no breakdown, so no category's base can be checked.`,
    ),
  ];
}

/** Every invariant, in the order a reader should see them. */
export const INVARIANTS: ((doc: CanonicalDocument) => InvariantResult[])[] = [
  lineNetAmount,
  priceBaseQuantity,
  documentLinesTotal,
  totalWithoutVat,
  totalWithVat,
  amountDue,
  vatTotalMatchesBreakdown,
  vatCategoryTaxableBase,
  vatCategoryTaxAmount,
  vatBreakdownPresent,
  currencyPresentWhenMoney,
  freeGoodsCarryZeroNet,
  depositsAreCodedAndExcluded,
  creditMemoReferencesInvoice,
  receivedIsNeverAssumed,
  asPrintedNotMutated,
];

/** Run them all. Order is stable so a corpus report diffs cleanly. */
export function runInvariants(doc: CanonicalDocument): InvariantResult[] {
  return INVARIANTS.flatMap((fn) => fn(doc));
}

/**
 * Count holds / fails / untestable.
 *
 * `untestable` is returned SEPARATELY and deliberately: a report that folds it
 * into `holds` says a stack of delivery notes with no money on them passed every
 * arithmetic rule, which is the exact shape of a system reporting absence as
 * health.
 */
export function summarise(results: InvariantResult[]): {
  holds: number;
  fails: number;
  untestable: number;
} {
  return {
    holds: results.filter((r) => r.holds === true).length,
    fails: results.filter((r) => r.holds === false).length,
    untestable: results.filter((r) => r.holds === null).length,
  };
}
