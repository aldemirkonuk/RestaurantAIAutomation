/**
 * Web endpoint sweep 2026-09-28, defects #4, #5, #6 (/inventory zones).
 *
 *  #4  the zone editor sent `parentId`; the gateway DTO declares `parent_id`
 *      and main.ts forbids unknown keys, so the edit was a 400 shown as saved.
 *  #5  every zone write went through a helper that swallowed the error, so the
 *      optimistic screen stood as if saved, and auto-locate announced
 *      "N wines assigned" whatever the server said.
 *  #6  the bottle stepper inside a zone updated the cache and never called the
 *      server, so the count went back on the next refresh.
 *
 * A failed write must never look like a saved one: each test below fails on
 * the pre-fix hook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
const mockRequest = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

vi.mock('../services/api/client', () => ({
  apiClient: { get: mockGet, post: mockPost, request: mockRequest },
}))
vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }))

import { useAuth } from '../contexts/AuthContext'
import { useStorageLocations, QUANTITY_SAVE_DEBOUNCE_MS } from './useStorageLocations'

const RESTAURANT = '11111111-1111-4111-8111-111111111111'
const LOC = '33333333-3333-4333-8333-333333333333'
const LOC2 = '44444444-4444-4444-8444-444444444444'
const PARENT = '22222222-2222-4222-8222-222222222222'

// The cache itself, so rollback assertions read what the hook wrote rather
// than a render that React Query has not re-notified yet.
let client: QueryClient
const cachedZones = () =>
  client.getQueryData<{ id: string; name: string }[]>(['storageLocations', RESTAURANT]) ?? []
const cachedMappings = () =>
  client.getQueryData<{ wineId: string; locationId: string; quantity: number }[]>([
    'storageLocationMappings',
    RESTAURANT,
  ]) ?? []

function wrapper() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
}

function serverAnswers() {
  mockGet.mockImplementation(async (url: string) => {
    if (url.endsWith('/mappings')) {
      return {
        data: [{ wineId: 'w1', locationId: LOC, quantity: 3, assignedAt: '2026-09-01T00:00:00Z' }],
      }
    }
    return {
      data: [
        { id: LOC, name: 'Rack A', capacity: 12, current_count: 3 },
        { id: LOC2, name: 'Rack B', capacity: 12, current_count: 0 },
      ],
    }
  })
}

async function mounted() {
  const hook = renderHook(() => useStorageLocations(), { wrapper: wrapper() })
  await waitFor(() => {
    expect(hook.result.current.locations).toHaveLength(2)
    expect(hook.result.current.mappings).toHaveLength(1)
  })
  return hook
}

const rejected = () =>
  Object.assign(new Error('Request failed with status code 400'), {
    response: { status: 400, data: { message: ['property parentId should not exist'] } },
  })

beforeEach(() => {
  vi.clearAllMocks()
  ;(useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    activeRestaurantId: RESTAURANT,
    isAuthenticated: true,
  })
  serverAnswers()
  mockRequest.mockResolvedValue({ data: {} })
})

describe('#4 — the zone edit speaks the DTO', () => {
  it('sends parent_id, never parentId', async () => {
    const { result } = await mounted()
    await act(async () => {
      await result.current.updateLocation(LOC, { name: 'Rack A', parentId: PARENT })
    })
    const body = mockRequest.mock.calls[0][0].data
    expect(body).toMatchObject({ name: 'Rack A', parent_id: PARENT })
    expect(body).not.toHaveProperty('parentId')
  })

  it('clears a parent by sending parent_id: null', async () => {
    const { result } = await mounted()
    await act(async () => {
      await result.current.updateLocation(LOC, { name: 'Rack A', parentId: undefined })
    })
    const body = mockRequest.mock.calls[0][0].data
    expect(body).toHaveProperty('parent_id', null)
  })
})

describe('#5 — a failed zone write is rolled back and said out loud', () => {
  it('a refused edit resolves false, restores the old zone and shows an error', async () => {
    const { result } = await mounted()
    mockRequest.mockRejectedValueOnce(rejected())
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.updateLocation(LOC, { name: 'Renamed' })
    })
    expect(ok).toBe(false)
    expect(cachedZones().find((l) => l.id === LOC)?.name).toBe('Rack A')
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('a refused delete brings the zone and its wines back', async () => {
    const { result } = await mounted()
    mockRequest.mockRejectedValueOnce(rejected())
    await act(async () => {
      await result.current.deleteLocation(LOC)
    })
    expect(cachedZones().map((l) => l.id)).toContain(LOC)
    expect(cachedMappings()).toHaveLength(1)
    expect(toastError).toHaveBeenCalled()
  })

  it('a refused removal puts the wine back in its zone', async () => {
    const { result } = await mounted()
    mockRequest.mockRejectedValueOnce(rejected())
    await act(async () => {
      await result.current.removeWineFromLocation('w1')
    })
    expect(cachedMappings()).toEqual([
      expect.objectContaining({ wineId: 'w1', locationId: LOC, quantity: 3 }),
    ])
    expect(toastError).toHaveBeenCalled()
  })

  it('auto-locate counts only the assignments the server accepted', async () => {
    const { result } = await mounted()
    mockRequest.mockImplementation(async (cfg: { data?: { wineId?: string } }) => {
      if (cfg.data?.wineId === 'w3') throw rejected()
      return { data: {} }
    })
    let outcome: { assigned: number; failed: number } | undefined
    await act(async () => {
      outcome = await result.current.assignMany([
        { wineId: 'w2', locationId: LOC2, quantity: 1 },
        { wineId: 'w3', locationId: LOC2, quantity: 1 },
      ])
    })
    expect(outcome).toEqual({ assigned: 1, failed: 1 })
    const ids = cachedMappings().map((m) => m.wineId)
    expect(ids).toContain('w2')
    expect(ids).not.toContain('w3')
  })
})

describe('#6 — the in-zone bottle stepper saves', () => {
  it('POSTs the final quantity once, after the stepper settles', async () => {
    const { result } = await mounted()
    act(() => {
      result.current.updateWineQuantityAtLocation('w1', 4)
      result.current.updateWineQuantityAtLocation('w1', 5)
      result.current.updateWineQuantityAtLocation('w1', 6)
    })
    expect(mockRequest).not.toHaveBeenCalled()
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1), {
      timeout: QUANTITY_SAVE_DEBOUNCE_MS + 2000,
    })
    expect(mockRequest.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      url: `/storage-locations/${RESTAURANT}/mappings`,
      data: { wineId: 'w1', locationId: LOC, quantity: 6 },
    })
  })

  it('a refused count goes back to the saved number and shows an error', async () => {
    const { result } = await mounted()
    mockRequest.mockRejectedValueOnce(rejected())
    act(() => {
      result.current.updateWineQuantityAtLocation('w1', 7)
    })
    expect(cachedMappings()[0].quantity).toBe(7)
    await waitFor(() => expect(toastError).toHaveBeenCalled(), {
      timeout: QUANTITY_SAVE_DEBOUNCE_MS + 2000,
    })
    expect(cachedMappings()[0].quantity).toBe(3)
  })
})
