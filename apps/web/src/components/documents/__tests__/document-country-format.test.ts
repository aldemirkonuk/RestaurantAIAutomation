/**
 * A euro or pound document prints its own country's way (F-1398).
 *
 * `localeFor` knew only TRY and printed everything else the American way, so a
 * German invoice read `€1,234.50` and `Aug 14, 2026`. It now follows the
 * seller's country (VAT prefix, else address), and failing that the house's
 * formats. TRY and USD documents keep their old shape.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { documentCountry, fmtDate, fmtMoney, fmtStamp } from '../canonical-format'
import { setHouseLocale } from '../../../lib/houseCurrency'

const seller = (vat: string | null, address: string | null) => ({
  vatIdentifier: { value: vat },
  address: { value: address },
})

afterEach(() => setHouseLocale('en-US'))

describe('documentCountry', () => {
  it('reads the seller VAT prefix first', () => {
    expect(documentCountry(seller('DE 123 456 789', 'Paris, France'))).toBe('DE')
    expect(documentCountry(seller('GB123456789', null))).toBe('GB')
    // VIES writes Greece as EL.
    expect(documentCountry(seller('EL123456789', null))).toBe('GR')
  })

  it('falls back to the last part of the address, and guesses nothing else', () => {
    expect(documentCountry(seller(null, 'Rue de Rivoli 1, 75001 Paris, France'))).toBe('FR')
    // A Turkish tax number carries no prefix, and this address names no country.
    expect(documentCountry(seller('1234567890', 'Kadıköy'))).toBeNull()
    expect(documentCountry(null)).toBeNull()
  })
})

describe('figures on a euro or pound document', () => {
  it("print in the seller's country, not the American way", () => {
    expect(fmtMoney(1234.5, 'EUR', 'DE')).toBe('€1.234,50')
    expect(fmtDate('2026-08-14', null, 'EUR', 'DE')).toBe('14.08.2026')
    expect(fmtDate('2026-08-14', null, 'GBP', 'GB')).toBe('14/08/2026')
  })

  it("use the house's formats when the paper names no country", () => {
    setHouseLocale('en-GB')
    expect(fmtMoney(1234.5, 'EUR')).toBe('€1,234.50')
    expect(fmtDate('2026-08-14', null, 'EUR')).toBe('14/08/2026')
    expect(fmtStamp('2026-08-14T09:40:00', null, 'GBP')).toBe('14/08 09:40')
  })

  it('leave Turkish and dollar documents as they were', () => {
    expect(fmtMoney(1234.5, 'TRY', 'DE')).toBe('₺1.234,50')
    expect(fmtMoney(1234.5, 'USD', 'DE')).toBe('$1,234.50')
    expect(fmtDate('2026-08-14', null, 'USD', 'DE')).toBe('Aug 14, 2026')
    expect(fmtDate('2026-08-14', 'TR', 'EUR', 'DE')).toBe('14.08.2026')
  })
})
