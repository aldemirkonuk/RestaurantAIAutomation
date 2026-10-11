/**
 * F-1161: the /inventory location chips set the filter and the URL, and
 * nothing read it -- the list and the count sheet stayed whole. F-1162: the
 * count sheet put a split wine on its first shelf beside the wine's total.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const rows = vi.hoisted(() => [
  { id: 'inv-1', wineId: 'w-1', wineName: 'Yakut', stockLive: 11, locations: [
    { locationId: 'cellar', qty: 8, wac: null },
    { locationId: 'bar', qty: 3, wac: null },
  ] },
  { id: 'inv-2', wineId: 'w-2', wineName: 'Kavaklidere', stockLive: 4, locations: [
    { locationId: 'rack-1', qty: 4, wac: null },
  ] },
  { id: 'inv-3', wineId: 'w-3', wineName: 'Doluca', stockLive: 2, locations: [
    { locationId: 'bar', qty: 0, wac: null },
    { locationId: null, qty: 2, wac: null },
  ] },
])

vi.mock('../../hooks/useInventoryData', () => ({
  useInventoryData: () => ({
    inventory: rows,
    summary: null,
    lowStockItems: [],
    isLoading: false,
    error: null,
    summaryError: null,
    lowStockError: null,
    isPending: false,
    refetch: vi.fn(),
    updateItem: vi.fn(),
  }),
}))
vi.mock('../../hooks/queries', () => ({ useWinesByIds: () => ({ data: [] }) }))

import { countSheetLines, useInventoryPage, zoneAndChildren } from './useInventoryPage'

// The cellar holds a rack; the bar holds nothing.
const zones = [
  { id: 'cellar' },
  { id: 'rack-1', parentId: 'cellar' },
  { id: 'bar' },
]

const names = (items: { name: string }[]) => items.map((i) => i.name).sort()

describe('useInventoryPage — the location chip filters the list (F-1161)', () => {
  it('[REVERT-FAILS] keeps the wines with a bottle on the zone or a zone inside it', () => {
    const { result } = renderHook(() => useInventoryPage({ zones }))
    expect(names(result.current.filteredInventory)).toEqual(['Doluca', 'Kavaklidere', 'Yakut'])

    act(() => result.current.setSelectedLocationFilter('cellar'))
    expect(names(result.current.filteredInventory)).toEqual(['Kavaklidere', 'Yakut'])

    // A zone whose row says 0 bottles does not hold the wine.
    act(() => result.current.setSelectedLocationFilter('bar'))
    expect(names(result.current.filteredInventory)).toEqual(['Yakut'])

    act(() => result.current.setSelectedLocationFilter(null))
    expect(result.current.filteredInventory).toHaveLength(3)
  })

  it('[REVERT-FAILS] leaves the map, zone manager and receiving list whole (F-1270)', () => {
    const { result } = renderHook(() => useInventoryPage({ zones }))
    act(() => result.current.setSelectedLocationFilter('bar'))
    expect(names(result.current.filteredInventory)).toEqual(['Yakut'])
    // The other zones and the unplaced bottles still show on the map.
    expect(names(result.current.filteredInventoryAnyPlace)).toEqual(['Doluca', 'Kavaklidere', 'Yakut'])
  })

  it('starts filtered from the URL', () => {
    const { result } = renderHook(() =>
      useInventoryPage({ zones, initialFilters: { location: 'rack-1' } }),
    )
    expect(names(result.current.filteredInventory)).toEqual(['Kavaklidere'])
  })
})

describe('countSheetLines — one line per wine and place (F-1162)', () => {
  const items = () => renderHook(() => useInventoryPage({ zones })).result.current.filteredInventory

  it('[REVERT-FAILS] gives a split wine a line per shelf, with that shelf\'s bottles', () => {
    const lines = countSheetLines(items())
    const yakut = lines.filter((l) => l.item.name === 'Yakut')
    expect(yakut.map((l) => [l.locationId, l.qty, l.first])).toEqual([
      ['cellar', 8, true],
      ['bar', 3, false],
    ])
    // Unplaced bottles are their own line; an empty shelf is none.
    expect(lines.filter((l) => l.item.name === 'Doluca').map((l) => [l.locationId, l.qty])).toEqual([[null, 2]])
  })

  it('[REVERT-FAILS] with a chip, lists only that zone\'s places', () => {
    const lines = countSheetLines(items(), zoneAndChildren('cellar', zones))
    expect(lines.map((l) => [l.item.name, l.locationId, l.qty])).toEqual([
      ['Kavaklidere', 'rack-1', 4],
      ['Yakut', 'cellar', 8],
    ])
  })
})
