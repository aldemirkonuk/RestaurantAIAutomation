/**
 * Moving between pages must honour useInventory's own 30 s staleTime.
 * App.tsx's default `refetchOnMount: 'always'` otherwise re-downloads the
 * whole inventory list on every SPA navigation, seconds after it was read.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

const getInventory = vi.hoisted(() => vi.fn(async () => [] as unknown[]))

vi.mock('../../services/api', () => ({
  inventoryApi: {
    getInventory,
    getInventorySummary: vi.fn(async () => null),
    getLowStockItems: vi.fn(async () => []),
  },
}))
vi.mock('../../services/api/inventory', () => ({ normalizeInventoryItem: (x: unknown) => x }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ activeRestaurantId: 'rest-aaa', isAuthenticated: true })),
}))

import { queryKeys } from '../../lib/query-keys'
import { useInventory } from './useInventoryQueries'

// Same defaults as App.tsx.
const appClient = () =>
  new QueryClient({
    defaultOptions: { queries: { staleTime: 5_000, refetchOnMount: 'always', retry: 1 } },
  })

describe('useInventory on mount', () => {
  it('reuses a list read a moment ago instead of reading it again', async () => {
    const qc = appClient()
    qc.setQueryData(queryKeys.inventory.list('rest-aaa'), [{ id: 'x' }])
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => useInventory(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([{ id: 'x' }]))
    await new Promise((r) => setTimeout(r, 30))
    expect(getInventory).not.toHaveBeenCalled()
  })

  it('still reads a list that was never read', async () => {
    getInventory.mockClear()
    const qc = appClient()
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children)
    renderHook(() => useInventory(), { wrapper })
    await waitFor(() => expect(getInventory).toHaveBeenCalledTimes(1))
  })
})
