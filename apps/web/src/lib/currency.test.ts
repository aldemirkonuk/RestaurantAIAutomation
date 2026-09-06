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

  it('offers every code it can default to, and nothing else', () => {
    // The picker's list IS the table's codes, so a manager cannot type "TL" or
    // "$" and cannot pick a code this file does not stand behind.
    expect(new Set(CURRENCY_CODES)).toEqual(
      new Set(COUNTRIES.map((c) => c.currency).filter(Boolean)),
    )
    expect(CURRENCY_CODES).toEqual([...CURRENCY_CODES].sort())
  })

  it('names the codes the estate actually needs', () => {
    expect(currencyLabel('TRY')).toBe('TRY - Turkish lira')
    expect(currencyLabel('GBP')).toBe('GBP - Pound sterling')
    expect(currencyLabel('USD')).toBe('USD - US dollar')
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
})
