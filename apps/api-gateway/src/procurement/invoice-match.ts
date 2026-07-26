/**
 * invoice-match — single source of truth for the three-way match verdict (backend authority).
 *
 * Three documents are reconciled when an order is delivered:
 *   ORDERED  (PO)       orderedQty          @ poUnitPrice      (agreed: final_price)
 *   INVOICED (vendor)   invoiceQty          @ invoiceUnitPrice (billed)
 *   RECEIVED (physical) acceptedQty + rejectedQty              (counted at the door)
 *
 * Key distinction (why `received` and not `accepted` is compared against the invoice):
 * "vendor sent 24, 2 arrived broken" and "only 22 ever left the warehouse" are different
 * failures with different remedies. Comparing accepted-vs-invoice would collapse them into
 * one number. Comparing received-vs-invoice keeps a short ship (`qty_short`) distinct from
 * damage (`rejected`), so vendor accountability stays honest.
 *
 * Pure: no DB, no I/O. The frontend mirrors these rules in apps/web/src/lib/invoiceMatch.ts
 * for live feedback while counting; THIS module is authoritative and decides what is
 * persisted. The two must stay in sync (same contract style as lib/inventoryStatus.ts, D6).
 */

export type MatchVerdict =
  | "matched"
  | "price_variance"
  | "qty_over"
  | "qty_short"
  | "rejected"
  | "partial"
  | "unmatched";

export type MatchCheckId =
  | "price"
  | "bill_vs_po"
  | "physical_vs_bill"
  | "damage"
  | "fulfilment";

export interface MatchInput {
  /** Ordered quantity from the PO. */
  orderedQty: number;
  /** Agreed unit price (final_price). Null when the order never carried a price. */
  poUnitPrice?: number | null;
  /** Quantity the vendor invoice bills for. Null = invoice not in hand yet. */
  invoiceQty?: number | null;
  /** Unit price the vendor invoice bills. Null = invoice not in hand yet. */
  invoiceUnitPrice?: number | null;
  /** Units accepted into stock. */
  acceptedQty: number;
  /** Units that arrived but were refused (damaged/corked). */
  rejectedQty?: number;
  /** Manager justification for accepting a price that differs from the PO. */
  priceOverrideReason?: string | null;
  /**
   * Units actually added to the ledger at markDelivered time. Defaults to the invoice
   * quantity (the delivery path stocks at invoice qty). Used only for the ledger delta.
   */
  stockedQty?: number | null;
}

export interface MatchCheck {
  id: MatchCheckId;
  ok: boolean;
  label: string;
  detail?: string;
}

