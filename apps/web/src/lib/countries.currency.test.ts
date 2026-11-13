/**
 * Every country the /get-started picker offers names its money, except the
 * two where no single answer is true (r28 onboarding audit, gap 4).
 *
 * 72 of the 194 rows carried no currency, so a house in one of them opened
 * with none and every money screen said "currency not recorded". The rows were
 * missing because the retired name table had 122 pairs, not because the
 * countries have no currency.
 */
import { describe, expect, it } from 'vitest'
import { COUNTRIES, currencyForCountry } from './countries'
import { CURRENCY_CODES } from './currency'

const byCurrency = (code: string) =>
  COUNTRIES.filter((c) => c.currency === code)
    .map((c) => c.code)
    .sort()

describe('every country names its money', () => {
  it('leaves exactly Palestine and Zimbabwe without a default', () => {
    expect(COUNTRIES.filter((c) => !c.currency).map((c) => c.code).sort()).toEqual(['PS', 'ZW'])
  })

  it('names only money the house can choose and the gateway accepts', () => {
    const offered = new Set(CURRENCY_CODES)
    expect(COUNTRIES.filter((c) => c.currency && !offered.has(c.currency)).map((c) => c.code)).toEqual([])
  })

  it('gives the shared currencies to every country that uses them', () => {
    // ISO 4217 list A1: the West and Central African francs and the East Caribbean dollar.
    expect(byCurrency('XOF')).toEqual(['BF', 'BJ', 'CI', 'GW', 'ML', 'NE', 'SN', 'TG'])
    expect(byCurrency('XAF')).toEqual(['CF', 'CG', 'CM', 'GA', 'GQ', 'TD'])
    expect(byCurrency('XCD')).toEqual(['AG', 'DM', 'GD', 'KN', 'LC', 'VC'])
  })

  it('gives a state that uses another state’s money that money', () => {
    for (const code of ['MH', 'FM', 'PW', 'TL', 'EC', 'SV', 'US']) {
      expect(COUNTRIES.find((c) => c.code === code)?.currency, code).toBe('USD')
    }
    for (const code of ['KI', 'NR', 'TV', 'AU']) {
      expect(COUNTRIES.find((c) => c.code === code)?.currency, code).toBe('AUD')
    }
    expect(currencyForCountry('Vatican City')).toBe('EUR')
    expect(currencyForCountry('Holy See')).toBe('EUR')
  })

  it('offers Côte d’Ivoire, which the table did not hold, by every spelling', () => {
    for (const text of ['Côte d\'Ivoire', 'Cote d\'Ivoire', 'Côte d’Ivoire', 'Ivory Coast', 'CI']) {
      expect(currencyForCountry(text), text).toBe('XOF')
    }
  })

  it('reads the national currencies the audit named', () => {
    expect(currencyForCountry('Bahamas')).toBe('BSD')
    expect(currencyForCountry('Maldives')).toBe('MVR')
    expect(currencyForCountry('Mauritius')).toBe('MUR')
    expect(currencyForCountry('Kyrgyzstan')).toBe('KGS')
    expect(currencyForCountry('Turkmenistan')).toBe('TMT')
    expect(currencyForCountry('Cape Verde')).toBe('CVE')
    expect(currencyForCountry('Sierra Leone')).toBe('SLE')
  })

  it('still never defaults the two unanswerable countries to dollars', () => {
    expect(currencyForCountry('Palestine')).toBeNull()
    expect(currencyForCountry('Zimbabwe')).toBeNull()
  })
})
