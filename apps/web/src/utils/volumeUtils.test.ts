import { describe, expect, it } from 'vitest'
import * as volume from './volumeUtils'
import { POUR_SIZE_MIN_ML, isValidPourSize } from './volumeUtils'

// Call F12 (recipes walk G17): the smallest pour is 10 ml, the same bound the
// gateway and the database hold. 30 ml refused a 20-25 ml spirit measure.
describe('the smallest pour', () => {
  it('accepts a 20 ml spirit measure and a 10 ml pour', () => {
    expect(isValidPourSize(20)).toBe(true)
    expect(isValidPourSize(25)).toBe(true)
    expect(isValidPourSize(10)).toBe(true)
  })

  it('refuses 9 ml, above 500 ml and a non-number', () => {
    expect(POUR_SIZE_MIN_ML).toBe(10)
    expect(isValidPourSize(9)).toBe(false)
    expect(isValidPourSize(501)).toBe(false)
    expect(isValidPourSize(Number.NaN)).toBe(false)
  })

  it('carries no invented glass cost (G16: costPerGlass had no caller)', () => {
    expect('costPerGlass' in volume).toBe(false)
  })
})
