/**
 * SimPOS terminal API — talks only to /simpos/:restaurantId.
 * Never reads WineOps tables directly; the signed webhook on check close
 * is the only channel into WineOps (decision C25).
 */

import { apiClient } from './client'

export interface SimposCatalogItem {
  id: string
  restaurant_id: string
  external_item_id: string
  wine_name: string
  producer: string | null
  vintage: number | null
  size_ml: number
  price: number
  is_active: boolean
}

export interface SimposCheckLine {
  id: string
  check_id: string
  catalog_id: string
  item_name_snapshot: string
  unit_price_snapshot: number
  qty: number
  status: 'active' | 'voided' | 'comped' | 'discounted'
  status_reason: string | null
  discount_amount: number
  added_at: string
}

export interface SimposCheck {
  id: string
  restaurant_id: string
  status: 'open' | 'closed'
  opened_at: string
  closed_at: string | null
  webhook_status: string | null
  webhook_error: string | null
  lines: SimposCheckLine[]
  lossTotal: number
}

export interface SimposOrder extends SimposCheck {
  // listOrders returns the same shape as a check with lines + lossTotal
}

function base(restaurantId: string) {
  return `/simpos/${restaurantId}`
}

export const simposApi = {
  async seedCatalog(restaurantId: string) {
    const { data } = await apiClient.post(`${base(restaurantId)}/catalog/seed`)
    return data as { seeded: boolean; count: number }
  },

  async listCatalog(restaurantId: string) {
    const { data } = await apiClient.get(`${base(restaurantId)}/catalog`)
    return data as SimposCatalogItem[]
  },

  async upsertCatalogItem(
    restaurantId: string,
    body: {
      id?: string
      wineName: string
      producer?: string | null
      vintage?: number | null
      sizeMl?: number
      price: number
    },
  ) {
    const { data } = await apiClient.post(`${base(restaurantId)}/catalog`, body)
    return data as SimposCatalogItem
  },

  async removeCatalogItem(restaurantId: string, catalogId: string) {
    await apiClient.delete(`${base(restaurantId)}/catalog/${catalogId}`)
  },

  async listTables(restaurantId: string) {
    const { data } = await apiClient.get(`${base(restaurantId)}/tables`)
    return data as Array<{ id: string; table_number: number; label: string | null }>
  },

  async getOrCreateOpenCheck(restaurantId: string) {
    const { data } = await apiClient.get(`${base(restaurantId)}/check`)
    return data as SimposCheck
  },

  async listOrders(restaurantId: string) {
    const { data } = await apiClient.get(`${base(restaurantId)}/orders`)
    return data as SimposOrder[]
  },

  async addLine(
    restaurantId: string,
    checkId: string,
    catalogId: string,
    qty = 1,
  ) {
    const { data } = await apiClient.post(
      `${base(restaurantId)}/check/${checkId}/lines`,
      { catalogId, qty },
    )
    return data
  },

  async setLineStatus(
    restaurantId: string,
    lineId: string,
    body: {
      status: 'active' | 'voided' | 'comped' | 'discounted'
      reason?: string
      discountAmount?: number
    },
  ) {
    const { data } = await apiClient.patch(
      `${base(restaurantId)}/lines/${lineId}`,
      body,
    )
    return data
  },

  async closeCheck(restaurantId: string, checkId: string) {
    const { data } = await apiClient.post(
      `${base(restaurantId)}/check/${checkId}/close`,
    )
    return data as { check: SimposCheck; lines: SimposCheckLine[]; webhook: { ok: boolean; error?: string } }
  },
}

export default simposApi
