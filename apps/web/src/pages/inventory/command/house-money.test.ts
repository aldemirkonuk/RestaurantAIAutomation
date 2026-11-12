import { describe, expect, it } from 'vitest'
import { houseCurrencyNote, houseMoney, type HouseCurrencyState } from './house-money'

const TRY: HouseCurrencyState = { state: 'recorded', code: 'TRY' }
const JPY: HouseCurrencyState = { state: 'recorded', code: 'JPY' }

describe('houseMoney (browser walk 2026-11-12)', () => {
  it('prints the house code, never a borrowed $', () => {
    expect(houseMoney(3711.9, TRY, 'whole')).toMatch(/^TRY\s?3,712$/)
    expect(houseMoney(160, TRY, 'exact')).toMatch(/^TRY\s?160\.00$/)
  })

  it("keeps a small unit cost to the lot's six places instead of reading 0.00", () => {
    // A gram of sugar at 0.0024 read "TRY 0.00" on the local check.
    expect(houseMoney(0.0024, TRY, 'exact')).toMatch(/^TRY\s?0\.0024$/)
    expect(houseMoney(8.333333, TRY, 'exact')).toMatch(/^TRY\s?8\.333333$/)
    expect(houseMoney(18.5, TRY, 'exact')).toMatch(/^TRY\s?18\.50$/)
    expect(houseMoney(0.0024, { state: 'not_recorded', code: null }, 'exact')).toBe('0.0024')
  })

  it("uses the currency's own minor units as the floor", () => {
    expect(houseMoney(160, JPY, 'exact')).toMatch(/160$/)
    expect(houseMoney(160, JPY, 'exact')).not.toMatch(/\./)
  })

  it('a missing value or a currency still being read is a dash, never 0', () => {
    expect(houseMoney(null, TRY, 'exact')).toBe('-')
    expect(houseMoney(5, { state: 'reading', code: null }, 'whole')).toBe('-')
  })

  it('says once why figures are plain numbers', () => {
    expect(houseCurrencyNote(TRY)).toBeNull()
    expect(houseCurrencyNote({ state: 'not_recorded', code: null })).toMatch(/has not recorded its currency/)
    expect(houseCurrencyNote({ state: 'unreadable', code: null })).toMatch(/could not be read/)
  })
})
