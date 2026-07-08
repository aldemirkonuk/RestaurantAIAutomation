import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// --- mocks -----------------------------------------------------------
// vi.mock() is hoisted to the top of the file by Vitest — any variable it
// references must be created with vi.hoisted() so it's also available before
// the rest of the module is initialised.
const mockGet = vi.hoisted(() => vi.fn())

vi.mock('../../services/api/client', () => ({
  apiClient: { get: mockGet },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../../contexts/AuthContext'
import { useActiveConversations, activeConversationKeys } from './useDraftEmailQueries'

// Helper: wrap in a fresh QueryClientProvider per test
function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
}

// -------------------------------------------------------------------

/**
 * Regression tests for Bug 3 (frontend): useActiveConversations must use
 * activeRestaurantId (not user.restaurantId) in its query key so that a
 * restaurant switch triggers a fresh fetch rather than returning cached data
 * from the previously-active restaurant.
 */
describe('useActiveConversations — query key uses activeRestaurantId (regression: Bug 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue({ data: [] })
  })

  it('uses activeRestaurantId as the query key when available', async () => {
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { restaurantId: 'jwt-rest-A', userId: 'u1', email: 'a@b.com', name: 'A', role: 'owner' },
      activeRestaurantId: 'active-rest-B',   // different from JWT restaurant
      isAuthenticated: true,
    })

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useActiveConversations(), { wrapper: wrapper(qc) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // The active cache key should include the activeRestaurantId, NOT the JWT one
    const cachedKeys = qc.getQueryCache().getAll().map((q) => q.queryKey)
    const expectedKey = activeConversationKeys.list('active-rest-B')
    expect(cachedKeys).toContainEqual(expectedKey)

    // The JWT-origin restaurant must NOT be used as the key
    const staleKey = activeConversationKeys.list('jwt-rest-A')
    expect(cachedKeys).not.toContainEqual(staleKey)
  })

  it('falls back to user.restaurantId when activeRestaurantId is null', async () => {
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { restaurantId: 'jwt-rest-A', userId: 'u1', email: 'a@b.com', name: 'A', role: 'owner' },
      activeRestaurantId: null,
      isAuthenticated: true,
    })

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderHook(() => useActiveConversations(), { wrapper: wrapper(qc) })

    await waitFor(() =>
      qc.getQueryCache().getAll().some((q) => q.queryKey[2] === 'jwt-rest-A'),
    )

    const cachedKeys = qc.getQueryCache().getAll().map((q) => q.queryKey)
    expect(cachedKeys).toContainEqual(activeConversationKeys.list('jwt-rest-A'))
  })

  it('refetches when activeRestaurantId changes (restaurant switch)', async () => {
    // First render: activeRestaurantId = 'rest-A'
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { restaurantId: 'jwt-rest-A' },
      activeRestaurantId: 'rest-A',
      isAuthenticated: true,
    })

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = renderHook(() => useActiveConversations(), { wrapper: wrapper(qc) })

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1))

    // Simulate restaurant switch: activeRestaurantId changes to 'rest-B'
    ;(useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { restaurantId: 'jwt-rest-A' },
      activeRestaurantId: 'rest-B',
      isAuthenticated: true,
    })

    rerender()

    // A second fetch must have been issued for the new restaurant
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))

    // Both restaurant IDs should have cache entries
    const cachedKeys = qc.getQueryCache().getAll().map((q) => q.queryKey)
    expect(cachedKeys).toContainEqual(activeConversationKeys.list('rest-A'))
    expect(cachedKeys).toContainEqual(activeConversationKeys.list('rest-B'))
  })

  it('does not fetch when restaurantId is empty', () => {
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      user: null,
      activeRestaurantId: null,
      isAuthenticated: true,
    })

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderHook(() => useActiveConversations(), { wrapper: wrapper(qc) })

    // No API call should fire when there is no restaurant ID
    expect(mockGet).not.toHaveBeenCalled()
  })
})
