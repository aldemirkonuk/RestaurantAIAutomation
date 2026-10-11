/**
 * The wine library export's summary sheet (F-1316). EVERY value below is
 * SYNTHETIC.
 *
 * `wine.price` is the library's list price, possibly a reference borrowed from
 * the library, so price × stock is not what the stock is worth to the house.
 */

import { describe, expect, it } from 'vitest'
import type { Wine } from '../data/wineData'
import { generateSummaryData } from './wineLibraryExport'

const wine = (over: Partial<Wine>): Wine =>
  ({
    id: 'w-1',
    name: 'Synthetic Red',
    producer: 'Synthetic Estate',
    vintage: 2020,
    price: 20,
    type: 'red',
    country: 'Nowhere',
    liveStock: 3,
    threshold: 2,
    ...over,
  }) as Wine

describe('wine library export — summary sheet (F-1316)', () => {
  it('names price × stock as the stock at library list prices, never as its value', () => {
    const rows = generateSummaryData([wine({}), wine({ id: 'w-2', price: 10, liveStock: 1 })])
    const metrics = rows.map((r) => r.metric)
    expect(metrics.some((m) => /inventory value|stock value/i.test(m))).toBe(false)
    const total = rows.find((r) => r.metric === 'Stock at library list prices (not what you paid)')
    expect(total?.value).toBe('$70.00')
    expect(metrics).toContain('Average library list price per bottle')
  })
})
