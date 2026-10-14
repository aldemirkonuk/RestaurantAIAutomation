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
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.value }))

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
vi.mock('@/services/api/countSessions', () => api)
vi.mock('@/services/api/inventory', () => ({
  getInventory: vi.fn().mockResolvedValue([{ id: 'gin', wineName: 'Gin', wineProducer: null, wineVintage: null }]),
}))

import CountReview from './CountReview'

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
