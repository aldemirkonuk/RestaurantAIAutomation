/**
 * Web endpoint sweep 2026-09-28, row 15 (/vendors, "add own vendor").
 *
 * `useCreateProvider` used to catch EVERY failure of POST /providers — a 400
 * validation refusal included — queue it for "offline sync", and resolve with
 * a fabricated `temp_…` id. The sheet then said "Provider saved offline" and
 * went on to write delivery days and an address against an id that does not
 * exist, while the vendor itself was never created (and the queued replay
 * would be refused the same way forever).
 *
 * The rule pinned here: only a real network failure — a request that went out
 * and got NO response — is queued. A 4xx or a 5xx is an answer from the
 * server, so the mutation rejects and the caller shows the error.
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

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

const httpError = (status: number, message: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    request: {},
    response: { status, data: { message } },
  })

const networkError = () =>
  Object.assign(new Error('Network Error'), {
    isAxiosError: true,
    request: {},
    response: undefined,
  })

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true })
}

const INPUT = { name: 'Kavaklıdere', paymentTerms: 'Net 30' } as never

function run() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const { result } = renderHook(() => useCreateProvider(), { wrapper: wrapper(qc) })
  return result
}

describe('useCreateProvider — offline queueing only on a real network failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sync.queueMutation.mockResolvedValue(undefined)
    setOnline(false)
  })

  it('a 400 refusal rejects — nothing queued, no fake id, no "saved offline"', async () => {
    api.createProvider.mockRejectedValue(
      httpError(400, 'property paymentTerms should not exist'),
    )
    const result = run()
    let caught: unknown
    await act(async () => {
      await result.current.mutateAsync(INPUT).catch((e) => {
        caught = e
      })
    })
    expect(caught).toBeDefined()
    expect(sync.queueMutation).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
  })

  it('a 500 rejects too — the server answered, so it is not "offline"', async () => {
    api.createProvider.mockRejectedValue(httpError(500, 'boom'))
    const result = run()
    let caught: unknown
    await act(async () => {
      await result.current.mutateAsync(INPUT).catch((e) => {
        caught = e
      })
    })
    expect(caught).toBeDefined()
    expect(sync.queueMutation).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('a request with no response at all is queued and marked pending', async () => {
    api.createProvider.mockRejectedValue(networkError())
    const result = run()
    let out: unknown
    await act(async () => {
      out = await result.current.mutateAsync(INPUT)
    })
    expect(sync.queueMutation).toHaveBeenCalledTimes(1)
    expect(sync.queueMutation.mock.calls[0][0]).toMatchObject({ type: 'provider.create' })
    expect(out).toMatchObject({ _pending: true })
    expect(toast.info).toHaveBeenCalled()
  })

  it('committed but reply lost: the queued replay carries the key the first attempt was sent with', async () => {
    // "No response" includes a timeout after the server wrote the vendor. The
    // replay must be recognisable as the same create, or it makes a duplicate.
    api.createProvider.mockRejectedValue(networkError())
    const result = run()
    await act(async () => {
      await result.current.mutateAsync(INPUT)
    })
    const firstKey = api.createProvider.mock.calls[0][1]?.idempotencyKey
    expect(typeof firstKey).toBe('string')
    expect(firstKey.length).toBeGreaterThan(10)
    expect(sync.queueMutation.mock.calls[0][0].data).toMatchObject({ idempotencyKey: firstKey })
  })

  it('two separate creates never share a key', async () => {
    api.createProvider.mockResolvedValue({ id: 'p1', name: 'x' })
    const result = run()
    await act(async () => {
      await result.current.mutateAsync(INPUT)
      await result.current.mutateAsync(INPUT)
    })
    const [a, b] = api.createProvider.mock.calls.map((c) => c[1]?.idempotencyKey)
    expect(a).toBeTruthy()
    expect(a).not.toBe(b)
  })

  it('no response while ONLINE (a timeout) rejects instead of queueing: the server may still be writing it', async () => {
    setOnline(true)
    api.createProvider.mockRejectedValue(networkError())
    const result = run()
    let caught: unknown
    await act(async () => {
      await result.current.mutateAsync(INPUT).catch((e) => {
        caught = e
      })
    })
    expect(caught).toBeDefined()
    expect(sync.queueMutation).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('a plain throw with no network evidence rejects, not queued', async () => {
    api.createProvider.mockRejectedValue(new TypeError('x is undefined'))
    const result = run()
    let caught: unknown
    await act(async () => {
      await result.current.mutateAsync(INPUT).catch((e) => {
        caught = e
      })
    })
    expect(caught).toBeDefined()
    expect(sync.queueMutation).not.toHaveBeenCalled()
  })
})
