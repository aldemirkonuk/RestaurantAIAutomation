/**
 * ADR 0051 — the app does not invent cellar zones, and does not write invented
 * ones into a tenant's database.
 *
 * Measured on production `exzueerziesmczwlhomd` on 2026-09-02, before the fix:
 * `storage_locations` held 87 rows across 7 tenants, and 84 of them carried one
 * of four hard-coded names — Main Cellar / Bar Stock / Overflow Storage / VIP
 * Reserve — across 6 tenants, first written 2026-05-20, most recent 2026-07-30.
 * 21 rows per name per name-group: it re-seeded repeatedly, because the effect's
 * `didSeedRef` was reset on every failure.
 *
 * The mechanism was one line: the queryFn RETURNED `DEFAULT_LOCATIONS` when the
 * server sent `[]`, which satisfied the seeding effect's `allAreDefaults` guard,
 * which POSTed all four to `/storage-locations/:id`.
 *
 * These tests hold the three states apart. Each one fails against the pre-fix
 * tree; see the ADR for the captured output.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { renderHook, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
const mockRequest = vi.hoisted(() => vi.fn())

vi.mock('../services/api/client', () => ({
  apiClient: { get: mockGet, post: mockPost, request: mockRequest },
}))
vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }))

import { useAuth } from '../contexts/AuthContext'
import { useStorageLocations } from './useStorageLocations'
import { CellarMapView } from '../pages/inventory/command/CellarMapView'

const RESTAURANT = '11111111-1111-4111-8111-111111111111'

// The hook keeps `retry: 1`, so a rejected fetch takes one exponential backoff
// (~1s) before it settles into an error. waitFor's 1000ms default races it.
const SETTLE = { timeout: 5000 }

/** The exact four names the pre-fix tree invented and wrote to tenant DBs. */
const INVENTED = ['Main Cellar', 'Bar Stock', 'Overflow Storage', 'VIP Reserve']

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
    // React Query logs expected rejections; silence only that.
  })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
}

/** Drives the real hook and renders the real map, as the page does. */
function MapHarness() {
  const { locations, locationsLoading, locationsUnavailable } = useStorageLocations()
  return (
    <CellarMapView
      items={[]}
      locations={locations}
      locationsLoading={locationsLoading}
      locationsUnavailable={locationsUnavailable}
      onOpenInTable={() => {}}
      onManageLocations={() => {}}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    activeRestaurantId: RESTAURANT,
    isAuthenticated: true,
  })
  mockPost.mockResolvedValue({ data: {} })
  mockRequest.mockResolvedValue({ data: {} })
})

describe('useStorageLocations — an empty server response is an answer, not a prompt', () => {
  it('reports zero zones when the server returns an empty list', async () => {
    mockGet.mockResolvedValue({ data: [] })

    const { result } = renderHook(() => useStorageLocations(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.locationsLoading).toBe(false))
    expect(result.current.locations).toEqual([])
  })

  it('never POSTs a zone the tenant did not create', async () => {
    mockGet.mockResolvedValue({ data: [] })

    const { result } = renderHook(() => useStorageLocations(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.locationsLoading).toBe(false))
    // Give the removed seeding effect every chance to fire.
    await new Promise((r) => setTimeout(r, 50))

    expect(mockPost).not.toHaveBeenCalled()
    const wrote = mockPost.mock.calls.map((c) => String(c[0]))
    expect(wrote.filter((u) => u.includes('/storage-locations/'))).toEqual([])
  })

  it('does not name Main Cellar, Bar Stock, Overflow Storage or VIP Reserve anywhere', async () => {
    mockGet.mockResolvedValue({ data: [] })

    const { result } = renderHook(() => useStorageLocations(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.locationsLoading).toBe(false))

    const names = result.current.locations.map((l) => l.name)
    for (const invented of INVENTED) expect(names).not.toContain(invented)
  })

  it('renders the empty state, and the empty state offers to create zones', async () => {
    mockGet.mockResolvedValue({ data: [] })

    render(<MapHarness />, { wrapper: wrapper() })

    expect(await screen.findByText(/no storage locations yet/i)).toBeInTheDocument()
    for (const invented of INVENTED) {
      expect(screen.queryByText(invented)).not.toBeInTheDocument()
    }
  })
})

