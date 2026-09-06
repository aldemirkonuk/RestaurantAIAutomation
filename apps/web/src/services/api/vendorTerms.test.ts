/**
 * The delivery-days repoint, asserted on the BODY and on the mapping.
 *
 * Ticking three weekdays in the Add/Edit Provider dialog used to write three
 * weekday names into `providers.regions_covered` — the geography column the map
 * and the territory filters read — and nothing else. The form now writes
 * `PUT /vendor-terms/:providerId`.
 *
 * These test the request body and the name-to-index mapping because those are
 * the two places the defect could reappear: a payload that quietly carries
 * `regionsCovered` again, or a mapping that shifts every day by one because the
 * picker starts at Monday and the column counts from Sunday.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  setVendorTerms,
  weekdayNamesToIndices,
  weekdayIndicesToNames,
  isWeekdayName,
  WEEKDAY_NAMES,
} from './vendorTerms'
import { apiClient } from './client'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...actual,
    apiClient: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
    getActiveRestaurantId: () => 'r-alpha',
  }
})

const http = vi.mocked(apiClient) as unknown as {
  put: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  http.put.mockResolvedValue({ data: { audited: true, auditReason: null } })
})

describe('weekday mapping — 0 is Sunday, and it stays 0', () => {
  it('maps the picker names onto the column indices', () => {
    // The picker displays Monday first; the column counts from Sunday. If these
    // two ever disagree every stored day shifts by one and nothing errors.
    expect(weekdayNamesToIndices(['Monday', 'Wednesday', 'Friday'])).toEqual([1, 3, 5])
    expect(weekdayNamesToIndices(['Sunday'])).toEqual([0])
    expect(weekdayNamesToIndices(['Saturday'])).toEqual([6])
  })

  it('sorts and de-duplicates, so the same set always compares equal', () => {
    expect(weekdayNamesToIndices(['Friday', 'Monday', 'friday', 'MONDAY'])).toEqual([1, 5])
  })

  it('DROPS a name that is not a weekday — a territory never becomes Sunday', () => {
    // The load-bearing case for the cleanup: `regions_covered` is full of real
    // place names, and mapping an unknown string to 0 would invent a Sunday
    // delivery for every vendor covering California.
    expect(weekdayNamesToIndices(['California', 'Mon', 'Sunday River'])).toEqual([])
    expect(weekdayNamesToIndices(['California', 'Monday'])).toEqual([1])
  })

  it('round-trips', () => {
    const names = ['Tuesday', 'Thursday']
    expect(weekdayIndicesToNames(weekdayNamesToIndices(names))).toEqual(names)
  })

  it('drops an out-of-range index rather than guessing', () => {
    expect(weekdayIndicesToNames([0, 7, -1, 3, 2.5])).toEqual(['Sunday', 'Wednesday'])
    expect(weekdayIndicesToNames(null)).toEqual([])
    expect(weekdayIndicesToNames(undefined)).toEqual([])
  })

  it('isWeekdayName matches exactly, never as a substring', () => {
    expect(isWeekdayName('Monday')).toBe(true)
    expect(isWeekdayName('  friday ')).toBe(true)
    expect(isWeekdayName('Sunday River')).toBe(false)
    expect(isWeekdayName('Mon')).toBe(false)
  })

  it('the name list is the gateway order', () => {
    expect(WEEKDAY_NAMES[0]).toBe('Sunday')
    expect(WEEKDAY_NAMES[6]).toBe('Saturday')
    expect(WEEKDAY_NAMES).toHaveLength(7)
  })
})

describe('setVendorTerms — where the days actually go', () => {
  it('PUTs to /vendor-terms/:providerId with only the days', async () => {
    await setVendorTerms('prov-1', {
      deliveryWeekdays: weekdayNamesToIndices(['Monday', 'Friday']),
    })

    expect(http.put).toHaveBeenCalledTimes(1)
    const [url, body] = http.put.mock.calls[0]
    expect(url).toBe('/vendor-terms/prov-1')
    expect(body).toEqual({ deliveryWeekdays: [1, 5] })
    // The column the days used to land in must not appear anywhere.
    expect(JSON.stringify(body)).not.toContain('regionsCovered')
    expect(JSON.stringify(body)).not.toContain('statesOrRegionsServed')
    // An absent key leaves that term alone; the form must not clear a cutoff or
    // a minimum somebody recorded on the settings register.
    expect(Object.keys(body as object)).toEqual(['deliveryWeekdays'])
  })

  it('an empty array is sent — it STATES "no fixed days"', async () => {
    await setVendorTerms('prov-1', { deliveryWeekdays: [] })
    expect(http.put.mock.calls[0][1]).toEqual({ deliveryWeekdays: [] })
  })
})
