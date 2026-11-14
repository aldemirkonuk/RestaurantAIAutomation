/**
 * The house's clock for a document page (r34 walk w2 F1, 2026-11-13).
 *
 * The walker's Istanbul house showed three clocks on one paper: the door count
 * in UTC, the agreement on the reader's clock and the delivery day as UTC's.
 * Every moment on the page now reads on the zone `GET /settings/time-zone`
 * answers (open to every member of the house; ADR 0207 round 3). When there is
 * no zone to read on, the page still keeps ONE clock, the reader's, and says
 * so in one line, because an unlabelled local time is a confident wrong answer
 * (lib/venueTime.ts).
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

/**
 * The one line that says which clock the page is on, when it is not the
 * house's. Null when the house's zone is in use, or while it is being read.
 */
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
