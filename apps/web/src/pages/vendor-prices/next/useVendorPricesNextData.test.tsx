/**
 * Fork 6 (ADR 0160 §112), answered 2026-09-18: the paper trail is "read fresh
 * each time the record opens, never served from a cache." The trail is drawn
 * from the compare read, so that read must not outlive the record — even
 * under the app's own defaults (App.tsx: `staleTime: 5_000`), which would
 * otherwise paint the previous copy on a reopen within five seconds.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const api = vi.hoisted(() => ({ compare: vi.fn() }))

vi.mock('../../../services/api/vendorIntel', async (orig) => {
  const real = await orig<typeof import('../../../services/api/vendorIntel')>()
  return { ...real, compareVendorPrices: api.compare }
})

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: 'owner', activeRestaurantId: 'house-1' }),
}))

import { useCompare } from './useVendorPricesNextData'

function appLikeClient() {
  // The same defaults App.tsx gives the real client, so this test fails if
  // useCompare ever falls back to them.
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 5_000, refetchOnMount: 'always', retry: 1 } },
  })
}

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  api.compare.mockReset()
  api.compare.mockResolvedValue({ observations: [], windowDays: 365, complete: true })
})

describe('useCompare — the record and its paper trail, loaded fresh', () => {
  it('declares no cache lifetime and no freshness window, whatever the client default', async () => {
    const qc = appLikeClient()
    const { result } = renderHook(() => useCompare({ kind: 'wine', id: 'w-1' }), { wrapper: wrapperFor(qc) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const q = qc.getQueryCache().find({ queryKey: ['vendor-prices-compare', 'house-1', 'wine', 'w-1'] })
    expect(q).toBeDefined()
    expect((q?.options as { staleTime?: number }).staleTime).toBe(0)
    expect((q?.options as { gcTime?: number }).gcTime).toBe(0)
  })

  it('drops the read when the record closes and reads again when it reopens', async () => {
    const qc = appLikeClient()
    const key = ['vendor-prices-compare', 'house-1', 'wine', 'w-2']
    const first = renderHook(() => useCompare({ kind: 'wine', id: 'w-2' }), { wrapper: wrapperFor(qc) })
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    first.unmount()
    await waitFor(() => expect(qc.getQueryCache().find({ queryKey: key })).toBeUndefined())

    const second = renderHook(() => useCompare({ kind: 'wine', id: 'w-2' }), { wrapper: wrapperFor(qc) })
    // Nothing painted from a previous copy: the reopened record starts empty.
    expect(second.result.current.data).toBeUndefined()
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))
    expect(api.compare).toHaveBeenCalledTimes(2)
  })
})
