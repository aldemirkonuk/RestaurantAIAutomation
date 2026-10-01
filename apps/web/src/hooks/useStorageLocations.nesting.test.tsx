/**
 * Zones nest (founder answer 2026-09-29, "Add parent column (Recommended)").
 * The hook reads the gateway's `parent_id`, and deleting a parent makes the
 * zones inside it top-level at once (the database does the same, trigger
 * storage_locations_orphans_go_top_level), and puts them back if the delete
 * is refused.
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
import { useStorageLocations } from './useStorageLocations'

const RESTAURANT = '11111111-1111-4111-8111-111111111111'
const CELLAR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const RACK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SHELF = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

let client: QueryClient
const cachedZones = () =>
  client.getQueryData<{ id: string; parentId?: string }[]>(['storageLocations', RESTAURANT]) ?? []

function wrapper() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useAuth).mockReturnValue({
    activeRestaurantId: RESTAURANT,
    isAuthenticated: true,
  } as unknown as ReturnType<typeof useAuth>)
  mockGet.mockImplementation(async (url: string) => {
    if (url.endsWith('/mappings')) return { data: [] }
    return {
      data: [
        { id: CELLAR, name: 'Cellar', capacity: 500, current_count: 0, parent_id: null },
        { id: RACK, name: 'Rack A', capacity: 60, current_count: 0, parent_id: CELLAR },
        { id: SHELF, name: 'Shelf 2', capacity: 12, current_count: 0, parent_id: RACK },
      ],
    }
  })
  mockRequest.mockResolvedValue({ data: {} })
})

async function mounted() {
  const hook = renderHook(() => useStorageLocations(), { wrapper: wrapper() })
  await waitFor(() => expect(hook.result.current.locations).toHaveLength(3))
  return hook
}

describe('zone nesting in useStorageLocations', () => {
  it("reads the gateway's parent_id", async () => {
    const { result } = await mounted()
    const byId = Object.fromEntries(result.current.locations.map((l) => [l.id, l]))
    expect(byId[RACK].parentId).toBe(CELLAR)
    expect(byId[CELLAR].parentId).toBeUndefined()
  })

  it('deleting a parent makes the zones inside it top-level, and leaves the rest', async () => {
    const { result } = await mounted()
    await act(async () => {
      expect(await result.current.deleteLocation(RACK)).toBe(true)
    })
    const shelf = cachedZones().find((z) => z.id === SHELF)
    expect(shelf).toBeDefined()
    expect(shelf?.parentId).toBeUndefined()
    expect(cachedZones().some((z) => z.id === RACK)).toBe(false)
  })

  it('a refused delete puts the zones inside it back under it', async () => {
    const { result } = await mounted()
    mockRequest.mockRejectedValueOnce({ response: { data: { message: 'no' } } })
    await act(async () => {
      expect(await result.current.deleteLocation(RACK)).toBe(false)
    })
    expect(cachedZones().find((z) => z.id === SHELF)?.parentId).toBe(RACK)
    expect(cachedZones().find((z) => z.id === RACK)?.parentId).toBe(CELLAR)
  })
})
