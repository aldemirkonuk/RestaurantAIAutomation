/**
 * The vendor-list import's own toast (S200 leftover of F-685). The hook gained
 * a caller in VendorCsvImport, so its toast is now seen, and it said "Import
 * successful" / "N providers imported." and, on a refusal, a bare status code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

const api = vi.hoisted(() => ({ bulkImportProviders: vi.fn() }))
const toast = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }))

vi.mock('../../services/api/providers', () => ({
  bulkImportProviders: (...a: unknown[]) => api.bulkImportProviders(...a),
}))
vi.mock('../../lib/sync-manager', () => ({ syncManager: {} }))
vi.mock('../../lib/offline-storage', () => ({ offlineStorage: {} }))
vi.mock('../../stores', () => ({ useNotificationStore: () => toast }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-A', user: { restaurantId: 'rest-A' } }),
}))

import { useBulkImportProviders } from './useProviderQueries'

function run() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return renderHook(() => useBulkImportProviders(), { wrapper }).result
}

const ARGS = { restaurantId: 'rest-A', providers: [{ name: 'Kavaklıdere' }] as never }

/** Every word the toast showed, title and body. */
const said = () =>
  [...toast.success.mock.calls, ...toast.warning.mock.calls, ...toast.error.mock.calls]
    .flat()
    .join(' ')

describe('useBulkImportProviders — the toast speaks of vendors, in plain words', () => {
  beforeEach(() => vi.clearAllMocks())

  it('says how many vendors were added', async () => {
    api.bulkImportProviders.mockResolvedValue({ imported: 3, failed: 0, errors: [] })
    const result = run()
    await act(async () => {
      await result.current.mutateAsync(ARGS)
    })
    expect(toast.success).toHaveBeenCalledWith('Vendors added', '3 vendors added to your list.')
    expect(said()).not.toMatch(/provider|import successful/i)
  })

  it('says which part was not added, one vendor said as one', async () => {
    api.bulkImportProviders.mockResolvedValue({ imported: 1, failed: 2, errors: ['x', 'y'] })
    const result = run()
    await act(async () => {
      await result.current.mutateAsync(ARGS)
    })
    expect(toast.warning).toHaveBeenCalledWith(
      'Some vendors were not added',
      '1 vendor added, 2 vendors not added.',
    )
  })

  it('never shows a status code when the server gave no reason', async () => {
    api.bulkImportProviders.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true,
        request: {},
        response: { status: 400, data: {} },
      }),
    )
    const result = run()
    await act(async () => {
      await result.current.mutateAsync(ARGS).catch(() => undefined)
    })
    expect(toast.error).toHaveBeenCalledWith('No vendors were added', 'No reason was given. Try again.')
    expect(said()).not.toMatch(/status code|Import failed/)
  })

  it('does not say nothing was added when it was not confirmed', async () => {
    api.bulkImportProviders.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 502'), {
        isAxiosError: true,
        request: {},
        response: { status: 502, data: {} },
      }),
    )
    const result = run()
    await act(async () => {
      await result.current.mutateAsync(ARGS).catch(() => undefined)
    })
    expect(toast.error).toHaveBeenCalledWith(
      'The import may not have finished',
      'It was not confirmed. Look at your vendors before importing the list again.',
    )
  })
})
