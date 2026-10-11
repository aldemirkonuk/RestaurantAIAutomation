import { describe, it, expect } from 'vitest'
import { countryToPhoneCountry, countryToPhoneDefault, toE164ForCountry } from './phone'

/** F-1212: a person's own number is read in the house's country, never assumed +1. */
describe('toE164ForCountry', () => {
  it('reads a local number in the house country', () => {
    expect(toE164ForCountry('0532 123 45 67', 'Türkiye')).toBe('+905321234567')
    expect(toE164ForCountry('(517) 555-0134', 'United States')).toBe('+15175550134')
  })

  it('keeps a number written with its + whatever the house country', () => {
    expect(toE164ForCountry('+44 20 7946 0958', 'Türkiye')).toBe('+442079460958')
  })

  it('never guesses +1 when the country names none', () => {
    expect(countryToPhoneCountry('')).toBeUndefined()
    expect(toE164ForCountry('0532 123 45 67', '')).toBe('0532 123 45 67')
    expect(toE164ForCountry('517 555 0134', undefined)).toBe('517 555 0134')
  })

  it('leaves the form default as it was', () => {
    expect(countryToPhoneDefault('')).toBe('US')
    expect(countryToPhoneDefault('Türkiye')).toBe('TR')
  })
})
