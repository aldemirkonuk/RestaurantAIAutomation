/**
 * Zones nest (founder answer 2026-09-29, "Add parent column (Recommended)":
 * Cellar → Rack A → Shelf 2). The zone list shows the tree, and the parent
 * picker never offers a choice the gateway and the database would refuse:
 * the zone itself, a zone already inside it (a cycle), or a zone the server
 * has not given an id yet.
 */
import { describe, it, expect } from 'vitest'
import { nestZones, parentChoices, zonesInside } from './zoneNesting'

const CELLAR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const RACK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SHELF = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const BAR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

// Deliberately out of tree order: the list is ordered by display_order, not by
// nesting, and a child may come before its parent.
const zones = [
  { id: SHELF, name: 'Shelf 2', parentId: RACK },
  { id: BAR, name: 'Bar' },
  { id: CELLAR, name: 'Cellar' },
  { id: RACK, name: 'Rack A', parentId: CELLAR },
]

describe('nestZones', () => {
  it('puts each zone under its parent, depth-first, keeping sibling order', () => {
    expect(nestZones(zones).map((n) => [n.zone.name, n.depth, n.parentName ?? null])).toEqual([
      ['Bar', 0, null],
      ['Cellar', 0, null],
      ['Rack A', 1, 'Cellar'],
      ['Shelf 2', 2, 'Rack A'],
    ])
  })

  it('shows a zone whose parent is not in the list at the top level, not hidden', () => {
    const out = nestZones([{ id: RACK, name: 'Rack A', parentId: 'gone' }])
    expect(out).toHaveLength(1)
    expect(out[0].depth).toBe(0)
  })

  it('shows every zone once even if the data holds a loop', () => {
    const loop = [
      { id: CELLAR, name: 'Cellar', parentId: RACK },
      { id: RACK, name: 'Rack A', parentId: CELLAR },
    ]
    expect(nestZones(loop).map((n) => n.zone.id).sort()).toEqual([CELLAR, RACK].sort())
  })
})

describe('parentChoices', () => {
  it('never offers the zone itself or anything inside it', () => {
    const ids = parentChoices(zones, CELLAR).map((n) => n.zone.id)
    expect(ids).toEqual([BAR])
  })

  it('offers every saved zone, nested, when creating', () => {
    const out = parentChoices(zones, undefined)
    expect(out.map((n) => [n.zone.name, n.depth])).toEqual([
      ['Bar', 0],
      ['Cellar', 0],
      ['Rack A', 1],
      ['Shelf 2', 2],
    ])
  })

  it('does not offer a zone still on its temporary id (the gateway would 400 it)', () => {
    const out = parentChoices([...zones, { id: 'loc-1727600000000', name: 'Unsaved' }], undefined)
    expect(out.map((n) => n.zone.name)).not.toContain('Unsaved')
  })
})

describe('zonesInside', () => {
  it('counts the zones directly inside one', () => {
    expect(zonesInside(zones, CELLAR)).toBe(1)
    expect(zonesInside(zones, SHELF)).toBe(0)
  })
})
