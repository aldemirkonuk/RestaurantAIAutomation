/**
 * Founder answer 2026-09-29 on nested-zone totals, verbatim pick "Show both
 * (Recommended)": "Parent shows its own bottles plus a rolled-up total for
 * everything inside, clearly labelled. Nothing hidden, no double counting in
 * reports."
 *
 * On the cellar map each zone card keeps its own bottles / slots line, and a
 * zone with zones inside it also carries a labelled line for itself plus
 * everything below it. A zone with nothing inside gets no such line.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { CellarMapView } from './CellarMapView'
import type { StorageLocation } from '../../../hooks/useStorageLocations'
import type { InventoryItem } from '../useInventoryPage'

const CELLAR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const RACK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const BAR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const zone = (id: string, name: string, capacity: number | null, parentId?: string): StorageLocation => ({
  id,
  name,
  capacity,
  currentCount: 0,
  color: '#be123c',
  ...(parentId ? { parentId } : {}),
})

const item = (id: string, name: string, at: Array<[string, number]>) =>
  ({
    inventoryId: id,
    name,
    liveStock: 50,
    shadowStock: 0,
    threshold: 1,
    locations: at.map(([locationId, qty]) => ({ locationId, qty, wac: null })),
  }) as unknown as InventoryItem

function draw() {
  render(
    <CellarMapView
      items={[
        item('i1', 'Barolo', [[CELLAR, 5], [RACK, 12]]),
        item('i2', 'Chablis', [[BAR, 3]]),
      ]}
      locations={[zone(CELLAR, 'Cellar', 100), zone(RACK, 'Rack A', 40, CELLAR), zone(BAR, 'Bar', null)]}
      onOpenInTable={() => {}}
      onManageLocations={() => {}}
    />,
  )
}

const card = (name: string) => screen.getByTestId(`zone-card-${name}`)

describe('cellar map — a parent shows its own count and a labelled roll-up', () => {
  it('the parent keeps its own bottles and adds a labelled total for itself and the zone inside', () => {
    draw()
    const cellar = within(card('Cellar'))
    expect(cellar.getByText(/^5 \/ 100 slots/)).toBeTruthy()
    expect(cellar.getByText('With the zone inside: 17/140')).toBeTruthy()
  })

  it('a zone with nothing inside shows only its own count', () => {
    draw()
    const rack = within(card('Rack A'))
    expect(rack.getByText(/^12 \/ 40 slots/)).toBeTruthy()
    expect(rack.queryByText(/^With the/)).toBeNull()
    expect(within(card('Bar')).queryByText(/^With the/)).toBeNull()
  })
})
