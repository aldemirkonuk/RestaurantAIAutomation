/**
 * The three retired tables, and the proof that nothing they knew was lost.
 *
 * ADR 0117 Q33 replaced `lib/countries.ts`'s name array,
 * `PlacesAutocomplete`'s `COUNTRY_ISO` and `lib/currency.ts`'s
 * `COUNTRY_CURRENCY` with one table keyed by ISO 3166-1 alpha-2. Retire-to-write
 * means naming what is retired; it does not mean trusting that the replacement
 * covers it.
 *
 * So the three tables are frozen below EXACTLY as they stood at `HEAD` on
 * 2026-09-05 — extracted mechanically from the files, not retyped — and every
 * pair is asserted against the new one. A regression here is a country that
 * used to resolve and no longer does, which is invisible in every other test:
 * the Google region bias just quietly stops being sent, which is precisely the
 * defect that started this.
 *
 * These constants are a FROZEN RECORD. They are never updated. When the table
 * grows, this file keeps saying what the old ones held.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COUNTRIES,
  COUNTRY_NAMES,
  countryByCode,
  countryByName,
  countryCodeFor,
  currencyForCountry,
} from './countries'

/** `PlacesAutocomplete.COUNTRY_ISO` at HEAD: 113 display name -> alpha-2 pairs. */
const RETIRED_COUNTRY_ISO: ReadonlyArray<readonly [string, string]> = [
  ['Afghanistan', 'af'],
  ['Albania', 'al'],
  ['Algeria', 'dz'],
  ['Argentina', 'ar'],
  ['Armenia', 'am'],
  ['Australia', 'au'],
  ['Austria', 'at'],
  ['Azerbaijan', 'az'],
  ['Bahrain', 'bh'],
  ['Bangladesh', 'bd'],
  ['Belarus', 'by'],
  ['Belgium', 'be'],
  ['Bolivia', 'bo'],
  ['Bosnia and Herzegovina', 'ba'],
  ['Brazil', 'br'],
  ['Bulgaria', 'bg'],
  ['Cambodia', 'kh'],
  ['Canada', 'ca'],
  ['Chile', 'cl'],
  ['China', 'cn'],
  ['Colombia', 'co'],
  ['Croatia', 'hr'],
  ['Cuba', 'cu'],
  ['Cyprus', 'cy'],
  ['Czech Republic', 'cz'],
  ['Denmark', 'dk'],
  ['Dominican Republic', 'do'],
  ['Ecuador', 'ec'],
  ['Egypt', 'eg'],
  ['Estonia', 'ee'],
  ['Ethiopia', 'et'],
  ['Finland', 'fi'],
  ['France', 'fr'],
  ['Georgia', 'ge'],
  ['Germany', 'de'],
  ['Ghana', 'gh'],
  ['Greece', 'gr'],
  ['Guatemala', 'gt'],
  ['Honduras', 'hn'],
  ['Hungary', 'hu'],
  ['Iceland', 'is'],
  ['India', 'in'],
  ['Indonesia', 'id'],
  ['Iran', 'ir'],
  ['Iraq', 'iq'],
  ['Ireland', 'ie'],
  ['Israel', 'il'],
  ['Italy', 'it'],
  ['Jamaica', 'jm'],
  ['Japan', 'jp'],
  ['Jordan', 'jo'],
  ['Kazakhstan', 'kz'],
  ['Kenya', 'ke'],
  ['Kuwait', 'kw'],
  ['Latvia', 'lv'],
  ['Lebanon', 'lb'],
  ['Libya', 'ly'],
  ['Lithuania', 'lt'],
  ['Luxembourg', 'lu'],
  ['Malaysia', 'my'],
  ['Malta', 'mt'],
  ['Mexico', 'mx'],
  ['Moldova', 'md'],
  ['Morocco', 'ma'],
  ['Myanmar', 'mm'],
  ['Nepal', 'np'],
  ['Netherlands', 'nl'],
  ['New Zealand', 'nz'],
  ['Nicaragua', 'ni'],
  ['Nigeria', 'ng'],
  ['North Macedonia', 'mk'],
  ['Norway', 'no'],
  ['Oman', 'om'],
  ['Pakistan', 'pk'],
  ['Panama', 'pa'],
  ['Paraguay', 'py'],
  ['Peru', 'pe'],
  ['Philippines', 'ph'],
  ['Poland', 'pl'],
  ['Portugal', 'pt'],
  ['Qatar', 'qa'],
  ['Romania', 'ro'],
  ['Russia', 'ru'],
  ['Saudi Arabia', 'sa'],
  ['Senegal', 'sn'],
  ['Serbia', 'rs'],
  ['Singapore', 'sg'],
  ['Slovakia', 'sk'],
  ['Slovenia', 'si'],
  ['South Africa', 'za'],
  ['South Korea', 'kr'],
  ['Spain', 'es'],
  ['Sri Lanka', 'lk'],
  ['Sudan', 'sd'],
  ['Sweden', 'se'],
  ['Switzerland', 'ch'],
  ['Syria', 'sy'],
  ['Taiwan', 'tw'],
  ['Tanzania', 'tz'],
  ['Thailand', 'th'],
  ['Tunisia', 'tn'],
  ['Turkey', 'tr'],
  ['Uganda', 'ug'],
  ['Ukraine', 'ua'],
  ['United Arab Emirates', 'ae'],
  ['United Kingdom', 'gb'],
  ['United States', 'us'],
  ['Uruguay', 'uy'],
  ['Uzbekistan', 'uz'],
  ['Venezuela', 've'],
  ['Vietnam', 'vn'],
  ['Yemen', 'ye'],
  ['Zimbabwe', 'zw'],
]

