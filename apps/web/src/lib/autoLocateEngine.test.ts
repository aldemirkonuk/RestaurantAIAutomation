import { describe, it, expect } from 'vitest'
import { computeAutoLocatePlan, type WineInput } from './autoLocateEngine'
import type { StorageLocation } from '../hooks/useStorageLocations'

/**
 * F-741. Auto-locate filed beers and spirits as red wine: a keg typed "red"
 * earned "Temperature match" at a red-wine zone and was grouped with the
 * reds, and the name signal was a substring test, so "Covered terrace"
 * (c-o-v-e-RED) earned every red row +15.
 */
const row = (o: Partial<WineInput>): WineInput =>
  ({ id: 'w', name: 'Row', type: 'unknown', liveStock: 1, shadowStock: 0, saleType: 'bottle', ...o }) as WineInput

const zone = (o: Partial<StorageLocation>): StorageLocation =>
  ({ id: 'z', name: 'Zone', capacity: 100, currentCount: 0, color: '#000', ...o }) as StorageLocation

describe('computeAutoLocatePlan — the kind of drink decides where it goes', () => {
  // A beer row still carrying the old "red" (the mapper's default before
  // F-728) must be read by its kind, not by that colour.
  it('does not give a beer a red-wine temperature match', () => {
    const beer = row({ id: 'beer', name: 'Bomonti', kind: 'beer', type: 'red' })
    const plan = computeAutoLocatePlan([beer], [zone({ id: 'reds', name: 'Cellar A', temperature: '62°F' })], [])
    expect(plan.assignments[0].reasons).not.toContain('Temperature match')
  })

  it('still gives a red wine its temperature match', () => {
    const red = row({ id: 'red', name: 'Yakut', kind: 'wine', type: 'red' })
    const plan = computeAutoLocatePlan([red], [zone({ id: 'reds', name: 'Cellar A', temperature: '62°F' })], [])
    expect(plan.assignments[0].reasons).toContain('Temperature match')
  })

  it('matches zone names on whole words, so "Covered terrace" is not a red zone', () => {
    const red = row({ id: 'red', name: 'Yakut', kind: 'wine', type: 'red' })
    const plan = computeAutoLocatePlan(
      [red],
      [zone({ id: 'terrace', name: 'Covered terrace', capacity: 100 }), zone({ id: 'reds', name: 'Red rack', capacity: 100 })],
      [],
    )
    expect(plan.assignments[0].locationId).toBe('reds')
    expect(plan.assignments[0].reasons).toContain('Location name suggests wine type')
  })

  it('groups a beer with beer, not with the reds', () => {
    const placedRed = row({ id: 'placed-red', name: 'Old red', kind: 'wine', type: 'red' })
    const placedBeer = row({ id: 'placed-beer', name: 'Old beer', kind: 'beer', type: 'red' })
    const beer = row({ id: 'beer', name: 'Efes', kind: 'beer', type: 'red' })
    const mappings = [
      { wineId: 'placed-red', locationId: 'reds', quantity: 1, assignedAt: '' },
      { wineId: 'placed-beer', locationId: 'beers', quantity: 1, assignedAt: '' },
    ] as never
    const plan = computeAutoLocatePlan(
      [placedRed, placedBeer, beer],
      [zone({ id: 'reds', name: 'Cellar A' }), zone({ id: 'beers', name: 'Cellar B' })],
      mappings,
    )
    const a = plan.assignments.find((x) => x.wineId === 'beer')!
    expect(a.locationId).toBe('beers')
    expect(a.wineType).toBe('beer')
  })

  it('reads a zone named for beer as a beer zone', () => {
    const beer = row({ id: 'beer', name: 'Efes', kind: 'beer' })
    const plan = computeAutoLocatePlan(
      [beer],
      [zone({ id: 'other', name: 'Stored stock' }), zone({ id: 'beers', name: 'Beer fridge' })],
      [],
    )
    expect(plan.assignments[0].locationId).toBe('beers')
  })
})
