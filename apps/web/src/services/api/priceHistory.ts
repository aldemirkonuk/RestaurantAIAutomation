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

/** The clock the house keeps, as `GET /settings/time-zone` answers it (the part a date needs). */
export interface HouseZoneRead {
  /** An IANA zone, or null when none is recorded. */
  zone: string | null
  /** False when the row itself could not be read (a different state from "none recorded"). */
  readable: boolean
  reason: string | null
}

export async function getHouseZone(): Promise<HouseZoneRead> {
  const { data } = await apiClient.get<HouseZoneRead>('/settings/time-zone')
  return data
}
