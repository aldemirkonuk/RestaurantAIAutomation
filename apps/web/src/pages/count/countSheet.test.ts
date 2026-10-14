/**
 * A stock-take on paper (F-1544 lane 6). Every case fails on the base, where
 * `countSheet.ts` did not exist: the count could not leave as a sheet, and a
 * filled sheet had no way back in.
 */
import { describe, expect, it, vi } from 'vitest'
import type { CountSession } from '@/services/api/countSessions'
import {
  countSheetColumns,
  countSheetRows,
  parseCountedAt,
  planCountSheet,
  sendCountSheet,
  type SheetSendApi,
} from './countSheet'

const OPENED = '2026-10-12T20:00:00.000Z' // 23:00 in Istanbul
const NOW = Date.parse('2026-10-13T06:00:00.000Z') // 09:00 in Istanbul
const ZONE = 'Europe/Istanbul'

function session(over: Partial<CountSession> = {}): CountSession {
  return {
    id: 'S1',
    kind: 'closing',
    status: 'open',
    openedAt: OPENED,
    shelves: [
      {
        locationId: 'L2',
        name: 'Cellar',
        order: 2,
        claimedByMe: false,
        claimedBy: null,
        claimedAt: null,
        done: false,
        doneAt: null,
        doneBy: null,
        items: [{ inventoryId: 'kav', name: 'Kavaklıdere', producer: '', vintage: null, countWhole: false }],
      },
      {
        locationId: 'L1',
        name: 'Back bar',
        order: 1,
        claimedByMe: false,
        claimedBy: null,
        claimedAt: null,
        done: false,
        doneAt: null,
        doneBy: null,
        items: [
          { inventoryId: 'yakut', name: 'Yakut', producer: 'Kavaklıdere', vintage: '2020', countWhole: false },
          { inventoryId: 'gin', name: 'Gin', producer: '', vintage: null, countWhole: false },
          { inventoryId: 'whole', name: 'Rakı', producer: '', vintage: null, countWhole: true },
        ],
      },
    ],
    ...over,
  }
}

const HOUSE_ITEMS = [
  { id: 'yakut', name: 'Yakut', producer: 'Kavaklıdere', vintage: 2020 },
  { id: 'gin', name: 'Gin', producer: null, vintage: null },
  { id: 'vodka', name: 'Vodka', producer: null, vintage: null },
  { id: 'syrah1', name: 'Syrah', producer: 'A', vintage: 2019 },
  { id: 'syrah2', name: 'Syrah', producer: 'B', vintage: 2021 },
]

const HEAD = ['Count', 'Shelf', 'Shelf code', 'Item', 'Producer', 'Vintage', 'Item code', 'Full bottles', 'Open (tenths)', 'Counted at']

/** The exported sheet as the CSV reader hands it back, then filled in. */
function filled(fill: Record<string, [string, string, string]>, s = session()): string[][] {
  const rows = countSheetRows(s).map((r) => countSheetColumns.map((c) => String(c.value(r) ?? '')))
  return [
    HEAD,
    ...rows.map((r) => {
      const f = fill[`${r[2]}:${r[6]}`]
      return f ? [...r.slice(0, 7), ...f] : r
    }),
  ]
}

const plan = (rows: string[][], over: Partial<Parameters<typeof planCountSheet>[1]> = {}) =>
  planCountSheet(rows, { session: session(), items: HOUSE_ITEMS, zone: ZONE, locale: 'tr-TR', now: NOW, ...over })

describe('the count sheet out', () => {
  it('is blind: shelves in walk order, the count id and codes, no expected figure or price, blank boxes', () => {
    const rows = countSheetRows(session())
    expect(countSheetColumns.map((c) => c.header)).toEqual(HEAD)
    expect(rows.map((r) => `${r.shelf}:${r.item}`)).toEqual(['Back bar:Yakut', 'Back bar:Gin', 'Back bar:', 'Cellar:Kavaklıdere', 'Cellar:'])
    expect(rows.every((r) => r.sessionId === 'S1')).toBe(true)
    // An item counted whole (F-945) is not on a shelf's sheet, as in the walk.
    expect(rows.some((r) => r.inventoryId === 'whole')).toBe(false)
    const cells = rows.map((r) => countSheetColumns.slice(7).map((c) => c.value(r)))
    expect(cells.flat().every((v) => v === '')).toBe(true)
    expect(JSON.stringify(rows)).not.toMatch(/expected|qty|cost|value/i)
  })
})

