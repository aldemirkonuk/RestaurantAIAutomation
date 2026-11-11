/**
 * The house's time zone, from the place that was picked (OB-7, proposal F7,
 * the session's call under the 2026-11-07 /goal).
 *
 * The page used to send the BROWSER's zone and say "its address sets the
 * house's timezone" (verdict G12). An owner setting the house up from
 * abroad gave the house the wrong clock.
 *
 * The invariant: when the place's country is known, the house's zone is a
 * zone OF THAT COUNTRY (tzdb `zone.tab`, `zonesByCountry.ts`) or none. A
 * matching UTC offset alone never admits the browser zone: Bogota and New
 * York share -5 in winter and part by an hour in summer (fix round, #1055).
 *
 *   1. The country has one zone: that zone, whatever the browser says.
 *   2. The country has several: the browser zone when it is one of them (by
 *      name, aliases folded through Intl) and, if Google said the place's
 *      offset, it has that offset now AND every zone of the country with
 *      that offset now keeps the browser's clock all year. With no offset
 *      said (Maps off, a typed address) a browser zone of the same country
 *      is taken, as before: nothing narrows the country further.
 *   3. Otherwise the person picks from the country's zones that have the
 *      place's offset now (all of the country's zones when no offset was
 *      said, or when none matches it).
 *   4. No country known (or a code the table does not hold): the browser
 *      zone when the offset agrees or none was said; else a pick from every
 *      zone this runtime knows with the place's offset now.
 *   5. A pick with nothing to offer never blocks the house: no zone is sent,
 *      the gateway stores NULL, and Settings > Time zone sets it later
 *      (item 62, "Browser zone, else none").
 */

import { ZONES_BY_COUNTRY } from './zonesByCountry'

/** The zones a country uses (tzdb `zone.tab`), or undefined for an unknown code. */
export function zonesOfCountry(countryCode: string | null | undefined): readonly string[] | undefined {
  if (!countryCode) return undefined
  return ZONES_BY_COUNTRY[countryCode.toUpperCase()]
}

/** The zone a one-zone country uses, or undefined. */
export function singleZoneFor(countryCode: string | null | undefined): string | undefined {
  const zones = zonesOfCountry(countryCode)
  return zones && zones.length === 1 ? zones[0] : undefined
}

/**
 * The runtime's own spelling of a zone (V8 folds Asia/Kolkata to
 * Asia/Calcutta), so a browser zone and a `zone.tab` name compare as equal
 * when they are the same zone. The input back when Intl will not say.
 */
export function canonicalZone(zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone || zone
  } catch {
    return zone
  }
}

const formatters = new Map<string, Intl.DateTimeFormat | null>()

function offsetFormatter(zone: string): Intl.DateTimeFormat | null {
  if (!formatters.has(zone)) {
    try {
      formatters.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }))
    } catch {
      formatters.set(zone, null)
    }
  }
  return formatters.get(zone) ?? null
}

/** A zone's UTC offset in minutes at `at`, or undefined when Intl cannot say. */
export function offsetMinutesOf(zone: string, at: Date = new Date()): number | undefined {
  try {
    const name = offsetFormatter(zone)
      ?.formatToParts(at)
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

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * True when two zones keep the same clock for the year from `at`, checked
 * every 15 days (a clock rule that lasts less than that would slip past).
 * False when Intl cannot say for either.
 */
export function sameClockForAYear(a: string, b: string, at: Date = new Date()): boolean {
  if (canonicalZone(a) === canonicalZone(b)) return true
  for (let day = 0; day <= 365; day += 15) {
    const when = new Date(at.getTime() + day * DAY_MS)
    const left = offsetMinutesOf(a, when)
    if (left === undefined || left !== offsetMinutesOf(b, when)) return false
  }
  return true
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
  /** The zone to send, or undefined while the person has not picked (or cannot). */
  zone: string | undefined
  /** How it was found: said on the page next to it. `none`: nothing to pick from. */
  source: 'country' | 'browser' | 'pick' | 'none'
  /** For `pick`: the zones the person chooses from (never empty). */
  choices: string[]
}

const NONE: ZoneAnswer = { zone: undefined, source: 'none', choices: [] }

function pick(choices: string[]): ZoneAnswer {
  return choices.length > 0 ? { zone: undefined, source: 'pick', choices } : NONE
}

export function zoneForPlace(input: {
  countryCode: string | null | undefined
  utcOffsetMinutes: number | null | undefined
  browserZone: string | undefined
  at?: Date
}): ZoneAnswer {
  const at = input.at ?? new Date()
  const offset = input.utcOffsetMinutes ?? undefined
  const browser = input.browserZone
  const browserOffsetAgrees = offset === undefined || (browser !== undefined && offsetMinutesOf(browser, at) === offset)

  const countryZones = zonesOfCountry(input.countryCode)
  if (countryZones) {
    if (countryZones.length === 1) return { zone: countryZones[0], source: 'country', choices: [] }
    const atOffset = offset === undefined ? [] : countryZones.filter((zone) => offsetMinutesOf(zone, at) === offset)
    if (browser && browserOffsetAgrees) {
      const own = canonicalZone(browser)
      const inCountry = countryZones.some((zone) => canonicalZone(zone) === own)
      // With the place's offset said, every zone of the country that has it
      // now must keep the browser's clock all year: a Denver place in winter
      // also matches Phoenix, which skips DST, so that is a pick.
      if (inCountry && atOffset.every((zone) => sameClockForAYear(zone, browser, at))) {
        return { zone: browser, source: 'browser', choices: [] }
      }
    }
    return pick([...(atOffset.length > 0 ? atOffset : countryZones)].sort())
  }

  if (browser && browserOffsetAgrees) return { zone: browser, source: 'browser', choices: [] }
  if (offset === undefined) return NONE
  return pick(zonesWithOffset(offset, at))
}
