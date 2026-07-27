import { DocType, Uom } from "./document-types";

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
  deposit?: number | null;

  /** Purchase order this line cites, when the document says so. */
  poNumber?: string | null;
}

export interface ParsedDocument {
  docType: DocType;
  /** Vendor's own number — what their AR desk quotes on the phone. */
  docNumber?: string | null;
  docDate?: string | null;
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
}

/** Money comparison in cents, so 528.0000001 !== 528 never fires. */
export function moneyEquals(a: number, b: number, toleranceCents = 1): boolean {
  return Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= toleranceCents;
}

/**
 * Fill in computedLinesTotal / tieOutDelta / tiesOut.
 *
 * Tolerance is one cent per line rather than a flat cent: vendors round per line
 * and the rounding accumulates, so a 40-line invoice can legitimately be off by
 * a few cents while a 2-line one cannot. A flat tolerance would either cry wolf
 * on long invoices or wave through real errors on short ones.
 */
export function applyTieOut(doc: ParsedDocument): ParsedDocument {
  const lineSum = doc.lines.reduce((acc, l) => {
    const lt =
      l.lineTotal ??
      (l.unitPrice != null ? l.unitPrice * l.qty : 0) - (l.allowance ?? 0);
    return acc + (Number.isFinite(lt) ? lt : 0);
  }, 0);

  const charges =
    (doc.freight ?? 0) +
    (doc.fuelSurcharge ?? 0) +
    (doc.splitCaseFee ?? 0) +
    (doc.deliveryFee ?? 0) +
    (doc.depositTotal ?? 0) +
    (doc.tax ?? 0) +
    (doc.otherCharges ?? 0) -
    (doc.discountTotal ?? 0);

  const computedLinesTotal = Math.round(lineSum * 100) / 100;

  if (doc.total == null) {
    // No stated total is not a failed tie-out — it is an untestable one. Saying
    // "does not tie out" here would train people to ignore the flag.
    return {
      ...doc,
      computedLinesTotal,
      tieOutDelta: null,
      tiesOut: null,
    };
  }

  const expected = computedLinesTotal + charges;
  const delta = Math.round((doc.total - expected) * 100) / 100;
  const toleranceCents = Math.max(1, doc.lines.length);
  const tiesOut = Math.abs(Math.round(delta * 100)) <= toleranceCents;

  return {
    ...doc,
    computedLinesTotal,
    tieOutDelta: delta,
    tiesOut,
    warnings: tiesOut
      ? doc.warnings
      : [
          ...doc.warnings,
          `Lines plus charges come to ${expected.toFixed(2)} but the document states ${doc.total.toFixed(2)} (off by ${delta.toFixed(2)}).`,
        ],
  };
}
