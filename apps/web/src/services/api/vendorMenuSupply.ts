/**
 * `GET /providers/menu-supply` — which of this house's vendors supply a wine on
 * its current menu, from purchase evidence (founder, 2026-09-26, item 36).
 *
 * Mirrors `VendorMenuSupply` in
 * `apps/api-gateway/src/providers/vendor-menu-supply.ts`; the rules (active
 * menus only, 180-day price window, orders that reached the vendor, live
 * inventory, every read house-scoped and paged) live there.
 */

import { apiClient } from './client'

export interface MenuSupplier {
  providerId: string
  menuWines: number
  priced: number
  ordered: number
  stocked: number
}

export interface VendorMenuSupply {
  menu: {
    current: boolean
    menus: number
    readAt: string | null
    lines: number
    linkedLines: number
    wines: number
  }
  windowDays: number
  since: string
  suppliers: MenuSupplier[]
}

export async function fetchVendorMenuSupply(): Promise<VendorMenuSupply> {
  const res = await apiClient.get<VendorMenuSupply>('/providers/menu-supply')
  return res.data
}
