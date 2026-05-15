import { describe, expect, it } from 'vitest'
import { countryToPhoneDefault, formatPhoneDisplay, isValidPhone, toE164 } from './phone'

describe('phone utils', () => {
  it('maps country labels to ISO defaults', () => {
    expect(countryToPhoneDefault('United States')).toBe('US')
    expect(countryToPhoneDefault('Turkey')).toBe('TR')
    expect(countryToPhoneDefault('United Kingdom')).toBe('GB')
  })

  it('validates E.164 numbers', () => {
    expect(isValidPhone('+14155552671')).toBe(true)
    expect(isValidPhone('+905551234567')).toBe(true)
    expect(isValidPhone('not-a-phone')).toBe(false)
  })

  it('formats for display', () => {
    const formatted = formatPhoneDisplay('+14155552671', 'US')
    expect(formatted).toContain('+1')
  })

  it('normalizes to E.164', () => {
    expect(toE164('4155552671', 'US')).toBe('+14155552671')
  })
})
