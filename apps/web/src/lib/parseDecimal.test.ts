/**
 * F-358: a typed price is read the way the house writes it. Every case here was
 * a bare `Number()` before — "1.250" was 1.25 in a Turkish house and "12,50"
 * was refused everywhere.
 */
import { describe, expect, it } from 'vitest'
import { displayGroupMark, groupMarkForCountry, parseDecimal, readingsDisagree, writeDecimal } from './parseDecimal'

describe('parseDecimal', () => {
  it('reads a decimal comma and a decimal point alike', () => {
    expect(parseDecimal('12,50')).toBe(12.5)
    expect(parseDecimal('12.50')).toBe(12.5)
    expect(parseDecimal(',5')).toBe(0.5)
  })

  it('reads both groupings with a decimal part, whatever the house', () => {
    for (const g of [null, '.', ','] as const) {
      expect(parseDecimal('1.250,00', g)).toBe(1250)
      expect(parseDecimal('1,250.00', g)).toBe(1250)
      expect(parseDecimal('12.345.678,9', g)).toBe(12345678.9)
    }
  })

  it('reads a mark written more than once as thousands', () => {
    expect(parseDecimal('1.250.000')).toBe(1250000)
    expect(parseDecimal('1,250,000')).toBe(1250000)
  })

  it('groups a lone mark before three digits only when the house groups with it', () => {
    expect(parseDecimal('1.250', '.')).toBe(1250) // a Turkish house: ₺1,250
    expect(parseDecimal('1.250', ',')).toBe(1.25) // an American house
    expect(parseDecimal('1.250', null)).toBe(1.25) // locale unknown: decimal
    expect(parseDecimal('1,250', ',')).toBe(1250)
    expect(parseDecimal('1,250', '.')).toBe(1.25)
    expect(parseDecimal('0.250', '.')).toBe(0.25) // a leading zero never groups
    expect(parseDecimal('12,50', '.')).toBe(12.5) // two digits never group
  })

  it('drops spaces, a currency sign and TL', () => {
    expect(parseDecimal(' $62.5 ')).toBe(62.5)
    expect(parseDecimal('₺1.250', '.')).toBe(1250)
    expect(parseDecimal('1.250,00 TL')).toBe(1250)
    expect(parseDecimal('€ 9,90')).toBe(9.9)
    expect(parseDecimal('1 250,00')).toBe(1250)
    expect(parseDecimal('-3')).toBe(-3)
  })

  it('refuses what is not a number, and never turns blank into 0', () => {
    for (const s of ['', '  ', 'abc', '1e3', '1.2.3', '1,25,0', '1.250,00,5', '12,5.0', '.', '1,2.50']) {
      expect(parseDecimal(s)).toBeNull()
    }
  })
})

describe('groupMarkForCountry', () => {
  it('reads the grouping mark from the runtime locale data', () => {
    expect(groupMarkForCountry('TR')).toBe('.')
    expect(groupMarkForCountry('DE')).toBe('.')
    expect(groupMarkForCountry('US')).toBe(',')
    expect(groupMarkForCountry('gb')).toBe(',')
  })
  it('is null for a space-grouping country and for nothing known', () => {
    expect(groupMarkForCountry('FR')).toBeNull()
    expect(groupMarkForCountry(null)).toBeNull()
    expect(groupMarkForCountry('Türkiye')).toBeNull()
  })
})

describe('readingsDisagree (F-799)', () => {
  it('names both readings when the house and the screen group with different marks', () => {
    // A Turkish house on an English screen: the house reads 1.25, the screen 1250.
    expect(readingsDisagree('1,250', '.', ',')).toEqual([1.25, 1250])
    expect(readingsDisagree('1.250', '.', ',')).toEqual([1250, 1.25])
    // A house whose country is unknown reads a lone mark as decimal; the screen may not.
    expect(readingsDisagree('1,250', null, ',')).toEqual([1.25, 1250])
  })
  it('is null when there is only one reading', () => {
    expect(readingsDisagree('1,250', ',', ',')).toBeNull()
    expect(readingsDisagree('1.250', '.', '.')).toBeNull()
    expect(readingsDisagree('12,50', '.', ',')).toBeNull()
    expect(readingsDisagree('1250', '.', ',')).toBeNull()
    expect(readingsDisagree('1.250,00', '.', ',')).toBeNull()
    expect(readingsDisagree('0,250', '.', ',')).toBeNull()
    expect(readingsDisagree('1,250', '.', null)).toBeNull()
    expect(readingsDisagree('abc', '.', ',')).toBeNull()
  })
})

describe('displayGroupMark', () => {
  it('reads the screen locale grouping mark', () => {
    expect(displayGroupMark('en-US')).toBe(',')
    expect(displayGroupMark('tr-TR')).toBe('.')
    expect(displayGroupMark('fr-FR')).toBeNull()
  })
})

describe('writeDecimal (F-1552)', () => {
  it('writes a number back so the same house reads the same number', () => {
    expect(writeDecimal(12.375, '.')).toBe('12,375')
    expect(parseDecimal(writeDecimal(12.375, '.'), '.')).toBe(12.375)
    expect(writeDecimal(12.375, ',')).toBe('12.375')
    expect(parseDecimal(writeDecimal(12.375, ','), ',')).toBe(12.375)
    expect(writeDecimal(2400, '.')).toBe('2400')
    expect(parseDecimal(writeDecimal(2400, '.'), '.')).toBe(2400)
  })

  it('writes nothing for a number that is not one', () => {
    expect(writeDecimal(null, '.')).toBe('')
    expect(writeDecimal(undefined)).toBe('')
    expect(writeDecimal(Number.NaN)).toBe('')
  })
})
