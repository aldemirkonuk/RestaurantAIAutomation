/**
 * The phone stock-take's rules (F-1544 lane 3), without a screen.
 * Every case fails on the base: the module did not exist.
 */
import { describe, expect, it } from 'vitest'
import type { CountShelf } from '../../services/api/countSessions'
import {
  emptyWalk,
  findItems,
  forgetRecounted,
  lineBody,
  lineKey,
  nextShelf,
  readSealed,
  readWalk,
  refusedDone,
  shelfStatus,
  stepTenths,
  tenthsWords,
  untouchedOnShelf,
  type WalkLine,
} from './countWalkModel'

const shelf = (id: string, over: Partial<CountShelf> = {}): CountShelf => ({
  locationId: id,
  name: `Shelf ${id}`,
  order: 0,
  claimedByMe: false,
  claimedBy: null,
  claimedAt: null,
  done: false,
  doneAt: null,
  doneBy: null,
  items: [
    { inventoryId: 'a', name: 'Kavaklıdere', producer: '', vintage: '2021', countWhole: false },
    { inventoryId: 'b', name: 'Barolo', producer: 'Vietti', vintage: null, countWhole: false },
    { inventoryId: 'w', name: 'House red', producer: '', vintage: null, countWhole: true },
  ],
  ...over,
})

const line = (over: Partial<WalkLine> = {}): WalkLine => ({
  locationId: 's1',
  itemId: 'a',
  itemLabel: 'Kavaklıdere 2021',
  sealed: 4,
  tenths: null,
  clientCountId: 'k1',
  at: '2026-10-12T22:00:00.000Z',
  state: 'sent',
  ...over,
})

describe('open bottles in tenths (F3 a)', () => {
  it('says tenths with a slash, never a decimal point, so a TR and a US house read it alike', () => {
    expect(tenthsWords(null)).toBe('Open bottle not counted')
    expect(tenthsWords(0)).toBe('No open bottle')
    expect(tenthsWords(7)).toBe('7/10 of a bottle open')
    expect(tenthsWords(13)).toBe('1 bottle and 3/10 open')
    expect(tenthsWords(20)).toBe('2 bottles open')
    for (const t of [7, 13, 25]) expect(tenthsWords(t)).not.toMatch(/[.,]\d/)
  })

  it('steps from not counted, to tenths, down to none, then back to not counted', () => {
    expect(stepTenths(null, 1)).toBe(1)
    expect(stepTenths(1, -1)).toBe(0)
    expect(stepTenths(0, -1)).toBeNull()
    expect(stepTenths(null, -1)).toBeNull()
  })

  it('reads a typed bottle count only as a whole number', () => {
    expect(readSealed('12')).toBe(12)
    expect(readSealed(' 0 ')).toBe(0)
    expect(readSealed('1,5')).toBeNull()
    expect(readSealed('-1')).toBeNull()
    expect(readSealed('')).toBeNull()
  })
})

describe('a walk line is a line of its count, through the one count route', () => {
  it('names the count and the shelf, and sends open bottles only when counted', () => {
    expect(lineBody('S', 'closing', line())).toEqual({
      countedQty: 4,
      stockState: 'live',
      clientCountId: 'k1',
      reason: 'Stock-take',
      locationId: 's1',
      sessionId: 'S',
    })
    expect(lineBody('S', 'closing', line({ tenths: 7 }))).toMatchObject({ openTenths: 7 })
    expect(lineBody('S', 'closing', line({ tenths: 0 }))).toMatchObject({ openTenths: 0 })
  })

  it('marks an opening count as one (ADR 0335 §2)', () => {
    expect(lineBody('S', 'opening', line())).toMatchObject({ opening: true, reason: 'Opening stock' })
    expect(lineBody('S', 'full', line())).not.toHaveProperty('opening')
  })
})

describe('"shelf done" zeroes only what was not counted', () => {
  it('lists the expected items with no line on this shelf, never an item counted whole (F-945)', () => {
    const w = emptyWalk()
    w.lines[lineKey('s1', 'a')] = line()
    expect(untouchedOnShelf(shelf('s1'), w).map((i) => i.inventoryId)).toEqual(['b'])
  })

  it('a line on another shelf does not count for this one (F-291)', () => {
    const w = emptyWalk()
    w.lines[lineKey('s2', 'a')] = line({ locationId: 's2' })
    expect(untouchedOnShelf(shelf('s1'), w).map((i) => i.inventoryId)).toEqual(['a', 'b'])
  })
})

describe('the shelf list', () => {
  it('says who holds a shelf, and which need counting again', () => {
    const w = emptyWalk()
    expect(shelfStatus(shelf('s1', { claimedBy: 'Ayşe' }), w).words).toBe('Ayşe is counting')
    expect(shelfStatus(shelf('s1', { done: true, doneBy: 'Sam' }), w).words).toBe('Done by Sam')
    w.dones.s1 = { clientDoneId: 'd', state: 'refused' }
    expect(shelfStatus(shelf('s1'), w).tone).toBe('recount')
  })

  it('walks on to the next shelf nobody has done or taken', () => {
    const w = emptyWalk()
    const list = [shelf('1'), shelf('2', { done: true }), shelf('3', { claimedBy: 'Ayşe' }), shelf('4')]
    expect(nextShelf(list, w, '1')?.locationId).toBe('4')
    expect(nextShelf(list, w, '4')?.locationId).toBe('1')
  })
})

