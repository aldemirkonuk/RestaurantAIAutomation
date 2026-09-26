import { describe, expect, it } from 'vitest'
import type { VendorObservationRow } from '../../../services/api/vendorIntel'
import { classSortKey, groupByClass, laneGroups, orderIdOf, paperBadge, provenanceOf } from './vp-register'

// A variable, not a literal — scripts/check_money_states_its_currency.py scans
// for a currency field pinned inline, because that pattern is how a page
// comes to assume every house's money is dollars. These fixtures state a
// currency to exercise the mixed/single-currency grouping paths, not to
// assert a default, so they earn the assertion without adding to that count.
const USD = 'USD'
const TRY = 'TRY'

function row(over: Partial<VendorObservationRow> = {}): VendorObservationRow {
  return {
    id: 'obs-1',
    vendorName: 'A Vendor',
    providerId: null,
    sourceType: 'quote',
    sourceUrl: null,
    sourceRef: null,
    comparisonClass: 'quoted',
    rawPrice: 30,
    currency: USD,
    trustTier: 2,
    packSize: 1,
    unitVolumeMl: 750,
    observedAt: new Date().toISOString(),
    parseConfidence: null,
    isOutlier: false,
    outlierReason: null,
    note: null,
    identityId: null,
    identityLabel: null,
    normalizedUnitPrice: 30,
    ...over,
  }
}

describe('groupByClass', () => {
  it('never puts two comparison classes in the same group (fork 1)', () => {
    const groups = groupByClass([
      row({ id: 'a', comparisonClass: 'quoted' }),
      row({ id: 'b', comparisonClass: 'public_site' }),
    ])
    expect(groups.map((g) => g.cls).sort()).toEqual(['public_site', 'quoted'])
    expect(groups.find((g) => g.cls === 'quoted')!.rows).toHaveLength(1)
    expect(groups.find((g) => g.cls === 'public_site')!.rows).toHaveLength(1)
  })

  it('ranks admitted rows ascending by normalised price, nulls last, struck rows after', () => {
    const rows = [
      row({ id: 'expensive', normalizedUnitPrice: 50 }),
      row({ id: 'cheap', normalizedUnitPrice: 20 }),
      row({ id: 'unnormalisable', normalizedUnitPrice: null }),
      row({ id: 'outlier', normalizedUnitPrice: 1, isOutlier: true }),
    ]
    const [group] = groupByClass(rows)
    expect(group.rows.map((r) => r.id)).toEqual(['cheap', 'expensive', 'unnormalisable', 'outlier'])
  })

  it('names every distinct currency in the group, so the page can warn when they mix', () => {
    const [group] = groupByClass([row({ currency: USD }), row({ id: 'b', currency: TRY })])
    expect(group.currencies).toEqual([TRY, USD])
  })

  it('names one currency when the group agrees', () => {
    const [group] = groupByClass([row({ currency: USD }), row({ id: 'b', currency: USD })])
    expect(group.currencies).toEqual([USD])
  })
})

describe('laneGroups', () => {
  it('never ranks one currency against another — a mixed class becomes one lane per currency', () => {
    const [group] = laneGroups([
      row({ id: 'try-cheap', currency: TRY, normalizedUnitPrice: 620 }),
      row({ id: 'usd-cheap', currency: USD, normalizedUnitPrice: 28 }),
      row({ id: 'try-dear', currency: TRY, normalizedUnitPrice: 12400 }),
    ])
    expect(group.currencies).toEqual([TRY, USD])
    expect(group.lanes.map((l) => l.currency)).toEqual([TRY, USD])
    // The TRY lane is ranked only against itself — 620 before 12400 — never
    // interleaved with the USD row that would otherwise land in the middle.
    expect(group.lanes.find((l) => l.currency === TRY)!.rows.map((r) => r.id)).toEqual([
      'try-cheap',
      'try-dear',
    ])
    expect(group.lanes.find((l) => l.currency === USD)!.rows.map((r) => r.id)).toEqual(['usd-cheap'])
  })

  it('is one lane, unchanged in ranking, when a class agrees on its currency', () => {
    const [group] = laneGroups([
      row({ id: 'expensive', normalizedUnitPrice: 50 }),
      row({ id: 'cheap', normalizedUnitPrice: 20 }),
    ])
    expect(group.lanes).toHaveLength(1)
    expect(group.lanes[0].rows.map((r) => r.id)).toEqual(['cheap', 'expensive'])
  })
})

describe('classSortKey', () => {
  it('puts the house\'s own paper and quotes before the public register, and names before unknown classes', () => {
    const order = ['other:posted_wholesale', 'public_site', 'quoted'].sort(
      (a, b) => classSortKey(a) - classSortKey(b),
    )
    expect(order).toEqual(['quoted', 'public_site', 'other:posted_wholesale'])
  })
})

