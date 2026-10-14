/**
 * F-1281: the valuation and count-sheet exports priced a wine with no recorded
 * cost at the library's reference price (or 0.00) -- `i.wac ?? i.price`, and
 * `price` is never null. F-1282: a location chip valued each wine's whole
 * house, not the zone's bottles.
 */
import { describe, expect, it } from 'vitest'
import type { Wine } from '../../data/wineData'
import type { InventoryItem as ApiInventoryItem } from '../../services/api/types'
import {
  qtyIn,
  recordedCost,
  stockValueCell,
  stockValueTotal,
  toInventoryItem,
  costedPart,
  zoneAndChildren,
} from './useInventoryPage'

const row = (over: Record<string, unknown> = {}) =>
  ({ id: 'inv-1', wineId: 'w-1', wineName: 'Yakut', stockLive: 6, ...over }) as unknown as ApiInventoryItem

// A library wine as the gateway sends it: `price` is its reference price.
const libraryWine = { id: 'w-1', name: 'Yakut', producer: 'Kavaklidere', price: 42 } as unknown as Wine

describe('a wine with no recorded cost is withheld, never priced (F-1281)', () => {
  it('[REVERT-FAILS] a library wine with no wac is withheld, not its reference price', () => {
    const item = toInventoryItem(row(), libraryWine)
    expect(item.price).toBe(42)
    expect(recordedCost(item)).toBeNull()
    expect(stockValueCell(item)).toBe('withheld')
  })

  it('[REVERT-FAILS] a wine the library did not load is withheld, not 0', () => {
    const item = toInventoryItem(row())
    expect(stockValueCell(item)).toBe('withheld')
  })

  it('a recorded wac values the live bottles', () => {
    const item = toInventoryItem(row({ wac: 40 }), libraryWine)
    expect(recordedCost(item)).toBe(40)
    expect(stockValueCell(item)).toBe(240)
  })

  it('no bottles on hand is 0 whatever the cost', () => {
    expect(stockValueCell(toInventoryItem(row({ stockLive: 0 }), libraryWine))).toBe(0)
  })

  it('[REVERT-FAILS] the total leaves the uncosted wine out and counts it', () => {
    const items = [
      toInventoryItem(row({ wac: 40 }), libraryWine),
      toInventoryItem(row({ id: 'inv-2', wineId: 'w-2', stockLive: 3 }), { ...libraryWine, id: 'w-2' }),
      toInventoryItem(row({ id: 'inv-3', wineId: 'w-3', stockLive: 0 })),
    ]
    expect(stockValueTotal(items)).toEqual({ value: 240, withheld: 1, partial: 0, bottles: 9, costedBottles: 6 })
  })
})

describe('a location chip values its zone’s bottles (F-1282)', () => {
  const zones = [{ id: 'cellar' }, { id: 'rack-1', parentId: 'cellar' }, { id: 'bar' }]
  const item = toInventoryItem(
    row({
      stockLive: 11,
      wac: 10,
      locations: [
        { locationId: 'cellar', qty: 5, wac: null },
        { locationId: 'rack-1', qty: 2, wac: null },
        { locationId: 'bar', qty: 4, wac: null },
      ],
    }),
    libraryWine,
  )

  it('[REVERT-FAILS] counts the zone and the zones inside it, not the whole house', () => {
    const cellar = zoneAndChildren('cellar', zones)
    expect(qtyIn(item, cellar)).toBe(7)
    expect(stockValueCell(item, qtyIn(item, cellar))).toBe(70)
    expect(stockValueTotal([item], (i) => qtyIn(i, cellar))).toEqual({
      value: 70,
      withheld: 0,
      partial: 0,
      bottles: 7,
      costedBottles: 7,
    })
    expect(qtyIn(item, zoneAndChildren('bar', zones))).toBe(4)
  })
})

describe('a wine costed for only some of its bottles is not valued whole (F-1652)', () => {
  // 36 on hand: 24 loaded with no cost, then 12 invoiced at 600.
  const part = toInventoryItem(row({ stockLive: 36, wac: 600, wacQty: 12 }), libraryWine)

  it('[REVERT-FAILS] the wine\u2019s cell is withheld, not 36 x 600', () => {
    expect(costedPart(part)).toBe(12)
    expect(stockValueCell(part)).toBe('withheld')
  })

  it('[REVERT-FAILS] the total adds only the costed bottles and says how many', () => {
    const whole = toInventoryItem(row({ id: 'inv-2', wineId: 'w-2', wac: 40 }), libraryWine)
    expect(stockValueTotal([part, whole])).toEqual({
      value: 7440,
      withheld: 0,
      partial: 1,
      bottles: 42,
      costedBottles: 18,
    })
  })

  it('[REVERT-FAILS] one zone\u2019s share of a part-costed wine is left out', () => {
    expect(stockValueTotal([part], () => 5)).toEqual({
      value: 0,
      withheld: 1,
      partial: 0,
      bottles: 5,
      costedBottles: 0,
    })
  })

  it('a cost covering every bottle, or a gateway that sends no wacQty, values them all', () => {
    expect(costedPart(toInventoryItem(row({ wac: 40, wacQty: 6 }), libraryWine))).toBeNull()
    expect(stockValueCell(toInventoryItem(row({ wac: 40 }), libraryWine))).toBe(240)
  })
})
