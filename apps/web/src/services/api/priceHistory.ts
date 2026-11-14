import { apiClient } from './client'

/** One change of a good's house price (`GET /pricing/history/:inventoryId`, r36 menu audit N6). */
export interface HousePriceVersion {
  bottle: number | null
  glass: number | null
  /** When this price took over. */
  from: string
  /** When it was replaced; null while it is the price now. */
  to: string | null
  /** 'manual' (by hand), 'import' (from a menu), 'agent_accepted' (advice accepted), 'backfill' (seeded). */
  source: string
  by: { userId: string | null; name: string | null }
  reason: string | null
}

export interface HousePriceHistory {
  inventoryId: string
  goodName: string | null
  /** Newest first. */
  versions: HousePriceVersion[]
  /** Older changes exist beyond these. */
  more: boolean
  namesReadable: boolean
  namesReason: string | null
}

/** One good's house-price history, newest first. Owner or manager only; a failed read throws. */
export async function getHousePriceHistory(inventoryId: string): Promise<HousePriceHistory> {
  const { data } = await apiClient.get<HousePriceHistory>(`/pricing/history/${inventoryId}`)
  return data
}