export interface MatchResult {
  verdict: MatchVerdict;
  checks: MatchCheck[];
  summary: string;
  /** Ordered but not yet accepted — keeps the order open instead of stranding shadow stock. */
  backorderQty: number;
  /** Signed correction to apply to the ledger: what we accepted minus what we already stocked. */
  ledgerDelta: number;
  /** True when the invoice price differs from the PO price and no override reason was given. */
  requiresOverride: boolean;
  /** Reuses the existing price_verified column: true only on an exact price match. */
  priceVerified: boolean;
  /** Vendor owes money back (billed for units not accepted, or sent damaged goods). */
  creditDue: boolean;
  /**
   * What each bottle in hand actually cost: amount billed / units accepted. Handles free
   * goods ("11 for the price of 10" -> 10x$22/11 = $20). Null when unpriced or nothing accepted.
   */
  effectiveUnitCost: number | null;
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** Compare two prices as money; avoids float noise like 22.00000000001 !== 22. */
const priceEquals = (a: number, b: number) =>
  Math.round(a * 100) === Math.round(b * 100);

export function computeMatch(input: MatchInput): MatchResult {
  const orderedQty = Math.max(0, input.orderedQty ?? 0);
  const acceptedQty = Math.max(0, input.acceptedQty ?? 0);
  const rejectedQty = Math.max(0, input.rejectedQty ?? 0);
  const receivedQty = acceptedQty + rejectedQty;

  const hasInvoice = input.invoiceQty != null;
  const invoiceQty = hasInvoice
    ? Math.max(0, input.invoiceQty as number)
    : null;
  const poUnitPrice = input.poUnitPrice ?? null;
  const invoiceUnitPrice = input.invoiceUnitPrice ?? null;
  const overrideReason = (input.priceOverrideReason ?? "").trim();

  const stockedQty = input.stockedQty ?? invoiceQty ?? orderedQty;

  const checks: MatchCheck[] = [];

  // --- price: exact match, no tolerance band (D-B) --------------------------------------
  const bothPriced = poUnitPrice != null && invoiceUnitPrice != null;
  const priceVerified =
    bothPriced && priceEquals(poUnitPrice, invoiceUnitPrice);
  const priceMismatch = bothPriced && !priceVerified;
  const requiresOverride = priceMismatch && overrideReason.length === 0;

  checks.push({
    id: "price",
    ok: !priceMismatch,
    label: "Invoice price matches the agreed price",
    detail: !bothPriced
      ? "No price to compare"
      : priceMismatch
        ? `Agreed ${money(poUnitPrice)} vs billed ${money(invoiceUnitPrice)}` +
          (overrideReason ? " — accepted by override" : "")
        : `Both ${money(poUnitPrice as number)}`,
  });

  // --- bill vs PO: did they bill for what we ordered? ------------------------------------
  const billMatchesPo = hasInvoice && invoiceQty === orderedQty;
  checks.push({
    id: "bill_vs_po",
    ok: billMatchesPo,
    label: "Invoice quantity matches the order",
    detail: !hasInvoice
      ? "No invoice recorded"
      : billMatchesPo
        ? `Both ${orderedQty}`
        : `Ordered ${orderedQty}, billed ${invoiceQty}`,
  });

  // --- physical vs bill: short ship / over delivery ---------------------------------------
  const physicalMatchesBill = hasInvoice && receivedQty === invoiceQty;
  checks.push({
    id: "physical_vs_bill",
    ok: physicalMatchesBill,
    label: "Delivered quantity matches the invoice",
    detail: !hasInvoice
      ? "No invoice recorded"
      : physicalMatchesBill
        ? `Both ${invoiceQty}`
        : `Billed ${invoiceQty}, ${receivedQty} arrived`,
  });

  // --- damage ----------------------------------------------------------------------------
  checks.push({
    id: "damage",
    ok: rejectedQty === 0,
    label: "No units rejected",
    detail:
      rejectedQty === 0
        ? "All units accepted"
        : `${rejectedQty} rejected on arrival`,
  });

  // --- fulfilment -------------------------------------------------------------------------
  const fullyFulfilled = acceptedQty >= orderedQty;
  const backorderQty = Math.max(0, orderedQty - acceptedQty);
  checks.push({
    id: "fulfilment",
    ok: fullyFulfilled,
    label: "Order fully fulfilled",
    detail: fullyFulfilled
      ? `${acceptedQty} of ${orderedQty} accepted`
      : `${acceptedQty} of ${orderedQty} accepted, ${backorderQty} outstanding`,
  });

  // --- verdict: one headline, ordered by financial severity -------------------------------
  let verdict: MatchVerdict;
  if (!hasInvoice) verdict = "unmatched";
  else if (requiresOverride) verdict = "price_variance";
  else if (receivedQty > (invoiceQty as number)) verdict = "qty_over";
  else if (receivedQty < (invoiceQty as number)) verdict = "qty_short";
  else if (rejectedQty > 0) verdict = "rejected";
  else if (!fullyFulfilled) verdict = "partial";
  else verdict = "matched";

  const creditDue =
    rejectedQty > 0 || (hasInvoice && (invoiceQty as number) > acceptedQty);

  const effectiveUnitCost =
    hasInvoice && invoiceUnitPrice != null && acceptedQty > 0
      ? ((invoiceQty as number) * invoiceUnitPrice) / acceptedQty
      : null;

  return {
    verdict,
    checks,
    summary: summarize(verdict, {
      orderedQty,
      invoiceQty,
      receivedQty,
      acceptedQty,
      rejectedQty,
      backorderQty,
      poUnitPrice,
      invoiceUnitPrice,
    }),
    backorderQty,
    ledgerDelta: acceptedQty - stockedQty,
    requiresOverride,
    priceVerified,
    creditDue,
    effectiveUnitCost,
  };
}

function summarize(
  verdict: MatchVerdict,
  f: {
    orderedQty: number;
    invoiceQty: number | null;
    receivedQty: number;
    acceptedQty: number;
    rejectedQty: number;
    backorderQty: number;
    poUnitPrice: number | null;
    invoiceUnitPrice: number | null;
  },
): string {
  switch (verdict) {
    case "matched":
      return `All ${f.acceptedQty} accepted at the agreed price.`;
    case "price_variance":
      return `Billed ${money(f.invoiceUnitPrice as number)} against an agreed ${money(
        f.poUnitPrice as number,
      )}.`;
    case "qty_over":
      return `${f.receivedQty} arrived but only ${f.invoiceQty} were billed.`;
    case "qty_short":
      return `Billed for ${f.invoiceQty} but only ${f.receivedQty} arrived — ${
        (f.invoiceQty as number) - f.receivedQty
      } short.`;
    case "rejected":
      return `${f.rejectedQty} of ${f.receivedQty} rejected on arrival — credit due.`;
    case "partial":
      return `${f.acceptedQty} of ${f.orderedQty} accepted, ${f.backorderQty} still outstanding.`;
    case "unmatched":
      return `${f.acceptedQty} accepted with no invoice on file yet.`;
  }
}

/** Verdicts that mean the manager must be told immediately (D-E). */
export function isDiscrepancy(verdict: MatchVerdict): boolean {
  return verdict !== "matched";
}
