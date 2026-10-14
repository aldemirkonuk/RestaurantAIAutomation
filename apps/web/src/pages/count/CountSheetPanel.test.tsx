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
  recordCountSheetLoad: vi.fn(async (..._a: unknown[]) => ({ id: 'load-1', logged: true })),
}))
const inventory = vi.hoisted(() => ({
  getInventory: vi.fn(async () => [{ id: 'gin', wineName: 'Gin', wineProducer: null, wineVintage: null }]),
  recordSpotCount: vi.fn(async (..._a: unknown[]) => ({ item: null, count: { held: false } })),
}))
const exported = vi.hoisted(() => ({ exportTable: vi.fn(async (..._a: unknown[]) => {}) }))
vi.mock('@/services/api/countSessions', () => sessions)
vi.mock('@/services/api/inventory', () => inventory)
const house = vi.hoisted(() => ({
  readHouseZone: vi.fn(async (_id: string): Promise<string | null> => 'Europe/Istanbul'),
  houseCurrency: vi.fn(async () => ({ readable: true, code: 'TRY', country: 'Turkey' }) as Record<string, unknown>),
}))
vi.mock('@/lib/houseZone', () => ({ useHouseZone: () => 'Europe/Istanbul', readHouseZone: house.readHouseZone }))
vi.mock('@/services/api/settings', () => ({ settingsApi: { houseCurrency: house.houseCurrency } }))
vi.mock('@/lib/tableExport', async (orig) => ({
  ...(await orig<typeof import('@/lib/tableExport')>()),
  exportTable: exported.exportTable,
}))
vi.mock('@/lib/csvImport', async (orig) => ({
  ...(await orig<typeof import('@/lib/csvImport')>()),
  readCsvFile: vi.fn(async () => csv.text),
}))

