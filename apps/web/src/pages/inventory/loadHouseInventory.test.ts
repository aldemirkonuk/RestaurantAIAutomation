/**
 * "Export all locations" reads every house's rows outside the page's own
 * hook. They must come out shaped as the page shows them: the raw gateway row
 * carries `wineName` / `stockLive` / `thresholdMin` (or their snake_case),
 * none of the `name` / `liveStock` / `threshold` the valuation columns read
 * (wave6sim F-366: blank names and zero stock for every house).
 */
import { describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ getInventory: vi.fn(), getWinesByIds: vi.fn() }))

vi.mock('../../services/api/inventory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/inventory')>()),
  getInventory: api.getInventory,
}))
vi.mock('../../services/api/wines', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/wines')>()),
  getWinesByIds: api.getWinesByIds,
}))

import { loadHouseInventory } from './useInventoryPage'

describe('loadHouseInventory', () => {
  it('a raw snake_case row comes out with its name, stock and par', async () => {
    api.getInventory.mockResolvedValue([
      {
        id: 'inv-1',
        master_wine_id: 'w-1',
        wine_name: 'Kavaklıdere Yakut',
        wine_producer: 'Kavaklıdere',
        stock_live: 7,
        shadow_stock: 2,
        threshold_min: 4,
        wac: 12.5,
      },
    ])
    api.getWinesByIds.mockResolvedValue([])
    const [row] = await loadHouseInventory('rest-B')
    expect(api.getInventory).toHaveBeenCalledWith('rest-B')
    expect(row.name).toBe('Kavaklıdere Yakut')
    expect(row.producer).toBe('Kavaklıdere')
    expect(row.liveStock).toBe(7)
    expect(row.shadowStock).toBe(2)
    expect(row.threshold).toBe(4)
    expect(row.wac).toBe(12.5)
    expect(row.inventoryId).toBe('inv-1')
  })

  it('takes the type from the library wine when it loads, as the page does', async () => {
    api.getInventory.mockResolvedValue([
      { id: 'inv-2', wineId: 'w-2', wineName: 'Alias', stockLive: 3, thresholdMin: 1 },
    ])
    api.getWinesByIds.mockResolvedValue([
      { id: 'w-2', name: 'Öküzgözü', producer: 'Turasan', type: 'red', category: 'red', vintage: 2019, price: 10 },
    ])
    const [row] = await loadHouseInventory('rest-C')
    expect(api.getWinesByIds).toHaveBeenCalledWith(['w-2'])
    expect(row.type).toBe('red')
    expect(row.liveStock).toBe(3)
  })
})
