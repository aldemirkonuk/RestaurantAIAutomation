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
