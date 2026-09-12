import { comparableUnits, DocType, toBottles, Uom } from "./document-types";

/**
 * What a line IS, as the paper presents it.
 *
 * `goods` is the default and the overwhelming case. The other two exist because
 * a returnable-container deposit and a delivery fee are frequently printed AS
 * LINES — the Turkish invoice read on 2026-09-04 prints its ₺180 depozito as
 * line 4 and again as a subtotal row — and a line that IS the deposit must not
 * be counted inside BT-106 goods, or every month's beverage-cost percentage is
 * inflated by refundable money (ADR 0103 D7 `DEPOSIT_OR_FEE`).
 *
 * THIS IS NOT `ParsedLine.deposit`. That field is a deposit charged ON a goods
 * line IN ADDITION to its net — twelve bottles of wine plus ₺5 per bottle of
 * crate deposit. The two are added in opposite directions and the extractor
 * prompt states the distinction.
 */
export const LINE_KINDS = ["goods", "deposit", "fee"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

/** One row of BG-23, as the paper prints it, before any canonical mapping. */
export interface ParsedTaxBreakdownRow {
  /** BT-119 — the rate as a percentage: 20 for `KDV %20`, 8.625 for `8.625%`. */
  rate: number | null;
  /** BT-116 — the amount that rate was applied TO (`matrah`). */
  taxableBase: number | null;
  /** BT-117 — the tax that rate produced. */
  amount: number | null;
  /** BT-118 — the VAT category code (S, Z, E, AE, K, G, O), when printed. */
  category?: string | null;
}

/**
 * ParsedDocument — what every intake channel produces, and the ONLY thing the
 * rest of procurement consumes.
 *
 * A vendor document reaches us as an X12 810, an emailed PDF, a photograph taken
 * in a stairwell, or a file dropped on SFTP. Those are wildly different problems
 * — but only at the edge. Everything downstream (line matching, the four-way
 * match, the credit ledger) must be unable to tell which one it is looking at,
 * because the moment a verdict depends on the channel, "we photographed it" and
 * "they sent it electronically" start producing different answers about the same
 * delivery, and the restaurant loses the argument with its distributor.
 *
 * A parse is a PROPOSAL. Nothing here has touched inventory, the ledger, or an
 * order. `confidence` and `warnings` exist so a human sees what the machine was
 * unsure about instead of discovering it in a cost report three months later.
 */

export interface ParsedLine {
  lineNo: number;
  vendorSku?: string | null;
  description?: string | null;
  vintage?: number | null;
  formatMl?: number | null;

  /** Quantity in the unit the document stated it in. */
  qty: number;
  uom: Uom;
  /** Bottles per case/pack. 1 when the document sells by the bottle. */
  packSize: number;
  /** Bottle-equivalent. Every quantity comparison uses this, never `qty`. */
  qtyBottles: number;
  /** Units supplied free under an agreed deal, so a bonus is not an overage. */
  freeGoodsQty: number;

  unitPrice?: number | null;
  lineTotal?: number | null;
  /** Post-offs, depletion allowances, bill-backs. A discount, not an error. */
  allowance?: number | null;
  /**
   * A deposit charged on THIS line IN ADDITION to its net — the ₺5-per-bottle
   * crate charge printed beside twelve bottles of wine. It ADDS to the line.
   *
   * A line that IS the deposit carries `lineKind: "deposit"` and no `deposit`
   * amount: the line's own `lineTotal` is the deposit, and adding the figure
   * twice is exactly the failure the 2026-09-04 corpus run named
   * (`line_net_amount` expected 360 against a stated 180).
   */
  deposit?: number | null;

  /**
   * What the line IS. Absent means the parser did not classify it, which the
   * mapper reads as `goods` unless the description says otherwise — never as a
   * confident claim that a CRV row is wine.
   */
  lineKind?: LineKind | null;

  /**
   * BT-149 — the quantity `unitPrice` is stated FOR, when the document prints
   * one. `142,00 / KS(12)` is a price base of 12; a plain per-bottle price is 1
   * or null. NULL MEANS THE PAPER DID NOT SAY, never "assume one unit made of
   * twelve" — the same rule `packSize` already carries, and for the same reason:
   * a guessed twelve is wrong by a factor of twelve.
   */
  priceBaseQty: number | null;
  /** BT-150 — the unit `priceBaseQty` is counted in. Null when not printed. */
  priceBaseUom: Uom | null;

  /**
   * The literal glyphs the document printed, keyed by the field they belong to
   * (`qty`, `unitPrice`, `lineTotal`, `allowance`, `deposit`).
   *
   * ADR 0104 D1: the screen must be able to show `142,00 / KS(12)` beside the
   * 142 we concluded. NOTHING here is ever reformatted — a normaliser that
   * rewrote `1.234,56` to `1234.56` would turn the provenance trail into a
   * second copy of our own answer. ABSENT means we did not keep it; it never
   * means the paper was blank.
   */
  printed?: Record<string, string>;

  /** Purchase order this line cites, when the document says so. */
  poNumber?: string | null;
}

export interface ParsedDocument {
  docType: DocType;
  /** Vendor's own number — what their AR desk quotes on the phone. */
  docNumber?: string | null;
  docDate?: string | null;
  /**
   * BG-13 / BT-72 — the date the goods were actually DELIVERED, when the paper
   * prints one ("DELIVERED Aug 12, 2026"; `TESLİM TARİHİ`; the date printed
   * against a referenced irsaliye when that date is presented as the delivery).
   *
   * NOT `docDate`. §A11 of the invoice research: a Turkish invoice is issued up
   * to seven days after the despatch it bills, and every response-window clock
   * in ADR 0103 A8 runs from delivery, not from issuance. NULL means the paper
   * printed no delivery date — never "assume the invoice date".
   */
  deliveredDate?: string | null;
  /** An 810 cites the 856/850 it bills for; following that chain self-assembles a delivery. */
  referencesDocNumber?: string | null;
  poNumber?: string | null;

  vendorName?: string | null;
  /** Vendor's own account number for this restaurant, when stated. */
  vendorAccount?: string | null;

  currency: string;
  subtotal?: number | null;
  freight?: number | null;
  fuelSurcharge?: number | null;
  splitCaseFee?: number | null;
  deliveryFee?: number | null;
  depositTotal?: number | null;
  tax?: number | null;
  otherCharges?: number | null;
  discountTotal?: number | null;
  total?: number | null;

  /**
   * BG-23 — the VAT breakdown, one row per (category, rate), as printed.
   *
   * `tax` alone is one number and cannot be checked against anything: BR-CO-14,
   * BR-S-08 and BR-CO-17 all need a rate and the base it was applied to. A
   * document that prints ONE tax line with a rate and a base
   * (`KDV %20 (matrah 9.172,00) 1.834,40`, `Sales tax 8.625% on 2,940.00`)
   * yields ONE row here — a single row is a breakdown, not an absence.
   *
   * ABSENT means the paper printed no rate/base pair. It never means zero VAT,
   * and the mapper does not fabricate a row that would reproduce the total.
   */
  taxBreakdown?: ParsedTaxBreakdownRow[];

  lines: ParsedLine[];

  /**
   * Arithmetic self-check. A model that hallucinated a quantity, or a mis-scaled
   * implied-decimal field, usually breaks the sum — so this is a free,
   * deterministic detector for the failure mode that matters most. It is also
   * what lets a bookkeeper tie our number to the vendor's statement, without
   * which they keep keying the invoice by hand and the customer pays twice.
   */
  computedLinesTotal: number | null;
  tieOutDelta: number | null;
  tiesOut: boolean | null;

  /** 0..1. Never used to auto-accept anything; it decides what a human sees first. */
  confidence: number;
  /** Human-readable reasons this parse might be wrong. Surfaced, never swallowed. */
  warnings: string[];

  /**
   * Printed literals for the DOCUMENT's own money fields (`total`, `subtotal`,
   * `tax`, `freight`, …). Same contract as `ParsedLine.printed`.
   */
  printed?: Record<string, string>;

  /**
   * Which model read this document (ADR 0059).
   *
   * `procurement_documents.extraction_model` has existed since the document
   * spine and had no writer at all, so every row said NULL — which reads as
   * "no model was involved" rather than "nobody recorded which one". The
   * extractor always knew the value; it simply never travelled this far.
   *
   * NULL is honest and load-bearing: an EDI parse and an unreadable document
   * genuinely had no model.
   */
  extractionModel?: string | null;

  /**
   * The neural-footprint row id for the extraction call, once its
   * fire-and-forget emit lands (ADR 0059). NULL when the emit was dropped or
   * there was no model call — attribution is lost, the document is not.
   */
  eventId?: string | null;
}

/** Money comparison in cents, so 528.0000001 !== 528 never fires. */
export function moneyEquals(a: number, b: number, toleranceCents = 1): boolean {
  return Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= toleranceCents;
}

/**
 * Tolerance is one cent per line rather than a flat cent: vendors round per line
 * and the rounding accumulates, so a 40-line invoice can legitimately be off by
 * a few cents while a 2-line one cannot. A flat tolerance would either cry wolf
 * on long invoices or wave through real errors on short ones.
 *
 * Exported because the `reconciliation_v1` doneability verdict (OD-59) records
 * the tolerance it judged against as evidence. Two copies of this rule would
 * drift, and the verdict would then cite a threshold it did not actually use.
 */
export function tieOutToleranceCents(lineCount: number): number {
  return Math.max(1, lineCount);
}

/**
 * A line's net from its price and quantity, honouring the printed price base.
 *
 * WHY THIS IS NOT `unitPrice × qty`. EN 16931 states the rule as
 * `BT-131 = BT-129 × (BT-146 ÷ BT-149)`: the price is stated FOR some quantity
 * (BT-149) in some unit (BT-150), and the invoiced quantity is stated in its own
 * unit (BT-130). When those two units differ — a Turkish invoice reading
 * `12 şişe @ 142,00 / KS(12)` — the naive product is 1.704,00 against a real
 * 142,00. That factor of twelve is the single most expensive silent error in
 * beverage receiving, and nothing downstream can see it.
 *
 * HOW packSize AND qtyBottles FIT. Dividing by BT-149 alone is not enough
 * either: `2 KS @ 264,00 / KS(12)` divided naively is 2 ÷ 12 × 264 = 44,00. The
 * quantity has to be expressed in the price base's OWN unit first, and
 * `packSize` (bottles per case) is the only conversion we have. So both sides
 * go to bottle-equivalents through the existing `toBottles`, and the ratio
 * between them is dimensionless:
 *
 *     net = toBottles(qty, uom, packSize) ÷ toBottles(base, baseUom, packSize)
 *           × unitPrice
 *
 * Both real arrangements come out right: quantity in cases (2 KS → 24 bottles,
 * base 12 bottles → 2 × 264 = 528,00) and quantity in bottles (12 şişe → 12
 * bottles, base 12 bottles → 1 × 142 = 142,00).
 *
 * IT REFUSES RATHER THAN GUESSING. A case quantity against a bottle price base
 * with no stated pack size, a base of zero, and a keg quantity against a bottle
 * base are all unresolvable. Each returns `net: null` WITH a `problem`, because
 * a silent 0 would move the discrepancy onto the document total and send a
 * bookkeeper to argue the wrong number.
 */
export interface PriceBaseResolution {
  /** The line net before allowances, or null when it cannot be computed. */
  net: number | null;
  /** Why not, when `net` is null and the reason is not simply "no price". */
  problem: string | null;
}

/** Units whose bottle-equivalent depends on packSize. */
const PACKED_UNITS = new Set<Uom>(["case", "pack", "split_case"]);

export function lineNetFromPrice(l: ParsedLine): PriceBaseResolution {
  const none: PriceBaseResolution = { net: null, problem: null };
  if (l.unitPrice == null || !Number.isFinite(l.unitPrice)) return none;

  const base = l.priceBaseQty;
  // No printed base: the price is per invoiced unit. This is what the extractor
  // has always assumed; it is now stated instead of implied.
  if (base == null) return { net: l.unitPrice * l.qty, problem: null };

  if (!Number.isFinite(base) || base <= 0)
    return {
      net: null,
      problem: `price base quantity of ${base} cannot be divided by`,
    };

  const baseUom = l.priceBaseUom ?? l.uom;
  if (baseUom === l.uom)
    return { net: (l.qty / base) * l.unitPrice, problem: null };

  if (!comparableUnits(l.uom, baseUom))
    return {
      net: null,
      problem: `a price stated per ${baseUom} cannot be reconciled with a quantity in ${l.uom}`,
    };

  // Different units, and the conversion between them IS the pack size. A
  // packSize of 1 on a packed unit means the document never stated it.
  const packUnknown =
    l.packSize <= 1 && (PACKED_UNITS.has(l.uom) || PACKED_UNITS.has(baseUom));
  if (packUnknown)
    return {
      net: null,
      problem: `the pack size is not stated, so a price per ${baseUom} cannot be reconciled with a quantity in ${l.uom}`,
    };

  const qtyEquiv = toBottles(l.qty, l.uom, l.packSize);
  const baseEquiv = toBottles(base, baseUom, l.packSize);
  if (!baseEquiv)
    return {
      net: null,
      problem: `price base quantity of ${base} ${baseUom} resolves to zero`,
    };
  return { net: (qtyEquiv / baseEquiv) * l.unitPrice, problem: null };
}

/** True when this line IS a deposit rather than a line carrying one. */
export function isDepositLine(l: ParsedLine): boolean {
  return l.lineKind === "deposit";
}

/** What one line contributes, before allowances. */
function lineContribution(
  l: ParsedLine,
  index: number,
  problems: string[],
): number {
  if (l.lineTotal != null)
    return Number.isFinite(l.lineTotal) ? l.lineTotal : 0;
  const { net, problem } = lineNetFromPrice(l);
  // Surfaced, never swallowed: a line that could not be resolved contributes
  // 0, and without this the tie-out would blame the document TOTAL for a
  // problem that lives in the line.
  if (problem)
    problems.push(
      `Line ${index + 1}: the printed price base could not be applied — ${problem}.`,
    );
  const lt = (net ?? 0) - (l.allowance ?? 0);
  return Number.isFinite(lt) ? lt : 0;
}

/** Fill in computedLinesTotal / tieOutDelta / tiesOut. */
export function applyTieOut(doc: ParsedDocument): ParsedDocument {
  const priceBaseProblems: string[] = [];

  /**
   * THE DEPOSIT IS COUNTED EXACTLY ONCE.
   *
   * A returnable-container deposit is routinely printed twice — as a line AND
   * as a `depositTotal` subtotal row (measured on the Turkish invoice read
   * 2026-09-04, which then reported "off by ₺180"). Counting the line in
   * `computedLinesTotal` and the subtotal again in `charges` invents ₺180 of
   * goods that nobody billed. So a `lineKind: "deposit"` line leaves the goods
   * sum and is carried in the charge term instead, whether or not the document
   * also printed the subtotal.
   */
  const depositLinesTotal = doc.lines.reduce(
    (acc, l, i) =>
      isDepositLine(l) ? acc + lineContribution(l, i, priceBaseProblems) : acc,
    0,
  );

  const lineSum = doc.lines.reduce(
    (acc, l, i) =>
      isDepositLine(l) ? acc : acc + lineContribution(l, i, priceBaseProblems),
    0,
  );

  const charges =
    (doc.freight ?? 0) +
    (doc.fuelSurcharge ?? 0) +
    (doc.splitCaseFee ?? 0) +
    (doc.deliveryFee ?? 0) +
    (doc.depositTotal ?? depositLinesTotal) +
    (doc.tax ?? 0) +
    (doc.otherCharges ?? 0) -
    (doc.discountTotal ?? 0);

  const computedLinesTotal = Math.round(lineSum * 100) / 100;
  const warnings = priceBaseProblems.length
    ? [...doc.warnings, ...priceBaseProblems]
    : doc.warnings;

  if (doc.total == null) {
    // No stated total is not a failed tie-out — it is an untestable one. Saying
    // "does not tie out" here would train people to ignore the flag.
    return {
      ...doc,
      computedLinesTotal,
      tieOutDelta: null,
      tiesOut: null,
      warnings,
    };
  }

  const expected = computedLinesTotal + charges;
  const delta = Math.round((doc.total - expected) * 100) / 100;
  const toleranceCents = tieOutToleranceCents(doc.lines.length);
  const tiesOut = Math.abs(Math.round(delta * 100)) <= toleranceCents;

  return {
    ...doc,
    computedLinesTotal,
    tieOutDelta: delta,
    tiesOut,
    warnings: tiesOut
      ? warnings
      : [
          ...warnings,
          `Lines plus charges come to ${expected.toFixed(2)} but the document states ${doc.total.toFixed(2)} (off by ${delta.toFixed(2)}).`,
        ],
  };
}
