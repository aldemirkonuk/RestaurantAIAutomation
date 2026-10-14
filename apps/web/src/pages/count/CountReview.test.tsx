/**
 * A stock-take's review (F-1544 lane 4). Each case fails on the base, where
 * `/count/:sessionId/review` did not exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const auth = vi.hoisted(() => ({
  value: {
    user: { userId: 'u1', restaurantId: 'h1' },
    activeRestaurantId: 'h1',
    activeRole: 'manager' as string | null,
  },
}))
// CountSheetPanel reads the house name through useContext(AuthContext) (F-1631),
// so the mock carries the context too, holding the same person.
vi.mock('@/contexts/AuthContext', async () => {
  const { createContext } = await import('react')
  return { useAuth: () => auth.value, AuthContext: createContext<unknown>(auth.value) }
})

const api = vi.hoisted(() => ({
  reviewCountSession: vi.fn(),
  chooseHeldCountLine: vi.fn(),
  dropHeldCountLine: vi.fn(),
  carryParkedCountLine: vi.fn(),
  dropParkedCountLine: vi.fn(),
  askShelfRecount: vi.fn(),
  signOffCountSession: vi.fn(),
  abandonCountSession: vi.fn(),
  houseHoldingCount: vi.fn(),
}))
// The calls are mocked; the module's word helpers (periodWords) are its own.
vi.mock('@/services/api/countSessions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...api,
}))
vi.mock('@/services/api/inventory', () => ({
  getInventory: vi.fn().mockResolvedValue([
    { id: 'gin', wineName: 'Gin', wineProducer: null, wineVintage: null },
    { id: 'ev', wineName: 'Ev Kırmızısı', libraryName: 'Kavaklıdere Yakut', wineProducer: null, wineVintage: null },
  ]),
}))

// F-1658: the house's zone, as the bell reads it.
const zone = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('@/lib/houseZone', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useHouseZone: () => zone.value,
}))

import CountReview from './CountReview'
import { setHouseLocale } from '@/lib/houseCurrency'

const line = (over: Record<string, unknown> = {}) => ({
  countId: 'c1',
  inventoryId: 'yakut',
  name: 'Yakut',
  counted: 4,
  openMl: null,
  countedBy: 'Ayşe',
  countedAt: '2026-10-12T21:10:00.000Z',
  afterSignOff: false,
  ...over,
})

function review(seesMoney: boolean, over: Record<string, unknown> = {}) {
  const money = (o: Record<string, unknown>) =>
    seesMoney ? o : Object.fromEntries(Object.entries(o).filter(([k]) => !['expected', 'variance', 'value', 'expectedOpenMl'].includes(k)))
  return {
    id: 'S1',
    kind: 'closing',
    status: 'open',
    openedAt: '2026-10-12T21:00:00.000Z',
    signedOffAt: null,
    signedOffBy: null,
    seesMoney,
    currency: seesMoney ? 'TRY' : null,
    shelves: [
      {
        locationId: 'L1',
        name: 'Back bar',
        done: true,
        doneAt: '2026-10-12T21:20:00.000Z',
        doneBy: 'Ayşe',
        round: 0,
        recountAskedAt: null,
        lines: [line(money({ expected: 6, variance: -2, value: -800 }))],
        missed: [{ inventoryId: 'gin', name: 'Gin' }],
        ...(seesMoney ? { value: -800 } : {}),
      },
      {
        locationId: 'L2',
        name: 'Cellar',
        done: false,
        doneAt: null,
        doneBy: null,
        round: 0,
        recountAskedAt: null,
        lines: [],
        missed: [],
      },
    ],
    notCounted: [{ locationId: 'L2', name: 'Cellar', round: 0 }],
    elsewhere: [],
    held: [
      {
        id: 'h1',
        inventoryId: 'yakut',
        name: 'Yakut',
        locationId: 'L1',
        shelf: 'Back bar',
        counted: 5,
        openMl: null,
        countedBy: 'Deniz',
        countedAt: '2026-10-12T21:15:00.000Z',
        against: line(money({ expected: 6, variance: -2, value: -800 })),
      },
    ],
    parked: [
      {
        id: 'p1',
        locationId: 'L1',
        shelf: 'Back bar',
        description: 'Gin, no label',
        counted: 2,
        countedBy: 'Deniz',
        countedAt: '2026-10-12T21:12:00.000Z',
      },
    ],
    moved: seesMoney ? [{ inventoryId: 'yakut', name: 'Yakut', bottles: 1, from: 'Back bar', to: 'Cellar' }] : [],
    afterSignOff: [],
    ...over,
  }
}

function show() {
  return render(
    <MemoryRouter initialEntries={['/count/S1/review']}>
      <Routes>
        <Route path="/count/:sessionId/review" element={<CountReview />} />
        <Route path="/count/:sessionId" element={<p>the walk</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.value.activeRole = 'manager'
})

describe('the review shows the walk', () => {
  it('a manager sees the difference and its value in the house currency, shelves not counted and missed lines', async () => {
    api.reviewCountSession.mockResolvedValue(review(true))
    show()
    expect(await screen.findByText('Not counted', { selector: 'h2' })).toBeTruthy()
    expect(screen.getAllByText('Cellar').length).toBeGreaterThan(0)
    expect(screen.getByText('−2')).toBeTruthy()
    expect(screen.getAllByText(/800/).length).toBeGreaterThan(0)
    expect(screen.getByText(/On the books here, no count sent: Gin/)).toBeTruthy()
    expect(screen.getByText(/1 short on Back bar, found on Cellar/)).toBeTruthy()
    // F-1544 lane 6: an owner or a manager can load a count made on paper.
    expect(screen.getByRole('button', { name: 'Count on paper' })).toBeTruthy()
  })

  it('names who counted a line on paper, and who loaded it when that was someone else (S227 owed)', async () => {
    const r = review(false)
    r.shelves[0].lines = [line({ paperBy: 'Mert' })]
    const parkedOnPaper: (typeof r.parked)[number] & { paperBy?: string } = { ...r.parked[0], paperBy: 'Deniz' }
    r.parked = [parkedOnPaper]
    api.reviewCountSession.mockResolvedValue(r)
    show()
    expect(await screen.findByText(/, counted on paper by Mert, loaded by Ayşe/)).toBeTruthy()
    // Loaded by the person who counted it: named once.
    expect(screen.getByText(/on Back bar, counted on paper by Deniz$/)).toBeTruthy()
    // A line counted on the phone reads as it did.
    expect(screen.getAllByText(/, by Deniz/).length).toBeGreaterThan(0)
  })

  it('the difference counts the open bottles in tenths, short in amber, as its value does (F-1621)', async () => {
    const shelves = review(true).shelves
    shelves[0].lines = [
      line({ name: 'Rakı', counted: 3, openMl: 140, expected: 3, variance: 0, openDifferenceTenths: -3, value: -210 }),
    ]
    api.reviewCountSession.mockResolvedValue(review(true, { shelves }))
    show()
    const diff = await screen.findByText('0, −3/10 open')
    expect(diff.className).toMatch(/text-amber-300/)
  })

  it('[REVERT-FAILS] says open bottles in tenths of their bottle, never ml, on lines and held lines (S230 owed)', async () => {
    auth.value.activeRole = 'staff'
    const r = review(false)
    r.shelves[0].lines = [line({ name: 'Rakı', counted: 3, openMl: 350, openTenths: 5, bottleSizeKnown: true })]
    const held = [{ ...r.held[0], openMl: 375, openTenths: 5, bottleSizeKnown: false }]
    api.reviewCountSession.mockResolvedValue({ ...r, held })
    show()
    expect(await screen.findByText(/3 bottles, 5\/10 of a bottle open/)).toBeTruthy()
    // An item with no bottle size says the 750 ml it was read on.
    expect(screen.getByText(/Second: 5 bottles, 5\/10 of a bottle open \(on a 750 ml bottle: this item has no bottle size\)/)).toBeTruthy()
    expect(screen.queryByText(/ml open/)).toBeNull()
  })

  it('[REVERT-FAILS] names the month the count is filed in (S230 owed)', async () => {
    api.reviewCountSession.mockResolvedValue(review(true, { period: '2026-10' }))
    show()
    const october = new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2026, 9, 1)),
    )
    expect(await screen.findByRole('heading', { name: `Review: Closing count · ${october}` })).toBeTruthy()
  })

  it('a bartender sees what was counted, never a difference or money, and no act', async () => {
    auth.value.activeRole = 'staff'
    api.reviewCountSession.mockResolvedValue(review(false))
    show()
    expect(await screen.findByText('Counted twice')).toBeTruthy()
    expect(screen.queryByText('−2')).toBeNull()
    expect(screen.queryByText(/800/)).toBeNull()
    expect(screen.queryByText('Use the second')).toBeNull()
    expect(screen.queryByText('Sign off this count')).toBeNull()
    expect(screen.queryByText('Count on paper')).toBeNull()
  })

  it('offers no paper count on a stopped count (F-1544 lane 6)', async () => {
    api.reviewCountSession.mockResolvedValue(review(true, { status: 'abandoned' }))
    show()
    expect(await screen.findByText(/This count was stopped/)).toBeTruthy()
    expect(screen.queryByText('Count on paper')).toBeNull()
  })
})

describe('the manager settles what the walk could not', () => {
  it('uses the second count of a shelf counted twice, then reads the review again', async () => {
    api.reviewCountSession.mockResolvedValue(review(true))
    api.chooseHeldCountLine.mockResolvedValue({ state: 'posted' })
    show()
    fireEvent.click(await screen.findByText('Use the second'))
    await waitFor(() => expect(api.chooseHeldCountLine).toHaveBeenCalledWith('S1', 'h1'))
    await waitFor(() => expect(api.reviewCountSession).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('The second count is in.')).toBeTruthy()
  })

  it('sends a shelf back with the round it saw', async () => {
    api.reviewCountSession.mockResolvedValue(review(true))
    api.askShelfRecount.mockResolvedValue({ round: 1 })
    show()
    fireEvent.click(await screen.findByText('Count this shelf again'))
    await waitFor(() => expect(api.askShelfRecount).toHaveBeenCalledWith('S1', 'L1', 0))
  })

  it('matches a parked line to one of the house items', async () => {
    api.reviewCountSession.mockResolvedValue(review(true))
    api.carryParkedCountLine.mockResolvedValue({ state: 'carried', held: false })
    show()
    fireEvent.click(await screen.findByText('It is one of ours'))
    fireEvent.change(await screen.findByLabelText("Which of the house's items is it"), {
      target: { value: 'gin' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Gin' }))
    await waitFor(() => expect(api.carryParkedCountLine).toHaveBeenCalledWith('S1', 'p1', 'gin'))
  })

  it('finds a renamed wine by the name on its label (F-1620, ADR 0124)', async () => {
    api.reviewCountSession.mockResolvedValue(review(true))
    show()
    fireEvent.click(await screen.findByText('It is one of ours'))
    fireEvent.change(await screen.findByLabelText("Which of the house's items is it"), {
      target: { value: 'yakut kavak' },
    })
    expect(await screen.findByRole('button', { name: 'Ev Kırmızısı' })).toBeTruthy()
  })

  it('asks before signing off with a shelf not counted, and signs on the second word', async () => {
    api.reviewCountSession.mockResolvedValue(review(true))
    api.signOffCountSession
      .mockResolvedValueOnce({ signedOff: false, notCounted: 1 })
      .mockResolvedValueOnce({ signedOff: true, notCounted: 1 })
    show()
    fireEvent.click(await screen.findByText('Sign off this count'))
    expect(await screen.findByText(/1 shelf is not counted\. Sign off anyway\?/)).toBeTruthy()
    expect(api.signOffCountSession).toHaveBeenLastCalledWith('S1', false)
    fireEvent.click(screen.getByText('Sign off anyway'))
    await waitFor(() => expect(api.signOffCountSession).toHaveBeenLastCalledWith('S1', true))
  })

  it('[REVERT-FAILS] says when it was signed off on the house clock, in digits (F-1658)', async () => {
    zone.value = 'Europe/Istanbul'
    setHouseLocale('tr-TR')
    try {
      api.reviewCountSession.mockResolvedValue(
        review(true, { status: 'signed_off', signedOffAt: '2026-10-12T22:00:00.000Z', signedOffBy: 'Selin' }),
      )
      show()
      const said = await screen.findByText(/Signed off by Selin/)
      // 01:00 on 13 October in Istanbul; the device (New York) is still on the 12th.
      expect(said.textContent).toContain(
        new Date('2026-10-12T22:00:00.000Z').toLocaleString('tr-TR', {
          day: 'numeric',
          month: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Europe/Istanbul',
        }),
      )
      expect(said.textContent).not.toMatch(/Eki/)
    } finally {
      zone.value = null
      setHouseLocale(null)
    }
  })

  it('lists the lines that came in after sign-off, and offers no act on an ended count', async () => {
    api.reviewCountSession.mockResolvedValue(
      review(true, {
        status: 'signed_off',
        signedOffAt: '2026-10-12T22:00:00.000Z',
        signedOffBy: 'Selin',
        held: [],
        parked: [],
        afterSignOff: [line({ countId: 'late', name: 'Rakı', counted: 3, countedBy: 'Deniz', afterSignOff: true })],
      }),
    )
    show()
    expect(await screen.findByText('Came in after sign-off')).toBeTruthy()
    expect(screen.getByText(/Signed off by Selin/)).toBeTruthy()
    expect(screen.getByText('Rakı')).toBeTruthy()
    expect(screen.queryByText('Sign off this count')).toBeNull()
    expect(screen.queryByText('Count this shelf again')).toBeNull()
    // A paper count that arrives after sign-off still lands (ADR 0241).
    expect(screen.getByRole('button', { name: 'Count on paper' })).toBeTruthy()
  })
})

describe('stopping a count from the review (F-1617)', () => {
  it('[REVERT-FAILS] a manager stops an open count after the question', async () => {
    api.reviewCountSession.mockResolvedValue(review(true))
    api.abandonCountSession.mockResolvedValue({ id: 'S1', status: 'abandoned', abandonedAt: 'x' })
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop this count' }))
    expect(api.abandonCountSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop it' }))
    await waitFor(() => expect(api.abandonCountSession).toHaveBeenCalledWith('S1'))
    // The page reads the count again, now stopped.
    await waitFor(() => expect(api.reviewCountSession).toHaveBeenCalledTimes(2))
  })

  it('staff are not offered it', async () => {
    auth.value.activeRole = 'staff'
    api.reviewCountSession.mockResolvedValue(review(false))
    show()
    await screen.findByText('Not counted', { selector: 'h2' })
    expect(screen.queryByRole('button', { name: 'Stop this count' })).toBeNull()
  })
})
