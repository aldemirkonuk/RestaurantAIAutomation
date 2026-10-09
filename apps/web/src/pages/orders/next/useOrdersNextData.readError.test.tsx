/**
 * F-403: /orders said "The orders could not be read (Request failed with status
 * code 429)". The hook now hands the page plain words for the clause.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode } from 'react'

const rateLimited = Object.assign(new Error('Request failed with status code 429'), {
  response: { status: 429, headers: { 'retry-after': '30' }, data: {} },
})

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', user: { restaurantId: 'r1' } }),
}))
vi.mock('@/services/api/client', () => ({
  apiClient: { get: () => Promise.reject(rateLimited) },
}))
vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useOrders: () => ({
    data: undefined,
    isLoading: false,
    isError: true,
    error: rateLimited,
    refetch: () => Promise.resolve(),
    dataUpdatedAt: 0,
  }),
}))
vi.mock('@/hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: [] }),
}))

import { useOrdersNextData } from './useOrdersNextData'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useOrdersNextData — read errors in plain words (F-403)', () => {
  it('says a rate limit as a wait, not the axios status line', async () => {
    const { result } = renderHook(() => useOrdersNextData(), { wrapper })
    expect(result.current.errorMessage).toBe(
      'too many requests in a short time — try again in 30 seconds',
    )
    await vi.waitFor(() => expect(result.current.approvalGateError).not.toBeNull())
    expect(result.current.approvalGateError).not.toMatch(/status code/)
  })
})