/** `lib/countries.ts` at HEAD: the 194 display names the pickers offered. */
const RETIRED_COUNTRY_NAMES: readonly string[] = [
  'Afghanistan',
  'Albania',
  'Algeria',
  'Andorra',
  'Angola',
  'Antigua and Barbuda',
  'Argentina',
  'Armenia',
  'Australia',
  'Austria',
  'Azerbaijan',
  'Bahamas',
  'Bahrain',
  'Bangladesh',
  'Barbados',
  'Belarus',
  'Belgium',
  'Belize',
  'Benin',
  'Bhutan',
  'Bolivia',
  'Bosnia and Herzegovina',
  'Botswana',
  'Brazil',
  'Brunei',
  'Bulgaria',
  'Burkina Faso',
  'Burundi',
  'Cabo Verde',
  'Cambodia',
  'Cameroon',
  'Canada',
  'Central African Republic',
  'Chad',
  'Chile',
  'China',
  'Colombia',
  'Comoros',
  'Congo',
  'Costa Rica',
  'Croatia',
  'Cuba',
  'Cyprus',
  'Czech Republic',
  'Denmark',
  'Djibouti',
  'Dominica',
  'Dominican Republic',
  'Ecuador',
  'Egypt',
  'El Salvador',
  'Equatorial Guinea',
  'Eritrea',
  'Estonia',
  'Eswatini',
  'Ethiopia',
  'Fiji',
  'Finland',
  'France',
  'Gabon',
  'Gambia',
  'Georgia',
  'Germany',
  'Ghana',
  'Greece',
  'Grenada',
  'Guatemala',
  'Guinea',
  'Guinea-Bissau',
  'Guyana',
  'Haiti',
  'Honduras',
  'Hungary',
  'Iceland',
  'India',
  'Indonesia',
  'Iran',
  'Iraq',
  'Ireland',
  'Israel',
  'Italy',
  'Jamaica',
  'Japan',
  'Jordan',
  'Kazakhstan',
  'Kenya',
  'Kiribati',
  'Kuwait',
  'Kyrgyzstan',
  'Laos',
  'Latvia',
  'Lebanon',
  'Lesotho',
  'Liberia',
  'Libya',
  'Liechtenstein',
  'Lithuania',
  'Luxembourg',
  'Madagascar',
  'Malawi',
  'Malaysia',
  'Maldives',
  'Mali',
  'Malta',
  'Marshall Islands',
  'Mauritania',
  'Mauritius',
  'Mexico',
  'Micronesia',
  'Moldova',
  'Monaco',
  'Mongolia',
  'Montenegro',
  'Morocco',
  'Mozambique',
  'Myanmar',
  'Namibia',
  'Nauru',
  'Nepal',
  'Netherlands',
  'New Zealand',
  'Nicaragua',
  'Niger',
  'Nigeria',
  'North Korea',
  'North Macedonia',
  'Norway',
  'Oman',
  'Pakistan',
  'Palau',
  'Palestine',
  'Panama',
  'Papua New Guinea',
  'Paraguay',
  'Peru',
  'Philippines',
  'Poland',
  'Portugal',
  'Qatar',
  'Romania',
  'Russia',
  'Rwanda',
  'Saint Kitts and Nevis',
  'Saint Lucia',
  'Saint Vincent and the Grenadines',
  'Samoa',
  'San Marino',
  'Sao Tome and Principe',
  'Saudi Arabia',
  'Senegal',
  'Serbia',
  'Seychelles',
  'Sierra Leone',
  'Singapore',
  'Slovakia',
  'Slovenia',
  'Solomon Islands',
  'Somalia',
  'South Africa',
  'South Korea',
  'South Sudan',
  'Spain',
  'Sri Lanka',
  'Sudan',
  'Suriname',
  'Sweden',
  'Switzerland',
  'Syria',
  'Taiwan',
  'Tajikistan',
  'Tanzania',
  'Thailand',
  'Timor-Leste',
  'Togo',
  'Tonga',
  'Trinidad and Tobago',
  'Tunisia',
  'Turkey',
  'Turkmenistan',
  'Tuvalu',
  'Uganda',
  'Ukraine',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
  'Uruguay',
  'Uzbekistan',
  'Vanuatu',
  'Vatican City',
  'Venezuela',
  'Vietnam',
  'Yemen',
  'Zambia',
  'Zimbabwe',
]

