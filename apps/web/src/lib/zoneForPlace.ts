/**
 * The house's time zone, from the place that was picked (OB-7, proposal F7,
 * the session's call under the 2026-11-07 /goal).
 *
 * The page used to send the BROWSER's zone and say "its address sets the
 * house's timezone" (verdict G12). An owner setting the house up from
 * abroad gave the house the wrong clock. The order now:
 *
 *   1. The country has one zone (the table below): that zone, whatever the
 *      browser says.
 *   2. Google said the place's UTC offset and the browser zone has that
 *      offset now: the browser zone (it is the more specific answer).
 *   3. No offset from Google: the browser zone, as before (nothing says it
 *      is wrong).
 *   4. The browser disagrees with the place: no zone is chosen. The page
 *      shows the zones that have the place's offset now, as a one-line pick.
 *
 * The table holds only countries with ONE IANA zone (canonical zones per
 * tzdb `zone1970.tab`, read 2026-11-11). A country missing from it is never
 * guessed: rule 2 or the pick answers. Adding a row is a one-line edit.
 */

const SINGLE_ZONE: Record<string, string> = {
  AE: 'Asia/Dubai',
  AT: 'Europe/Vienna',
  BE: 'Europe/Brussels',
  BG: 'Europe/Sofia',
  CH: 'Europe/Zurich',
  CZ: 'Europe/Prague',
  DK: 'Europe/Copenhagen',
  EE: 'Europe/Tallinn',
  EG: 'Africa/Cairo',
  FI: 'Europe/Helsinki',
  FR: 'Europe/Paris',
  GB: 'Europe/London',
  GE: 'Asia/Tbilisi',
  GR: 'Europe/Athens',
  HR: 'Europe/Zagreb',
  HU: 'Europe/Budapest',
  IE: 'Europe/Dublin',
  IL: 'Asia/Jerusalem',
  IN: 'Asia/Kolkata',
  IT: 'Europe/Rome',
  JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul',
  LT: 'Europe/Vilnius',
  LV: 'Europe/Riga',
  MA: 'Africa/Casablanca',
  NL: 'Europe/Amsterdam',
  NO: 'Europe/Oslo',
  PL: 'Europe/Warsaw',
  QA: 'Asia/Qatar',
  RO: 'Europe/Bucharest',
  RS: 'Europe/Belgrade',
  SA: 'Asia/Riyadh',
  SE: 'Europe/Stockholm',
  SG: 'Asia/Singapore',
  SI: 'Europe/Ljubljana',
  SK: 'Europe/Bratislava',
  TR: 'Europe/Istanbul',
}

/** The zone a one-zone country uses, or undefined. */
export function singleZoneFor(countryCode: string | null | undefined): string | undefined {
  if (!countryCode) return undefined
  return SINGLE_ZONE[countryCode.toUpperCase()]
}

/** A zone's UTC offset in minutes at `at`, or undefined when Intl cannot say. */
export function offsetMinutesOf(zone: string, at: Date = new Date()): number | undefined {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value
    if (!name) return undefined
    if (name === 'GMT') return 0
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name)
    if (!match) return undefined
    const minutes = Number(match[2]) * 60 + Number(match[3])
    return match[1] === '-' ? -minutes : minutes
  } catch {
    return undefined
  }
}

/** Every zone this runtime knows whose offset at `at` is `offset`, sorted. */
export function zonesWithOffset(offset: number, at: Date = new Date()): string[] {
  let all: string[] = []
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    all = supported ? supported('timeZone') : []
  } catch {
    all = []
  }
  return all.filter((zone) => offsetMinutesOf(zone, at) === offset).sort()
}

export interface ZoneAnswer {
  /** The zone to send, or undefined while the person has not picked. */
  zone: string | undefined
  /** How it was found: said on the page next to it. */
  source: 'country' | 'browser' | 'pick'
  /** For `pick`: the zones with the place's offset now. */
  choices: string[]
}

export function zoneForPlace(input: {
  countryCode: string | null | undefined
  utcOffsetMinutes: number | null | undefined
  browserZone: string | undefined
  at?: Date
}): ZoneAnswer {
  const at = input.at ?? new Date()
  const single = singleZoneFor(input.countryCode)
  if (single) return { zone: single, source: 'country', choices: [] }
  if (input.utcOffsetMinutes == null) {
    return { zone: input.browserZone, source: 'browser', choices: [] }
  }
  if (input.browserZone && offsetMinutesOf(input.browserZone, at) === input.utcOffsetMinutes) {
    return { zone: input.browserZone, source: 'browser', choices: [] }
  }
  return { zone: undefined, source: 'pick', choices: zonesWithOffset(input.utcOffsetMinutes, at) }
}
