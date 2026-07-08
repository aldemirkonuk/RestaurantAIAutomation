/**
 * Test 1: deleteInventoryItem API function
 * Verifies the correct HTTP endpoint and parameters are used.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deleteInventoryItem } from '../../services/api/inventory'

// Mock the API client module
vi.mock('../../services/api/client', () => ({
  apiClient: {
    delete: vi.fn(),
  },
  getActiveRestaurantId: vi.fn(() => 'restaurant-abc'),
}))

import { apiClient } from '../../services/api/client'

describe('deleteInventoryItem API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(apiClient.delete as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { success: true },
    })
  })

  it('calls DELETE /inventory/:restaurantId/item/:itemId with the inventory row ID', async () => {
    const inventoryRowId = 'inv-row-uuid-001'
    const restaurantId = 'restaurant-xyz'

    const result = await deleteInventoryItem(inventoryRowId, restaurantId)

    expect(apiClient.delete).toHaveBeenCalledTimes(1)
    expect(apiClient.delete).toHaveBeenCalledWith(
      `/inventory/${restaurantId}/item/${inventoryRowId}`
    )
    expect(result).toEqual({ success: true })
  })

  it('falls back to getActiveRestaurantId when no restaurantId is provided', async () => {
    const inventoryRowId = 'inv-row-uuid-002'

    await deleteInventoryItem(inventoryRowId) // no restaurantId arg

    // Should use the mocked getActiveRestaurantId() → 'restaurant-abc'
    expect(apiClient.delete).toHaveBeenCalledWith(
      '/inventory/restaurant-abc/item/inv-row-uuid-002'
    )
  })

  it('propagates API errors to the caller', async () => {
    (apiClient.delete as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Not Found')
    )

    await expect(deleteInventoryItem('bad-id', 'rest-id')).rejects.toThrow('Not Found')
  })
})
