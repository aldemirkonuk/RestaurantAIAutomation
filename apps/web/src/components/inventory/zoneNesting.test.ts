/**
 * Zones nest (founder answer 2026-09-29, "Add parent column (Recommended)":
 * Cellar → Rack A → Shelf 2). The zone list shows the tree, and the parent
 * picker never offers a choice the gateway and the database would refuse:
 * the zone itself, a zone already inside it (a cycle), or a zone the server
 * has not given an id yet.
 */
import { describe, it, expect } from 'vitest'
import { nestZones, parentChoices, zonesInside, rolledUpTotals, rollupLabel } from './zoneNesting'

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

// Founder answer 2026-09-29 on nested-zone totals, verbatim pick "Show both
// (Recommended)": "Parent shows its own bottles plus a rolled-up total for
// everything inside, clearly labelled. Nothing hidden, no double counting in
// reports." Each zone keeps its own count; a parent ALSO gets a total of
// itself and every zone below it, at any depth.
describe('rolledUpTotals', () => {
  const counted = [
    { id: SHELF, name: 'Shelf 2', parentId: RACK, capacity: 10, currentCount: 4 },
    { id: BAR, name: 'Bar', capacity: 20, currentCount: 7 },
    { id: CELLAR, name: 'Cellar', capacity: 100, currentCount: 30 },
    { id: RACK, name: 'Rack A', parentId: CELLAR, capacity: 40, currentCount: 12 },
  ]
  const own = (z: { currentCount: number }) => z.currentCount

  it('gives a parent itself plus every zone below it, at any depth', () => {
    const r = rolledUpTotals(counted, own)
    expect(r.get(CELLAR)).toEqual({ bottles: 46, capacity: 150, capacityUnknown: 0, zonesInside: 2 })
    expect(r.get(RACK)).toEqual({ bottles: 16, capacity: 50, capacityUnknown: 0, zonesInside: 1 })
  })

  it('gives no roll-up to a zone with nothing inside it', () => {
    const r = rolledUpTotals(counted, own)
    expect(r.has(SHELF)).toBe(false)
    expect(r.has(BAR)).toBe(false)
  })

  it('leaves every zone its own count: the roll-up is added, never substituted', () => {
    const before = counted.map((z) => [z.id, z.currentCount])
    rolledUpTotals(counted, own)
    expect(counted.map((z) => [z.id, z.currentCount])).toEqual(before)
  })

  it('counts each bottle once across the house: own counts sum to the total, roll-ups are not added', () => {
    const r = rolledUpTotals(counted, own)
    const house = counted.reduce((s, z) => s + own(z), 0)
    expect(house).toBe(53)
    // The top-level roll-ups partition the house: every bottle is in exactly one.
    const tops = counted.filter((z) => !z.parentId)
    const viaTops = tops.reduce((s, z) => s + (r.get(z.id)?.bottles ?? own(z)), 0)
    expect(viaTops).toBe(house)
  })

  it('does not invent a capacity: unrecorded ones are counted and left out of the sum', () => {
    const r = rolledUpTotals(
      [
        { id: CELLAR, name: 'Cellar', capacity: null, currentCount: 5 },
        { id: RACK, name: 'Rack A', parentId: CELLAR, capacity: 40, currentCount: 12 },
        { id: SHELF, name: 'Shelf 2', parentId: RACK, capacity: null, currentCount: 1 },
      ],
      own,
    )
    expect(r.get(CELLAR)).toEqual({ bottles: 18, capacity: 40, capacityUnknown: 2, zonesInside: 2 })
    expect(r.get(RACK)).toEqual({ bottles: 13, capacity: 40, capacityUnknown: 1, zonesInside: 1 })
  })

  it('is null capacity when no zone in the subtree has one recorded', () => {
    const r = rolledUpTotals(
      [
        { id: CELLAR, name: 'Cellar', capacity: null, currentCount: 5 },
        { id: RACK, name: 'Rack A', parentId: CELLAR, capacity: null, currentCount: 2 },
      ],
      own,
    )
    expect(r.get(CELLAR)).toEqual({ bottles: 7, capacity: null, capacityUnknown: 2, zonesInside: 1 })
  })

  it('terminates and counts each zone once when the data holds a loop', () => {
    const r = rolledUpTotals(
      [
        { id: CELLAR, name: 'Cellar', parentId: RACK, capacity: 10, currentCount: 1 },
        { id: RACK, name: 'Rack A', parentId: CELLAR, capacity: 10, currentCount: 2 },
      ],
      own,
    )
    expect(r.get(CELLAR)?.bottles).toBe(3)
    expect(r.get(RACK)?.bottles).toBe(3)
  })

  it('takes the per-zone count from the caller (the map counts from inventory rows)', () => {
    const fromRows = new Map([[CELLAR, 1], [RACK, 2], [SHELF, 3]])
    const r = rolledUpTotals(counted, (z) => fromRows.get(z.id) ?? 0)
    expect(r.get(CELLAR)?.bottles).toBe(6)
  })
})

describe('rollupLabel', () => {
  it('names what it adds up, so it is never read as the zone’s own count', () => {
    expect(rollupLabel({ bottles: 46, capacity: 150, capacityUnknown: 0, zonesInside: 2 })).toBe(
      'With the 2 zones inside: 46/150',
    )
    expect(rollupLabel({ bottles: 16, capacity: 50, capacityUnknown: 0, zonesInside: 1 })).toBe(
      'With the zone inside: 16/50',
    )
  })

  it('says when part of the capacity is not recorded, and when none is', () => {
    expect(rollupLabel({ bottles: 18, capacity: 40, capacityUnknown: 2, zonesInside: 2 })).toBe(
      'With the 2 zones inside: 18/40 (2 zones have no capacity recorded)',
    )
    expect(rollupLabel({ bottles: 13, capacity: 40, capacityUnknown: 1, zonesInside: 1 })).toBe(
      'With the zone inside: 13/40 (1 zone has no capacity recorded)',
    )
    expect(rollupLabel({ bottles: 7, capacity: null, capacityUnknown: 2, zonesInside: 1 })).toBe(
      'With the zone inside: 7 bottles (no capacity recorded)',
    )
  })
})
