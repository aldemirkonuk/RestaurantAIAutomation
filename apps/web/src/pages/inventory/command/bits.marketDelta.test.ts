import { describe, it, expect } from 'vitest'
import { marketDeltaPct } from './bits'
import type { InventoryItem } from '../useInventoryPage'

/**
 * F-1311: the delta read `wac ?? price`, so a wine with no recorded cost was
 * measured against the library's reference price, which is not what this
 * house paid.
 */
describe('marketDeltaPct — only against what the house paid (F-1311)', () => {
  it('[REVERT-FAILS] gives no delta when no cost is recorded, whatever the library price', () => {
    const item = { price: 40, marketPrice: 50, wac: undefined } as unknown as InventoryItem
    expect(marketDeltaPct(item)).toBeNull()
  })

  it('measures market against the recorded cost', () => {
    const item = { price: 40, marketPrice: 50, wac: 25 } as unknown as InventoryItem
    expect(marketDeltaPct(item)).toBe(100)
  })
})
