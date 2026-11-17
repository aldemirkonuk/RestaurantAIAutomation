/**
 * A vendor that was really created is the house's setup vendor step. The rail
 * keeps the setup it read until the window is next focused, so it went on
 * saying the vendor was still to do. Creating one asks that read again; a
 * vendor only queued for later (no network) or refused does not, since the
 * house has not got it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

const api = vi.hoisted(() => ({ createProvider: vi.fn() }))
const sync = vi.hoisted(() => ({ queueMutation: vi.fn() }))
const toast = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn(), error: vi.fn() }))

vi.mock('../../services/api/providers', () => ({
  createProvider: (...a: unknown[]) => api.createProvider(...a),
}))
vi.mock('../../lib/sync-manager', () => ({ syncManager: sync }))
vi.mock('../../lib/offline-storage', () => ({ offlineStorage: {} }))
vi.mock('../../stores', () => ({ useNotificationStore: () => toast }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-A', user: { restaurantId: 'rest-A' } }),
}))

import { useCreateProvider } from './useProviderQueries'

const INPUT = { name: 'Kavaklıdere', paymentTerms: 'Net 30' } as never

function run() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  qc.setQueryData(['onboarding-progress'], { vendor_added: false })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => useCreateProvider(), { wrapper })
  const stale = () => qc.getQueryState(['onboarding-progress'])?.isInvalidated
  return { result, stale }
}

describe('creating a vendor asks the house setup read again', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sync.queueMutation.mockResolvedValue(undefined)
  })

  it('a vendor the gateway created marks the setup read stale', async () => {
    api.createProvider.mockResolvedValue({ id: 'p-1', name: 'Kavaklıdere' })
    const { result, stale } = run()
    expect(stale()).toBe(false)
    await act(async () => {
      await result.current.mutateAsync(INPUT)
    })
    expect(stale()).toBe(true)
  })

  it('a vendor only queued while offline does not: the house has not got it yet', async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    api.createProvider.mockRejectedValue(
      Object.assign(new Error('Network Error'), { isAxiosError: true, request: {}, response: undefined }),
    )
    const { result, stale } = run()
    await act(async () => {
      await result.current.mutateAsync(INPUT)
    })
    expect(sync.queueMutation).toHaveBeenCalled()
    expect(stale()).toBe(false)
  })

  it('a refused vendor does not', async () => {
    api.createProvider.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true,
        request: {},
        response: { status: 400, data: { message: 'no' } },
      }),
    )
    const { result, stale } = run()
    await act(async () => {
      await result.current.mutateAsync(INPUT).catch(() => undefined)
    })
    expect(stale()).toBe(false)
  })
})
