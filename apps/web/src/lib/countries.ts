/**
 * One country table, keyed by ISO 3166-1 alpha-2. Every surface reads it.
 *
 * ADR 0117 Q33, founder 2026-09-05: *"One country table keyed by ISO code, every
 * surface reads it"*.
 *
 * WHAT WAS WRONG, MEASURED
 * ------------------------
 * Three tables of the same fact, keyed three different ways, disagreeing:
 *
 *   - `lib/countries.ts` — a flat array of 194 display NAMES, no codes.
 *   - `components/ui/PlacesAutocomplete.tsx` — `COUNTRY_ISO`, 113 name -> alpha-2
 *     pairs, used to bias the Google Places search.
 *   - `lib/currency.ts` — `COUNTRY_CURRENCY`, 122 name -> ISO 4217 pairs, plus a
 *     private alias map.
 *
 * The drift was not theoretical. Google Places writes its own `longText` into
 * `restaurants.country`, and for Türkiye that is **`Türkiye`** — which is what
 * all three Turkish and British production rows carry. Both older tables spell
 * it `Turkey`, so a Turkish address filled in from Google matched NEITHER: the
 * combobox showed a country its own list did not contain, and the ISO bias on
 * every subsequent address search was silently lost. Measured 2026-09-05 on the
 * live rows.
 *
 * A name is the wrong key. Countries are renamed (Türkiye 2022, Eswatini 2018,
 * North Macedonia 2019, Cabo Verde 2013), they have several correct spellings at
 * once, and the one a third party sends is not ours to choose. The CODE does not
 * move. So the code is the key, the display name is one field, and every
 * spelling anybody has actually sent is an alias that resolves to the same row.
 *
 * RETIRE-TO-WRITE (CLAUDE.md §4). This file supersedes all three:
 *   - the old `COUNTRIES` string array — this file's `COUNTRY_NAMES` is the same
 *     194 names, derived rather than typed;
 *   - `PlacesAutocomplete`'s `COUNTRY_ISO` — deleted, the component now calls
 *     `countryCodeFor`;
 *   - `lib/currency.ts`'s `COUNTRY_CURRENCY` and its private alias map — deleted,
 *     `currencyForCountry` now resolves through this table.
 *
 * `countries.migration.test.ts` asserts that every pair the retired
 * `COUNTRY_ISO` knew still resolves to the same code, so the retirement is
 * proved rather than trusted.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not the gateway's `price-index/jurisdiction.ts`. That resolves a house
 * or a source to a JURISDICTION — ISO 3166-1 **and** 3166-2 regions, all 81
 * Turkish provinces, `GB-EAW` — for the price register, and it belongs to ADR
 * 0117's non-US-markets work. Measured 2026-09-05: it is the only other ISO 3166
 * table in the repository, no country-name table exists in `apps/api-gateway`,
 * `apps/mobile`, `packages/` or `services/`, and neither app imports a shared
 * package that could hold one (`apps/web` depends on `@wineops/ui`;
 * `apps/api-gateway` depends on no workspace package at all, and
 * `@wineops/database` is imported by nobody). So "one table" is one table in the
 * app that has the surfaces, not a new shared package with one consumer.
 *
 * SOURCE. ISO 3166-1 alpha-2 as published by the ISO 3166 Maintenance Agency;
 * ISO 4217 alpha-3 as published by SIX Financial Information for ISO, list A1.
 * Compiled 2026-09-05. No external call is made at any point.
 */

export interface Country {
  /** ISO 3166-1 alpha-2, upper case. The key. Never changes. */
  readonly code: string;
  /** What this app calls it. May change; the code does not. */
  readonly name: string;
  /** ISO 4217 alpha-3, where this file can state it. Absent is not USD. */
  readonly currency?: string;
  /**
   * Every other spelling anybody has actually sent us — Google's `longText`,
   * a constituent country somebody typed, a former name, an abbreviation. Not
   * a guess at what someone might type: a record of what arrived.
   */
  readonly aliases?: readonly string[];
}

