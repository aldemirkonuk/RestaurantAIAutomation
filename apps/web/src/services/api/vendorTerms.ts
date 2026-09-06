import { apiClient } from './client'

/**
 * What a vendor told this house — read and written through `/vendor-terms`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS: THE DELIVERY-DAYS DEFECT
 * ---------------------------------------------------------------------------
 * The Add/Edit Provider dialogs have collected delivery weekdays since long
 * before there was anywhere to put them. `Providers.tsx` sent them as
 * `statesOrRegionsServed`, `services/api/providers.ts` mapped that onto
 * `regionsCovered`, and the gateway wrote `providers.regions_covered` — the
 * GEOGRAPHY column. Ticking "Monday, Wednesday, Friday" had exactly one
 * persisted effect: three weekday names joined the list of regions the vendor
 * covers, which is what the map and the territory filters read. The sibling
 * `deliverySchedule` field was declared on the web DTO and dropped on the floor
 * before it ever reached a payload.
 *
 * `restaurant_vendor_terms` (migration 20260903140000) is the column that was
 * missing. It stores delivery weekdays per (restaurant, provider), records WHO
 * stated them and WHEN, and files the change in `system_audit_log`. The form now
 * writes there and `regions_covered` stops receiving weekdays.
 *
 * ---------------------------------------------------------------------------
 * WEEKDAY NUMBERING — ONE CONVENTION, STATED ONCE
 * ---------------------------------------------------------------------------
 * 0 = Sunday .. 6 = Saturday, which is `extract(dow)` in Postgres and
 * `Date#getDay()` in JS, and is exactly the order the gateway declares in
 * `apps/api-gateway/src/vendor-terms/term-inference.ts` (`WEEKDAY_NAMES`). The
 * dialogs display names starting at Monday; the mapping below is the only place
 * the two orders meet, so a reordered picker cannot silently shift every stored
 * day by one.
 */

/** Index-ordered: `WEEKDAY_NAMES[3] === 'Wednesday'`. Mirrors the gateway. */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

export type WeekdayName = (typeof WEEKDAY_NAMES)[number]

/**
 * Names to indices, sorted, de-duplicated, unknown names dropped.
 *
 * An unrecognised string is DROPPED rather than mapped to 0: a legacy
 * `regions_covered` entry like "California" must not silently become Sunday.
 * Sorted so the same set of days always compares equal.
 */
export function weekdayNamesToIndices(names: readonly string[]): number[] {
  const out = new Set<number>()
  for (const raw of names) {
    const i = WEEKDAY_NAMES.findIndex(
      (n) => n.toLowerCase() === String(raw ?? '').trim().toLowerCase(),
    )
    if (i >= 0) out.add(i)
  }
  return [...out].sort((a, b) => a - b)
}

/** Indices back to names. Out-of-range indices are dropped, never guessed. */
export function weekdayIndicesToNames(indices: readonly number[] | null | undefined): string[] {
  if (!Array.isArray(indices)) return []
  const out: string[] = []
  for (const i of indices) {
    if (Number.isInteger(i) && i >= 0 && i <= 6) out.push(WEEKDAY_NAMES[i])
  }
  return out
}

/** True when the string names a weekday. Used by the cleanup listing. */
export function isWeekdayName(value: string): boolean {
  return WEEKDAY_NAMES.some(
    (n) => n.toLowerCase() === String(value ?? '').trim().toLowerCase(),
  )
}

export interface SetVendorTermsBody {
  /** 0=Sunday..6=Saturday. `[]` states "no fixed days"; `null` withdraws. */
  deliveryWeekdays?: number[] | null
  orderCutoffTime?: string | null
  orderCutoffOffsetDays?: number | null
  minimumOrderAmount?: number | null
  leadTimeDays?: number | null
  paymentTerms?: string | null
  notes?: string | null
}

export interface VendorTermsWriteResult {
  audited?: boolean
  auditReason?: string | null
}

/**
 * Record what the house was told about one vendor.
 *
 * An ABSENT key leaves that term as it was; an explicit `null` withdraws the
 * statement. The provider form sends only `deliveryWeekdays`, so it can never
 * clear a cutoff or a minimum somebody recorded on the settings register.
 */
export async function setVendorTerms(
  providerId: string,
  body: SetVendorTermsBody,
): Promise<VendorTermsWriteResult> {
  const { data } = await apiClient.put<VendorTermsWriteResult>(
    `/vendor-terms/${providerId}`,
    body,
  )
  return data ?? {}
}

/** One vendor's terms as the register reports them, narrowed to what forms need. */
export interface VendorTermsRowLite {
  providerId: string
  deliveryWeekdays: { value: number[] | null; source: string }
}

export interface VendorTermsReadoutLite {
  vendors: VendorTermsRowLite[]
}

/**
 * Every vendor's terms for the signed-in restaurant.
 *
 * The edit dialog seeds its weekday checkboxes from this rather than from
 * `regionsCovered` — reading the geography column back into a delivery-days
 * control is what kept the defect circulating.
 */
export async function listVendorTerms(): Promise<VendorTermsReadoutLite> {
  const { data } = await apiClient.get<VendorTermsReadoutLite>('/vendor-terms')
  return data ?? { vendors: [] }
}

export const vendorTermsApi = {
  setVendorTerms,
  listVendorTerms,
  weekdayNamesToIndices,
  weekdayIndicesToNames,
  isWeekdayName,
  WEEKDAY_NAMES,
}

export default vendorTermsApi
