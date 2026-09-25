/**
 * ADR 0193 -- `useUpdateInventoryItem` hand-picked the fields it forwarded
 * (stock, par, POS guid, active) and silently dropped everything else, so a
 * price change sent through it never left the browser. The hook runs for real
 * here; only the API module and the auth context are replaced.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

const updateInventoryItem = vi.hoisted(() => vi.fn(async () => ({})))

vi.mock('../../services/api', () => ({
  inventoryApi: { updateInventoryItem },
}))
vi.mock('../../services/api/inventory', () => ({
  normalizeInventoryItem: (x: unknown) => x,
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-1', isAuthenticated: true }),
}))

import { useUpdateInventoryItem } from './useInventoryQueries'

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

describe('useUpdateInventoryItem forwards the house’s own prices', () => {
  it('sends menuPriceBottle and menuPriceGlass, including a null that clears one', async () => {
    const { result } = renderHook(() => useUpdateInventoryItem(), { wrapper: wrapper() })
    await act(async () => {
      await result.current.mutateAsync({
        itemId: 'inv-1',
        data: { menuPriceBottle: 70, menuPriceGlass: null } as never,
      })
    })
    expect(updateInventoryItem).toHaveBeenCalledTimes(1)
    const [itemId, body, restaurantId] = updateInventoryItem.mock.calls[0] as unknown as [string, Record<string, unknown>, string]
    expect(itemId).toBe('inv-1')
    expect(restaurantId).toBe('rest-1')
    expect(body.menuPriceBottle).toBe(70)
    expect('menuPriceGlass' in body && body.menuPriceGlass === null).toBe(true)
  })
})
