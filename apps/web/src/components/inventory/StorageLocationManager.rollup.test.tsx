/**
 * Founder answer 2026-09-29 on nested-zone totals, verbatim pick "Show both
 * (Recommended)": "Parent shows its own bottles plus a rolled-up total for
 * everything inside, clearly labelled. Nothing hidden, no double counting in
 * reports."
 *
 * In the zone manager each zone row keeps its own bottles/capacity, a parent
 * row adds a labelled total for itself and every zone below it, and the
 * footer's house total counts each bottle once (own counts, never roll-ups).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

const CELLAR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const RACK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SHELF = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const zones = [
  { id: CELLAR, name: 'Cellar', capacity: 100, currentCount: 0, color: '#be123c' },
  { id: RACK, name: 'Rack A', capacity: 40, currentCount: 0, color: '#be123c', parentId: CELLAR },
  { id: SHELF, name: 'Shelf 2', capacity: 10, currentCount: 0, color: '#be123c', parentId: RACK },
]
// Own counts come from the mappings (getLocationsWithActualCounts).
const own: Record<string, number> = { [CELLAR]: 5, [RACK]: 12, [SHELF]: 4 }

vi.mock('../../hooks/useStorageLocations', () => ({
  useStorageLocations: () => ({
    locations: zones,
    locationsLoading: false,
    locationsUnavailable: false,
    getLocationsWithActualCounts: () => zones.map((z) => ({ ...z, currentCount: own[z.id] })),
    mappings: [],
    assignWineToLocation: vi.fn(),
    removeWineFromLocation: vi.fn(),
    addLocation: vi.fn(),
    updateLocation: vi.fn(),
    deleteLocation: vi.fn(),
    updateWineQuantityAtLocation: vi.fn(),
    getLocationStats: () => ({ utilizationRate: 14 }),
    recalculateLocationCounts: vi.fn(),
    setLocations: vi.fn(),
  }),
  // ADR 0238 (#519 on main, after #515 was written): an owner or manager.
  useZoneSetupAccess: () => ({ maySetUp: true, unknown: false, loading: false, assigned: null }),
}))

import { StorageLocationManager } from './StorageLocationManager'

const row = (name: string) => screen.getByTestId(`zone-row-${name}`)

describe('zone manager — own counts, a labelled roll-up on parents, each bottle once', () => {
  it('a parent keeps its own count and adds a labelled total for everything inside it', () => {
    render(<StorageLocationManager isOpen onClose={() => {}} />)
    const cellar = within(row('Cellar'))
    expect(cellar.getByText('5/100')).toBeTruthy()
    expect(cellar.getByText('With the 2 zones inside: 21/150')).toBeTruthy()
    const rack = within(row('Rack A'))
    expect(rack.getByText('12/40')).toBeTruthy()
    expect(rack.getByText('With the zone inside: 16/50')).toBeTruthy()
  })

  it('a zone with nothing inside shows only its own count', () => {
    render(<StorageLocationManager isOpen onClose={() => {}} />)
    const shelf = within(row('Shelf 2'))
    expect(shelf.getByText('4/10')).toBeTruthy()
    expect(shelf.queryByText(/^With the/)).toBeNull()
  })

  it('the footer counts each bottle once: 21, not 21 + 16 + own counts', () => {
    render(<StorageLocationManager isOpen onClose={() => {}} />)
    expect(screen.getByText(/3 locations • 21 bottles •/)).toBeTruthy()
  })
})
