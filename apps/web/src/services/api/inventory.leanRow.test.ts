import { describe, it, expect } from 'vitest'
import { normalizeInventoryItem } from './inventory'

/**
 * perf-p6-2: the gateway's lean list leaves null-valued keys out instead of
 * sending them as null. Every web reader reaches a list row through
 * normalizeInventoryItem, so an absent key must read exactly as a null one.
 */
describe('normalizeInventoryItem on a lean row', () => {
  const NULL_KEYS = [
    'negotiated_price', 'last_alerted_at', 'toast_item_guid', 'last_counted_at',
    'physical_stock', 'threshold_max', 'last_sold_at', 'menu_section',
    'target_price', 'markup_ratio', 'provider_id', 'identity_id', 'sku',
  ]
  const withNulls = { id: 'a', restaurant_id: 'r', stock_live: 3, ...Object.fromEntries(NULL_KEYS.map((k) => [k, null])), lastCountedAt: null }
  const lean = { id: 'a', restaurant_id: 'r', stock_live: 3, lastCountedAt: null }

  it('reads an absent key as it read a null one', () => {
    const a = normalizeInventoryItem(withNulls as never) as unknown as Record<string, unknown>
    const b = normalizeInventoryItem(lean as never) as unknown as Record<string, unknown>
    for (const k of Object.keys(b)) expect(b[k]).toEqual(a[k])
    // every key the null row carried only as raw null is, at worst, undefined here
    for (const k of NULL_KEYS) expect(b[k] ?? null).toBeNull()
  })

  it('keeps lastCountedAt === null when the gateway sends it as null', () => {
    expect(normalizeInventoryItem(lean as never).lastCountedAt).toBeNull()
  })
})
