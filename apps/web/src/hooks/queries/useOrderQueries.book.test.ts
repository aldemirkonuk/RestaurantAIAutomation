/**
 * F-1132 (rehit of F-117): `useOrders` is what /orders counts its stages and
 * sums its month from. It read the gateway's first page — the newest 50 — so a
 * house with 230 orders saw figures for 50. It now reads the whole book.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

const get = vi.hoisted(() => vi.fn())

vi.mock('../../services/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/client')>(
    '../../services/api/client',
  )
  return {
    ...actual,
    apiClient: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    getActiveRestaurantId: () => 'rest-1',
  }
})

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-1', isAuthenticated: true }),
}))

vi.mock('../../contexts/RealtimeContext', () => ({
  useOrdersSubscription: () => undefined,
}))

import { useOrders } from './useOrderQueries'

const rows = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `o-${from + i}`, status: 'pending' }))

describe('useOrders reads the whole order book (F-1132)', () => {
  it('holds every order the house has, not the newest page', async () => {
    get.mockImplementation(async (_path: string, cfg?: { params?: { page?: number } }) => {
      const page = cfg?.params?.page ?? 1
      // A gateway that, like the real one, answers 50 when no limit is sent.
      if (!cfg?.params?.page) return { data: { orders: rows(0, 50), total: 230, hasMore: true } }
      return page < 3
        ? { data: { orders: rows((page - 1) * 100, 100), total: 230, hasMore: true } }
        : { data: { orders: rows(200, 30), total: 230, hasMore: false } }
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children)

    const { result } = renderHook(() => useOrders(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(230)
  })
})
