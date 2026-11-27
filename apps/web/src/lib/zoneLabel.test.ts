/** r28 onboarding gap 14: the house's clock named as an owner reads it. */
import { describe, expect, it } from 'vitest'
import { utcOffsetText, zoneCity, zoneGenericName, zoneLabel } from './zoneLabel'

// A winter day: New York keeps UTC−5, Istanbul UTC+3 all year.
const WINTER = new Date('2026-01-15T12:00:00Z')
const SUMMER = new Date('2026-07-15T12:00:00Z')

describe('utcOffsetText', () => {
  it('says the offset with a true minus sign, and the minutes only when there are some', () => {
    expect(utcOffsetText(180)).toBe('UTC+3')
    expect(utcOffsetText(-300)).toBe('UTC−5')
    expect(utcOffsetText(330)).toBe('UTC+5:30')
    expect(utcOffsetText(345)).toBe('UTC+5:45')
    expect(utcOffsetText(-570)).toBe('UTC−9:30')
    expect(utcOffsetText(0)).toBe('UTC')
  })
})

describe('zoneCity', () => {
  it('names the city, spaces for underscores', () => {
    expect(zoneCity('America/New_York')).toBe('New York')
    expect(zoneCity('Europe/Istanbul')).toBe('Istanbul')
  })

  it('a three-part name says the city and the part it is in', () => {
    expect(zoneCity('America/Indiana/Indianapolis')).toBe('Indianapolis, Indiana')
    expect(zoneCity('America/Kentucky/Monticello')).toBe('Monticello, Kentucky')
  })

  it('a zone with no city has none', () => {
    expect(zoneCity('UTC')).toBeNull()
    expect(zoneCity('Etc/GMT+5')).toBeNull()
  })
})

describe('zoneLabel', () => {
  it('reads as a place, a clock name and an offset', () => {
    expect(zoneLabel('America/New_York', WINTER)).toBe('New York · Eastern Time, UTC−5')
    expect(zoneLabel('America/Detroit', SUMMER)).toBe('Detroit · Eastern Time, UTC−4')
    expect(zoneLabel('Asia/Kolkata', WINTER)).toBe('Kolkata · India Standard Time, UTC+5:30')
  })

  it('two zones with the same clock name are told apart by their city', () => {
    expect(zoneLabel('America/Indiana/Indianapolis', WINTER)).toBe('Indianapolis, Indiana · Eastern Time, UTC−5')
    expect(zoneLabel('America/Indiana/Indianapolis', WINTER)).not.toBe(zoneLabel('America/New_York', WINTER))
  })

  it('a zone Intl names only by offset gets no clock name', () => {
    expect(zoneGenericName('Etc/UTC', WINTER)).toBeNull()
  })

  it('a zone with no city, or one Intl does not know, comes back as given', () => {
    expect(zoneLabel('UTC', WINTER)).toBe('UTC')
    expect(zoneLabel('Mars/Olympus_Mons', WINTER)).toBe('Mars/Olympus_Mons')
  })
})
