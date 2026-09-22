/**
 * Deliveries that booked nothing ask an owner or a manager to name their item
 * (founder, 2026-09-22, verbatim pick: "Deliver, flag to name it
 * (Recommended)"). The gateway's rules are proved in
 * procurement/delivery-item-to-name.spec.ts; proved here: an owner or manager
 * names by the item's id and states the count a zero-bottle delivery lacks,
 * anyone else is told who can, the gateway's sentence is what is said after,
 * and a failed read is never "nothing waiting".
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../../../services/api/client', () => ({
  apiClient: {
    get: (...a: unknown[]) => api.get(...a),
    post: (...a: unknown[]) => api.post(...a),
  },
  getActiveRestaurantId: () => 'rest-A',
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}))

import { DeliveriesToName } from './DeliveriesToName'

const ZERO = {
  orderId: 'ord-1',
  orderNumber: 'PO-7',
  why: 'zero_bottles',
  bottlesResolved: 0,
  orderInventoryId: 'inv-1',
  raisedAt: '2026-09-22T08:00:00Z',
}
const ITEMS = [
  { inventoryId: 'inv-1', name: 'Kavaklıdere Yakut 2019' },
  { inventoryId: 'inv-2', name: 'Doluca Kav 2018' },
]

function draw(url = '/inventory') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <MemoryRouter initialEntries={[url]}>
      <QueryClientProvider client={qc}>
        <DeliveriesToName items={ITEMS} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  api.get.mockReset()
  api.post.mockReset()
})

describe('deliveries waiting for their item', () => {
  it('an owner states the count of a zero-bottle delivery and books it; the gateway sentence is said', async () => {
    api.get.mockResolvedValue({ data: { viewer: { mayName: true, mayNameReason: null }, deliveries: [ZERO] } })
    api.post.mockResolvedValue({ data: { bottlesBooked: 6, says: "The delivery's item was named and 6 bottles were booked." } })
    draw()
    expect(await screen.findByTestId('deliveries-to-name')).toHaveTextContent(
      'PO-7 was delivered with no bottle count, so no stock was booked.',
    )
    expect(screen.getByText('Item: Kavaklıdere Yakut 2019')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Bottles that came in'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Book the stock' }))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/procurement/orders/ord-1/name-item', { inventoryId: 'inv-1', bottles: 6 }),
    )
    expect(await screen.findByTestId('delivery-to-name-says')).toHaveTextContent(
      "The delivery's item was named and 6 bottles were booked.",
    )
  })

  it('the gateway sentence stays said after the refetched list no longer holds the named delivery', async () => {
    // [Last call, 2026-09-22] The sentence lived inside the row, and the
    // refetch after naming drops the row, so the page said it for a moment
    // and then nothing — the research and audit sentences with it.
    api.get
      .mockResolvedValueOnce({ data: { viewer: { mayName: true, mayNameReason: null }, deliveries: [ZERO] } })
      .mockResolvedValue({ data: { viewer: { mayName: true, mayNameReason: null }, deliveries: [] } })
    api.post.mockResolvedValue({
      data: { bottlesBooked: 6, says: "The delivery's item was named and 6 bottles were booked. This wine is not in the wine library yet, so it is queued for research." },
    })
    draw()
    await screen.findByTestId('deliveries-to-name')
    fireEvent.change(screen.getByPlaceholderText('Bottles that came in'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Book the stock' }))
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByPlaceholderText('Bottles that came in')).toBeNull())
    expect(screen.getByTestId('delivery-to-name-says')).toHaveTextContent('so it is queued for research.')
  })

  it('the gateway sentence stays said when the refetch after naming fails', async () => {
    api.get
      .mockResolvedValueOnce({ data: { viewer: { mayName: true, mayNameReason: null }, deliveries: [ZERO] } })
      .mockRejectedValue({ message: 'network down' })
    api.post.mockResolvedValue({ data: { bottlesBooked: 6, says: "The delivery's item was named and 6 bottles were booked." } })
    draw()
    await screen.findByTestId('deliveries-to-name')
    fireEvent.change(screen.getByPlaceholderText('Bottles that came in'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Book the stock' }))
    expect(await screen.findByTestId('deliveries-to-name-unread')).toHaveTextContent('network down')
    expect(screen.getByTestId('delivery-to-name-says')).toHaveTextContent('6 bottles were booked.')
  })

  it('a count that is not a whole number is refused on the page; nothing is sent', async () => {
    api.get.mockResolvedValue({ data: { viewer: { mayName: true, mayNameReason: null }, deliveries: [ZERO] } })
    draw()
    await screen.findByTestId('deliveries-to-name')
    fireEvent.change(screen.getByPlaceholderText('Bottles that came in'), { target: { value: '2.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Book the stock' }))
    expect(await screen.findByTestId('delivery-to-name-problem')).toHaveTextContent('as a whole number')
    expect(api.post).not.toHaveBeenCalled()
  })

  it('a no-item delivery is named by choosing the item by its id', async () => {
    api.get.mockResolvedValue({
      data: {
        viewer: { mayName: true, mayNameReason: null },
        deliveries: [{ ...ZERO, why: 'no_item', bottlesResolved: 12, orderInventoryId: null }],
      },
    })
    api.post.mockResolvedValue({ data: { bottlesBooked: 12, says: 'Booked.' } })
    draw()
    await screen.findByTestId('deliveries-to-name')
    expect(screen.queryByPlaceholderText('Bottles that came in')).toBeNull()
    fireEvent.change(screen.getByLabelText('The item this delivery was for'), { target: { value: 'inv-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Book the stock' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/procurement/orders/ord-1/name-item', { inventoryId: 'inv-2' }))
  })

  it('someone who may not name it is told who can, and offered nothing to book', async () => {
    api.get.mockResolvedValue({
      data: { viewer: { mayName: false, mayNameReason: "Only an owner or a manager names a delivery's item." }, deliveries: [ZERO] },
    })
    draw()
    expect(await screen.findByTestId('deliveries-to-name')).toHaveTextContent(
      'Waiting for an owner or a manager to name it. Nothing was booked.',
    )
    expect(screen.queryByRole('button', { name: 'Book the stock' })).toBeNull()
  })

  it("the gateway's refusal is said", async () => {
    api.get.mockResolvedValue({ data: { viewer: { mayName: true, mayNameReason: null }, deliveries: [ZERO] } })
    api.post.mockRejectedValue(new Error('Someone named this delivery’s item a moment ago. Nothing was booked twice.'))
    draw()
    await screen.findByTestId('deliveries-to-name')
    fireEvent.change(screen.getByPlaceholderText('Bottles that came in'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Book the stock' }))
    expect(await screen.findByTestId('delivery-to-name-problem')).toHaveTextContent('Nothing was booked twice.')
  })

  it('a failed read is said, never "nothing waiting"', async () => {
    api.get.mockRejectedValue(new Error('timeout'))
    draw()
    expect(await screen.findByTestId('deliveries-to-name-unread')).toHaveTextContent(
      'Which deliveries wait for their item could not be read (timeout)',
    )
  })

  it('nothing waiting draws nothing', async () => {
    api.get.mockResolvedValue({ data: { viewer: { mayName: true, mayNameReason: null }, deliveries: [] } })
    draw()
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(screen.queryByTestId('deliveries-to-name')).toBeNull()
  })
})
