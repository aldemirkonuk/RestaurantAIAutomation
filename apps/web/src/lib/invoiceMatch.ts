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
  /**
   * The ISO 4217 codes the two prices are in: the order's (agreed) and the
   * invoice's (billed). Words only, nothing is converted. Absent, a price is a
   * bare number, never dollars (browser walk 2026-11-12: a TRY invoice read
   * "$25.00" on this screen).
   */
  poCurrency?: string | null
  invoiceCurrency?: string | null
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

/**
 * A price in its own currency, the same characters the gateway prints
 * (`invoice-match.ts` `moneyIn`, parity test): a fixed locale, two places,
 * `$25.00` for USD, `TRY 25.00` for lira, and the bare number with no code.
 */
export function money(n: number, code?: string | null): string {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : ''
  if (!/^[A-Z]{3}$/.test(c)) return n.toFixed(2)
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: c,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `${n.toFixed(2)} ${c}`
  }
}

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
  // Physical vs physical. The slip counts bottles on the truck, free ones included, so this
  // uses receivedQty; netting free goods out of one side only made an agreed 11-for-10 with a
  // slip counting 11 read as a bottle lost in transit. billableReceived is for the invoice.
  const shortShipped = hasShip && receivedQty < (shippedQty as number)

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
          // A price that differs, accepted with a reason, is not "the agreed
          // price" (browser walk 2026-11-12: billed 25 against an agreed 20,
          // accepted with an override, and the toast said "at the agreed price").
          (priceMismatch
            ? `All ${acceptedQty} accepted at the billed ${money(invoiceUnitPrice as number, input.invoiceCurrency)}, not the agreed ${money(poUnitPrice as number, input.poCurrency)}.`
            : `All ${acceptedQty} accepted at the agreed price.`) +
          (freeGoodsQty > 0 ? ` Includes ${freeGoodsQty} free.` : '')
        )
      case 'overbilled_vs_ship':
        return `Their packing slip says ${shippedQty} but their invoice bills ${invoiceQty} — proven by their own paperwork.`
      case 'price_variance':
        return `Billed ${money(invoiceUnitPrice as number, input.invoiceCurrency)} against an agreed ${money(poUnitPrice as number, input.poCurrency)}.`
      case 'qty_over':
        return `${billableReceived} arrived but only ${invoiceQty} were billed.`
      case 'qty_short':
        return `Billed for ${invoiceQty} but only ${billableReceived} arrived — ${
          (invoiceQty as number) - billableReceived
        } short.`
      case 'short_shipped':
        return `Packing slip says ${shippedQty}, only ${receivedQty} arrived — ${
          (shippedQty as number) - receivedQty
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

/**
 * The sentence a verification adds when its price restated cost (receipts
 * walk 2026-11-11, item 5). Sales made before the invoice arrived are settled
 * to the invoice cost by `revalue_lot`; the house should hear that, not only
 * the gateway log. Null when there is nothing to say. No amount is printed:
 * the cost is per bottle in the order's currency, and the toast that carries
 * this line already names the prices.
 */
export function costCorrectionLine(
  c: { bottlesRevalued: number; salesSettled: number } | null | undefined,
): string | null {
  if (!c) return null
  const parts: string[] = []
  // `salesSettled` counts sale DRAWS, one per sale per lot (revalue_lot's
  // draws_settled), so a sale that drew from two lots counts twice. One draw
  // is one sale; more than one is said without a number, never as that many
  // sales (fix round 2026-11-12, finding on #1112).
  if (c.salesSettled > 0)
    parts.push(
      c.salesSettled === 1
        ? 'A sale made before the invoice arrived now carries the invoice cost.'
        : 'Sales made before the invoice arrived now carry the invoice cost.',
    )
  if (c.bottlesRevalued > 0)
    parts.push(
      c.bottlesRevalued === 1
        ? 'The bottle still on the shelf is costed at it too.'
        : `The ${c.bottlesRevalued} bottles still on the shelf are costed at it too.`,
    )
  return parts.length ? parts.join(' ') : null
}
