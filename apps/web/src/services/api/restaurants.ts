/**
 * Restaurant-level facts that are not a feature flag and not a member.
 *
 * Today that is operating hours (ADR 0093 D1). Routes are scoped under
 * `/restaurants/:restaurantId/...`, like `team.ts`.
 */
import { apiClient, getActiveRestaurantId } from './client'

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export const WEEKDAYS: readonly Weekday[] = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
]

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

export const MAX_RANGES_PER_DAY = 3

export interface HourRange {
  open: string
  close: string
}

export type OperatingHours = Record<Weekday, HourRange[]>

export interface OperatingHoursResponse {
  restaurantId: string
  /** The venue's IANA zone, or null when it has none. Never defaulted here. */
  timezone: string | null
  /**
   * `null` means the hours are UNKNOWN. It is NOT an empty week and NOT a
   * venue that never opens — the editor must render it as "not set" and never
   * as seven closed days (ADR 0020).
   */
  operatingHours: OperatingHours | null
  updatedAt: string | null
  /** Present only when the column holds something that does not parse. */
  storedHoursErrors?: string[]
}

const base = (rid?: string) => {
  const id = rid || getActiveRestaurantId()
  if (!id) throw new Error('No restaurant selected')
  return `/restaurants/${id}`
}

export const restaurantsApi = {
  async getOperatingHours(restaurantId?: string): Promise<OperatingHoursResponse> {
    const res = await apiClient.get<OperatingHoursResponse>(
      `${base(restaurantId)}/operating-hours`,
    )
    return res.data
  },

  /**
   * `hours` of `null` is a real instruction — "we do not know these" — and the
   * key is always sent, because a body without it is refused by the gateway
   * rather than treated as an erasure.
   */
  async putOperatingHours(
    restaurantId: string | undefined,
    hours: OperatingHours | null,
  ): Promise<OperatingHoursResponse> {
    const res = await apiClient.put<OperatingHoursResponse>(
      `${base(restaurantId)}/operating-hours`,
      { operatingHours: hours },
    )
    return res.data
  },
}

/**
 * The gateway's `{ message, errors[] }` out of an axios failure, or null when
 * the failure was not a validation one. Returning null rather than a
 * plausible-looking empty list matters: an empty `errors` array would render
 * as "saved with no problems" over a request that failed.
 */
export function operatingHoursErrorsFrom(err: unknown): string[] | null {
  const data = (err as { response?: { data?: unknown } })?.response?.data
  if (!data || typeof data !== 'object') return null
  const errors = (data as { errors?: unknown }).errors
  if (!Array.isArray(errors) || errors.length === 0) return null
  return errors.map((e) => String(e))
}
