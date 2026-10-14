/**
 * The phone stock-take screen (F-1544 lane 3). Each case fails on the base,
 * where `/count/:sessionId` did not exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const auth = vi.hoisted(() => ({
  value: {
    user: { userId: 'u1', restaurantId: 'h1' },
    activeRestaurantId: 'h1',
    activeRole: 'staff' as string | null,
    availableRestaurants: [
      { id: 'h1', name: 'Kadıköy', city: 'Istanbul', chain_id: null, chain_name: null },
      { id: 'h2', name: 'Detroit', city: 'Detroit', chain_id: null, chain_name: null },
    ],
    setActiveRestaurantId: vi.fn(),
  },
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.value }))

const api = vi.hoisted(() => ({
  pullCountSession: vi.fn(),
  claimCountShelf: vi.fn(),
  abandonCountSession: vi.fn(),
  houseHoldingCount: vi.fn(),
}))
// The calls are mocked; the module's word helpers (periodWords) are its own.
vi.mock('@/services/api/countSessions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...api,
}))
const inv = vi.hoisted(() => ({ getInventory: vi.fn() }))
vi.mock('@/services/api/inventory', () => inv)
const store = vi.hoisted(() => ({ getPendingMutationsByType: vi.fn() }))
vi.mock('@/lib/offline-storage', () => ({ offlineStorage: store }))
const outbox = vi.hoisted(() => ({
  submitSpotCount: vi.fn(),
  submitShelfDone: vi.fn(),
  submitParkedLine: vi.fn(),
  watchSpotCountOutbox: vi.fn(() => () => {}),
  SPOT_COUNTS_CHANGED_EVENT: 'mdv:spot-counts-changed',
  SHELF_DONE_TYPE: 'inventory.countShelfDone',
  PARK_TYPE: 'inventory.countPark',
}))
vi.mock('@/lib/spotCountOutbox', () => outbox)

import CountWalk from './CountWalk'

const SESSION = {
  id: 'S1',
  kind: 'closing',
  status: 'open',
  openedAt: '2026-10-12T21:00:00.000Z',
  shelves: [
    {
      locationId: 'L1',
      name: 'Back bar',
      order: 0,
      claimedByMe: false,
      claimedBy: null,
      claimedAt: null,
      done: false,
      doneAt: null,
      doneBy: null,
      items: [
        { inventoryId: 'a', name: 'Barolo', producer: 'Vietti', vintage: '2019', countWhole: false },
        { inventoryId: 'b', name: 'Rakı', producer: '', vintage: null, countWhole: false },
      ],
    },
    {
      locationId: 'L2',
      name: 'Cellar rack 1',
      order: 1,
      claimedByMe: false,
      claimedBy: 'Ayşe',
      claimedAt: null,
      done: false,
      doneAt: null,
      doneBy: null,
      items: [],
    },
  ],
}

function renderWalk() {
  return render(
    <MemoryRouter initialEntries={['/count/S1']}>
      <Routes>
        <Route path="/count/:sessionId" element={<CountWalk />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  auth.value.activeRole = 'staff'
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  inv.getInventory.mockResolvedValue([])
  store.getPendingMutationsByType.mockResolvedValue([])
  api.pullCountSession.mockResolvedValue(structuredClone(SESSION))
  api.claimCountShelf.mockResolvedValue({ locationId: 'L1', claimedByMe: true, claimedAt: 'x' })
  outbox.submitSpotCount.mockResolvedValue({ synced: true, count: { expectedQty: null } })
  outbox.submitShelfDone.mockResolvedValue({
    synced: true,
    result: { done: true, posted: ['b'], held: [], refused: [] },
  })
})

async function openBackBar() {
  renderWalk()
  fireEvent.click(await screen.findByRole('button', { name: /Back bar/ }))
  await screen.findByRole('button', { name: 'Shelf done' })
}

describe('the walk', () => {
  it('lists the shelves in walk order with who holds them, and never a quantity (blind count)', async () => {
    renderWalk()
    expect(await screen.findByText('Ayşe is counting')).toBeInTheDocument()
    expect(screen.getByText('0 of 2 shelves done')).toBeInTheDocument()
    const names = screen.getAllByRole('button', { name: /Back bar|Cellar rack/ }).map((b) => b.textContent)
    expect(names[0]).toMatch(/Back bar/)
    expect(names[1]).toMatch(/Cellar rack 1/)
  })

  it('takes the shelf, then posts a count as a line of this count, on this shelf, with the open tenths', async () => {
    await openBackBar()
    expect(api.claimCountShelf).toHaveBeenCalledWith('S1', 'L1', false)
    fireEvent.change(screen.getByLabelText('Full bottles'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open bottle: one more' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open bottle: one more' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(outbox.submitSpotCount).toHaveBeenCalledTimes(1))
    const entry = outbox.submitSpotCount.mock.calls[0][0]
    expect(entry.itemId).toBe('a')
    expect(entry.restaurantId).toBe('h1')
    expect(entry.body).toMatchObject({
      countedQty: 5,
      sessionId: 'S1',
      locationId: 'L1',
      openTenths: 2,
      clientCountId: expect.any(String),
    })
    expect(await screen.findByText(/5 bottles, 2\/10 of a bottle open\. Sent\./)).toBeInTheDocument()
  })

  it('says a count with no signal is saved on this phone', async () => {
    outbox.submitSpotCount.mockResolvedValue({ synced: false })
    await openBackBar()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Saved on this phone/)).toBeInTheDocument()
  })

  it('calls a saved count sent only after the outbox reports a send, never on an empty queue read', async () => {
    outbox.submitSpotCount.mockResolvedValue({ synced: false })
    await openBackBar()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Saved on this phone/)).toBeInTheDocument()
    // The queue reads empty (the mock store holds nothing): not proof of a send.
    window.dispatchEvent(new Event(outbox.SPOT_COUNTS_CHANGED_EVENT))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText(/Saved on this phone/)).toBeInTheDocument()
    // The outbox says it sent something: now absence from the queue means sent.
    const onSent = (outbox.watchSpotCountOutbox.mock.calls[0] as unknown as [() => void])[0]
    onSent()
    expect(await screen.findByText(/Sent\./)).toBeInTheDocument()
  })

  it('says a second count of the same shelf went to the manager (F2 a: the one held line)', async () => {
    outbox.submitSpotCount.mockResolvedValue({ synced: true, count: { held: true } })
    await openBackBar()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/the manager picks one/)).toBeInTheDocument()
  })

  it('shows the house\'s refusal on the line and keeps it open to count again', async () => {
    outbox.submitSpotCount.mockRejectedValue({
      response: { status: 409, data: { message: 'Bottles moved after this count. Count it again.' } },
    })
    await openBackBar()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(outbox.submitSpotCount).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })
})

describe('shelf done', () => {
  it('lists the items not counted, asks, then posts only those as 0', async () => {
    await openBackBar()
    fireEvent.click(screen.getByRole('button', { name: 'Save' })) // Barolo counted
    await waitFor(() => expect(outbox.submitSpotCount).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Shelf done' }))
    expect(screen.getByText(/Each of these will count as 0/)).toBeInTheDocument()
    expect(screen.getByText('Rakı')).toBeInTheDocument()
    expect(outbox.submitShelfDone).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Shelf done/ }))
    await waitFor(() => expect(outbox.submitShelfDone).toHaveBeenCalledTimes(1))
    expect(outbox.submitShelfDone.mock.calls[0][0]).toMatchObject({
      sessionId: 'S1',
      locationId: 'L1',
      body: { zeroItemIds: ['b'], clientDoneId: expect.any(String) },
    })
  })

  it('a done the house could not close says to count again', async () => {
    outbox.submitShelfDone.mockResolvedValue({
      synced: true,
      result: {
        done: false,
        posted: [],
        held: [],
        refused: [{ inventoryId: 'b', reason: 'moved' }],
        message: 'Count this shelf again: some bottles moved after it was counted.',
      },
    })
    await openBackBar()
    fireEvent.click(screen.getByRole('button', { name: 'Shelf done' }))
    fireEvent.click(screen.getByRole('button', { name: /Shelf done/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Count this shelf again/)
  })
})

describe('a done that comes back partly refused (F-1616, F-1619)', () => {
  const PARTLY = {
    done: false,
    posted: ['a'],
    held: [],
    refused: [{ inventoryId: 'b', reason: 'moved' }],
    message: 'Count this shelf again: some bottles moved after it was counted.',
  }

  it('keeps the zeros that posted as counted, marks the item to count again, and pulls the list again', async () => {
    outbox.submitShelfDone.mockResolvedValueOnce({ synced: true, result: PARTLY })
    await openBackBar()
    const pulls = api.pullCountSession.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Shelf done' }))
    fireEvent.click(screen.getByRole('button', { name: /Shelf done/ }))
    expect(await screen.findByText('Bottles moved. Count it again.')).toBeInTheDocument()
    expect(screen.getByText(/0 bottles, no open bottle\. Sent\./)).toBeInTheDocument()
    await waitFor(() => expect(api.pullCountSession.mock.calls.length).toBeGreaterThan(pulls))
    // Saying done again sends only what is still not counted, never the zero that posted.
    fireEvent.click(screen.getByRole('button', { name: 'Shelf done' }))
    fireEvent.click(screen.getByRole('button', { name: /Shelf done/ }))
    await waitFor(() => expect(outbox.submitShelfDone).toHaveBeenCalledTimes(2))
    expect(outbox.submitShelfDone.mock.calls[1][0].body.zeroItemIds).toEqual(['b'])
  })

  it('a queued done the house answered later keeps which items to count again', async () => {
    window.localStorage.setItem(
      'mdv:count-walk:h1:u1:S1',
      JSON.stringify({ lines: {}, extras: {}, parked: [], dones: { L1: { clientDoneId: 'd1', state: 'saved' } } }),
    )
    store.getPendingMutationsByType.mockImplementation(async (type: string) =>
      type === 'inventory.countShelfDone'
        ? [
            {
              id: 'm1',
              type,
              lastError: PARTLY.message,
              parked: { reason: 'refused', status: 409, at: 'x' },
              data: {
                sessionId: 'S1',
                locationId: 'L1',
                shelfLabel: 'Back bar',
                body: { clientDoneId: 'd1', zeroItemIds: ['a', 'b'] },
                countedAt: '2026-10-12T22:00:00.000Z',
                answer: PARTLY,
              },
            },
          ]
        : [],
    )
    renderWalk()
    expect(await screen.findByText('Count again')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Back bar/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(await screen.findByText('Bottles moved. Count it again.')).toBeInTheDocument()
    expect(screen.getByText(/0 bottles, no open bottle\. Sent\./)).toBeInTheDocument()
    expect(screen.queryByText('Not counted yet')).not.toBeInTheDocument()
  })

  it('a done that closed the shelf names an item it did not count', async () => {
    outbox.submitShelfDone.mockResolvedValueOnce({
      synced: true,
      result: {
        done: true,
        posted: ['a'],
        held: [],
        refused: [],
        skipped: [{ inventoryId: 'b', name: 'Rakı' }],
        message: "Not counted, no longer on this shelf's books: Rakı.",
      },
    })
    await openBackBar()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Shelf done' }))
    fireEvent.click(screen.getByRole('button', { name: /Shelf done/ }))
    expect(await screen.findByRole('status')).toHaveTextContent(/no longer on this shelf's books: Rakı/)
  })
})

describe('find (F-1620, ADR 0124)', () => {
  it('finds a renamed wine by the name on its label', async () => {
    inv.getInventory.mockResolvedValue([
      { id: 'c', wineName: 'Ev Kırmızısı', libraryName: 'Kavaklıdere Yakut', wineProducer: null, wineVintage: null },
    ])
    await openBackBar()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: /Find/ }))
    await waitFor(() => expect(inv.getInventory).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Name on the label'), { target: { value: 'yakut' } })
    expect(await screen.findByText('Ev Kırmızısı')).toBeInTheDocument()
  })

  it('a found item with bottles on no shelf is counted on Inventory, never on this shelf (F-1683)', async () => {
    inv.getInventory.mockResolvedValue([
      {
        id: 'c',
        wineName: 'Efes Pilsen',
        wineProducer: null,
        wineVintage: null,
        locations: [{ locationId: null, qty: 12, wac: null }],
      },
    ])
    await openBackBar()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: /Find/ }))
    fireEvent.change(await screen.findByLabelText('Name on the label'), { target: { value: 'efes' } })
    fireEvent.click(await screen.findByRole('button', { name: /Efes Pilsen/ }))
    expect(
      await screen.findByText('Some of this sits off the shelves. Count it on Inventory, all at once.'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Full bottles')).not.toBeInTheDocument()
    expect(outbox.submitSpotCount).not.toHaveBeenCalled()
  })
})

describe('the month a count is for (S230 owed)', () => {
  it('[REVERT-FAILS] the walk names the month its counts are filed in', async () => {
    api.pullCountSession.mockResolvedValue({ ...structuredClone(SESSION), period: '2026-10' })
    renderWalk()
    const october = new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2026, 9, 1)),
    )
    expect(await screen.findByRole('heading', { name: new RegExp(` · ${october}$`) })).toBeInTheDocument()
  })
})

describe('who may count', () => {
  it('a staff member cannot count opening stock', async () => {
    api.pullCountSession.mockResolvedValue({ ...structuredClone(SESSION), kind: 'opening' })
    renderWalk()
    expect(await screen.findByText('Only an owner or a manager counts opening stock.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Back bar/ })).toBeDisabled()
  })

  it('walks the copy kept on this phone when the count cannot be read', async () => {
    renderWalk()
    await screen.findByText('Ayşe is counting')
    api.pullCountSession.mockRejectedValue(new Error('Network Error'))
    const { unmount } = renderWalk()
    expect(await screen.findByText(/this is the list saved on this phone/)).toBeInTheDocument()
    unmount()
  })
})

describe('the house and stopping (F-1628, F-1629, F-1617)', () => {
  it('[REVERT-FAILS] names the house the count is in', async () => {
    renderWalk()
    expect((await screen.findByTestId('count-house')).textContent).toContain('Kadıköy, Istanbul')
  })

  it('[REVERT-FAILS] a count held by another of your houses offers to open it there', async () => {
    api.pullCountSession.mockRejectedValue({
      response: { status: 404, data: { message: "That count is not one of this house's." } },
    })
    api.houseHoldingCount.mockResolvedValue({ id: 'h2', name: 'Detroit', city: 'Detroit' })
    auth.value.setActiveRestaurantId.mockResolvedValue(true)
    renderWalk()
    fireEvent.click(await screen.findByRole('button', { name: 'Open it in Detroit' }))
    await waitFor(() => expect(auth.value.setActiveRestaurantId).toHaveBeenCalledWith('h2'))
    expect(api.houseHoldingCount).toHaveBeenCalledWith('S1')
  })

  it('staff are not offered "Stop this count"', async () => {
    renderWalk()
    await screen.findByText('Ayşe is counting')
    expect(screen.queryByRole('button', { name: 'Stop this count' })).toBeNull()
  })

  it('[REVERT-FAILS] a manager stops it only after the question', async () => {
    auth.value.activeRole = 'manager'
    api.abandonCountSession.mockResolvedValue({ id: 'S1', status: 'abandoned', abandonedAt: 'x' })
    renderWalk()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop this count' }))
    expect(api.abandonCountSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop it' }))
    await waitFor(() => expect(api.abandonCountSession).toHaveBeenCalledWith('S1'))
  })
})