describe('when a shelf was counted', () => {
  it('reads the house clock, not the device clock', () => {
    // 01:30 in Istanbul is 22:30 UTC the evening before.
    expect(parseCountedAt('2026-10-13 01:30', ZONE, 'tr-TR')).toBe(Date.parse('2026-10-12T22:30:00Z'))
    expect(parseCountedAt('13.10.2026 01:30', ZONE, 'tr-TR')).toBe(Date.parse('2026-10-12T22:30:00Z'))
    expect(parseCountedAt('13/10/2026 01:30:00', ZONE, 'tr-TR')).toBe(Date.parse('2026-10-12T22:30:00Z'))
    // A US house's Excel writes month first, with AM/PM.
    expect(parseCountedAt('10/13/2026 1:30 AM', 'America/New_York', 'en-US')).toBe(Date.parse('2026-10-13T05:30:00Z'))
    expect(parseCountedAt('10/12/2026 11:45 PM', 'America/New_York', 'en-US')).toBe(Date.parse('2026-10-13T03:45:00Z'))
  })

  it('refuses what is not a real day and time', () => {
    for (const bad of ['', 'yesterday', '01:30', '2026-02-30 10:00', '2026-10-13 25:00', '13/13/2026 10:00', '10/13/2026 13:00 PM']) {
      expect(parseCountedAt(bad, ZONE, 'tr-TR')).toBeNull()
    }
  })
})

