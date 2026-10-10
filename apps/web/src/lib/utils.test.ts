/**
 * `formatMoney` 'full' — whole amounts drop the cents, amounts with cents keep
 * both digits. Production printed "$39,302.5" (F-753), because the full mode
 * allowed zero to two fraction digits and so dropped the trailing zero.
 */

import { describe, expect, it } from 'vitest'
import { formatMoney } from './utils'

describe("formatMoney 'full'", () => {
  it('keeps two digits when there are cents', () => {
    expect(formatMoney(39302.5)).toBe('$39,302.50')
    expect(formatMoney(845.5, 'full')).toBe('$845.50')
    expect(formatMoney(0.1)).toBe('$0.10')
    expect(formatMoney(14523.8)).toBe('$14,523.80')
    expect(formatMoney(14523.87)).toBe('$14,523.87')
  })

  it('prints a whole amount without cents', () => {
    expect(formatMoney(14523)).toBe('$14,523')
    expect(formatMoney(0)).toBe('$0')
    // Rounds to a whole number at two places, so it reads as one.
    expect(formatMoney(845.004)).toBe('$845')
  })

  it('leaves the table and compact modes as they were', () => {
    expect(formatMoney(845.5, 'table')).toBe('$845.50')
    expect(formatMoney(14523, 'table')).toBe('$14,523.00')
    expect(formatMoney(39302.5, 'compact')).toBe('$39.3K')
  })
})
