/**
 * The currency default, and the sentence that stands in for one when there is
 * none — ADR 0117 Q25, founder 2026-09-05.
 *
 * The three cases at the top are not illustrative. They are the three
 * production rows that were wrong on 2026-09-05: two houses in Turkiye and one
 * in London, all three carrying `USD` because `restaurants.currency` defaulted
 * to it and the sign-up form never named the column.
 */

import { describe, expect, it } from 'vitest'
import { COUNTRIES } from './countries'
import {
  CURRENCY_CODES,
  CURRENCY_NOT_RECORDED,
  currencyForCountry,
  currencyLabel,
  currencyMinorUnits,
  formatMoney,
} from './currency'

describe('currencyForCountry — the three rows that were wrong', () => {
  it('gives Turkiye TRY, in the spelling Google actually returns', () => {
    // `Türkiye` with the u-umlaut is what all three Turkish production rows
    // carry, and it is what `PlacesAutocomplete` writes into `country`. The
    // app's own COUNTRIES list still says `Turkey`, so both must work.
    expect(currencyForCountry('Türkiye')).toBe('TRY')
    expect(currencyForCountry('Turkiye')).toBe('TRY')
    expect(currencyForCountry('Turkey')).toBe('TRY')
  })

  it('gives the United Kingdom GBP, including the country a Londoner types', () => {
    expect(currencyForCountry('United Kingdom')).toBe('GBP')
    // `ADMIN 1` carries `state_province: 'England'`; somebody typing that as the
    // country should not fall through to nothing.
    expect(currencyForCountry('England')).toBe('GBP')
    expect(currencyForCountry('Scotland')).toBe('GBP')
  })

  it('handles the four spellings of the United States already in production', () => {
    for (const spelling of ['United States', 'united States', 'USA', 'US']) {
      expect(currencyForCountry(spelling)).toBe('USD')
    }
  })
})

describe('currencyForCountry — what it refuses to guess', () => {
  it('returns null, NOT USD, for a country it has no row for', () => {
    // The whole defect in one assertion. Defaulting an unknown country to
    // dollars is exactly how a restaurant in Fethiye came to assert USD.
    expect(currencyForCountry('Ruritania')).toBeNull()
    expect(currencyForCountry('Ruritania')).not.toBe('USD')
  })

  it('returns null for nothing at all', () => {
    expect(currencyForCountry('')).toBeNull()
    expect(currencyForCountry('   ')).toBeNull()
    expect(currencyForCountry(null)).toBeNull()
    expect(currencyForCountry(undefined)).toBeNull()
  })
})

