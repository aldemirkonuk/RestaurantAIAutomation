import { describe, it, expect } from 'vitest'
import { computeMatch, verdictStyle, type MatchInput } from './invoiceMatch'
// The backend is authoritative. Importing it directly here is the whole point: these rules are
// duplicated across the API and the web app, and D6 exists because the same concept drifting
// into three incompatible definitions is what broke trust last time. If someone changes one
// side and not the other, this file goes red.
import { computeMatch as computeMatchApi } from '../../../api-gateway/src/procurement/invoice-match'

const base: MatchInput = {
  orderedQty: 24,
  poUnitPrice: 22,
  invoiceQty: 24,
  invoiceUnitPrice: 22,
  acceptedQty: 24,
  rejectedQty: 0,
}

describe('invoiceMatch (web mirror)', () => {
  it('reports a clean match when everything agrees', () => {
    const r = computeMatch(base)

    expect(r.verdict).toBe('matched')
    expect(r.backorderQty).toBe(0)
    expect(r.requiresOverride).toBe(false)
    expect(r.priceVerified).toBe(true)
    expect(r.effectiveUnitCost).toBe(22)
  })

  // F-341: until 2026-10-09 both prices printed under a bare "$".
  it('says each price in its own money, never a guessed dollar', () => {
    const euro = computeMatch({ ...base, poCurrency: 'EUR', invoiceCurrency: 'EUR', invoiceUnitPrice: 24 })
    expect(euro.summary).toBe('Billed €24.00 against an agreed €22.00.')

    const unrecorded = computeMatch({ ...base, invoiceUnitPrice: 24 })
    expect(unrecorded.summary).toBe(
      'Billed 24.00 (currency not recorded) against an agreed 22.00 (currency not recorded).',
    )

    // Word-for-word the gateway's sentence, money included.
    const lira = { ...base, poCurrency: 'TRY', invoiceCurrency: 'TRY', invoiceUnitPrice: 2400 }
    expect(computeMatch(lira).summary).toBe(computeMatchApi(lira).summary)
  })

  // F-341: two different moneys were compared as numbers — 22 EUR against 770 TRY asked for an
  // override reason, and 22 EUR against 22 TRY read "at the agreed price".
  it('holds a price billed in another money for the owner instead of comparing it', () => {
    const lira = computeMatch({ ...base, poCurrency: 'EUR', invoiceCurrency: 'TRY', invoiceUnitPrice: 770 })
    expect(lira.verdict).toBe('currency_differs')
    expect(lira.requiresOverride).toBe(false)
    expect(lira.priceVerified).toBe(false)
    expect(lira.summary).toContain('The price was not compared: the agreement is in EUR and the invoice is in TRY')
    expect(verdictStyle('currency_differs').label).toBe('Different money')

    const sameFigure = computeMatch({ ...base, poCurrency: 'EUR', invoiceCurrency: 'TRY' })
    expect(sameFigure.verdict).toBe('currency_differs')
    expect(sameFigure.summary).not.toContain('at the agreed price')
  })

  // F-776: a short delivery billed in another money read "All 22 accepted" on an order of 24.
  it('keeps a short delivery the headline when the money differs', () => {
    const short = computeMatch({ ...base, poCurrency: 'EUR', invoiceCurrency: 'TRY', invoiceQty: 22, acceptedQty: 22 })
    expect(short.verdict).toBe('partial')
    expect(short.summary).toMatch(/^22 of 24 accepted, 2 still outstanding\. The price was not compared/)
    expect(short.summary).not.toContain('All 22 accepted')
  })

  it('blocks on any price deviation until a reason is given', () => {
    const flagged = computeMatch({ ...base, invoiceUnitPrice: 22.01 })
    expect(flagged.verdict).toBe('price_variance')
    expect(flagged.requiresOverride).toBe(true)

    const overridden = computeMatch({
      ...base,
      invoiceUnitPrice: 22.01,
      priceOverrideReason: 'freight surcharge',
    })
    expect(overridden.requiresOverride).toBe(false)
    expect(overridden.priceVerified).toBe(false)
  })

  it('separates damage from a short ship', () => {
    const damaged = computeMatch({ ...base, acceptedQty: 22, rejectedQty: 2 })
    const short = computeMatch({ ...base, acceptedQty: 22, rejectedQty: 0 })

    expect(damaged.verdict).toBe('rejected')
    expect(short.verdict).toBe('qty_short')
    expect(damaged.backorderQty).toBe(short.backorderQty)
  })

  it('does not read an agreed free bottle as one lost in transit', () => {
    // Slip 11, invoice 10, 11 bottles on the pallet, all of them here. The slip is a physical
    // count and includes the free bottle; comparing it against the billing count flagged a
    // clean delivery as `short_shipped` the instant a slip was attached.
    const r = computeMatch({
      orderedQty: 10,
      poUnitPrice: 22,
      shippedQty: 11,
      invoiceQty: 10,
      invoiceUnitPrice: 22,
      acceptedQty: 11,
      freeGoodsQty: 1,
    })

    expect(r.verdict).toBe('matched')
    expect(r.creditDue).toBe(false)
  })

  it('holds a backorder open on a partial delivery', () => {
    const r = computeMatch({ ...base, invoiceQty: 20, acceptedQty: 20 })

    expect(r.verdict).toBe('partial')
    expect(r.backorderQty).toBe(4)
  })

  it('has a style for every verdict it can produce', () => {
    const verdicts = [
      'matched',
      'overbilled_vs_ship',
      'price_variance',
      'qty_over',
      'qty_short',
      'short_shipped',
      'rejected',
      'partial',
      'unmatched',
    ] as const

    for (const v of verdicts) {
      expect(verdictStyle(v).label.length).toBeGreaterThan(0)
    }
  })
})

