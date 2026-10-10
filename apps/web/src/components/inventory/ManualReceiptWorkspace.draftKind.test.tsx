/**
 * F-740 — a drink received through a draft was never classified. The draft
 * carried no kind, so the library row it created had nothing for the
 * classifier to read, and a beer stayed 'unknown' everywhere it showed.
 */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const persistMock = vi.fn()

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { restaurantId: 'r1' }, activeRestaurantId: 'r1' }),
}))
vi.mock('../../hooks/queries', () => ({
  useWines: () => ({ data: [], isFetching: false }),
}))
vi.mock('../../hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: [] }),
}))
vi.mock('../../hooks/useStorageLocations', () => ({
  useStorageLocations: () => ({ locations: [] }),
}))
// Keep the real save-key and error helpers (F-566); only the write is stubbed.
vi.mock('../../lib/menuScannerPersistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/menuScannerPersistence')>()),
  persistBatchToInventory: (...args: unknown[]) => {
    persistMock(...args)
    return Promise.resolve({ added: [{}], stockAdded: [], reactivated: [], provisional: [], failed: [] })
  },
}))

import { ManualReceiptWorkspace } from './ManualReceiptWorkspace'

describe('a new drink keeps its kind', () => {
  it('the manual receipt sends the kind the person picked', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ManualReceiptWorkspace isOpen onClose={() => {}} />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByText('Wine not in the library'))
    fireEvent.change(screen.getByPlaceholderText('Wine name *'), { target: { value: 'Efes Pilsen' } })
    fireEvent.change(screen.getByLabelText('Kind of drink'), { target: { value: 'beer' } })
    fireEvent.click(screen.getByText('Add line'))
    fireEvent.click(screen.getByText(/^Record 1 bottle$/))

    await waitFor(() => expect(persistMock).toHaveBeenCalledTimes(1))
    const lines = persistMock.mock.calls[0][0]
    expect(lines[0].wineDraft).toEqual({ name: 'Efes Pilsen', vintage: null, category: 'beer' })
  })
})

// The real module: the page test above mocks it.
describe('scanned drafts', () => {
  it('carry the style the scan read, and nothing the gateway would refuse', async () => {
    const real = await vi.importActual<typeof import('../../lib/menuScannerPersistence')>(
      '../../lib/menuScannerPersistence',
    )
    const rows = real.detectedWinesToBatchRows([
      { id: 'a', name: 'Doluca Kav', wineType: 'red', confidence: 0.95 },
      { id: 'b', name: 'Mystery', wineType: 'Claret' as never, confidence: 0.95 },
    ] as never)
    expect(rows[0].draft?.category).toBe('red')
    expect(rows[1].draft?.category).toBeUndefined()
  })
})
