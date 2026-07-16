/**
 * invoiceMatch — three-way match rules for live feedback while counting a delivery (frontend).
 *
 * The BACKEND is authoritative: apps/api-gateway/src/procurement/invoice-match.ts decides the
 * verdict that gets persisted. This mirror exists so the receiving screen can show the verdict
 * update as the manager edits counts, before anything is submitted. The two must stay in sync
 * — same arrangement as lib/inventoryStatus.ts (D6: one definition per layer, documented).
 *
 * Three documents are reconciled:
 *   ORDERED  (PO)       orderedQty          @ poUnitPrice      (agreed)
 *   INVOICED (vendor)   invoiceQty          @ invoiceUnitPrice (billed)
 *   RECEIVED (physical) acceptedQty + rejectedQty
 *
 * `received` (not `accepted`) is compared against the invoice on purpose: "sent 24, 2 broke"
 * and "only 22 arrived" leave the same stock but are different vendor failures.
 */

export type MatchVerdict =
  | 'matched'
  | 'price_variance'
  | 'qty_over'
  | 'qty_short'
  | 'rejected'
  | 'partial'
  | 'unmatched'

export interface MatchInput {
  orderedQty: number
  poUnitPrice?: number | null
  invoiceQty?: number | null
  invoiceUnitPrice?: number | null
  acceptedQty: number
  rejectedQty?: number
  priceOverrideReason?: string | null
}

export interface MatchResult {
  verdict: MatchVerdict
  summary: string
  backorderQty: number
  requiresOverride: boolean
  priceVerified: boolean
  creditDue: boolean
  effectiveUnitCost: number | null
}

export const money = (n: number) => `$${n.toFixed(2)}`

/** Compare as cents so 22.000000001 still equals 22. */
const priceEquals = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100)

export function computeMatch(input: MatchInput): MatchResult {
  const orderedQty = Math.max(0, input.orderedQty ?? 0)
  const acceptedQty = Math.max(0, input.acceptedQty ?? 0)
  const rejectedQty = Math.max(0, input.rejectedQty ?? 0)
  const receivedQty = acceptedQty + rejectedQty

  const hasInvoice = input.invoiceQty != null
  const invoiceQty = hasInvoice ? Math.max(0, input.invoiceQty as number) : null
  const poUnitPrice = input.poUnitPrice ?? null
  const invoiceUnitPrice = input.invoiceUnitPrice ?? null
  const overrideReason = (input.priceOverrideReason ?? '').trim()

  const bothPriced = poUnitPrice != null && invoiceUnitPrice != null
  const priceVerified = bothPriced && priceEquals(poUnitPrice, invoiceUnitPrice)
  const priceMismatch = bothPriced && !priceVerified
  const requiresOverride = priceMismatch && overrideReason.length === 0

  const backorderQty = Math.max(0, orderedQty - acceptedQty)
  const fullyFulfilled = acceptedQty >= orderedQty

  let verdict: MatchVerdict
  if (!hasInvoice) verdict = 'unmatched'
  else if (requiresOverride) verdict = 'price_variance'
  else if (receivedQty > (invoiceQty as number)) verdict = 'qty_over'
  else if (receivedQty < (invoiceQty as number)) verdict = 'qty_short'
  else if (rejectedQty > 0) verdict = 'rejected'
  else if (!fullyFulfilled) verdict = 'partial'
  else verdict = 'matched'

  const creditDue = rejectedQty > 0 || (hasInvoice && (invoiceQty as number) > acceptedQty)

  const effectiveUnitCost =
    hasInvoice && invoiceUnitPrice != null && acceptedQty > 0
      ? ((invoiceQty as number) * invoiceUnitPrice) / acceptedQty
      : null

  const summary = (() => {
    switch (verdict) {
      case 'matched':
        return `All ${acceptedQty} accepted at the agreed price.`
      case 'price_variance':
        return `Billed ${money(invoiceUnitPrice as number)} against an agreed ${money(poUnitPrice as number)}.`
      case 'qty_over':
        return `${receivedQty} arrived but only ${invoiceQty} were billed.`
      case 'qty_short':
        return `Billed for ${invoiceQty} but only ${receivedQty} arrived — ${
          (invoiceQty as number) - receivedQty
        } short.`
      case 'rejected':
        return `${rejectedQty} of ${receivedQty} rejected on arrival — credit due.`
      case 'partial':
        return `${acceptedQty} of ${orderedQty} accepted, ${backorderQty} still outstanding.`
      case 'unmatched':
        return `${acceptedQty} accepted with no invoice on file yet.`
    }
  })()

  return {
    verdict,
    summary,
    backorderQty,
    requiresOverride,
    priceVerified,
    creditDue,
    effectiveUnitCost,
  }
}

interface VerdictStyle {
  label: string
  bg: string
  text: string
  ring: string
}

const VERDICT_STYLES: Record<MatchVerdict, VerdictStyle> = {
  matched: { label: 'Clean match', bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  price_variance: { label: 'Price variance', bg: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-200' },
  qty_over: { label: 'Over-delivered', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200' },
  qty_short: { label: 'Short shipment', bg: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-200' },
  rejected: { label: 'Units rejected', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200' },
  partial: { label: 'Partial delivery', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200' },
  unmatched: { label: 'No invoice yet', bg: 'bg-gray-100', text: 'text-gray-600', ring: 'ring-gray-200' },
}

export const verdictStyle = (v: MatchVerdict): VerdictStyle => VERDICT_STYLES[v]