describe('the filled sheet in', () => {
  it('posts each counted line on its shelf at the shelf time, and closes a shelf where every item has a number', () => {
    const p = plan(
      filled({
        'L1:yakut': ['4', '5', '2026-10-13 01:30'],
        'L1:gin': ['0', '', ''],
        'L2:kav': ['2', '', ''],
      }),
    )
    expect(p.fileProblem).toBeNull()
    expect(p.refused).toEqual([])
    const [bar, cellar] = p.shelves
    expect(bar.name).toBe('Back bar')
    expect(bar.countedAt).toBe(Date.parse('2026-10-12T22:30:00Z'))
    expect(bar.lines.map((l) => [l.inventoryId, l.sealed, l.tenths])).toEqual([
      ['yakut', 4, 5],
      ['gin', 0, null],
    ])
    expect(bar.closes).toBe(true)
    // A shelf with numbers and no time is not sent: when it was counted is
    // what the stock is checked against.
    expect(cellar).toBeUndefined()
    expect(p.refusedShelves).toEqual([
      { name: 'Cellar', reason: 'No time is written for when this shelf was counted.', lines: 1 },
    ])
  })

  it('never reads a blank as 0: the shelf stays not counted and names what has no number', () => {
    const p = plan(filled({ 'L1:yakut': ['4', '', '2026-10-13 01:30'] }))
    expect(p.shelves).toHaveLength(1)
    expect(p.shelves[0].lines.map((l) => l.inventoryId)).toEqual(['yakut'])
    expect(p.shelves[0].closes).toBe(false)
    expect(p.shelves[0].notCounted).toEqual(['Gin'])
  })

  it('a shelf already done takes the sheet as second counts and is not closed again', () => {
    const s = session()
    s.shelves[1].done = true
    const p = plan(filled({ 'L1:yakut': ['4', '', '2026-10-13 01:30'], 'L1:gin': ['1', '', ''] }, s), { session: s })
    expect(p.shelves[0].alreadyDone).toBe(true)
    expect(p.shelves[0].closes).toBe(false)
  })

  it('names the shelf it refuses for its time, and why', () => {
    const at = (t: string) => plan(filled({ 'L1:yakut': ['4', '', t] })).refusedShelves.map((s) => s.reason)
    expect(at('tonight')).toEqual(['"tonight" could not be read as a time. Write it like 2026-10-13 01:30.'])
    expect(at('2026-10-13 12:30')).toEqual(['The time written for this shelf has not come yet.'])
    expect(at('2026-10-12 21:00')).toEqual(['The time written for this shelf is before this count was opened.'])
    const two = plan(filled({ 'L1:yakut': ['4', '', '2026-10-13 01:30'], 'L1:gin': ['1', '', '2026-10-13 02:30'] }))
    expect(two.refusedShelves[0].reason).toBe('Two different times are written for this shelf. Write one.')
    expect(two.shelves).toEqual([])
  })

  it('reads a bottle written in by name: from the shelf, from the house, or parked when the house does not carry it', () => {
    const rows = filled({ 'L1:yakut': ['4', '', '2026-10-13 01:30'] })
    rows.push(['S1', 'Back bar', '', 'vodka', '', '', '', '2', '', ''])
    rows.push(['', 'back BAR', '', 'Mystery Malbec', 'Nobody', '2018', '', '1', '3', ''])
    rows.push(['S1', 'Back bar', '', 'Syrah', '', '', '', '1', '', ''])
    rows.push(['S1', 'Back bar', '', 'Syrah', '', '2021', '', '1', '', ''])
    const p = plan(rows)
    const bar = p.shelves[0]
    expect(bar.lines.map((l) => l.inventoryId)).toEqual(['yakut', 'vodka', 'syrah2'])
    expect(bar.parked).toEqual([{ line: 8, description: 'Mystery Malbec Nobody 2018', sealed: 1, openDropped: true }])
    expect(p.refused).toEqual([{ line: 9, label: 'Syrah', reason: 'More than one item is called "Syrah". Add its year or maker.' }])
  })

  it('refuses a line it cannot read, and says why', () => {
    const rows = filled({ 'L1:yakut': ['4', '', '2026-10-13 01:30'] })
    rows.push(['S1', 'Back bar', '', '', '', '', 'gin', 'two', '', ''])
    rows.push(['S1', 'Back bar', '', '', '', '', 'gin', '1', '101', ''])
    rows.push(['S1', 'Back bar', '', '', '', '', 'gin', '', '3', ''])
    rows.push(['S1', 'Back bar', '', '', '', '', 'whole', '1', '', ''])
    rows.push(['S1', 'Back bar', '', '', '', '', 'nope', '1', '', ''])
    rows.push(['S1', 'Bar 9', '', 'Gin', '', '', '', '1', '', ''])
    rows.push(['S1', '', '', 'Gin', '', '', '', '1', '', ''])
    rows.push(['S1', 'Back bar', '', 'Yakut', '', '', '', '5', '', ''])
    rows.push(['S2', 'Back bar', 'L1', 'Gin', '', '', 'gin', '1', '', ''])
    const p = plan(rows)
    expect(p.refused.map((r) => r.reason)).toEqual([
      '"two" is not a number of full bottles (a whole number).',
      '"101" is not tenths of a bottle (a whole number: 5 is half a bottle).',
      'Write the full bottles too, 0 if there are none.',
      'Some of this sits off the shelves. Count it on Inventory, all at once.',
      "The Item code is not one of this house's items.",
      'No shelf called "Bar 9" in this count.',
      'No shelf on this line.',
      'Also on line 2 for this shelf; the first line is used.',
      'This line is from another count.',
    ])
    expect(p.shelves[0].lines.map((l) => l.inventoryId)).toEqual(['yakut'])
  })

  it('refuses the whole file when it is another count, a stopped count, or has no columns to read', () => {
    const other = filled({ 'L1:yakut': ['4', '', '2026-10-13 01:30'] }).map((r, i) => (i === 0 ? r : ['S9', ...r.slice(1)]))
    expect(plan(other).fileProblem).toMatch(/from another count/)
    expect(plan(filled({}), { session: session({ status: 'abandoned' }) }).fileProblem).toMatch(/stopped/)
    expect(plan([['Wine', 'Quantity'], ['Gin', '1']]).fileProblem).toMatch(/Shelf, Item and Full bottles/)
    expect(plan([HEAD]).fileProblem).toMatch(/no lines/)
  })

  it('reads the Turkish headers and the house decimal marks', () => {
    const rows = [
      ['Sayım', 'Raf', 'Ürün', 'Tam şişe', 'Açık', 'Sayım saati'],
      ['S1', 'Back bar', 'Gin', '1.000', '5', '13.10.2026 01.30'],
    ]
    const p = plan(rows)
    expect(p.shelves[0].lines).toEqual([{ line: 2, inventoryId: 'gin', name: 'Gin', sealed: 1000, tenths: 5 }])
  })

  it("drops the export's formula guard from a cell Excel kept it on", () => {
    const rows = [HEAD, ['S1', 'Back bar', 'L1', "'=Mystery", '', '', '', '1', '', '2026-10-13 01:30']]
    expect(plan(rows).shelves[0].parked[0].description).toBe('=Mystery')
  })
})