/**
 * Parity: the mirror must agree with the backend on every case that decides an outcome.
 * Only the fields the UI actually renders are compared — the backend additionally returns a
 * `checks[]` breakdown that the mirror deliberately does not carry.
 */
describe('refused bottles and claimed-back units (web mirror)', () => {
  it('reads a bill that leaves the refused bottles off as clean, never Over-delivered (F-414)', () => {
    const r = computeMatch({ orderedQty: 12, poUnitPrice: 20, invoiceQty: 10, invoiceUnitPrice: 20, acceptedQty: 10, rejectedQty: 2 })
    expect(r.verdict).toBe('matched')
    expect(r.creditDue).toBe(false)
    expect(r.creditAmount).toBeNull()
    const zero = computeMatch({ orderedQty: 6, poUnitPrice: 20, invoiceQty: 0, invoiceUnitPrice: 20, acceptedQty: 0, rejectedQty: 6 })
    expect(zero.verdict).toBe('matched')
  })

  it('never puts a claimed-back unit into the bottle cost as well (F-415)', () => {
    const r = computeMatch({ orderedQty: 12, poUnitPrice: 20, invoiceQty: 12, invoiceUnitPrice: 20, acceptedQty: 10, rejectedQty: 2 })
    expect(r.creditAmount).toBe(40)
    expect(r.effectiveUnitCost).toBe(20)
  })
})

