/**
 * F-1128: the approval gate was read once and never again, so an order placed
 * or changed after the page opened showed an armed Approve die to someone who
 * may not seal it. The gate is re-read with the orders it judges.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode } from 'react'

const gateGets = vi.fn()

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', user: { restaurantId: 'r1' } }),
}))
vi.mock('@/services/api/client', () => ({
  apiClient: {
    get: (url: string) => {
      if (url !== '/procurement/order-approval-gate') {
        return Promise.reject(new Error('not this test'))
      }
      gateGets()
      return Promise.resolve({
        data: {
          restaurantId: 'r1',
          callerRole: 'staff',
          policySet: true,
          policyNote: 'this house has recorded at least one approval rule',
          readable: true,
          reason: null,
          orders: [],
        },
      })
    },
  },
}))
vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useOrders: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => Promise.resolve(),
    dataUpdatedAt: 1,
  }),
}))
vi.mock('@/hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: [] }),
}))

import { useOrdersNextData } from './useOrdersNextData'

function setup() {
  gateGets.mockReset()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useOrdersNextData(), { wrapper })
  return { qc, ...hook }
}

describe('useOrdersNextData — the gate follows the orders (F-1128)', () => {
  it('re-reads the gate whenever the orders are invalidated (socket, placement, approval)', async () => {
    const { qc, result } = setup()
    await vi.waitFor(() => expect(result.current.approvalByOrder).not.toBeNull())
    expect(gateGets).toHaveBeenCalledTimes(1)

    await act(() => qc.invalidateQueries({ queryKey: ['orders'] }))
    await vi.waitFor(() => expect(gateGets).toHaveBeenCalledTimes(2))
  })

  it('re-reads the gate on the page refetch after an order is placed or saved', async () => {
    const { result } = setup()
    await vi.waitFor(() => expect(result.current.approvalByOrder).not.toBeNull())
    expect(gateGets).toHaveBeenCalledTimes(1)

    act(() => result.current.refetch())
    await vi.waitFor(() => expect(gateGets).toHaveBeenCalledTimes(2))
  })

  it("hands the page the reader's role once the gate has answered", async () => {
    const { result } = setup()
    expect(result.current.approvalCallerRole).toBeUndefined()
    await vi.waitFor(() => expect(result.current.approvalCallerRole).toBe('staff'))
  })
})
