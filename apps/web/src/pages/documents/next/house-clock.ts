/**
 * The house's clock for a document page (r34 walk w2 F1): the zone
 * `GET /settings/time-zone` answers. Without one the page keeps ONE clock, the
 * reader's, and says so (lib/venueTime.ts).
 */
import { apiClient } from '../../../services/api/client'
import { knownZone } from '../../../components/documents/canonical-format'

/** The part of `GET /settings/time-zone` this page reads. */
export interface HouseClockReadout {
  zone: string | null
  unreadZone?: string | null
  readable?: boolean
}

export async function readHouseClock(): Promise<HouseClockReadout> {
  const { data } = await apiClient.get<HouseClockReadout>('/settings/time-zone')
  return data
}

/**
 * The zone this page reads its moments on, or null for the reader's own clock.
 * `undefined` = still reading: the page keeps quiet rather than claim a clock.
 */
export function houseZoneOf(
  read: { data?: HouseClockReadout; isError: boolean; isPending: boolean },
): string | null | undefined {
  if (read.isPending && !read.isError) return undefined
  if (read.isError || !read.data || read.data.readable === false) return null
  return knownZone(read.data.zone)
}

/** Which clock the page is on, when it is not the house's; null otherwise. */
export function deviceClockNote(
  read: { data?: HouseClockReadout; isError: boolean; isPending: boolean },
): string | null {
  const zone = houseZoneOf(read)
  if (zone !== null) return null
  const head = 'Times on this page are on this device’s clock:'
  if (read.isError || !read.data || read.data.readable === false) {
    return `${head} the house’s time zone could not be read.`
  }
  if (read.data.zone || read.data.unreadZone) {
    return `${head} the house’s time zone is not one this browser knows.`
  }
  return `${head} the house has no time zone set. An owner or a manager sets it in Settings.`
}