/** `lib/currency.ts` at HEAD: 122 display name -> ISO 4217 pairs. */
const RETIRED_COUNTRY_CURRENCY: ReadonlyArray<readonly [string, string]> = [
  ['Afghanistan', 'AFN'],
  ['Albania', 'ALL'],
  ['Algeria', 'DZD'],
  ['Andorra', 'EUR'],
  ['Angola', 'AOA'],
  ['Argentina', 'ARS'],
  ['Armenia', 'AMD'],
  ['Australia', 'AUD'],
  ['Austria', 'EUR'],
  ['Azerbaijan', 'AZN'],
  ['Bahrain', 'BHD'],
  ['Bangladesh', 'BDT'],
  ['Barbados', 'BBD'],
  ['Belarus', 'BYN'],
  ['Belgium', 'EUR'],
  ['Belize', 'BZD'],
  ['Bolivia', 'BOB'],
  ['Bosnia and Herzegovina', 'BAM'],
  ['Botswana', 'BWP'],
  ['Brazil', 'BRL'],
  ['Brunei', 'BND'],
  ['Bulgaria', 'BGN'],
  ['Cambodia', 'KHR'],
  ['Canada', 'CAD'],
  ['Chile', 'CLP'],
  ['China', 'CNY'],
  ['Colombia', 'COP'],
  ['Costa Rica', 'CRC'],
  ['Croatia', 'EUR'],
  ['Cuba', 'CUP'],
  ['Cyprus', 'EUR'],
  ['Czech Republic', 'CZK'],
  ['Denmark', 'DKK'],
  ['Dominican Republic', 'DOP'],
  ['Ecuador', 'USD'],
  ['Egypt', 'EGP'],
  ['El Salvador', 'USD'],
  ['Estonia', 'EUR'],
  ['Ethiopia', 'ETB'],
  ['Fiji', 'FJD'],
  ['Finland', 'EUR'],
  ['France', 'EUR'],
  ['Georgia', 'GEL'],
  ['Germany', 'EUR'],
  ['Ghana', 'GHS'],
  ['Greece', 'EUR'],
  ['Guatemala', 'GTQ'],
  ['Honduras', 'HNL'],
  ['Hungary', 'HUF'],
  ['Iceland', 'ISK'],
  ['India', 'INR'],
  ['Indonesia', 'IDR'],
  ['Iran', 'IRR'],
  ['Iraq', 'IQD'],
  ['Ireland', 'EUR'],
  ['Israel', 'ILS'],
  ['Italy', 'EUR'],
  ['Jamaica', 'JMD'],
  ['Japan', 'JPY'],
  ['Jordan', 'JOD'],
  ['Kazakhstan', 'KZT'],
  ['Kenya', 'KES'],
  ['Kuwait', 'KWD'],
  ['Latvia', 'EUR'],
  ['Lebanon', 'LBP'],
  ['Libya', 'LYD'],
  ['Liechtenstein', 'CHF'],
  ['Lithuania', 'EUR'],
  ['Luxembourg', 'EUR'],
  ['Malaysia', 'MYR'],
  ['Malta', 'EUR'],
  ['Mexico', 'MXN'],
  ['Moldova', 'MDL'],
  ['Monaco', 'EUR'],
  ['Mongolia', 'MNT'],
  ['Montenegro', 'EUR'],
  ['Morocco', 'MAD'],
  ['Nepal', 'NPR'],
  ['Netherlands', 'EUR'],
  ['New Zealand', 'NZD'],
  ['Nicaragua', 'NIO'],
  ['Nigeria', 'NGN'],
  ['North Macedonia', 'MKD'],
  ['Norway', 'NOK'],
  ['Oman', 'OMR'],
  ['Pakistan', 'PKR'],
  ['Panama', 'PAB'],
  ['Paraguay', 'PYG'],
  ['Peru', 'PEN'],
  ['Philippines', 'PHP'],
  ['Poland', 'PLN'],
  ['Portugal', 'EUR'],
  ['Qatar', 'QAR'],
  ['Romania', 'RON'],
  ['Russia', 'RUB'],
  ['San Marino', 'EUR'],
  ['Saudi Arabia', 'SAR'],
  ['Serbia', 'RSD'],
  ['Singapore', 'SGD'],
  ['Slovakia', 'EUR'],
  ['Slovenia', 'EUR'],
  ['South Africa', 'ZAR'],
  ['South Korea', 'KRW'],
  ['Spain', 'EUR'],
  ['Sri Lanka', 'LKR'],
  ['Sweden', 'SEK'],
  ['Switzerland', 'CHF'],
  ['Taiwan', 'TWD'],
  ['Tanzania', 'TZS'],
  ['Thailand', 'THB'],
  ['Tunisia', 'TND'],
  ['Turkey', 'TRY'],
  ['Uganda', 'UGX'],
  ['Ukraine', 'UAH'],
  ['United Arab Emirates', 'AED'],
  ['United Kingdom', 'GBP'],
  ['United States', 'USD'],
  ['Uruguay', 'UYU'],
  ['Uzbekistan', 'UZS'],
  ['Venezuela', 'VES'],
  ['Vietnam', 'VND'],
  ['Zambia', 'ZMW'],
]