describe('find a bottle', () => {
  const items = [
    { id: '1', name: 'Kavaklıdere Yakut', producer: 'Kavaklıdere', vintage: 2020 },
    { id: '2', name: 'İzmir Rakı', producer: null, vintage: null },
    { id: '3', name: 'Barolo', producer: 'Vietti', vintage: 2019 },
  ]
  it('matches every word, folding case, accents and the Turkish i', () => {
    expect(findItems(items, 'kavaklidere 2020').map((i) => i.id)).toEqual(['1'])
    expect(findItems(items, 'izmir').map((i) => i.id)).toEqual(['2'])
    expect(findItems(items, 'VIETTI').map((i) => i.id)).toEqual(['3'])
    expect(findItems(items, '   ')).toEqual([])
  })

  it('finds a renamed wine by the library name too, showing the house name (F-1620, ADR 0124)', () => {
    const renamed = [{ id: '9', name: 'Ev Kırmızısı', alsoKnownAs: 'Kavaklıdere Yakut', producer: null, vintage: null }]
    expect(findItems(renamed, 'yakut').map((i) => i.name)).toEqual(['Ev Kırmızısı'])
  })
})

describe('a "done" the house could not close (F-1616, F-1619)', () => {
  it('keeps the zeros that posted as lines and the items to count again, so the next done does not resend them', () => {
    const w = refusedDone(
      emptyWalk(),
      shelf('s1'),
      'd1',
      { posted: ['a'], held: [], refused: [{ inventoryId: 'b', reason: 'moved' }], message: 'Count again' },
      '2026-10-12T22:00:00.000Z',
    )
    expect(w.dones.s1).toEqual({ clientDoneId: 'd1', state: 'refused', recount: ['b'], message: 'Count again' })
    expect(w.lines[lineKey('s1', 'a')]).toMatchObject({ sealed: 0, tenths: 0, state: 'sent', itemLabel: 'Kavaklıdere 2021' })
    expect(untouchedOnShelf(shelf('s1'), w).map((i) => i.inventoryId)).toEqual(['b'])
  })

  it('never overwrites a line this phone already holds', () => {
    const before = emptyWalk()
    before.lines[lineKey('s1', 'a')] = line({ sealed: 3 })
    const w = refusedDone(before, shelf('s1'), 'd1', { posted: ['a'], held: [], refused: [] }, 'x')
    expect(w.lines[lineKey('s1', 'a')].sealed).toBe(3)
  })
})

describe('the walk kept on this phone', () => {
  it('reads as empty when storage holds nothing or refuses', () => {
    expect(readWalk('mdv:none')).toEqual(emptyWalk())
  })
})

describe('a shelf a manager sent back (F-1544 lane 4)', () => {
  const ASKED = '2026-10-12T22:00:00.000Z'
  const before = line({ locationId: 'L1', itemId: 'a', at: '2026-10-12T21:30:00.000Z' })
  const after = line({ locationId: 'L1', itemId: 'b', at: '2026-10-12T22:05:00.000Z' })
  const other = line({ locationId: 'L2', itemId: 'a', at: '2026-10-12T21:30:00.000Z' })
  const walked = () => ({
    ...emptyWalk(),
    lines: {
      [lineKey('L1', 'a')]: before,
      [lineKey('L1', 'b')]: after,
      [lineKey('L2', 'a')]: other,
    },
    dones: {
      L1: { clientDoneId: 'd1', state: 'sent' as const },
      L2: { clientDoneId: 'd2', state: 'sent' as const },
    },
  })

  it('forgets the old pass on that shelf only, keeps lines after the ask, and reads as not started', () => {
    const sent = shelf('L1', { round: 1, recountAskedAt: ASKED })
    const { walk, forgot } = forgetRecounted(walked(), { shelves: [sent, shelf('L2')] })
    expect(forgot).toEqual(['L1'])
    expect(Object.keys(walk.lines).sort()).toEqual([lineKey('L1', 'b'), lineKey('L2', 'a')])
    expect(walk.dones.L1).toBeUndefined()
    expect(walk.dones.L2).toBeDefined()
    expect(walk.rounds).toEqual({ L1: 1 })
    expect(shelfStatus(sent, walk).tone).toBe('open')
  })

  it('forgets once per round: a line counted again later is kept on the next pull', () => {
    const sent = shelf('L1', { round: 1, recountAskedAt: ASKED })
    const once = forgetRecounted(walked(), { shelves: [sent] }).walk
    const recounted = {
      ...once,
      lines: { ...once.lines, [lineKey('L1', 'a')]: line({ ...before, at: '2026-10-12T21:00:00.000Z' }) },
    }
    const again = forgetRecounted(recounted, { shelves: [sent] })
    expect(again.walk).toBe(recounted)
    expect(again.forgot).toEqual([])
  })

  it('control: a walk no shelf of which was sent back is left exactly as it was', () => {
    const w = walked()
    const out = forgetRecounted(w, { shelves: [shelf('L1'), shelf('L2', { round: 0 })] })
    expect(out.walk).toBe(w)
    expect(out.forgot).toEqual([])
  })

  it('keeps the rounds it saw across a reload of the phone', () => {
    const w = { ...emptyWalk(), rounds: { L1: 2 } }
    localStorage.setItem('walk-test', JSON.stringify(w))
    expect(readWalk('walk-test').rounds).toEqual({ L1: 2 })
    localStorage.removeItem('walk-test')
  })
})
