/**
 * invoiceMatch — four-way match rules for live feedback while counting a delivery (frontend).
 *
 * The BACKEND is authoritative: apps/api-gateway/src/procurement/invoice-match.ts decides the
 * verdict that gets persisted. This mirror exists so the receiving screen can show the verdict
 * update as the manager edits counts, before anything is submitted. The two must stay in sync
 * — same arrangement as lib/inventoryStatus.ts (D6: one definition per layer, documented).
 *
 * Four documents are reconciled:
 *   ORDERED  (PO, 850)          orderedQty          @ poUnitPrice      (agreed)
 *   SHIPPED  (packing slip, 856) shippedQty                            (what the vendor says left)
 *   RECEIVED (physical)         acceptedQty + rejectedQty
 *   BILLED   (invoice, 810)     invoiceQty          @ invoiceUnitPrice (charged)
 *
 * The packing slip earns its place because it is the vendor's OWN statement. When their slip
 * says 22 and their invoice says 24, the overbill is proven by their paperwork and there is
 * nothing to argue about — so that verdict outranks everything but a missing invoice.
 *
 * `received` (not `accepted`) is compared against the invoice on purpose: "sent 24, 2 broke"
 * and "only 22 arrived" leave the same stock but are different vendor failures.
 *
 * A null shippedQty or invoiceQty means UNKNOWN, never "it agreed". Quantities are
 * bottle-equivalents; the caller normalises cases before calling.
 */

export type MatchVerdict =
  | 'matched'
  | 'overbilled_vs_ship'
  | 'price_variance'
  | 'qty_over'
  | 'qty_short'
  | 'short_shipped'
  | 'rejected'
  | 'partial'
  | 'unmatched'

export interface MatchInput {
  orderedQty: number
  poUnitPrice?: number | null
  /** From the packing slip / ASN. Null = none in hand, which is common. */
  shippedQty?: number | null
  invoiceQty?: number | null
  invoiceUnitPrice?: number | null
  acceptedQty: number
  rejectedQty?: number
  /** Agreed free bottles; netted out so a deal stops reading as an overage. */
  freeGoodsQty?: number
  /** Freight/fees apportioned here, folded into landed cost. */
  allocatedCharges?: number
  priceOverrideReason?: string | null
}

export interface MatchResult {
  verdict: MatchVerdict
  summary: string
  backorderQty: number
  requiresOverride: boolean
  priceVerified: boolean
  creditDue: boolean
  creditAmount: number | null
  /** The vendor's own packing slip proves the overbill. */
  selfEvidenced: boolean
  effectiveUnitCost: number | null
}

export const money = (n: number) => `$${n.toFixed(2)}`

/** Compare as cents so 22.000000001 still equals 22. */
const priceEquals = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100)

export function computeMatch(input: MatchInput): MatchResult {
  const orderedQty = Math.max(0, input.orderedQty ?? 0)
  const acceptedQty = Math.max(0, input.acceptedQty ?? 0)
  const rejectedQty = Math.max(0, input.rejectedQty ?? 0)
  const freeGoodsQty = Math.max(0, input.freeGoodsQty ?? 0)
  const allocatedCharges = Math.max(0, input.allocatedCharges ?? 0)
  const receivedQty = acceptedQty + rejectedQty
  // What the vendor may bill for: everything that arrived except what they gave us.
  const billableReceived = Math.max(0, receivedQty - freeGoodsQty)

  const hasShip = input.shippedQty != null
  const shippedQty = hasShip ? Math.max(0, input.shippedQty as number) : null

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

  const overbilledVsShip = hasShip && hasInvoice && (invoiceQty as number) > (shippedQty as number)
  const shortShipped = hasShip && billableReceived < (shippedQty as number)

  let verdict: MatchVerdict
  if (!hasInvoice) verdict = 'unmatched'
  else if (overbilledVsShip) verdict = 'overbilled_vs_ship'
  else if (requiresOverride) verdict = 'price_variance'
  else if (billableReceived > (invoiceQty as number)) verdict = 'qty_over'
  else if (billableReceived < (invoiceQty as number)) verdict = 'qty_short'
  else if (shortShipped) verdict = 'short_shipped'
  else if (rejectedQty > 0) verdict = 'rejected'
  else if (!fullyFulfilled) verdict = 'partial'
  else verdict = 'matched'

  const creditDue =
    rejectedQty > 0 || overbilledVsShip || (hasInvoice && (invoiceQty as number) > billableReceived)

  const unitsOwed = hasInvoice
    ? Math.max(0, (invoiceQty as number) - (billableReceived - rejectedQty))
    : 0
  const creditAmount =
    hasInvoice && invoiceUnitPrice != null && unitsOwed > 0
      ? Math.round(unitsOwed * invoiceUnitPrice * 100) / 100
      : null

  const effectiveUnitCost =
    hasInvoice && invoiceUnitPrice != null && acceptedQty > 0
      ? ((invoiceQty as number) * invoiceUnitPrice + allocatedCharges) / acceptedQty
      : null

  const summary = (() => {
    switch (verdict) {
      case 'matched':
        return (
          `All ${acceptedQty} accepted at the agreed price.` +
          (freeGoodsQty > 0 ? ` Includes ${freeGoodsQty} free.` : '')
        )
      case 'overbilled_vs_ship':
        return `Their packing slip says ${shippedQty} but their invoice bills ${invoiceQty} — proven by their own paperwork.`
      case 'price_variance':
        return `Billed ${money(invoiceUnitPrice as number)} against an agreed ${money(poUnitPrice as number)}.`
      case 'qty_over':
        return `${billableReceived} arrived but only ${invoiceQty} were billed.`
      case 'qty_short':
        return `Billed for ${invoiceQty} but only ${billableReceived} arrived — ${
          (invoiceQty as number) - billableReceived
        } short.`
      case 'short_shipped':
        return `Packing slip says ${shippedQty}, only ${billableReceived} arrived — ${
          (shippedQty as number) - billableReceived
        } lost between the warehouse and the door.`
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
    creditAmount,
    selfEvidenced: overbilledVsShip,
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
  // Their own two documents disagree. Strongest claim we can make, so it gets
  // the loudest treatment on screen.
  overbilled_vs_ship: { label: 'Overbilled vs their slip', bg: 'bg-rose-100', text: 'text-rose-800', ring: 'ring-rose-300' },
  short_shipped: { label: 'Lost in transit', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200' },
  price_variance: { label: 'Price variance', bg: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-200' },
  qty_over: { label: 'Over-delivered', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200' },
  qty_short: { label: 'Short shipment', bg: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-200' },
  rejected: { label: 'Units rejected', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200' },
  partial: { label: 'Partial delivery', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200' },
  unmatched: { label: 'No invoice yet', bg: 'bg-gray-100', text: 'text-gray-600', ring: 'ring-gray-200' },
}

export const verdictStyle = (v: MatchVerdict): VerdictStyle => VERDICT_STYLES[v]
