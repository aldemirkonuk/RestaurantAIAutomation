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
  /**
   * The invoice's price AS PRINTED, in `invoicePriceUom` — absent unit = PER
   * BOTTLE, what the field always meant (founder, 2026-10-02, RECEIPTS-W56).
   */
  invoiceUnitPrice?: number | null;
  /** bottle, case, pack, split_case — ADR 0119's words. Absent = per bottle. */
  invoicePriceUom?: string | null;
  /** Bottles in one `invoicePriceUom`; both or neither. */
  invoicePricePackSize?: number | null;
  invoiceCurrency?: string | null;
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
const priceEquals = (a: number, b: number) =>
  Math.round(a * 100) === Math.round(b * 100);

/** One unit the invoice's price can be keyed in (ADR 0119 vocabulary). */
export interface InvoicePriceUnit {
  uom: string;
  packSize: number;
}

const PRICE_UNIT_WORD: Record<string, string> = {
  case: "case",
  cases: "case",
  pack: "pack",
  packs: "pack",
  split_case: "split_case",
};

/** "a case of 24", "a bottle" — the gateway engine's `pricePer`, word for word. */
export function pricePer(uom: string, packSize: number): string {
  switch (uom) {
    case "bottle":
      return "a bottle";
    case "each":
      return "each";
    case "case":
      return `a case of ${packSize}`;
    case "pack":
      return `a pack of ${packSize}`;
    case "split_case":
      return `a split case of ${packSize}`;
    default:
      return `a ${uom}`;
  }
}

/** "per case of 24", "per bottle" — what the pick says. */
export function invoicePriceUnitLabel(u: InvoicePriceUnit): string {
  return u.uom === "bottle"
    ? "per bottle"
    : `per ${pricePer(u.uom, u.packSize).replace(/^a /, "")}`;
}

/**
 * PRICE AS PRINTED (founder, 2026-10-02, RECEIPTS-W56): the units this order's
 * invoice price can be keyed in, starting at the order line's own price unit
 * (ADR 0119). Bottles and packs of N only — a keg or litre line gets no pick
 * (`null`) and the screen behaves as before; that door waits for ADR 0115.
 */
export function invoicePriceUnits(order: {
  priceUom?: string | null;
  pricePackSize?: number | null;
} | null | undefined): { options: InvoicePriceUnit[]; initial: InvoicePriceUnit } | null {
  const lineUom =
    typeof order?.priceUom === "string" ? order.priceUom.trim().toLowerCase() : null;
  if (lineUom === "keg" || lineUom === "liter" || lineUom === "litre") return null;
  const bottle: InvoicePriceUnit = { uom: "bottle", packSize: 1 };
  const word = lineUom ? PRICE_UNIT_WORD[lineUom] : undefined;
  const pack = order?.pricePackSize;
  if (word && typeof pack === "number" && Number.isInteger(pack) && pack >= 1) {
    const line = { uom: word, packSize: pack };
    return { options: [bottle, line], initial: line };
  }
  return { options: [bottle], initial: bottle };
}

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
  // The printed figure, converted to per bottle ONCE — as the gateway's
  // `readInvoicePrice` does. No unit = per bottle, pack 1.
  const asPrinted = input.invoiceUnitPrice ?? null;
  const priceStated = asPrinted != null && !!input.invoicePriceUom;
  const priceUom = priceStated ? (input.invoicePriceUom as string) : "bottle";
  const pricePack = priceStated
    ? Math.max(1, input.invoicePricePackSize ?? 1)
    : 1;
  const invoiceUnitPrice =
    asPrinted == null ? null : pricePack === 1 ? asPrinted : asPrinted / pricePack;
  const overrideReason = (input.priceOverrideReason ?? "").trim();

  const bothPriced = poUnitPrice != null && asPrinted != null;
  // Compared to the cent IN THE PRINTED UNIT, like the gateway.
  const agreedInPrintedUnit =
    poUnitPrice != null ? poUnitPrice * pricePack : null;
  const priceVerified =
    bothPriced &&
    priceEquals(agreedInPrintedUnit as number, asPrinted as number);
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
          : `All ${acceptedQty} accepted; the entered quantities match. Price verification is pending.`;
      case "price_variance": {
        const per = pricePer(priceUom, pricePack);
        return (
          `Billed ${(asPrinted as number).toFixed(2)} ${per} against a stated ${(agreedInPrintedUnit as number).toFixed(2)} ${per}` +
          (pricePack > 1
            ? ` (${(poUnitPrice as number).toFixed(2)} a bottle)`
            : "") +
          ". The server will check the agreement and currency."
        );
      }
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
