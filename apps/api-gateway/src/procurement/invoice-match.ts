/**
 * invoice-match — single source of truth for the match verdict (backend authority).
 *
 * FOUR documents are reconciled when an order is delivered:
 *   ORDERED  (PO, EDI 850)          orderedQty          @ poUnitPrice      (agreed: final_price)
 *   SHIPPED  (packing slip, EDI 856) shippedQty                            (what the vendor says left)
 *   RECEIVED (physical)             acceptedQty + rejectedQty              (counted at the door)
 *   BILLED   (invoice, EDI 810)     invoiceQty          @ invoiceUnitPrice (charged)
 *
 * Why the packing slip is worth a whole extra document:
 * it is the DISTRIBUTOR'S OWN statement of what shipped. Every other
 * discrepancy is our word against theirs and gets argued on the phone. But when
 * their ship notice says 22 and their invoice says 24, their own paperwork
 * proves the overbill — nothing is left to dispute. That verdict
 * (`overbilled_vs_ship`) is the highest-confidence claim this system can make,
 * so it outranks everything except a missing invoice.
 *
 * Why `received` and not `accepted` is compared against the invoice:
 * "vendor sent 24, 2 arrived broken" and "only 22 ever left the warehouse" are
 * different failures with different remedies. Comparing accepted-vs-invoice
 * would collapse them into one number. Comparing received-vs-invoice keeps a
 * short ship (`qty_short`) distinct from damage (`rejected`), so vendor
 * accountability stays honest. With a packing slip in hand the distinction gets
 * sharper still: short-vs-ship is a carrier or warehouse problem, over-vs-ship
 * is a billing problem.
 *
 * ABSENCE IS NOT AGREEMENT. A null shippedQty or invoiceQty means "we do not
 * know", never "it matched". The caller must not substitute the PO for a
 * missing invoice: doing so makes the headline check compare a number to itself
 * and writes a price-verified assertion no human ever made.
 *
 * QUANTITIES ARE BOTTLE-EQUIVALENTS. Callers normalise through
 * documents/document-types.ts#toBottles before calling. Ordering 2 cases and
 * being invoiced 24 bottles is a match, and comparing the bare numbers reports
 * a 22-unit overage — the most common false alarm in beverage receiving.
 *
 * Pure: no DB, no I/O. The frontend mirrors these rules in
 * apps/web/src/lib/invoiceMatch.ts for live feedback while counting; THIS module
 * is authoritative and decides what is persisted.
 */

export type MatchVerdict =
  | "matched"
  | "overbilled_vs_ship"
  | "price_variance"
  | "qty_over"
  | "qty_short"
  | "short_shipped"
  | "rejected"
  | "partial"
  | "unmatched";

export type MatchCheckId =
  | "price"
  | "bill_vs_po"
  | "bill_vs_ship"
  | "physical_vs_ship"
  | "physical_vs_bill"
  | "damage"
  | "fulfilment";

export interface MatchInput {
  /** Ordered quantity from the PO, in bottle-equivalents. */
  orderedQty: number;
  /** Agreed unit price (final_price). Null when the order never carried a price. */
  poUnitPrice?: number | null;
  /**
   * Quantity the packing slip / ASN says shipped. Null = no packing slip, which
   * is common and must read as unknown rather than as agreement.
   */
  shippedQty?: number | null;
  /** Quantity the vendor invoice bills for. Null = invoice not in hand yet. */
  invoiceQty?: number | null;
  /** Unit price the vendor invoice bills. Null = invoice not in hand yet. */
  invoiceUnitPrice?: number | null;
  /** Units accepted into stock. */
  acceptedQty: number;
  /** Units that arrived but were refused (damaged/corked). */
  rejectedQty?: number;
  /**
   * Units supplied free under an agreed deal ("11 for the price of 10").
   * Netted out of every quantity comparison. Without this an ordinary,
   * negotiated bonus reads as `qty_over` and fires a critical alert every time
   * — and a manager who is alarmed about good news stops reading alarms.
   */
  freeGoodsQty?: number;
  /** Manager justification for accepting a price that differs from the PO. */
  priceOverrideReason?: string | null;
  /**
   * Freight, fuel surcharge and split-case fees apportioned to this line.
   * Folded into effectiveUnitCost so what lands on the books is landed cost, not
   * the sticker price. Freight is a cost component, not a price variance.
   */
  allocatedCharges?: number;
  /**
   * Units actually added to the ledger at markDelivered time — NOT what we wish
   * had been stocked. The delivery path stocks optimistically at invoice
   * quantity before anyone counts, so this defaults to that, and ledgerDelta is
   * the correction back to reality. Defaulting it to acceptedQty would make
   * ledgerDelta permanently zero and silently strand every miscount.
   */
  stockedQty?: number | null;
}

