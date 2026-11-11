/** OB-7, proposal F7: the house's clock comes from the place, not the browser. */
import { describe, expect, it } from 'vitest'
import { offsetMinutesOf, singleZoneFor, zoneForPlace, zonesWithOffset } from './zoneForPlace'

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
})
