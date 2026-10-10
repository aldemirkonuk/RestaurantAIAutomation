/**
 * F-712: a manual receipt's typed lines survive a refresh or a Back on this
 * tab, kept per person and house, and are gone once the receipt is recorded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const auth = { user: { userId: 'u-1', restaurantId: 'house-a' }, activeRestaurantId: 'house-a' }
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../../hooks/queries', () => ({
  useWines: (opts: { search?: string }) => ({
    data: opts.search ? [{ id: 'w-1', name: 'Barolo Cannubi', producer: 'Borgogno', vintage: 2019 }] : [],
    isFetching: false,
  }),
}))
vi.mock('../../hooks/queries/useProviderQueries', () => ({ useProviders: () => ({ data: [] }) }))
vi.mock('../../hooks/useStorageLocations', () => ({ useStorageLocations: () => ({ locations: [] }) }))
const persistBatchToInventory = vi.fn()
vi.mock('../../lib/menuScannerPersistence', () => ({
  persistBatchToInventory: (...a: unknown[]) => persistBatchToInventory(...a),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

import { ManualReceiptWorkspace } from './ManualReceiptWorkspace'

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ManualReceiptWorkspace isOpen onClose={() => {}} />
    </QueryClientProvider>,
  )
}

function addBarolo() {
  fireEvent.change(screen.getByPlaceholderText(/Search the Master Wine Library/), { target: { value: 'Barolo' } })
  fireEvent.click(screen.getByRole('button', { name: /Barolo Cannubi/ }))
}

const KEY = 'mdv:manual-receipt:u-1:house-a'

describe('ManualReceiptWorkspace draft (F-712)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    persistBatchToInventory.mockReset()
    auth.activeRestaurantId = 'house-a'
  })

  it('brings the typed lines back after the page remounts', async () => {
    const first = mount()
    addBarolo()
    fireEvent.change(screen.getByPlaceholderText(/INV-4471/), { target: { value: 'DN-4471' } })
    await waitFor(() => expect(window.sessionStorage.getItem(KEY)).toContain('Barolo Cannubi'))
    first.unmount()

    mount()
    expect(await screen.findByText('Barolo Cannubi')).toBeInTheDocument()
    expect(screen.getByDisplayValue('DN-4471')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Record 1 bottle/ })).toBeEnabled()
  })

  it('does not show one house\'s receipt in another', async () => {
    const first = mount()
    addBarolo()
    await waitFor(() => expect(window.sessionStorage.getItem(KEY)).toContain('Barolo Cannubi'))
    first.unmount()

    auth.activeRestaurantId = 'house-b'
    mount()
    expect(screen.queryByText('Barolo Cannubi')).not.toBeInTheDocument()
    expect(window.sessionStorage.getItem(KEY)).toContain('Barolo Cannubi')
  })

  it('forgets the receipt once it is recorded', async () => {
    persistBatchToInventory.mockResolvedValue({
      added: [{ index: 0 }],
      stockAdded: [],
      reactivated: [],
      provisional: [],
      failed: [],
    })
    const first = mount()
    addBarolo()
    await waitFor(() => expect(window.sessionStorage.getItem(KEY)).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /Record 1 bottle/ }))
    await waitFor(() => expect(persistBatchToInventory).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(window.sessionStorage.getItem(KEY)).toBeNull())
    first.unmount()

    mount()
    expect(screen.queryByText('Barolo Cannubi')).not.toBeInTheDocument()
  })

  it('says so when the page closed while the receipt was being saved', async () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        providerId: '',
        reference: '',
        defaultLocationId: '',
        rows: [{ key: 'receipt-9', wineId: 'w-1', name: 'Barolo Cannubi', quantity: 1, cost: '', isSample: false, selected: false }],
        saving: true,
      }),
    )
    mount()
    expect(await screen.findByText(/being saved when the page closed/)).toBeInTheDocument()
  })
})