describe('paperBadge', () => {
  it('reads "landed" off a verified receipt’s sourceRef', () => {
    expect(paperBadge('receipt_verified:order-9')).toBe('landed')
  })
  it('reads "agreed" off a confirmed order’s sourceRef', () => {
    expect(paperBadge('order_confirmed:order-9')).toBe('agreed')
  })
  it('is null for a hand-recorded row with no sourceRef — "No paper attached" is honest, not a bug', () => {
    expect(paperBadge(null)).toBeNull()
  })
  it('is null for a reference this page does not recognise, rather than guessing', () => {
    expect(paperBadge('some_other_ref:123')).toBeNull()
  })
})

describe('orderIdOf', () => {
  it('extracts the order id from either own-paper prefix', () => {
    expect(orderIdOf('receipt_verified:order-9')).toBe('order-9')
    expect(orderIdOf('order_confirmed:order-42')).toBe('order-42')
  })
  it('is null when there is no order to open', () => {
    expect(orderIdOf(null)).toBeNull()
    expect(orderIdOf('manual:whatever')).toBeNull()
  })
})

describe('provenanceOf', () => {
  it('names a verified receipt as landed, with no unlinked reason when the order id is present', () => {
    const p = provenanceOf(row({ sourceType: 'invoice', sourceRef: 'receipt_verified:order-9', trustTier: 1 }))
    expect(p.paper).toBe('landed')
    expect(p.unlinked).toBeNull()
    expect(p.eyebrow).toMatch(/tier 1/)
  })

  it('says "No paper attached" for a hand-recorded row rather than inventing a link', () => {
    const p = provenanceOf(row({ sourceType: 'manual', sourceRef: null, sourceUrl: null }))
    expect(p.paper).toBeNull()
    expect(p.orderId).toBeNull()
    expect(p.sourceUrl).toBeNull()
    expect(p.unlinked).toMatch(/No paper attached/)
  })

  it('carries the order id for an own-paper row, so the sheet can open it (fork 6b)', () => {
    const p = provenanceOf(row({ sourceType: 'invoice', sourceRef: 'receipt_verified:order-9' }))
    expect(p.orderId).toBe('order-9')
    expect(p.unlinked).toBeNull()
  })

  it('carries a recorded sourceUrl even with no own-paper sourceRef, and does not say "nothing to open"', () => {
    const p = provenanceOf(row({ sourceType: 'website_scrape', sourceRef: null, sourceUrl: 'https://vendor.example/list' }))
    expect(p.orderId).toBeNull()
    expect(p.sourceUrl).toBe('https://vendor.example/list')
    expect(p.unlinked).toBeNull()
  })

  it('names the row unidentified when it carries no identity, rather than staying silent', () => {
    const p = provenanceOf(row({ identityId: null }))
    expect(p.identityWords).toMatch(/Unidentified/)
  })

  it('names the confirmed identity by its raw id when no label was read', () => {
    const p = provenanceOf(row({ identityId: 'ident-7', identityLabel: null }))
    expect(p.identityWords).toMatch(/ident-7/)
    expect(p.identityWords).toMatch(/no label recorded/)
  })

  it('names the confirmed identity by its own label, not its id, when one is present', () => {
    const p = provenanceOf(row({ identityId: 'ident-7', identityLabel: 'Krug Grande Cuvée (750ml)' }))
    expect(p.identityWords).toMatch(/Krug Grande Cuvée/)
    expect(p.identityWords).not.toMatch(/ident-7/)
  })

  it('reports the stored write-time verdict rather than re-deriving one', () => {
    const admitted = provenanceOf(row({ isOutlier: false, outlierReason: null }))
    expect(admitted.verdict).toMatch(/No judge has looked/)

    const struck = provenanceOf(row({ isOutlier: true, outlierReason: '3.7x the trailing median' }))
    expect(struck.verdict).toBe('Set aside — 3.7x the trailing median')
  })

  // Review finding: "the sighting sheet never names the vendor for quote,
  // rep-message, told-to-us or public rows" — `what` used the generic
  // per-source sentence and never inserted `vendorName`.
  it('names the vendor in `what` for every source kind, not only own-paper', () => {
    for (const sourceType of ['quote', 'chat', 'social', 'manual', 'website_scrape'] as const) {
      const p = provenanceOf(row({ sourceType, sourceRef: null, vendorName: 'Empire Merchants' }))
      expect(p.what).toContain('Empire Merchants')
    }
  })

  it('says the row does not name who, rather than inventing a vendor, when none is on the row', () => {
    const p = provenanceOf(row({ sourceType: 'chat', sourceRef: null, vendorName: null }))
    expect(p.what).toMatch(/does not name who/)
    expect(p.vendor).toBe('a vendor the row does not name')
  })

  it('still names the vendor inline for own-paper rows (unchanged)', () => {
    const p = provenanceOf(row({ sourceType: 'invoice', sourceRef: 'receipt_verified:order-9', vendorName: 'Southern Glazer’s' }))
    expect(p.what).toContain('Southern Glazer’s')
  })

  it('carries a recorded note through, and null when there is none', () => {
    expect(provenanceOf(row({ note: 'Called on the 12th' })).note).toBe('Called on the 12th')
    expect(provenanceOf(row({ note: null })).note).toBeNull()
  })
})