import { CountSheetPanel } from './CountSheetPanel'
import { AuthContext } from '@/contexts/AuthContext'
import { setHouseLocale } from '@/lib/houseCurrency'

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
  house.readHouseZone.mockResolvedValue('Europe/Istanbul')
  setHouseLocale(null)
  house.houseCurrency.mockResolvedValue({ readable: true, code: 'TRY', country: 'Turkey' })
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

  it('names the sheet for its house (F-1631)', async () => {
    const houses = { availableRestaurants: [{ id: 'h0', name: 'Detroit' }, { id: 'h1', name: 'Tuzlu Rüzgar Kadıköy' }] }
    render(
      <AuthContext.Provider value={houses as never}>
        <CountSheetPanel sessionId="S1" house="h1" onSent={vi.fn()} />
      </AuthContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Count on paper' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download the sheet' }))
    await waitFor(() => expect(exported.exportTable).toHaveBeenCalled())
    const opts = exported.exportTable.mock.calls[0][0] as { filename: string }
    expect(opts.filename).toMatch(/^mudavym-tuzlu-ruzgar-kadikoy-count-sheet-\d{4}-\d{2}-\d{2}$/)
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

  it('writes the load down: who counted on paper, lines in and refused (S227 owed, ADR 0335 §3)', async () => {
    csv.text = [
      'Count;Shelf;Shelf code;Item;Item code;Full bottles;Open (tenths);Counted at',
      'S1;Back bar;L1;Gin;gin;3;5;13.10.2026 01:30',
      'S1;Back bar;L1;Rum;;x;;13.10.2026 01:30',
      'S1;Cellar;L2;Kavaklıdere;kav;2;;',
    ].join('\n')
    const who = { user: { name: 'Selin' }, availableRestaurants: [] }
    render(
      <AuthContext.Provider value={who as never}>
        <CountSheetPanel sessionId="S1" house="h1" onSent={vi.fn()} />
      </AuthContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Count on paper' }))
    load()
    const name = (await screen.findByLabelText('Who counted on paper?')) as HTMLInputElement
    // The person loading it, by default.
    expect(name.value).toBe('Selin')
    fireEvent.change(name, { target: { value: 'Mert' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send 1 line' }))
    await waitFor(() => expect(sessions.recordCountSheetLoad).toHaveBeenCalled())
    expect(sessions.recordCountSheetLoad).toHaveBeenCalledWith('S1', {
      countedByName: 'Mert',
      rowsIn: 1,
      // The unreadable bottles line, and the Cellar line with no time.
      rowsRefused: 2,
      rowsNotSent: 0,
      shelfKeys: [`sheet:S1:L1:${Date.parse('2026-10-12T22:30:00.000Z')}`],
    })
    expect(screen.queryByText(/could not be written down/)).toBeNull()
  })

  it('names nobody else when the loader counted it, and says so when the load is not written down', async () => {
    csv.text = [
      'Count;Shelf;Shelf code;Item;Item code;Full bottles;Open (tenths);Counted at',
      'S1;Back bar;L1;Gin;gin;3;;13.10.2026 01:30',
    ].join('\n')
    sessions.recordCountSheetLoad.mockRejectedValueOnce(new Error('offline'))
    const who = { user: { name: 'Selin' }, availableRestaurants: [] }
    render(
      <AuthContext.Provider value={who as never}>
        <CountSheetPanel sessionId="S1" house="h1" onSent={vi.fn()} />
      </AuthContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Count on paper' }))
    load()
    fireEvent.click(await screen.findByRole('button', { name: 'Send 1 line' }))
    expect(await screen.findByText(/this load could not be written down/)).toBeTruthy()
    expect(sessions.recordCountSheetLoad).toHaveBeenCalledWith('S1', expect.objectContaining({ countedByName: '' }))
    // The lines went in all the same.
    expect(screen.getByText('Back bar: 1 counted, shelf done')).toBeTruthy()
  })

  it('says a whole file from another count is refused and offers nothing to send', async () => {
    csv.text = 'Count,Shelf,Item,Full bottles,Counted at\nS9,Back bar,Gin,3,2026-10-13 01:30'
    open()
    load()
    expect(await screen.findByText(/This sheet is from another count/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Send/ })).toBeNull()
  })
  // F-1680: the panel stood on the module's last locale and zone, so in the
  // moment after a switch from Istanbul a Detroit sheet was read day first
  // on Istanbul's clock. It now asks the house it is loading for.
  it("reads a sheet in the house's own way after a switch (F-1680)", async () => {
    // What the last house (Istanbul) left behind, before Detroit's answer lands.
    setHouseLocale('tr-TR')
    house.houseCurrency.mockResolvedValue({ readable: true, code: 'USD', country: 'United States' })
    house.readHouseZone.mockResolvedValue('America/Detroit')
    csv.text = [
      'Count,Shelf,Shelf code,Item,Item code,Full bottles,Open (tenths),Counted at',
      'S1,Back bar,L1,Gin,gin,3,,10/12/2026 9:30 PM',
    ].join('\n')
    open()
    load()
    fireEvent.click(await screen.findByRole('button', { name: 'Send 1 line' }))
    await waitFor(() => expect(inventory.recordSpotCount).toHaveBeenCalled())
    expect(house.readHouseZone).toHaveBeenCalledWith('h1')
    expect(inventory.recordSpotCount).toHaveBeenCalledWith(
      'gin',
      expect.objectContaining({
        countedQty: 3,
        // 12 October, 21:30 in Detroit, not 10 December in Istanbul.
        countedAgoMs: Date.parse('2026-10-13T06:00:00.000Z') - Date.parse('2026-10-13T01:30:00.000Z'),
      }),
      'h1',
    )
  })

  it("reads nothing when the house's way of writing cannot be read (F-1680)", async () => {
    house.houseCurrency.mockResolvedValue({ readable: false, code: null, country: null })
    csv.text = 'Count,Shelf,Shelf code,Item,Item code,Full bottles,Open (tenths),Counted at\n'
    open()
    load()
    expect(await screen.findByText(/way of writing dates could not be read/)).toBeTruthy()
    expect(inventory.recordSpotCount).not.toHaveBeenCalled()
  })
})
