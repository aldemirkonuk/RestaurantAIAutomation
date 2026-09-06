/**
 * `GET /inventory/:id/low-stock` serves `v_low_stock_items` rows as the database
 * names them (`wine_name`, `producer`, `vintage`, `stock_live`, `threshold_min`,
 * `master_wine_id`) while the service declared `InventoryItem[]` (camelCase).
 * Every reader that trusted the type — the Dashboard's Low Stock card and its
 * modal — rendered "Unknown wine" with blank counts over seven named wines
 * (`.planning/v3.0-TECH-DEBT.md`, 2026-09-03 intelligence lens, defect 1).
 *
 * The row below is the exact shape the lens curled from the running gateway
 * (Sim Meyhouse: Graham's Tawny Porto, 3 in stock, par 4). If the gateway ever
 * starts mapping the view itself, the second block keeps this a no-op rather
 * than a double-map.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getLowStockItems, normalizeInventoryItem } from './inventory'
import { apiClient } from './client'
import type { InventoryItem } from './types'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }
})

const http = vi.mocked(apiClient) as unknown as { get: ReturnType<typeof vi.fn> }

beforeEach(() => http.get.mockReset())

const RESTAURANT = 'a229f22b-2aac-4e54-a8b2-033a8f93ac5e'

/** One `v_low_stock_items` row, as the gateway returns it. */
const viewRow = {
  id: 'inv-porto',
  restaurant_id: RESTAURANT,
  master_wine_id: 'mw-porto',
  provider_id: null,
  stock_live: 3,
  physical_stock: 3,
  shadow_stock: 0,
  threshold_min: 4,
  validation_max: 24,
  inventory_state: 'STABLE',
  is_active: true,
  created_at: '2026-09-02T20:00:00.000Z',
  updated_at: '2026-09-03T04:10:00.000Z',
  deleted_at: null,
  wine_name: "Graham's Tawny Porto",
  producer: "W. & J. Graham's",
  vintage: null,
  restaurant_name: 'Sim Meyhouse',
}

describe('getLowStockItems delivers the type it declares', () => {
  it('maps the raw view row to camelCase so the card can name the wine and count the bottles', async () => {
    http.get.mockResolvedValue({ data: [viewRow] })

    const [wine] = await getLowStockItems(RESTAURANT)

    expect(http.get).toHaveBeenCalledWith(`/inventory/${RESTAURANT}/low-stock`)
    // The exact reads the Dashboard card and modal make (Dashboard.tsx:971,998,1004,1315,1320).
    expect(wine.wineName || wine.wineProducer || 'Unknown wine').toBe("Graham's Tawny Porto")
    expect(wine.stockLive).toBe(3)
    expect(wine.thresholdMin).toBe(4)
    expect(wine.stockLive <= wine.thresholdMin * 0.5).toBe(false) // 'high', not 'critical'
    // The rest of the declared shape the card's navigation and menu rely on.
    expect(wine.id).toBe('inv-porto')
    expect(wine.wineId).toBe('mw-porto')
    expect(wine.restaurantId).toBe(RESTAURANT)
    expect(wine.wineProducer).toBe("W. & J. Graham's")
    expect(wine.isActive).toBe(true)
  })

  it('does not invent a bottle size the view does not carry', async () => {
    http.get.mockResolvedValue({ data: [viewRow] })
    const [wine] = await getLowStockItems(RESTAURANT)
    expect(wine.bottleSizeMl).toBeUndefined()
  })

  it('returns an empty list, not a crash, when nothing is below par', async () => {
    http.get.mockResolvedValue({ data: [] })
    await expect(getLowStockItems(RESTAURANT)).resolves.toEqual([])
  })
})

describe('normalizeInventoryItem is idempotent and lets camelCase win', () => {
  it('passes an already-mapped row through unchanged', () => {
    const mapped = normalizeInventoryItem(viewRow)
    expect(normalizeInventoryItem(mapped)).toEqual(mapped)
  })

  it('prefers the camelCase value when the gateway sends both casings', () => {
    const both = { ...viewRow, stockLive: 2, thresholdMin: 6, wineName: 'Mapped name' } as Partial<InventoryItem> &
      typeof viewRow
    const wine = normalizeInventoryItem(both)
    expect(wine.stockLive).toBe(2)
    expect(wine.thresholdMin).toBe(6)
    expect(wine.wineName).toBe('Mapped name')
  })

  it('keeps a real zero as zero', () => {
    const wine = normalizeInventoryItem({ ...viewRow, stock_live: 0 })
    expect(wine.stockLive).toBe(0)
  })
})
