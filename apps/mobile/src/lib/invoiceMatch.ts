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
import { usableLocale } from "@/lib/houseMoney";

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
  | "unmatched"
  /** Agreed and billed in two different moneys: the price was not compared (F-341). */
  | "currency_differs";

export interface MatchInput {
  orderedQty: number;
  poUnitPrice?: number | null;
  /** The money the agreed price is in (F-341). Absent compares as before. */
  poCurrency?: string | null;
  invoiceQty?: number | null;
  invoiceUnitPrice?: number | null;
  invoiceCurrency?: string | null;
  acceptedQty: number;
  rejectedQty?: number;
  priceOverrideReason?: string | null;
  /** The house's formats tag (F-954): prices are grouped the house's way. */
  locale?: string | null;
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

/** A three-letter code, trimmed and in capitals, or null when none is stated. */
const codeOf = (c: string | null | undefined): string | null => {
  const x = (c ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(x) ? x : null;
};

/**
 * A figure in the money it is in (F-341), as the gateway's `moneyIn` says it.
 * This printed a bare "$" until 2026-10-09, so a euro or lira delivery was
 * checked under a dollar sign. No money stated says so, never USD.
 *
 * F-954: grouped, and with the house's marks when its formats tag is known —
 * a Turkish manager who typed "1250,00" read back "TRY 1250.00" in en-US with
 * no grouping. No tag keeps en-US, now grouped.
 */
export const money = (
  n: number,
  currency: string | null | undefined,
  locale?: string | null,
) => {
  const tag = usableLocale(locale);
  const code = codeOf(currency);
  const plain = n.toLocaleString(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (code) {
    try {
      return new Intl.NumberFormat(tag, { style: "currency", currency: code }).format(n);
    } catch {
      return `${plain} ${code}`;
    }
  }
  return `${plain} (currency not recorded)`;
};

/**
 * The money the order was agreed in: the agreement line's, else the order's
 * own (F-800). Mirrors the gateway's `poCurrency` in `verifyReceipt`, so the
 * phone holds or compares a price exactly when the server will.
 */
export function agreedCurrency(
  order?: { agreedCurrency?: string | null; currency?: string | null } | null,
): string | null {
  return order?.agreedCurrency ?? order?.currency ?? null;
}

/**
 * Both moneys stated and not the same: the price is not compared (F-341).
 * Mirrors the gateway's `differentMoney` in invoice-match.ts.
 */
export function differentMoney(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const x = (a ?? "").trim().toUpperCase();
  const y = (b ?? "").trim().toUpperCase();
  return x !== "" && y !== "" && x !== y;
}

/** The gateway's sentence for a price held because the two moneys differ. */
export function notComparedWords(
  agreedIn: string | null | undefined,
  billedIn: string | null | undefined,
): string {
  return (
    `The price was not compared: the agreement is in ${(agreedIn ?? "").trim().toUpperCase()} ` +
    `and the invoice is in ${(billedIn ?? "").trim().toUpperCase()}, and nothing here converts one ` +
    `into the other. You decide whether this price is right.`
  );
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

  const bothPriced = poUnitPrice != null && invoiceUnitPrice != null;
  // Two stated, different moneys are never compared as numbers (F-341); the
  // price is held for the owner instead of passing or asking for an override.
  const currencyDiffers =
    bothPriced && differentMoney(input.poCurrency, input.invoiceCurrency);
  const priceVerified =
    bothPriced &&
    !currencyDiffers &&
    priceEquals(poUnitPrice as number, invoiceUnitPrice as number);
  const priceMismatch = bothPriced && !currencyDiffers && !priceVerified;
  const requiresOverride = priceMismatch && overrideReason.length === 0;

  const backorderQty = Math.max(0, orderedQty - acceptedQty);
  const fullyFulfilled = acceptedQty >= orderedQty;

  let verdict: MatchVerdict;
  if (!hasInvoice) verdict = "unmatched";
  else if (requiresOverride) verdict = "price_variance";
  else if (receivedQty > (invoiceQty as number)) verdict = "qty_over";
  else if (receivedQty < (invoiceQty as number)) verdict = "qty_short";
  else if (rejectedQty > 0) verdict = "rejected";
  // A short delivery stays the headline even when the money differs (F-776,
  // F-812), as on the gateway and the web; the held price is still said after
  // it, by the not-compared sentence.
  else if (!fullyFulfilled) verdict = "partial";
  else if (currencyDiffers) verdict = "currency_differs";
  else verdict = "matched";

  const creditDue =
    rejectedQty > 0 || (hasInvoice && (invoiceQty as number) > acceptedQty);

  const effectiveUnitCost =
    hasInvoice && invoiceUnitPrice != null && acceptedQty > 0
      ? ((invoiceQty as number) * invoiceUnitPrice) / acceptedQty
      : null;

  const headline = (() => {
    switch (verdict) {
      case "matched":
        return priceVerified
          ? `All ${acceptedQty} accepted; the stated prices match.`
          : `All ${acceptedQty} accepted; the entered quantities match. Price verification is pending.`;
      case "price_variance":
        return `Billed ${money(invoiceUnitPrice as number, input.invoiceCurrency, input.locale)} against a stated ${money(poUnitPrice as number, input.poCurrency, input.locale)} per bottle. The server will check the agreement.`;
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
      case "currency_differs":
        return `All ${acceptedQty} accepted. Agreed ${money(poUnitPrice as number, input.poCurrency, input.locale)}, billed ${money(invoiceUnitPrice as number, input.invoiceCurrency, input.locale)} per bottle.`;
    }
  })();
  // The sentence rides along whichever verdict headlines, as on the gateway.
  const summary = currencyDiffers
    ? `${headline} ${notComparedWords(input.poCurrency, input.invoiceCurrency)}`
    : headline;

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
  currency_differs: {
    label: "Different money",
    bg: color.warningTint,
    text: color.warning,
  },
};

export const verdictTone = (v: MatchVerdict): VerdictTone => VERDICT_TONES[v];