describe('invoiceMatch parity with the API engine', () => {
  const cases: Array<[string, MatchInput]> = [
    ['exact match', base],
    ['float noise in price', { ...base, invoiceUnitPrice: 22.000000001 }],
    ['price over agreed', { ...base, invoiceUnitPrice: 24 }],
    ['price over, overridden', { ...base, invoiceUnitPrice: 24, priceOverrideReason: 'agreed' }],
    ['whitespace-only override', { ...base, invoiceUnitPrice: 24, priceOverrideReason: '   ' }],
    ['short ship', { ...base, acceptedQty: 22 }],
    ['damaged units', { ...base, acceptedQty: 22, rejectedQty: 2 }],
    ['short AND damaged', { ...base, acceptedQty: 20, rejectedQty: 1 }],
    ['over delivery', { ...base, acceptedQty: 26 }],
    ['partial, bill agrees', { ...base, invoiceQty: 20, acceptedQty: 20 }],
    ['free goods 11-for-10, undeclared', { orderedQty: 10, poUnitPrice: 22, invoiceQty: 10, invoiceUnitPrice: 22, acceptedQty: 11 }],
    ['free goods 11-for-10, declared', { orderedQty: 10, poUnitPrice: 22, invoiceQty: 10, invoiceUnitPrice: 22, acceptedQty: 11, freeGoodsQty: 1 }],
    ['no invoice yet', { ...base, invoiceQty: null, invoiceUnitPrice: null }],
    ['unpriced order', { ...base, poUnitPrice: null, invoiceUnitPrice: null }],
    ['negative input', { ...base, acceptedQty: -5, rejectedQty: -2 }],
    // Packing slip cases — the fourth document.
    ['overbilled vs their own slip', { ...base, shippedQty: 22, invoiceQty: 24, acceptedQty: 22 }],
    ['overbilled AND overpriced', { ...base, shippedQty: 22, invoiceQty: 24, invoiceUnitPrice: 26, acceptedQty: 22 }],
    ['lost in transit', { ...base, shippedQty: 24, acceptedQty: 22 }],
    ['slip agrees with everything', { ...base, shippedQty: 24 }],
    ['slip present, no invoice', { ...base, shippedQty: 24, invoiceQty: null, invoiceUnitPrice: null }],
    ['allocated freight', { ...base, allocatedCharges: 48 }],
    // Free goods x packing slip. The slip counts physical bottles (free ones included), the
    // invoice counts billable ones — comparing across the two axes turned an agreed 11-for-10
    // into "1 lost in transit". Both engines have to net these the same way or the receiving
    // screen shows one verdict while the backend persists another.
    ['free goods, slip counts the free bottle', { orderedQty: 10, poUnitPrice: 22, shippedQty: 11, invoiceQty: 10, invoiceUnitPrice: 22, acceptedQty: 11, freeGoodsQty: 1 }],
    ['free goods, slip counts only the billable', { orderedQty: 10, poUnitPrice: 22, shippedQty: 10, invoiceQty: 10, invoiceUnitPrice: 22, acceptedQty: 11, freeGoodsQty: 1 }],
    ['free goods, real transit loss', { orderedQty: 10, poUnitPrice: 22, shippedQty: 11, invoiceQty: 10, invoiceUnitPrice: 22, acceptedQty: 10, freeGoodsQty: 1 }],
    ['free goods and damage under a slip', { orderedQty: 10, poUnitPrice: 22, shippedQty: 11, invoiceQty: 10, invoiceUnitPrice: 22, acceptedQty: 10, rejectedQty: 1, freeGoodsQty: 1 }],
    // F-341: two different moneys are held, never compared as numbers.
    ['another money, same figure', { ...base, poCurrency: 'EUR', invoiceCurrency: 'TRY' }],
    ['another money, different figure', { ...base, poCurrency: 'EUR', invoiceCurrency: 'TRY', invoiceUnitPrice: 770 }],
    ['another money and a short ship', { ...base, poCurrency: 'EUR', invoiceCurrency: 'TRY', acceptedQty: 22 }],
    ['another money and a short delivery', { ...base, poCurrency: 'EUR', invoiceCurrency: 'TRY', invoiceQty: 22, acceptedQty: 22 }],
    ['one money not recorded', { ...base, poCurrency: 'EUR', invoiceUnitPrice: 24 }],
    // F-414: refused bottles left off the bill — net, partly net, whole case at 0, under-billed.
    ['refused left off the bill', { orderedQty: 12, poUnitPrice: 20, invoiceQty: 10, invoiceUnitPrice: 20, acceptedQty: 10, rejectedQty: 2 }],
    ['refused, one of them billed', { orderedQty: 12, poUnitPrice: 20, invoiceQty: 11, invoiceUnitPrice: 20, acceptedQty: 10, rejectedQty: 2 }],
    ['whole case refused, billed 0', { orderedQty: 6, poUnitPrice: 20, invoiceQty: 0, invoiceUnitPrice: 20, acceptedQty: 0, rejectedQty: 6 }],
    ['refused and under-billed', { orderedQty: 12, poUnitPrice: 20, invoiceQty: 8, invoiceUnitPrice: 20, acceptedQty: 10, rejectedQty: 2 }],
    // F-415: claimed-back units with freight on top.
    ['short with freight', { orderedQty: 12, poUnitPrice: 20, invoiceQty: 12, invoiceUnitPrice: 20, acceptedQty: 10, allocatedCharges: 30 }],
    ['free goods and a real short ship', { orderedQty: 24, poUnitPrice: 22, shippedQty: 24, invoiceQty: 21, invoiceUnitPrice: 22, acceptedQty: 22, freeGoodsQty: 1 }],
  ]

  it.each(cases)('agrees with the backend: %s', (_label, input) => {
    const web = computeMatch(input)
    const api = computeMatchApi(input)

    expect(web.verdict).toBe(api.verdict)
    expect(web.summary).toBe(api.summary)
    expect(web.backorderQty).toBe(api.backorderQty)
    expect(web.requiresOverride).toBe(api.requiresOverride)
    expect(web.priceVerified).toBe(api.priceVerified)
    expect(web.creditDue).toBe(api.creditDue)
    expect(web.creditAmount).toBe(api.creditAmount)
    expect(web.selfEvidenced).toBe(api.selfEvidenced)
    expect(web.effectiveUnitCost).toBe(api.effectiveUnitCost)
  })
})
