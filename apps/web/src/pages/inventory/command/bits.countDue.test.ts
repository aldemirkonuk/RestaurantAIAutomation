import { describe, it, expect } from 'vitest'
import { daysSinceCounted, rowFlags } from './bits'
import type { InventoryItem } from '../useInventoryPage'

/**
 * F-1235: a count of one shelf no longer stamps the wine's last_counted_at
 * (F-1165), so a house that counts shelf by shelf read as "Count due" on every
 * wine forever. The flag now reads each stocked shelf's own newest count.
 */
const DAY = 86_400_000
const ago = (d: number) => new Date(Date.now() - d * DAY - 60_000).toISOString()

function wine(over: Partial<InventoryItem>): InventoryItem {
  return {
    id: 'w1',
    name: 'Kavaklıdere Yakut',
    liveStock: 6,
    threshold: null,
    lastCounted: null,
    isActive: true,
    locations: [
      { locationId: 'bar', qty: 2, wac: null },
      { locationId: 'cellar', qty: 4, wac: null },
    ],
    ...over,
  } as InventoryItem
}

describe('count due reads each shelf (F-1235)', () => {
  it('is not due when every stocked shelf was counted on its own lately', () => {
    const item = wine({
      shelfCounts: [
        { locationId: 'bar', countedAt: ago(2) },
        { locationId: 'cellar', countedAt: ago(5) },
      ],
    })
    expect(daysSinceCounted(item)).toBe(5)
    expect(rowFlags(item)).not.toContain('count')
  })

  it('is due when any stocked shelf is older than the threshold', () => {
    const item = wine({
      shelfCounts: [
        { locationId: 'bar', countedAt: ago(1) },
        { locationId: 'cellar', countedAt: ago(30) },
      ],
    })
    expect(daysSinceCounted(item)).toBe(30)
    expect(rowFlags(item)).toContain('count')
  })

  it('is due, with no days, when a stocked shelf was never counted', () => {
    const item = wine({ shelfCounts: [{ locationId: 'bar', countedAt: ago(1) }] })
    expect(daysSinceCounted(item)).toBeNull()
    expect(rowFlags(item)).toContain('count')
  })

  it('an empty shelf does not make the wine due', () => {
    const item = wine({
      locations: [
        { locationId: 'bar', qty: 2, wac: null },
        { locationId: 'cellar', qty: 0, wac: null },
      ],
      shelfCounts: [{ locationId: 'bar', countedAt: ago(3) }],
    })
    expect(rowFlags(item)).not.toContain('count')
  })

  it('a whole-wine count newer than a shelf count speaks for that shelf', () => {
    const item = wine({
      lastCounted: ago(4),
      shelfCounts: [{ locationId: 'bar', countedAt: ago(40) }],
    })
    expect(daysSinceCounted(item)).toBe(4)
  })

  it('shelf counts not known: the whole-wine date, never fresher', () => {
    expect(daysSinceCounted(wine({ lastCounted: ago(30), shelfCounts: null }))).toBe(30)
    expect(daysSinceCounted(wine({ lastCounted: null, shelfCounts: null }))).toBeNull()
  })
})
