/** OB-7, proposal F7: the house's clock comes from the place, not the browser. */
import { afterEach, describe, expect, it } from 'vitest'
import { offsetMinutesOf, sameClockForAYear, singleZoneFor, zoneForPlace, zonesOfCountry, zonesWithOffset } from './zoneForPlace'
import { ZONES_BY_COUNTRY } from './zonesByCountry'

// A fixed winter instant, so DST never moves an expectation.
const AT = new Date('2026-01-15T12:00:00Z')

describe('zoneForPlace', () => {
  it('(t2) a one-zone country names its zone whatever the browser says', () => {
    const answer = zoneForPlace({ countryCode: 'tr', utcOffsetMinutes: 180, browserZone: 'America/New_York', at: AT })
    expect(answer).toEqual({ zone: 'Europe/Istanbul', source: 'country', choices: [] })
  })

  it('a many-zone country takes the browser zone when its offset matches the place', () => {
    const answer = zoneForPlace({ countryCode: 'US', utcOffsetMinutes: -300, browserZone: 'America/New_York', at: AT })
    expect(answer).toEqual({ zone: 'America/New_York', source: 'browser', choices: [] })
  })

  it('(t3) a many-zone country whose offset disagrees with the browser asks for a pick', () => {
    const answer = zoneForPlace({ countryCode: 'US', utcOffsetMinutes: -480, browserZone: 'America/New_York', at: AT })
    expect(answer.zone).toBeUndefined()
    expect(answer.source).toBe('pick')
    expect(answer.choices).toContain('America/Los_Angeles')
    expect(answer.choices).not.toContain('America/New_York')
  })

  it('no offset from Google keeps the browser zone, and no zone at all stays unknown', () => {
    expect(zoneForPlace({ countryCode: 'US', utcOffsetMinutes: null, browserZone: 'America/Chicago', at: AT }).zone).toBe('America/Chicago')
    expect(zoneForPlace({ countryCode: null, utcOffsetMinutes: null, browserZone: undefined, at: AT }).zone).toBeUndefined()
  })

  it('reads offsets on both sides of UTC and at zero', () => {
    expect(offsetMinutesOf('Europe/Istanbul', AT)).toBe(180)
    expect(offsetMinutesOf('America/New_York', AT)).toBe(-300)
    expect(offsetMinutesOf('Asia/Kolkata', AT)).toBe(330)
    expect(offsetMinutesOf('Europe/London', AT)).toBe(0)
    expect(offsetMinutesOf('Not/AZone', AT)).toBeUndefined()
  })

  it('every table zone is a zone this runtime knows, and an unknown country is never guessed', () => {
    expect(singleZoneFor('XX')).toBeUndefined()
    expect(singleZoneFor('ES')).toBeUndefined() // Canaries: two zones
    // ICU lists some zones by their older canonical name (Asia/Calcutta), so
    // the pick is checked by offset, not by spelling; the gateway accepts both.
    const at330 = zonesWithOffset(330, AT)
    expect(at330.length).toBeGreaterThan(0)
    expect(at330.every((zone) => offsetMinutesOf(zone, AT) === 330)).toBe(true)
  })

  // Fix round (#1055): offset equality is not the same clock.
  it('a browser zone from another country is never taken, even at the same offset', () => {
    // Bogota keeps -5 all year; New York is -5 only in winter.
    const answer = zoneForPlace({ countryCode: 'US', utcOffsetMinutes: -300, browserZone: 'America/Bogota', at: AT })
    expect(answer.source).toBe('pick')
    expect(answer.zone).toBeUndefined()
    expect(answer.choices).toContain('America/New_York')
    expect(answer.choices).not.toContain('America/Bogota')
    expect(answer.choices.every((zone) => zonesOfCountry('US')!.includes(zone))).toBe(true)
  })

  it('with no offset said, a browser zone from another country gets the whole country to pick from', () => {
    const answer = zoneForPlace({ countryCode: 'us', utcOffsetMinutes: null, browserZone: 'America/Bogota', at: AT })
    expect(answer.source).toBe('pick')
    expect([...answer.choices].sort()).toEqual([...zonesOfCountry('US')!].sort())
  })

  it('a same-country browser zone is a pick when another zone with that offset keeps a different clock', () => {
    // Denver in January is -7, as is Phoenix, which has no summer time.
    const answer = zoneForPlace({ countryCode: 'US', utcOffsetMinutes: -420, browserZone: 'America/Denver', at: AT })
    expect(answer.source).toBe('pick')
    expect(answer.choices).toEqual(expect.arrayContaining(['America/Denver', 'America/Phoenix']))
    expect(sameClockForAYear('America/Denver', 'America/Phoenix', AT)).toBe(false)
    expect(sameClockForAYear('America/New_York', 'America/Detroit', AT)).toBe(true)
  })

  it('a browser zone spelled by its older name still counts as the country\'s', () => {
    const answer = zoneForPlace({ countryCode: 'US', utcOffsetMinutes: -300, browserZone: 'America/Indianapolis', at: AT })
    expect(answer).toEqual({ zone: 'America/Indianapolis', source: 'browser', choices: [] })
  })

  it('a pick with nothing to offer opens the house with no zone instead of blocking it', () => {
    // No zone on Earth is UTC+0:07.
    expect(zoneForPlace({ countryCode: null, utcOffsetMinutes: 7, browserZone: 'America/New_York', at: AT })).toEqual({
      zone: undefined,
      source: 'none',
      choices: [],
    })
  })

  describe('on a runtime without Intl.supportedValuesOf', () => {
    const original = (Intl as unknown as { supportedValuesOf?: unknown }).supportedValuesOf
    afterEach(() => {
      ;(Intl as unknown as { supportedValuesOf?: unknown }).supportedValuesOf = original
    })

    it('a known country still offers its own zones, and an unknown one falls to none', () => {
      ;(Intl as unknown as { supportedValuesOf?: unknown }).supportedValuesOf = undefined
      const known = zoneForPlace({ countryCode: 'US', utcOffsetMinutes: -480, browserZone: 'Europe/Istanbul', at: AT })
      expect(known.source).toBe('pick')
      expect(known.choices).toContain('America/Los_Angeles')
      const unknown = zoneForPlace({ countryCode: null, utcOffsetMinutes: -480, browserZone: 'Europe/Istanbul', at: AT })
      expect(unknown).toEqual({ zone: undefined, source: 'none', choices: [] })
    })
  })

  it('a code the table does not hold counts as no country', () => {
    expect(zonesOfCountry('XK')).toBeUndefined()
    expect(zoneForPlace({ countryCode: 'XK', utcOffsetMinutes: null, browserZone: 'Europe/Belgrade', at: AT }).zone).toBe('Europe/Belgrade')
  })

  it('the generated table keeps the hand-checked one-zone countries, and every zone in it is one Intl knows', () => {
    for (const [code, zone] of [['TR', 'Europe/Istanbul'], ['GB', 'Europe/London'], ['HR', 'Europe/Zagreb'], ['IN', 'Asia/Kolkata'], ['CO', 'America/Bogota']]) {
      expect(singleZoneFor(code)).toBe(zone)
    }
    expect(singleZoneFor('DE')).toBeUndefined() // Busingen
    const unknown = Object.values(ZONES_BY_COUNTRY).flat().filter((zone) => offsetMinutesOf(zone, AT) === undefined)
    expect(unknown).toEqual([])
  })
})