describe('the table itself', () => {
  it('holds only well-formed ISO 4217 alpha-3 codes', () => {
    for (const country of COUNTRIES) {
      if (country.currency === undefined) continue
      expect(country.currency, `${country.code} -> ${country.currency}`).toMatch(
        /^[A-Z]{3}$/,
      )
    }
  })

  it('offers every code it can default to, and every other active ISO currency', () => {
    // WIDENED 2026-09-06 (founder batch 67). The picker used to be exactly the
    // country table's 96 codes, which meant a house billed in HKD could have
    // the invoice filed by the gateway and still not name HKD anywhere itself.
    // The country table is now a SUBSET: every default it can derive is
    // offerable, and ~60 currencies no country row reaches are offerable too.
    const fromCountries = COUNTRIES.map((c) => c.currency).filter(Boolean) as string[]
    const offered = new Set(CURRENCY_CODES)
    expect(fromCountries.filter((c) => !offered.has(c))).toEqual([])
    expect(CURRENCY_CODES).toEqual([...CURRENCY_CODES].sort())
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length)
  })

  it('offers the three currencies the narrow list refused, and still no junk', () => {
    // The founder's own examples: "A Hong Kong or Macau vendor's invoice files
    // instead of being held." XOF is one currency across eight countries, so a
    // per-country table could never reach it.
    for (const code of ['HKD', 'MOP', 'XOF']) {
      expect(CURRENCY_CODES).toContain(code)
      expect(currencyLabel(code)).not.toBe(code) // it has a real name, not a bare echo
    }
    // Not currencies, and not offerable: a test code, a metal, a funds code and
    // a withdrawn one.
    for (const code of ['ZZZ', 'XTS', 'XAU', 'CLF', 'HRK']) {
      expect(CURRENCY_CODES).not.toContain(code)
    }
  })

  it('names the codes the estate actually needs', () => {
    expect(currencyLabel('TRY')).toBe('TRY - Turkish lira')
    expect(currencyLabel('GBP')).toBe('GBP - Pound sterling')
    expect(currencyLabel('USD')).toBe('USD - US dollar')
    expect(currencyLabel('HKD')).toBe('HKD - Hong Kong dollar')
    expect(currencyLabel('XOF')).toBe('XOF - CFA franc BCEAO')
  })

  it('knows how many decimal places each currency HAS', () => {
    // Not cosmetic. Two decimals on every code printed 1200 yen as `1,200.00`
    // and rounded a 1.500-dinar line to `1.50` — a different amount.
    expect(currencyMinorUnits('JPY')).toBe(0)
    expect(currencyMinorUnits('KWD')).toBe(3)
    expect(currencyMinorUnits('USD')).toBe(2)
    expect(currencyMinorUnits('XOF')).toBe(0)
    // A code this product does not hold gets NULL, not a confident two.
    expect(currencyMinorUnits('ZZZ')).toBeNull()
    expect(currencyMinorUnits(null)).toBeNull()
  })
})

describe('formatMoney — never a symbol nobody earned', () => {
  it('says so in words when the currency is not recorded', () => {
    const out = formatMoney(1200, null)
    expect(out).toContain(CURRENCY_NOT_RECORDED)
    // Not a dollar sign, not a euro sign, not a bare number pretending.
    expect(out).not.toContain('$')
  })

  it('treats a malformed code as not recorded rather than printing it as money', () => {
    for (const bad of ['', 'usd', '$', 'TL', 'US$']) {
      expect(formatMoney(10, bad)).toContain(CURRENCY_NOT_RECORDED)
    }
  })

  it('formats a real code in its own currency', () => {
    // Intl chooses the symbol and its placement by locale; the assertion is only
    // that the money is NOT presented as dollars and that the number survives.
    const turkish = formatMoney(1200, 'TRY')
    expect(turkish).not.toContain('$')
    expect(turkish).toMatch(/1[.,]200/)
  })

  it('returns a dash for a missing amount, whatever the currency', () => {
    expect(formatMoney(null, 'TRY')).toBe('-')
    expect(formatMoney(undefined, null)).toBe('-')
    expect(formatMoney(Number.NaN, 'GBP')).toBe('-')
  })

  it("prints the currency's OWN decimal places, not two", () => {
    // Yen have no subunit; a flat two decimals printed a 1200-yen invoice as
    // `1,200.00`, which is not a yen figure anybody writes. Asserted on the
    // digits rather than on the symbol, because Intl chooses the symbol and
    // its placement by locale.
    expect(formatMoney(1200, 'JPY')).toMatch(/1[.,]200(?![.,]\d)/)
    expect(formatMoney(1200, 'JPY')).not.toMatch(/1[.,]200[.,]00/)
    // Three, for the seven dinars and rials that have three.
    expect(formatMoney(1.5, 'KWD')).toMatch(/1[.,]500/)
    // Two, still, for the ordinary case.
    expect(formatMoney(1200, 'USD')).toMatch(/1[.,]200[.,]00/)
    // XOF, one of the codes the old list refused, has none.
    expect(formatMoney(5000, 'XOF')).not.toMatch(/5[.,]000[.,]00/)
  })

  it('still honours an explicit digit count from the caller', () => {
    // The unit-price columns pass three deliberately; the currency's own count
    // is a DEFAULT, not an override of the caller.
    expect(formatMoney(1200, 'JPY', { maximumFractionDigits: 2 })).toMatch(
      /1[.,]200[.,]00/,
    )
  })
})
