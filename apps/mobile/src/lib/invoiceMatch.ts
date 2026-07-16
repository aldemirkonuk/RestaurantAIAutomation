/**
 * invoiceMatch — three-way match rules, mobile mirror.
 *
 * The BACKEND is authoritative (apps/api-gateway/src/procurement/invoice-match.ts)
 * and the web keeps its own mirror in apps/web/src/lib/invoiceMatch.ts. This copy
 * exists so the receiving screen shows the verdict live while counting. The three
 * must stay in sync.
 *
 *   ORDERED  (PO)       orderedQty          @ poUnitPrice      (agreed)
 *   INVOICED (vendor)   invoiceQty          @ invoiceUnitPrice (billed)
 *   RECEIVED (physical) acceptedQty + rejectedQty
 *
 * `received` (not `accepted`) is compared against the invoice on purpose:
 * "sent 24, 2 broke" and "only 22 arrived" leave the same stock but are
 * different vendor failures.
 */
import { color } from "@/design/tokens";

export type MatchVerdict =
  | "matched"
  | "price_variance"
  | "qty_over"
  | "qty_short"
  | "rejected"
  | "partial"
  | "unmatched";

export interface MatchInput {
  orderedQty: number;
  poUnitPrice?: number | null;
  invoiceQty?: number | null;
  invoiceUnitPrice?: number | null;
  acceptedQty: number;
  rejectedQty?: number;
  priceOverrideReason?: string | null;
}

export interface MatchResult {
  verdict: MatchVerdict;
  summary: string;
  backorderQty: number;
  requiresOverride: boolean;
  priceVerified: boolean;
  creditDue: boolean;
  effectiveUnitCost: number | null;
}

export const money = (n: number) => `$${n.toFixed(2)}`;

/** Compare as cents so 22.000000001 still equals 22. */
const priceEquals = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

export function computeMatch(input: MatchInput): MatchResult {
  const orderedQty = Math.max(0, input.orderedQty ?? 0);
  const acceptedQty = Math.max(0, input.acceptedQty ?? 0);
  const rejectedQty = Math.max(0, input.rejectedQty ?? 0);
  const receivedQty = acceptedQty + rejectedQty;

  const hasInvoice = input.invoiceQty != null;
  const invoiceQty = hasInvoice ? Math.max(0, input.invoiceQty as number) : null;
  const poUnitPrice = input.poUnitPrice ?? null;
  const invoiceUnitPrice = input.invoiceUnitPrice ?? null;
  const overrideReason = (input.priceOverrideReason ?? "").trim();

  const bothPriced = poUnitPrice != null && invoiceUnitPrice != null;
  const priceVerified = bothPriced && priceEquals(poUnitPrice as number, invoiceUnitPrice as number);
  const priceMismatch = bothPriced && !priceVerified;
  const requiresOverride = priceMismatch && overrideReason.length === 0;

  const backorderQty = Math.max(0, orderedQty - acceptedQty);
  const fullyFulfilled = acceptedQty >= orderedQty;

  let verdict: MatchVerdict;
  if (!hasInvoice) verdict = "unmatched";
  else if (requiresOverride) verdict = "price_variance";
  else if (receivedQty > (invoiceQty as number)) verdict = "qty_over";
  else if (receivedQty < (invoiceQty as number)) verdict = "qty_short";
  else if (rejectedQty > 0) verdict = "rejected";
  else if (!fullyFulfilled) verdict = "partial";
  else verdict = "matched";

  const creditDue = rejectedQty > 0 || (hasInvoice && (invoiceQty as number) > acceptedQty);

  const effectiveUnitCost =
    hasInvoice && invoiceUnitPrice != null && acceptedQty > 0
      ? ((invoiceQty as number) * invoiceUnitPrice) / acceptedQty
      : null;

  const summary = (() => {
    switch (verdict) {
      case "matched":
        return `All ${acceptedQty} accepted at the agreed price.`;
      case "price_variance":
        return `Billed ${money(invoiceUnitPrice as number)} against an agreed ${money(poUnitPrice as number)}.`;
      case "qty_over":
        return `${receivedQty} arrived but only ${invoiceQty} were billed.`;
      case "qty_short":
        return `Billed for ${invoiceQty} but only ${receivedQty} arrived — ${
          (invoiceQty as number) - receivedQty
        } short.`;
      case "rejected":
        return `${rejectedQty} of ${receivedQty} rejected on arrival — credit due.`;
      case "partial":
        return `${acceptedQty} of ${orderedQty} accepted, ${backorderQty} still outstanding.`;
      case "unmatched":
        return `${acceptedQty} accepted with no invoice on file yet.`;
    }
  })();

  return {
    verdict,
    summary,
    backorderQty,
    requiresOverride,
    priceVerified,
    creditDue,
    effectiveUnitCost,
  };
}

interface VerdictTone {
  label: string;
  bg: string;
  text: string;
}

const VERDICT_TONES: Record<MatchVerdict, VerdictTone> = {
  matched: { label: "Clean match", bg: color.successTint, text: color.success },
  price_variance: { label: "Price variance", bg: color.dangerTint, text: color.danger },
  qty_over: { label: "Over-delivered", bg: color.warningTint, text: color.warning },
  qty_short: { label: "Short shipment", bg: color.dangerTint, text: color.danger },
  rejected: { label: "Units rejected", bg: color.warningTint, text: color.warning },
  partial: { label: "Partial delivery", bg: color.warningTint, text: color.warning },
  unmatched: { label: "No invoice yet", bg: color.fill, text: color.inkTertiary },
};

export const verdictTone = (v: MatchVerdict): VerdictTone => VERDICT_TONES[v];
