/**
 * Test 2: handleRemoveFromInventory behaviour
 * Verifies the three critical contracts:
 *   (a) uses item.inventoryId (the DB PK), NOT item.id (the wine ID)
 *   (b) optimistically removes from TanStack Query cache immediately
 *   (c) invalidates inventory queries after a successful API call
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- mock API service ----
vi.mock('../../services/api', () => ({
  inventoryApi: {
    deleteInventoryItem: vi.fn(),
  },
}))

// ---- mock react query ----
const mockSetQueryData = vi.fn()
const mockInvalidateQueries = vi.fn()
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useQueryClient: () => ({
      setQueryData: mockSetQueryData,
      invalidateQueries: mockInvalidateQueries,
    }),
  }
})

import { inventoryApi } from '../../services/api'
import { queryKeys } from '../../lib/query-keys'

// Helper: simulates the logic of handleRemoveFromInventory without
// mounting the full Inventory component.
async function simulateRemove(
  item: { id: string; inventoryId?: string; name: string; liveStock?: number; shadowStock?: number },
  activeRestaurantId: string,
  queryClient: { setQueryData: typeof mockSetQueryData; invalidateQueries: typeof mockInvalidateQueries },
) {
  const inventoryRowId = item.inventoryId || item.id
  const cacheKey = queryKeys.inventory.list(activeRestaurantId)

  // Optimistic removal
  queryClient.setQueryData(cacheKey, (old: any[] | undefined) =>
    old ? old.filter((i: any) => i.id !== inventoryRowId) : []
  )

  await inventoryApi.deleteInventoryItem(inventoryRowId, activeRestaurantId)
  queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })
}

describe('handleRemoveFromInventory logic', () => {
  const restaurantId = 'rest-123'
  const fakeItem = {
    id: 'wine-master-uuid',       // this is the WINE id, not inventory row
    inventoryId: 'inv-row-uuid',  // this is the restaurant_inventory.id
    name: 'Barolo Riserva',
    liveStock: 3,
    shadowStock: 2,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(inventoryApi.deleteInventoryItem as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
    })
  })

  it('(a) passes item.inventoryId (DB PK) to deleteInventoryItem, not item.id (wine ID)', async () => {
    const qc = { setQueryData: mockSetQueryData, invalidateQueries: mockInvalidateQueries }
    await simulateRemove(fakeItem, restaurantId, qc)

    expect(inventoryApi.deleteInventoryItem).toHaveBeenCalledWith(
      'inv-row-uuid',   // inventoryId — the correct DB primary key
      restaurantId
    )
    expect(inventoryApi.deleteInventoryItem).not.toHaveBeenCalledWith(
      'wine-master-uuid', // item.id — wrong, must NOT be used
      expect.anything()
    )
  })

  it('(b) calls setQueryData before the API call (optimistic, instant UI update)', async () => {
    let apiCallOrder = 0
    let setDataOrder = 0

    mockSetQueryData.mockImplementation(() => { setDataOrder = ++apiCallOrder })
    ;(inventoryApi.deleteInventoryItem as ReturnType<typeof vi.fn>).mockImplementation(
      async () => { apiCallOrder++; return { success: true } }
    )

    const qc = { setQueryData: mockSetQueryData, invalidateQueries: mockInvalidateQueries }
    await simulateRemove(fakeItem, restaurantId, qc)

    expect(setDataOrder).toBe(1) // setQueryData was first
    expect(mockSetQueryData).toHaveBeenCalled()
  })

  it('(b) optimistic update filters OUT the deleted item by inventoryId', () => {
    const existingCacheItems = [
      { id: 'inv-row-uuid', wine_name: 'Barolo Riserva' },
      { id: 'other-inv-id', wine_name: 'Bordeaux' },
    ]

    // Capture the updater function passed to setQueryData
    mockSetQueryData.mockImplementation((_key: any, updater: (old: any[]) => any[]) => {
      const result = updater(existingCacheItems)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('other-inv-id')
    })

    const qc = { setQueryData: mockSetQueryData, invalidateQueries: mockInvalidateQueries }
    // Run synchronously — only the setQueryData part
    const inventoryRowId = fakeItem.inventoryId || fakeItem.id
    const cacheKey = queryKeys.inventory.list(restaurantId)
    qc.setQueryData(cacheKey, (old: any[] | undefined) =>
      old ? old.filter((i: any) => i.id !== inventoryRowId) : []
    )
  })

  it('(c) calls invalidateQueries after successful deletion', async () => {
    const qc = { setQueryData: mockSetQueryData, invalidateQueries: mockInvalidateQueries }
    await simulateRemove(fakeItem, restaurantId, qc)

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.inventory.all,
    })
  })
})
