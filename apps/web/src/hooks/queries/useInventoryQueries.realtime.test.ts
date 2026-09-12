/**
 * The `stock:updated` narrowing, measured at its SECOND entry point.
 *
 * `lib/websocket.tsx` narrows its own `invalidateQueries` with
 * `isQueryAffectedByStockUpdate` and then, three lines later, dispatches the
 * `inventory_change` CustomEvent. `useInventory` listens for that event. While
 * its listener blanket-invalidated `['inventory']`, the narrowing upstream
 * bought nothing at all — the whole tree refetched anyway, one line below the
 * commit message claiming it did not.
 *
 * A predicate test alone cannot see that: the predicate was correct the whole
 * time. These cases go through the event, which is the only place the two ends
 * meet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

const getInventory = vi.hoisted(() => vi.fn(async () => [] as unknown[]))

vi.mock('../../services/api', () => ({
  inventoryApi: {
    getInventory,
    getInventorySummary: vi.fn(async () => null),
    getLowStockItems: vi.fn(async () => []),
  },
}))

vi.mock('../../services/api/inventory', () => ({
  normalizeInventoryItem: (x: unknown) => x,
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../../contexts/AuthContext'
import { queryKeys } from '../../lib/query-keys'
import { useInventory } from './useInventoryQueries'

const RESTAURANT = 'rest-aaa'
const OTHER_RESTAURANT = 'rest-bbb'

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
}

/** Query shapes the app registers that a stock event must NOT disturb. */
const UNTOUCHABLE: Array<{ key: readonly unknown[]; label: string }> = [
  { key: queryKeys.wines.list(), label: 'wine library list' },
  { key: queryKeys.inventory.list(OTHER_RESTAURANT), label: 'another restaurant’s list' },
  { key: queryKeys.inventory.summary(OTHER_RESTAURANT), label: 'another restaurant’s summary' },
  { key: ['inventory', 'receipt-depth', ['order-1']], label: 'receipt depth' },
  { key: [...queryKeys.inventory.all, 'unmapped-toast', RESTAURANT], label: 'unmapped toast' },
]

/** Queries a stock event in THIS restaurant genuinely stales. */
const TOUCHED: Array<{ key: readonly unknown[]; label: string }> = [
  { key: queryKeys.inventory.summary(RESTAURANT), label: 'this restaurant’s summary' },
  { key: queryKeys.inventory.lowStock(RESTAURANT), label: 'this restaurant’s low stock' },
  { key: ['inventory', 'sommelier-context'], label: 'sommelier stock context' },
]

function seed(qc: QueryClient) {
  for (const { key } of [...UNTOUCHABLE, ...TOUCHED]) qc.setQueryData(key, { seeded: true })
}

function dispatch(detail: unknown) {
  act(() => {
    window.dispatchEvent(new CustomEvent('inventory_change', { detail }))
  })
}

describe('useInventory — the inventory_change listener honours the stock narrowing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getInventory.mockResolvedValue([])
    ;(useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      activeRestaurantId: RESTAURANT,
      isAuthenticated: true,
    })
  })

  it('leaves the wine library and other tenants alone on a socket stock event', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    seed(qc)
    renderHook(() => useInventory(), { wrapper: wrapper(qc) })
    await waitFor(() => expect(getInventory).toHaveBeenCalled())

    // Exactly what lib/websocket.tsx dispatches for `stock:updated`.
    dispatch({
      eventType: 'UPDATE',
      source: 'websocket',
      new: {
        inventory_id: 'inv-row-1',
        restaurant_id: RESTAURANT,
        wine_name: 'Barolo Riserva',
        stock_before: 12,
        stock_after: 11,
      },
    })

    for (const { key, label } of UNTOUCHABLE) {
      expect(qc.getQueryState(key)?.isInvalidated, label).toBe(false)
    }
  })

  it('still stales everything the event genuinely changes — the narrowing must MATCH', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    seed(qc)
    renderHook(() => useInventory(), { wrapper: wrapper(qc) })
    await waitFor(() => expect(getInventory).toHaveBeenCalled())

    dispatch({
      eventType: 'UPDATE',
      source: 'websocket',
      new: { inventory_id: 'inv-row-1', restaurant_id: RESTAURANT },
    })

    for (const { key, label } of TOUCHED) {
      expect(qc.getQueryState(key)?.isInvalidated, label).toBe(true)
    }
  })

  it('a local payload with no restaurant_id keeps the blanket refresh', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    seed(qc)
    renderHook(() => useInventory(), { wrapper: wrapper(qc) })
    await waitFor(() => expect(getInventory).toHaveBeenCalled())

    // contexts/RealtimeContext.tsx `dispatchInventoryUpdate` — a different
    // payload shape entirely. Unreadable here, so it must widen, not mute.
    dispatch({
      eventType: 'UPDATE',
      source: 'local',
      new: { type: 'add', wineId: 'wine-1', source: 'wine_library', timestamp: '2026-09-12T00:00:00Z' },
    })

    expect(
      qc.getQueryState([...queryKeys.inventory.all, 'unmapped-toast', RESTAURANT])?.isInvalidated,
      'unmapped toast, on an unreadable payload',
    ).toBe(true)
    expect(qc.getQueryState(queryKeys.wines.list())?.isInvalidated, 'wine library').toBe(false)
  })
})
