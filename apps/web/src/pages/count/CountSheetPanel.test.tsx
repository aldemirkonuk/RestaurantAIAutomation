/**
 * A stock-take on paper, on the review page (F-1544 lane 6). Each case fails
 * on the base, where the panel did not exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const csv = vi.hoisted(() => ({ text: '' }))
const sessions = vi.hoisted(() => ({
  pullCountSession: vi.fn(),
  parkCountLine: vi.fn(async () => ({})),
  markCountShelfDone: vi.fn(async () => ({ done: true })),
}))
const inventory = vi.hoisted(() => ({
  getInventory: vi.fn(async () => [{ id: 'gin', wineName: 'Gin', wineProducer: null, wineVintage: null }]),
  recordSpotCount: vi.fn(async (..._a: unknown[]) => ({ item: null, count: { held: false } })),
}))
const exported = vi.hoisted(() => ({ exportTable: vi.fn(async (..._a: unknown[]) => {}) }))
vi.mock('@/services/api/countSessions', () => sessions)
vi.mock('@/services/api/inventory', () => inventory)
vi.mock('@/lib/houseZone', () => ({ useHouseZone: () => 'Europe/Istanbul' }))
vi.mock('@/lib/houseCurrency', () => ({ getHouseLocale: () => 'tr-TR' }))
vi.mock('@/lib/tableExport', async (orig) => ({
  ...(await orig<typeof import('@/lib/tableExport')>()),
  exportTable: exported.exportTable,
}))
vi.mock('@/lib/csvImport', async (orig) => ({
  ...(await orig<typeof import('@/lib/csvImport')>()),
  readCsvFile: vi.fn(async () => csv.text),
}))

import { CountSheetPanel } from './CountSheetPanel'

const SESSION = {
  id: 'S1',
  kind: 'closing',
  status: 'open',
  openedAt: '2026-10-12T20:00:00.000Z',
  shelves: [
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
      items: [{ inventoryId: 'gin', name: 'Gin', producer: '', vintage: null, countWhole: false }],
    },
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
  ],
}

function open(onSent = vi.fn()) {
  render(<CountSheetPanel sessionId="S1" house="h1" onSent={onSent} />)
  fireEvent.click(screen.getByRole('button', { name: 'Count on paper' }))
  return onSent
}

function load() {
  fireEvent.change(screen.getByLabelText('Filled count sheet (CSV)'), {
    target: { files: [new File(['x'], 'sheet.csv', { type: 'text/csv' })] },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  sessions.pullCountSession.mockResolvedValue(SESSION)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T06:00:00.000Z'))
})

describe('CountSheetPanel (F-1544 lane 6)', () => {
  it("downloads the count's blind sheet", async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Download the sheet' }))
    await waitFor(() => expect(exported.exportTable).toHaveBeenCalled())
    const opts = exported.exportTable.mock.calls[0][0] as { format: string; rows: Array<{ item: string; sessionId: string }> }
    expect(opts.format).toBe('csv')
    expect(opts.rows.map((r) => r.item)).toEqual(['Gin', '', 'Kavaklıdere', ''])
    expect(opts.rows.every((r) => r.sessionId === 'S1')).toBe(true)
  })

  it('previews, names the refused shelf, and sends nothing until Send', async () => {
    csv.text = [
      'Count;Shelf;Shelf code;Item;Item code;Full bottles;Open (tenths);Counted at',
      'S1;Back bar;L1;Gin;gin;3;5;13.10.2026 01:30',
      'S1;Cellar;L2;Kavaklıdere;kav;2;;',
    ].join('\n')
    const onSent = open()
    load()
    expect(await screen.findByText('Every item has a number, so the shelf is done.')).toBeTruthy()
    expect(screen.getByText(/Cellar, not sent \(1 line\): No time is written/)).toBeTruthy()
    expect(inventory.recordSpotCount).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Send 1 line' }))
    await waitFor(() => expect(sessions.markCountShelfDone).toHaveBeenCalled())
    expect(inventory.recordSpotCount).toHaveBeenCalledWith(
      'gin',
      expect.objectContaining({
        countedQty: 3,
        openTenths: 5,
        sessionId: 'S1',
        locationId: 'L1',
        countedAgoMs: Date.parse('2026-10-13T06:00:00.000Z') - Date.parse('2026-10-12T22:30:00.000Z'),
      }),
      'h1',
    )
    expect(await screen.findByText('Back bar: 1 counted, shelf done')).toBeTruthy()
    expect(onSent).toHaveBeenCalled()
  })

  it('says a whole file from another count is refused and offers nothing to send', async () => {
    csv.text = 'Count,Shelf,Item,Full bottles,Counted at\nS9,Back bar,Gin,3,2026-10-13 01:30'
    open()
    load()
    expect(await screen.findByText(/This sheet is from another count/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Send/ })).toBeNull()
  })
})
