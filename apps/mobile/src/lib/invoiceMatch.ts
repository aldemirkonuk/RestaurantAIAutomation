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

/**
 * Local bottle-count preview for the native receiving form. The gateway owns
 * verification, packing-slip/free-goods checks, landed costs and credit claims.
 * This preview must not describe missing price/document inputs as verified.
 */
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
  /** The ISO code copied from the vendor's paper, or null when none is stated. */
  invoiceCurrency?: string | null;
  /** The order's own ISO code (`procurement_orders.currency`), or null when it names none. */
  poCurrency?: string | null;
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

/** A three-letter ISO code, or null: a stored value that is not one names no currency. */
export function currencyCode(code: string | null | undefined): string | null {
  const c = (code ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

/**
 * A price in its own currency: "TRY 12.00". This printed a dollar sign for
 * every invoice whatever its currency; a currency sign is a claim about the
 * amount, so a price with no stated currency says so instead of borrowing one.
 */
export function money(n: number, currency: string | null | undefined): string {
  const code = currencyCode(currency);
  return code ? `${code} ${n.toFixed(2)}` : `${n.toFixed(2)} (currency not stated)`;
}

/**
 * True when two prices can be read side by side on this phone: the same
 * stated currency, or a currency missing on either side (the preview the
 * server re-checks). Two different stated currencies are never netted or
 * called equal here: nothing on the phone converts.
 */
export function sameMoney(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const x = currencyCode(a);
  const y = currencyCode(b);
  return x === null || y === null || x === y;
}

/** Compare as cents so 22.000000001 still equals 22. */
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

  const invoiceCurrency = currencyCode(input.invoiceCurrency);
  const poCurrency = currencyCode(input.poCurrency);
  const bothPriced = poUnitPrice != null && invoiceUnitPrice != null;
  // Two different stated currencies: equal figures are not a verified price.
  const twoCurrencies = bothPriced && !sameMoney(invoiceCurrency, poCurrency);
  const figuresEqual =
    bothPriced &&
    priceEquals(poUnitPrice as number, invoiceUnitPrice as number);
  const priceVerified = figuresEqual && !twoCurrencies;
  // The override rule stays the server's (invoice-match.ts): figures that
  // differ need a reason, whatever their currencies, or the server refuses
  // the receipt. Only what this preview CLAIMS changes with currency.
  const priceMismatch = bothPriced && !figuresEqual;
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

  const creditDue =
    rejectedQty > 0 || (hasInvoice && (invoiceQty as number) > acceptedQty);

  const effectiveUnitCost =
    hasInvoice && invoiceUnitPrice != null && acceptedQty > 0
      ? ((invoiceQty as number) * invoiceUnitPrice) / acceptedQty
      : null;

  const summary = (() => {
    switch (verdict) {
      case "matched":
        return priceVerified
          ? `All ${acceptedQty} accepted; the stated prices match.`
          : twoCurrencies
            ? `All ${acceptedQty} accepted; the entered quantities match. The invoice is in ${invoiceCurrency} and the order in ${poCurrency}, so the server compares the prices.`
            : `All ${acceptedQty} accepted; the entered quantities match. Price verification is pending.`;
      case "price_variance":
        return `Billed ${money(invoiceUnitPrice as number, invoiceCurrency)} against an agreed ${money(poUnitPrice as number, poCurrency)} per bottle. The server will check the agreement and currency.`;
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
        return `${acceptedQty} counted; no invoice quantities entered on this form.`;
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
  matched: {
    label: "Counts match — preview",
    bg: color.successTint,
    text: color.success,
  },
  price_variance: {
    label: "Price variance",
    bg: color.dangerTint,
    text: color.danger,
  },
  qty_over: {
    label: "Over-delivered",
    bg: color.warningTint,
    text: color.warning,
  },
  qty_short: {
    label: "Short shipment",
    bg: color.dangerTint,
    text: color.danger,
  },
  rejected: {
    label: "Units rejected",
    bg: color.warningTint,
    text: color.warning,
  },
  partial: {
    label: "Partial delivery",
    bg: color.warningTint,
    text: color.warning,
  },
  unmatched: {
    label: "No invoice yet",
    bg: color.fill,
    text: color.inkTertiary,
  },
};

export const verdictTone = (v: MatchVerdict): VerdictTone => VERDICT_TONES[v];