describe('useStorageLocations — a failed fetch says so in words', () => {
  it('flags the zones as unavailable rather than substituting any', async () => {
    mockGet.mockRejectedValue(new Error('gateway down'))

    const { result } = renderHook(() => useStorageLocations(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.locationsUnavailable).toBe(true), SETTLE)
    expect(result.current.locations).toEqual([])
  })

  it('the map says the zones could not be loaded, and does not say there are none', async () => {
    mockGet.mockRejectedValue(new Error('gateway down'))

    render(<MapHarness />, { wrapper: wrapper() })

    expect(await screen.findByText(/could not be loaded/i, undefined, SETTLE)).toBeInTheDocument()
    expect(screen.queryByText(/no storage locations yet/i)).not.toBeInTheDocument()
    for (const invented of INVENTED) {
      expect(screen.queryByText(invented)).not.toBeInTheDocument()
    }
  })

  it('a failure is not a licence to seed either', async () => {
    mockGet.mockRejectedValue(new Error('gateway down'))

    const { result } = renderHook(() => useStorageLocations(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.locationsUnavailable).toBe(true), SETTLE)
    await new Promise((r) => setTimeout(r, 50))

    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('useStorageLocations — loading is a third state', () => {
  it('does not render the empty state before the query has answered', async () => {
    let release: (v: { data: unknown[] }) => void = () => {}
    mockGet.mockReturnValue(new Promise((r) => { release = r }))

    render(<MapHarness />, { wrapper: wrapper() })

    expect(screen.getByText(/loading storage zones/i)).toBeInTheDocument()
    expect(screen.queryByText(/no storage locations yet/i)).not.toBeInTheDocument()
    for (const invented of INVENTED) {
      expect(screen.queryByText(invented)).not.toBeInTheDocument()
    }

    release({ data: [] })
    expect(await screen.findByText(/no storage locations yet/i)).toBeInTheDocument()
  })
})

describe('useStorageLocations — a capacity nobody entered is unknown, not 100', () => {
  it('maps a missing capacity to null', async () => {
    mockGet.mockResolvedValue({
      data: [{ id: 'a1', name: 'Back Room', current_count: 3 }],
    })

    const { result } = renderHook(() => useStorageLocations(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.locations).toHaveLength(1))

    expect(result.current.locations[0].capacity).toBeNull()
  })

  it('keeps a recorded capacity exactly as recorded', async () => {
    mockGet.mockResolvedValue({
      data: [{ id: 'a1', name: 'Back Room', capacity: 42, current_count: 3 }],
    })

    const { result } = renderHook(() => useStorageLocations(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.locations).toHaveLength(1))

    expect(result.current.locations[0].capacity).toBe(42)
  })

  it('draws no fill bar and no denominator for an unrecorded capacity', async () => {
    mockGet.mockResolvedValue({
      data: [{ id: 'a1', name: 'Back Room', current_count: 0 }],
    })

    render(<MapHarness />, { wrapper: wrapper() })

    expect(await screen.findByText(/capacity not recorded/i)).toBeInTheDocument()
    expect(screen.getByText(/0 \/ — slots/)).toBeInTheDocument()
    expect(screen.queryByText(/0 \/ 100 slots/)).not.toBeInTheDocument()
  })

  it('excludes unknown capacities from the utilisation denominator and counts them', async () => {
    mockGet.mockResolvedValue({
      data: [
        { id: 'a1', name: 'Recorded', capacity: 100, current_count: 25 },
        { id: 'a2', name: 'Unrecorded', current_count: 40 },
      ],
    })

    const { result } = renderHook(() => useStorageLocations(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.locations).toHaveLength(2))

    const stats = result.current.getLocationStats()
    expect(stats.totalCapacity).toBe(100)
    expect(stats.capacityUnknownCount).toBe(1)
    expect(stats.utilizationRate).toBe(25)
  })
})