export interface MatchCheck {
  id: MatchCheckId;
  /** null = could not be evaluated (document absent). Distinct from false. */
  ok: boolean | null;
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
  /** Money owed back, when it can be computed. Null when unpriced. */
  creditAmount: number | null;
  /**
   * True when the vendor's own packing slip proves the overbill. A claim carrying
   * this needs no argument, only the attachment.
   */
  selfEvidenced: boolean;
  /**
   * What each bottle in hand actually cost: (amount billed + allocated charges)
   * / units accepted. Handles free goods ("11 for the price of 10" -> 10x$22/11
   * = $20). Null when unpriced or nothing accepted. THIS is what must be written
   * to the stock lot — the whole match is theatre if the books keep the PO price.
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
  const freeGoodsQty = Math.max(0, input.freeGoodsQty ?? 0);
  const allocatedCharges = Math.max(0, input.allocatedCharges ?? 0);
  const receivedQty = acceptedQty + rejectedQty;

  // What the vendor is entitled to bill for: everything that arrived except the
  // units they gave us.
  const billableReceived = Math.max(0, receivedQty - freeGoodsQty);

  const hasShip = input.shippedQty != null;
  const shippedQty = hasShip ? Math.max(0, input.shippedQty as number) : null;

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
    ok: !bothPriced ? null : !priceMismatch,
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
    ok: hasInvoice ? billMatchesPo : null,
    label: "Invoice quantity matches the order",
    detail: !hasInvoice
      ? "No invoice recorded"
      : billMatchesPo
        ? `Both ${orderedQty}`
        : `Ordered ${orderedQty}, billed ${invoiceQty}`,
  });

  // --- bill vs ship: the vendor's own two documents disagreeing ---------------------------
  // The single most valuable check in this file. No counting on our side is
  // involved, so there is nothing for the vendor to dispute.
  const canCompareBillShip = hasInvoice && hasShip;
  const overbilledVsShip =
    canCompareBillShip && (invoiceQty as number) > (shippedQty as number);
  checks.push({
    id: "bill_vs_ship",
    ok: canCompareBillShip
      ? (invoiceQty as number) === (shippedQty as number)
      : null,
    label: "Invoice matches the vendor's own packing slip",
    detail: !canCompareBillShip
      ? hasShip
        ? "No invoice recorded"
        : "No packing slip recorded"
      : (invoiceQty as number) === (shippedQty as number)
        ? `Both ${invoiceQty}`
        : `Their slip says ${shippedQty}, their invoice says ${invoiceQty}`,
  });

  // --- physical vs ship: did everything that left the warehouse get here? ------------------
  // BOTH SIDES MUST BE PHYSICAL COUNTS. The packing slip counts bottles on the
  // truck, free ones included, so this compares receivedQty and NOT
  // billableReceived. Netting free goods out of one side only made an agreed
  // 11-for-10 with a slip counting 11 read as "1 lost between the warehouse and
  // the door" — the free-goods false alarm, moved onto the transit axis.
  const shortShipped = hasShip && receivedQty < (shippedQty as number);
  checks.push({
    id: "physical_vs_ship",
    ok: hasShip ? receivedQty === (shippedQty as number) : null,
    label: "Everything on the packing slip arrived",
    detail: !hasShip
      ? "No packing slip recorded"
      : receivedQty === (shippedQty as number)
        ? `Both ${shippedQty}`
        : `Slip says ${shippedQty}, ${receivedQty} arrived`,
  });

  // --- physical vs bill: short ship / over delivery ---------------------------------------
  // The BILLING axis, so free goods come off: the vendor may not bill for what
  // they gave us. This is the one comparison billableReceived belongs in.
  const physicalMatchesBill =
    hasInvoice && billableReceived === (invoiceQty as number);
  checks.push({
    id: "physical_vs_bill",
    ok: hasInvoice ? physicalMatchesBill : null,
    label: "Delivered quantity matches the invoice",
    detail: !hasInvoice
      ? "No invoice recorded"
      : physicalMatchesBill
        ? `Both ${invoiceQty}`
        : `Billed ${invoiceQty}, ${billableReceived} arrived` +
          (freeGoodsQty > 0 ? ` (plus ${freeGoodsQty} free)` : ""),
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

  // --- verdict: one headline, ordered by evidentiary strength then severity ----------------
  let verdict: MatchVerdict;
  if (!hasInvoice) verdict = "unmatched";
  else if (overbilledVsShip) verdict = "overbilled_vs_ship";
  else if (requiresOverride) verdict = "price_variance";
  else if (billableReceived > (invoiceQty as number)) verdict = "qty_over";
  else if (billableReceived < (invoiceQty as number)) verdict = "qty_short";
  else if (shortShipped) verdict = "short_shipped";
  else if (rejectedQty > 0) verdict = "rejected";
  else if (!fullyFulfilled) verdict = "partial";
  else verdict = "matched";

  const creditDue =
    rejectedQty > 0 ||
    overbilledVsShip ||
    (hasInvoice && (invoiceQty as number) > billableReceived);

  // Money owed back: units billed but not usably received, at the billed price.
  const unitsOwed = hasInvoice
    ? Math.max(0, (invoiceQty as number) - (billableReceived - rejectedQty))
    : 0;
  const creditAmount =
    hasInvoice && invoiceUnitPrice != null && unitsOwed > 0
      ? Math.round(unitsOwed * invoiceUnitPrice * 100) / 100
      : null;

  const effectiveUnitCost =
    hasInvoice && invoiceUnitPrice != null && acceptedQty > 0
      ? ((invoiceQty as number) * invoiceUnitPrice + allocatedCharges) /
        acceptedQty
      : null;

  return {
    verdict,
    checks,
    summary: summarize(verdict, {
      orderedQty,
      shippedQty,
      invoiceQty,
      receivedQty,
      billableReceived,
      acceptedQty,
      rejectedQty,
      freeGoodsQty,
      backorderQty,
      poUnitPrice,
      invoiceUnitPrice,
    }),
    backorderQty,
    ledgerDelta: acceptedQty - stockedQty,
    requiresOverride,
    priceVerified,
    creditDue,
    creditAmount,
    selfEvidenced: overbilledVsShip,
    effectiveUnitCost,
  };
}

function summarize(
  verdict: MatchVerdict,
  f: {
    orderedQty: number;
    shippedQty: number | null;
    invoiceQty: number | null;
    /** Physical bottles at the door, free ones included. Use against the slip. */
    receivedQty: number;
    /** Physical minus free goods. Use against the invoice. */
    billableReceived: number;
    acceptedQty: number;
    rejectedQty: number;
    freeGoodsQty: number;
    backorderQty: number;
    poUnitPrice: number | null;
    invoiceUnitPrice: number | null;
  },
): string {
  switch (verdict) {
    case "matched":
      return (
        `All ${f.acceptedQty} accepted at the agreed price.` +
        (f.freeGoodsQty > 0 ? ` Includes ${f.freeGoodsQty} free.` : "")
      );
    case "overbilled_vs_ship":
      return `Their packing slip says ${f.shippedQty} but their invoice bills ${f.invoiceQty} — proven by their own paperwork.`;
    case "price_variance":
      return `Billed ${money(f.invoiceUnitPrice as number)} against an agreed ${money(
        f.poUnitPrice as number,
      )}.`;
    case "qty_over":
      return `${f.billableReceived} arrived but only ${f.invoiceQty} were billed.`;
    case "qty_short":
      return `Billed for ${f.invoiceQty} but only ${f.billableReceived} arrived — ${
        (f.invoiceQty as number) - f.billableReceived
      } short.`;
    case "short_shipped":
      // Physical, to match the check: the slip counted free bottles too, so
      // billableReceived here would overstate the loss (or invent one).
      return `Packing slip says ${f.shippedQty}, only ${f.receivedQty} arrived — ${
        (f.shippedQty as number) - f.receivedQty
      } lost between the warehouse and the door.`;
    case "rejected":
      // Physical again — how many of the bottles in front of the manager were
      // refused. receivedQty already includes the rejected units; adding them
      // again reported "2 of 26 rejected" on a 24-bottle delivery.
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

/**
 * Verdicts a claim can be raised on. Narrower than isDiscrepancy: `partial` and
 * `unmatched` are states of an unfinished delivery, not vendor errors, and
 * raising a claim on them would put a restaurant in front of its distributor
 * asking for money over paperwork that has not arrived yet.
 */
export function isClaimable(verdict: MatchVerdict): boolean {
  return (
    verdict === "overbilled_vs_ship" ||
    verdict === "qty_short" ||
    verdict === "short_shipped" ||
    verdict === "rejected" ||
    verdict === "price_variance"
  );
}
