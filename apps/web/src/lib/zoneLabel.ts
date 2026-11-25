import { offsetMinutesOf } from './zoneForPlace'

/**
 * A time zone as an owner reads it (r28 onboarding gap 14): "Detroit ·
 * Eastern Time, UTC−5", not "America/Detroit". The house still stores the
 * IANA name; only the words change. A US house picking its clock was shown
 * ten raw names ("America/Kentucky/Monticello", "America/Indiana/Vincennes"),
 * and every owner read "Clock · Europe/Istanbul" on the first form.
 */

/** "UTC+3", "UTC−5", "UTC+5:30", "UTC" (a true minus sign, as in print). */
export function utcOffsetText(minutes: number): string {
  if (minutes === 0) return 'UTC'
  const sign = minutes > 0 ? '+' : '−'
  const abs = Math.abs(minutes)
  const hours = Math.floor(abs / 60)
  const rest = abs % 60
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`
}

/** The place a zone is named for: "New York"; "Indianapolis, Indiana" for a three-part name. */
export function zoneCity(zone: string): string | null {
  const parts = zone.split('/').map((part) => part.replace(/_/g, ' ').trim())
  if (parts.length < 2 || parts[0] === 'Etc') return null
  const city = parts[parts.length - 1]
  return parts.length > 2 ? `${city}, ${parts[parts.length - 2]}` : city
}

/** Intl's long generic name ("Eastern Time"), or null when it only gives an offset. */
export function zoneGenericName(zone: string, at: Date = new Date()): string | null {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longGeneric' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value
    return name && !/^GMT|^UTC/.test(name) ? name : null
  } catch {
    return null
  }
}

/** The whole label. A zone Intl does not know comes back as it was given. */
export function zoneLabel(zone: string, at: Date = new Date()): string {
  const city = zoneCity(zone)
  const offset = offsetMinutesOf(zone, at)
  if (!city || offset === undefined) return zone
  const generic = zoneGenericName(zone, at)
  return `${city}${generic ? ` · ${generic}` : ''}, ${utcOffsetText(offset)}`
}