describe('nothing the retired tables knew was lost', () => {
  it('resolves every one of COUNTRY_ISO’s pairs to the same alpha-2 code', () => {
    for (const [name, iso] of RETIRED_COUNTRY_ISO) {
      expect(countryCodeFor(name), name).toBe(iso)
    }
  })

  it('still offers all 194 display names, in the same order', () => {
    expect(COUNTRY_NAMES).toEqual(RETIRED_COUNTRY_NAMES)
  })

  it('resolves every one of COUNTRY_CURRENCY’s pairs to the same code', () => {
    for (const [name, code] of RETIRED_COUNTRY_CURRENCY) {
      expect(currencyForCountry(name), name).toBe(code)
    }
  })
})

describe('the table is keyed by the code, and the key is sound', () => {
  it('gives every country a distinct upper-case alpha-2 code', () => {
    const seen = new Set<string>()
    for (const c of COUNTRIES) {
      expect(c.code, c.name).toMatch(/^[A-Z]{2}$/)
      expect(seen.has(c.code), `${c.code} twice`).toBe(false)
      seen.add(c.code)
    }
    expect(seen.size).toBe(COUNTRIES.length)
  })

  it('resolves a country by its code as well as by its name', () => {
    expect(countryByCode('TR')?.name).toBe('Turkey')
    expect(countryByCode('tr')?.name).toBe('Turkey')
    expect(countryByName('TR')?.code).toBe('TR')
  })
})

describe('the spelling that started this', () => {
  it('resolves Türkiye, the spelling Google actually sends', () => {
    // All three Turkish production rows carry this exact string, written by
    // PlacesAutocomplete from Google's own `longText`. Both retired tables said
    // "Turkey", so it matched neither.
    expect(countryByName('Türkiye')?.code).toBe('TR')
    expect(countryCodeFor('Türkiye')).toBe('tr')
    expect(currencyForCountry('Türkiye')).toBe('TRY')
  })

  it('resolves the constituent countries somebody types for the UK', () => {
    for (const text of ['England', 'Scotland', 'Wales', 'Northern Ireland', 'UK']) {
      expect(countryByName(text)?.code, text).toBe('GB')
    }
  })

  it('resolves the four spellings of the United States already in production', () => {
    for (const text of ['United States', 'united States', 'USA', 'US']) {
      expect(countryByName(text)?.code, text).toBe('US')
    }
  })

  it('returns null for text it does not know, and never guesses', () => {
    expect(countryByName('Ruritania')).toBeNull()
    expect(countryCodeFor('Ruritania')).toBeNull()
    expect(currencyForCountry('Ruritania')).toBeNull()
    expect(currencyForCountry('Ruritania')).not.toBe('USD')
  })
})

describe('the retired tables are gone from the tree, not merely unused', () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')

  it('PlacesAutocomplete no longer carries its own name -> code map', () => {
    const src = read('components/ui/PlacesAutocomplete.tsx')
    // A retired table left in place is a table somebody will edit.
    expect(src).not.toContain('const COUNTRY_ISO')
    expect(src).toContain('countryCodeFor')
  })

  it('currency.ts no longer carries its own country map', () => {
    const src = read('lib/currency.ts')
    expect(src).not.toContain('const COUNTRY_CURRENCY')
    expect(src).not.toContain('const COUNTRY_ALIASES')
  })
})
