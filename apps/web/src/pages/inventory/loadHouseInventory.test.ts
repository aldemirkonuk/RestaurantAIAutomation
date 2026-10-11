/**
 * "Export all locations" reads every house's rows outside the page's own
 * hook, in ONE read that names no house (F-596: a per-house read with this
 * house's token was a 403, so the export never ran). They must come out shaped as the page shows them: the raw gateway row
 * carries `wineName` / `stockLive` / `thresholdMin` (or their snake_case),
 * none of the `name` / `liveStock` / `threshold` the valuation columns read
 * (wave6sim F-366: blank names and zero stock for every house).
 */
import { describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getInventory: vi.fn(),
  getInventoryAcrossHouses: vi.fn(),
  getWinesByIds: vi.fn(),
}))

vi.mock('../../services/api/inventory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/inventory')>()),
  getInventory: api.getInventory,
  getInventoryAcrossHouses: api.getInventoryAcrossHouses,
}))
vi.mock('../../services/api/wines', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/wines')>()),
  getWinesByIds: api.getWinesByIds,
}))

import { loadEveryHouseInventory, stockValueCell, type InventoryItem } from './useInventoryPage'

const house = (name: string, items: unknown[], code: string | null = 'TRY') => ({
  restaurantId: `id-${name}`,
  name,
  currency: { code, readable: true },
  items,
})

describe('loadEveryHouseInventory', () => {
  it('a raw snake_case row comes out with its name, stock and par', async () => {
    api.getInventoryAcrossHouses.mockResolvedValue({
      houses: [house('Meyhane', [{
        id: 'inv-1',
        master_wine_id: 'w-1',
        wine_name: 'Kavaklıdere Yakut',
        wine_producer: 'Kavaklıdere',
        stock_live: 7,
        shadow_stock: 2,
        threshold_min: 4,
        wac: 12.5,
      }])],
      notIncluded: [],
    })
    api.getWinesByIds.mockResolvedValue([])
    const { houses } = await loadEveryHouseInventory()
    const [row] = houses[0].items
    // Never the per-house read: that names another house with this house's token.
    expect(api.getInventory).not.toHaveBeenCalled()
    expect(houses[0].name).toBe('Meyhane')
    expect(houses[0].currency).toEqual({ code: 'TRY', readable: true })
    expect(row.name).toBe('Kavaklıdere Yakut')
    expect(row.producer).toBe('Kavaklıdere')
    expect(row.liveStock).toBe(7)
    expect(row.shadowStock).toBe(2)
    expect(row.threshold).toBe(4)
    expect(row.wac).toBe(12.5)
    expect(row.inventoryId).toBe('inv-1')
  })

  it('takes the type from the library wine when it loads, as the page does', async () => {
    api.getInventoryAcrossHouses.mockResolvedValue({
      houses: [
        house('Bistro', [{ id: 'inv-2', wineId: 'w-2', wineName: 'Alias', stockLive: 3, thresholdMin: 1 }], 'USD'),
      ],
      notIncluded: [{ restaurantId: 'id-Bar', name: 'Bar' }],
    })
    api.getWinesByIds.mockResolvedValue([
      { id: 'w-2', name: 'Öküzgözü', producer: 'Turasan', type: 'red', category: 'red', vintage: 2019, price: 10 },
    ])
    const { houses, notIncluded } = await loadEveryHouseInventory()
    const [row] = houses[0].items
    expect(api.getWinesByIds).toHaveBeenCalledWith(['w-2'])
    expect(notIncluded).toEqual(['Bar'])
    expect(row.type).toBe('red')
    expect(row.liveStock).toBe(3)
  })
})

describe('stockValueCell (F-078)', () => {
  const item = (over: Partial<InventoryItem>) =>
    ({ name: 'Yakut', liveStock: 3, shadowStock: 1, wac: null, price: null, ...over }) as unknown as InventoryItem

  it('an uncosted wine on hand is withheld, never 0', () => {
    expect(stockValueCell(item({}))).toBe('withheld')
  })
  it('a costed wine is cost times bottles, to the cent', () => {
    expect(stockValueCell(item({ wac: 12.345 }))).toBe(37.04)
    expect(stockValueCell(item({ price: 10 }))).toBe(30)
  })
  it('counts live bottles only, never shadow ones on order (F-1167)', () => {
    expect(stockValueCell(item({ wac: 10, liveStock: 3, shadowStock: 10 }))).toBe(30)
    expect(stockValueCell(item({ wac: 10, liveStock: 0, shadowStock: 10 }))).toBe(0)
  })
  it('no bottles is 0 whatever the cost', () => {
    expect(stockValueCell(item({ liveStock: 0, shadowStock: 0 }))).toBe(0)
  })
})