export const COUNTRIES: readonly Country[] = [
  { code: 'AF', name: 'Afghanistan', currency: 'AFN' },
  { code: 'AL', name: 'Albania', currency: 'ALL' },
  { code: 'DZ', name: 'Algeria', currency: 'DZD' },
  { code: 'AD', name: 'Andorra', currency: 'EUR' },
  { code: 'AO', name: 'Angola', currency: 'AOA' },
  { code: 'AG', name: 'Antigua and Barbuda' },
  { code: 'AR', name: 'Argentina', currency: 'ARS' },
  { code: 'AM', name: 'Armenia', currency: 'AMD' },
  { code: 'AU', name: 'Australia', currency: 'AUD' },
  { code: 'AT', name: 'Austria', currency: 'EUR' },
  { code: 'AZ', name: 'Azerbaijan', currency: 'AZN' },
  { code: 'BS', name: 'Bahamas' },
  { code: 'BH', name: 'Bahrain', currency: 'BHD' },
  { code: 'BD', name: 'Bangladesh', currency: 'BDT' },
  { code: 'BB', name: 'Barbados', currency: 'BBD' },
  { code: 'BY', name: 'Belarus', currency: 'BYN' },
  { code: 'BE', name: 'Belgium', currency: 'EUR' },
  { code: 'BZ', name: 'Belize', currency: 'BZD' },
  { code: 'BJ', name: 'Benin' },
  { code: 'BT', name: 'Bhutan' },
  { code: 'BO', name: 'Bolivia', currency: 'BOB', aliases: ['Plurinational State of Bolivia'] },
  { code: 'BA', name: 'Bosnia and Herzegovina', currency: 'BAM' },
  { code: 'BW', name: 'Botswana', currency: 'BWP' },
  { code: 'BR', name: 'Brazil', currency: 'BRL' },
  { code: 'BN', name: 'Brunei', currency: 'BND' },
  { code: 'BG', name: 'Bulgaria', currency: 'BGN' },
  { code: 'BF', name: 'Burkina Faso' },
  { code: 'BI', name: 'Burundi' },
  { code: 'CV', name: 'Cabo Verde', aliases: ['Cape Verde'] },
  { code: 'KH', name: 'Cambodia', currency: 'KHR' },
  { code: 'CM', name: 'Cameroon' },
  { code: 'CA', name: 'Canada', currency: 'CAD' },
  { code: 'CF', name: 'Central African Republic' },
  { code: 'TD', name: 'Chad' },
  { code: 'CL', name: 'Chile', currency: 'CLP' },
  { code: 'CN', name: 'China', currency: 'CNY' },
  { code: 'CO', name: 'Colombia', currency: 'COP' },
  { code: 'KM', name: 'Comoros' },
  { code: 'CG', name: 'Congo' },
  { code: 'CR', name: 'Costa Rica', currency: 'CRC' },
  { code: 'HR', name: 'Croatia', currency: 'EUR' },
  { code: 'CU', name: 'Cuba', currency: 'CUP' },
  { code: 'CY', name: 'Cyprus', currency: 'EUR' },
  { code: 'CZ', name: 'Czech Republic', currency: 'CZK', aliases: ['Czechia'] },
  { code: 'DK', name: 'Denmark', currency: 'DKK' },
  { code: 'DJ', name: 'Djibouti' },
  { code: 'DM', name: 'Dominica' },
  { code: 'DO', name: 'Dominican Republic', currency: 'DOP' },
  { code: 'EC', name: 'Ecuador', currency: 'USD' },
  { code: 'EG', name: 'Egypt', currency: 'EGP' },
  { code: 'SV', name: 'El Salvador', currency: 'USD' },
  { code: 'GQ', name: 'Equatorial Guinea' },
  { code: 'ER', name: 'Eritrea' },
  { code: 'EE', name: 'Estonia', currency: 'EUR' },
  { code: 'SZ', name: 'Eswatini', aliases: ['Swaziland'] },
  { code: 'ET', name: 'Ethiopia', currency: 'ETB' },
  { code: 'FJ', name: 'Fiji', currency: 'FJD' },
  { code: 'FI', name: 'Finland', currency: 'EUR' },
  { code: 'FR', name: 'France', currency: 'EUR' },
  { code: 'GA', name: 'Gabon' },
  { code: 'GM', name: 'Gambia' },
  { code: 'GE', name: 'Georgia', currency: 'GEL' },
  { code: 'DE', name: 'Germany', currency: 'EUR' },
  { code: 'GH', name: 'Ghana', currency: 'GHS' },
  { code: 'GR', name: 'Greece', currency: 'EUR' },
  { code: 'GD', name: 'Grenada' },
  { code: 'GT', name: 'Guatemala', currency: 'GTQ' },
  { code: 'GN', name: 'Guinea' },
  { code: 'GW', name: 'Guinea-Bissau' },
  { code: 'GY', name: 'Guyana' },
  { code: 'HT', name: 'Haiti' },
  { code: 'HN', name: 'Honduras', currency: 'HNL' },
  { code: 'HU', name: 'Hungary', currency: 'HUF' },
  { code: 'IS', name: 'Iceland', currency: 'ISK' },
  { code: 'IN', name: 'India', currency: 'INR' },
  { code: 'ID', name: 'Indonesia', currency: 'IDR' },
  { code: 'IR', name: 'Iran', currency: 'IRR', aliases: ['Islamic Republic of Iran'] },
  { code: 'IQ', name: 'Iraq', currency: 'IQD' },
  { code: 'IE', name: 'Ireland', currency: 'EUR' },
  { code: 'IL', name: 'Israel', currency: 'ILS' },
  { code: 'IT', name: 'Italy', currency: 'EUR' },
  { code: 'JM', name: 'Jamaica', currency: 'JMD' },
  { code: 'JP', name: 'Japan', currency: 'JPY' },
  { code: 'JO', name: 'Jordan', currency: 'JOD' },
  { code: 'KZ', name: 'Kazakhstan', currency: 'KZT' },
  { code: 'KE', name: 'Kenya', currency: 'KES' },
  { code: 'KI', name: 'Kiribati' },
  { code: 'KW', name: 'Kuwait', currency: 'KWD' },
  { code: 'KG', name: 'Kyrgyzstan' },
  { code: 'LA', name: 'Laos', aliases: ['Lao People\'s Democratic Republic'] },
  { code: 'LV', name: 'Latvia', currency: 'EUR' },
  { code: 'LB', name: 'Lebanon', currency: 'LBP' },
  { code: 'LS', name: 'Lesotho' },
  { code: 'LR', name: 'Liberia' },
  { code: 'LY', name: 'Libya', currency: 'LYD' },
  { code: 'LI', name: 'Liechtenstein', currency: 'CHF' },
  { code: 'LT', name: 'Lithuania', currency: 'EUR' },
  { code: 'LU', name: 'Luxembourg', currency: 'EUR' },
  { code: 'MG', name: 'Madagascar' },
  { code: 'MW', name: 'Malawi' },
  { code: 'MY', name: 'Malaysia', currency: 'MYR' },
  { code: 'MV', name: 'Maldives' },
  { code: 'ML', name: 'Mali' },
  { code: 'MT', name: 'Malta', currency: 'EUR' },
  { code: 'MH', name: 'Marshall Islands' },
  { code: 'MR', name: 'Mauritania' },
  { code: 'MU', name: 'Mauritius' },
  { code: 'MX', name: 'Mexico', currency: 'MXN' },
  { code: 'FM', name: 'Micronesia' },
  { code: 'MD', name: 'Moldova', currency: 'MDL', aliases: ['Republic of Moldova'] },
  { code: 'MC', name: 'Monaco', currency: 'EUR' },
  { code: 'MN', name: 'Mongolia', currency: 'MNT' },
  { code: 'ME', name: 'Montenegro', currency: 'EUR' },
  { code: 'MA', name: 'Morocco', currency: 'MAD' },
  { code: 'MZ', name: 'Mozambique' },
  { code: 'MM', name: 'Myanmar', aliases: ['Burma'] },
  { code: 'NA', name: 'Namibia' },
  { code: 'NR', name: 'Nauru' },
  { code: 'NP', name: 'Nepal', currency: 'NPR' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', aliases: ['Holland', 'The Netherlands'] },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD' },
  { code: 'NI', name: 'Nicaragua', currency: 'NIO' },
  { code: 'NE', name: 'Niger' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN' },
  { code: 'KP', name: 'North Korea', aliases: ['Democratic People\'s Republic of Korea', 'Korea, North'] },
  { code: 'MK', name: 'North Macedonia', currency: 'MKD', aliases: ['Macedonia'] },
  { code: 'NO', name: 'Norway', currency: 'NOK' },
  { code: 'OM', name: 'Oman', currency: 'OMR' },
  { code: 'PK', name: 'Pakistan', currency: 'PKR' },
  { code: 'PW', name: 'Palau' },
  { code: 'PS', name: 'Palestine' },
  { code: 'PA', name: 'Panama', currency: 'PAB' },
  { code: 'PG', name: 'Papua New Guinea' },
  { code: 'PY', name: 'Paraguay', currency: 'PYG' },
  { code: 'PE', name: 'Peru', currency: 'PEN' },
  { code: 'PH', name: 'Philippines', currency: 'PHP' },
  { code: 'PL', name: 'Poland', currency: 'PLN' },
  { code: 'PT', name: 'Portugal', currency: 'EUR' },
  { code: 'QA', name: 'Qatar', currency: 'QAR' },
  { code: 'RO', name: 'Romania', currency: 'RON' },
  { code: 'RU', name: 'Russia', currency: 'RUB', aliases: ['Russian Federation'] },
  { code: 'RW', name: 'Rwanda' },
  { code: 'KN', name: 'Saint Kitts and Nevis' },
  { code: 'LC', name: 'Saint Lucia' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines' },
  { code: 'WS', name: 'Samoa' },
  { code: 'SM', name: 'San Marino', currency: 'EUR' },
  { code: 'ST', name: 'Sao Tome and Principe' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR' },
  { code: 'SN', name: 'Senegal' },
  { code: 'RS', name: 'Serbia', currency: 'RSD' },
  { code: 'SC', name: 'Seychelles' },
  { code: 'SL', name: 'Sierra Leone' },
  { code: 'SG', name: 'Singapore', currency: 'SGD' },
  { code: 'SK', name: 'Slovakia', currency: 'EUR' },
  { code: 'SI', name: 'Slovenia', currency: 'EUR' },
  { code: 'SB', name: 'Solomon Islands' },
  { code: 'SO', name: 'Somalia' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR' },
  { code: 'KR', name: 'South Korea', currency: 'KRW', aliases: ['Republic of Korea', 'Korea, South'] },
  { code: 'SS', name: 'South Sudan' },
  { code: 'ES', name: 'Spain', currency: 'EUR' },
  { code: 'LK', name: 'Sri Lanka', currency: 'LKR' },
  { code: 'SD', name: 'Sudan' },
  { code: 'SR', name: 'Suriname' },
  { code: 'SE', name: 'Sweden', currency: 'SEK' },
  { code: 'CH', name: 'Switzerland', currency: 'CHF' },
  { code: 'SY', name: 'Syria', aliases: ['Syrian Arab Republic'] },
  { code: 'TW', name: 'Taiwan', currency: 'TWD' },
  { code: 'TJ', name: 'Tajikistan' },
  { code: 'TZ', name: 'Tanzania', currency: 'TZS', aliases: ['United Republic of Tanzania'] },
  { code: 'TH', name: 'Thailand', currency: 'THB' },
  { code: 'TL', name: 'Timor-Leste', aliases: ['East Timor'] },
  { code: 'TG', name: 'Togo' },
  { code: 'TO', name: 'Tonga' },
  { code: 'TT', name: 'Trinidad and Tobago' },
  { code: 'TN', name: 'Tunisia', currency: 'TND' },
  { code: 'TR', name: 'Turkey', currency: 'TRY', aliases: ['Türkiye', 'Turkiye', 'Republic of Türkiye'] },
  { code: 'TM', name: 'Turkmenistan' },
  { code: 'TV', name: 'Tuvalu' },
  { code: 'UG', name: 'Uganda', currency: 'UGX' },
  { code: 'UA', name: 'Ukraine', currency: 'UAH' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', aliases: ['UAE'] },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', aliases: ['UK', 'Great Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland', 'GB'] },
  { code: 'US', name: 'United States', currency: 'USD', aliases: ['USA', 'US', 'U.S.', 'United States of America'] },
  { code: 'UY', name: 'Uruguay', currency: 'UYU' },
  { code: 'UZ', name: 'Uzbekistan', currency: 'UZS' },
  { code: 'VU', name: 'Vanuatu' },
  { code: 'VA', name: 'Vatican City', aliases: ['Holy See'] },
  { code: 'VE', name: 'Venezuela', currency: 'VES', aliases: ['Bolivarian Republic of Venezuela'] },
  { code: 'VN', name: 'Vietnam', currency: 'VND', aliases: ['Viet Nam'] },
  { code: 'YE', name: 'Yemen' },
  { code: 'ZM', name: 'Zambia', currency: 'ZMW' },
  { code: 'ZW', name: 'Zimbabwe' },
];

/** Lower-case and strip diacritics, so one country is one key. */
function fold(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

const BY_CODE = new Map<string, Country>(COUNTRIES.map((c) => [c.code, c]));

const BY_TEXT = new Map<string, Country>();
for (const country of COUNTRIES) {
  BY_TEXT.set(fold(country.name), country);
  BY_TEXT.set(fold(country.code), country);
  for (const alias of country.aliases ?? []) BY_TEXT.set(fold(alias), country);
}

/**
 * The display names, in the order the pickers show them.
 *
 * Derived from the table rather than typed beside it — the array and the codes
 * cannot drift apart if only one of them exists.
 */
export const COUNTRY_NAMES: readonly string[] = COUNTRIES.map((c) => c.name);

/** The row for an ISO 3166-1 alpha-2 code, or null. */
export function countryByCode(code: string | null | undefined): Country | null {
  if (typeof code !== 'string') return null;
  return BY_CODE.get(code.trim().toUpperCase()) ?? null;
}

/**
 * The row for anything a person or a third party wrote — a display name, a
 * code, or any recorded alias. `Türkiye`, `Turkiye`, `Turkey`, `TR` and `tr`
 * are one row.
 *
 * `null` for text this table does not know. It is never guessed at: a wrong
 * country is worse than an unknown one, because everything downstream (the
 * address bias, the currency default) then confidently uses it.
 */
export function countryByName(text: string | null | undefined): Country | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  return BY_TEXT.get(fold(text)) ?? null;
}

/**
 * The lower-case alpha-2 code Google Places wants for its region bias, or null.
 *
 * Lower case because that is the shape the Places API takes; the table holds the
 * canonical upper case and this is the one place the conversion happens.
 */
export function countryCodeFor(text: string | null | undefined): string | null {
  const country = countryByName(text);
  return country ? country.code.toLowerCase() : null;
}

/**
 * The ISO 4217 code this country prices in, or `null` when this table cannot
 * state it.
 *
 * `null` is a real answer and the caller must render it as one. It is NEVER
 * USD: defaulting an unknown country to dollars is exactly how a restaurant in
 * Fethiye came to assert USD for seven months (ADR 0117 Q25).
 */
export function currencyForCountry(text: string | null | undefined): string | null {
  return countryByName(text)?.currency ?? null;
}