describe('sending the sheet', () => {
  const ok = () => ({
    recordSpotCount: vi.fn<SheetSendApi['recordSpotCount']>(async () => ({ count: { held: false } })),
    parkCountLine: vi.fn<SheetSendApi['parkCountLine']>(async () => ({})),
    markCountShelfDone: vi.fn<SheetSendApi['markCountShelfDone']>(async () => ({ done: true })),
  })
  const full = () => {
    const rows = filled({ 'L1:yakut': ['4', '5', '2026-10-13 01:30'], 'L1:gin': ['0', '', ''] })
    rows.push(['S1', 'Back bar', 'L1', 'Mystery', '', '', '', '2', '', ''])
    return plan(rows)
  }

  it('posts every line as a line of this count, on its shelf, aged from the shelf time, then says the shelf done', async () => {
    const api = ok()
    const out = await sendCountSheet(full(), { id: 'S1', kind: 'closing' }, api, () => NOW)
    const age = NOW - Date.parse('2026-10-12T22:30:00Z')
    expect(api.recordSpotCount).toHaveBeenCalledTimes(2)
    expect(api.recordSpotCount).toHaveBeenNthCalledWith(1, 'yakut', {
      countedQty: 4,
      stockState: 'live',
      clientCountId: `sheet:S1:L1:${Date.parse('2026-10-12T22:30:00Z')}:4:5`,
      reason: 'Stock-take, from a count sheet',
      countedAgoMs: age,
      locationId: 'L1',
      sessionId: 'S1',
      openTenths: 5,
    })
    // Every call names the count: nothing here is ever a spot count.
    for (const [, body] of api.recordSpotCount.mock.calls) expect(body.sessionId).toBe('S1')
    expect(api.recordSpotCount.mock.calls[1][1]).not.toHaveProperty('openTenths')
    expect(api.parkCountLine).toHaveBeenCalledWith('S1', expect.objectContaining({ description: 'Mystery', countedQty: 2, countedAgoMs: age }))
    expect(api.markCountShelfDone).toHaveBeenCalledWith('S1', 'L1', {
      clientDoneId: `sheet:S1:L1:${Date.parse('2026-10-12T22:30:00Z')}`,
      zeroItemIds: [],
      countedAgoMs: age,
    })
    expect(out).toEqual([
      { name: 'Back bar', posted: 2, held: [], parked: 1, refused: [], notSent: [], done: 'closed' },
    ])
  })

  it('sends the same sheet twice under the same keys, so the house replays it instead of counting again', async () => {
    const a = ok()
    const b = ok()
    await sendCountSheet(full(), { id: 'S1', kind: 'closing' }, a, () => NOW)
    await sendCountSheet(full(), { id: 'S1', kind: 'closing' }, b, () => NOW + 60_000)
    const keys = (api: ReturnType<typeof ok>) => [
      ...api.recordSpotCount.mock.calls.map((c) => c[1].clientCountId),
      ...api.parkCountLine.mock.calls.map((c) => c[1].clientLineId),
      ...api.markCountShelfDone.mock.calls.map((c) => c[2].clientDoneId),
    ]
    expect(keys(b)).toEqual(keys(a))
    expect(new Set(keys(a)).size).toBe(4)
  })

  it('a shelf the stock moved on is refused by the house, named, and not said done', async () => {
    const api = ok()
    api.recordSpotCount.mockImplementationOnce(async () => {
      throw { response: { status: 409, data: { message: 'Count this shelf again: some bottles moved after it was counted.' } } }
    })
    const out = await sendCountSheet(full(), { id: 'S1', kind: 'closing' }, api, () => NOW)
    expect(out[0].refused).toEqual([{ name: 'Yakut', reason: 'Count this shelf again: some bottles moved after it was counted.' }])
    expect(out[0].done).toBe('not-closed')
    expect(api.markCountShelfDone).not.toHaveBeenCalled()
  })

  it('keeps a line the house could not take for a later try, and a second count it held for the manager', async () => {
    const api = ok()
    api.recordSpotCount
      .mockImplementationOnce(async () => ({ count: { held: true } }))
      .mockImplementationOnce(async () => {
        throw new Error('Network Error')
      })
    const out = await sendCountSheet(full(), { id: 'S1', kind: 'closing' }, api, () => NOW)
    expect(out[0].held).toEqual(['Yakut'])
    expect(out[0].notSent).toEqual(['Gin'])
    expect(out[0].done).toBe('not-closed')
  })

  it('an opening count sends its lines as opening counts', async () => {
    const api = ok()
    await sendCountSheet(full(), { id: 'S1', kind: 'opening' }, api, () => NOW)
    expect(api.recordSpotCount.mock.calls[0][1]).toMatchObject({ opening: true, reason: 'Opening stock, from a count sheet' })
  })
})
