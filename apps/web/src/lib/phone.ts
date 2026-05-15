import { isValidPhoneNumber, parsePhoneNumber } from 'libphonenumber-js'
import type { CountryCode } from 'libphonenumber-js'

/** Country display name → ISO 3166-1 alpha-2 (aligned with PlacesAutocomplete). */
const COUNTRY_NAME_TO_ISO: Record<string, CountryCode> = {
  Afghanistan: 'AF',
  Albania: 'AL',
  Algeria: 'DZ',
  Argentina: 'AR',
  Armenia: 'AM',
  Australia: 'AU',
  Austria: 'AT',
  Azerbaijan: 'AZ',
  Bahrain: 'BH',
  Bangladesh: 'BD',
  Belarus: 'BY',
  Belgium: 'BE',
  Bolivia: 'BO',
  'Bosnia and Herzegovina': 'BA',
  Brazil: 'BR',
  Bulgaria: 'BG',
  Cambodia: 'KH',
  Canada: 'CA',
  Chile: 'CL',
  China: 'CN',
  Colombia: 'CO',
  Croatia: 'HR',
  Cuba: 'CU',
  Cyprus: 'CY',
  'Czech Republic': 'CZ',
  Denmark: 'DK',
  'Dominican Republic': 'DO',
  Ecuador: 'EC',
  Egypt: 'EG',
  Estonia: 'EE',
  Ethiopia: 'ET',
  Finland: 'FI',
  France: 'FR',
  Georgia: 'GE',
  Germany: 'DE',
  Ghana: 'GH',
  Greece: 'GR',
  Guatemala: 'GT',
  Honduras: 'HN',
  Hungary: 'HU',
  Iceland: 'IS',
  India: 'IN',
  Indonesia: 'ID',
  Iran: 'IR',
  Iraq: 'IQ',
  Ireland: 'IE',
  Israel: 'IL',
  Italy: 'IT',
  Jamaica: 'JM',
  Japan: 'JP',
  Jordan: 'JO',
  Kazakhstan: 'KZ',
  Kenya: 'KE',
  Kuwait: 'KW',
  Latvia: 'LV',
  Lebanon: 'LB',
  Libya: 'LY',
  Lithuania: 'LT',
  Luxembourg: 'LU',
  Malaysia: 'MY',
  Malta: 'MT',
  Mexico: 'MX',
  Moldova: 'MD',
  Morocco: 'MA',
  Myanmar: 'MM',
  Nepal: 'NP',
  Netherlands: 'NL',
  'New Zealand': 'NZ',
  Nicaragua: 'NI',
  Nigeria: 'NG',
  'North Macedonia': 'MK',
  Norway: 'NO',
  Oman: 'OM',
  Pakistan: 'PK',
  Panama: 'PA',
  Paraguay: 'PY',
  Peru: 'PE',
  Philippines: 'PH',
  Poland: 'PL',
  Portugal: 'PT',
  Qatar: 'QA',
  Romania: 'RO',
  Russia: 'RU',
  'Saudi Arabia': 'SA',
  Senegal: 'SN',
  Serbia: 'RS',
  Singapore: 'SG',
  Slovakia: 'SK',
  Slovenia: 'SI',
  'South Africa': 'ZA',
  'South Korea': 'KR',
  Spain: 'ES',
  'Sri Lanka': 'LK',
  Sudan: 'SD',
  Sweden: 'SE',
  Switzerland: 'CH',
  Syria: 'SY',
  Taiwan: 'TW',
  Tanzania: 'TZ',
  Thailand: 'TH',
  Tunisia: 'TN',
  Turkey: 'TR',
  Uganda: 'UG',
  Ukraine: 'UA',
  'United Arab Emirates': 'AE',
  'United Kingdom': 'GB',
  'United States': 'US',
  Uruguay: 'UY',
  Uzbekistan: 'UZ',
  Venezuela: 'VE',
  Vietnam: 'VN',
  Yemen: 'YE',
  Zimbabwe: 'ZW',
}

const ISO_ALIASES: Record<string, CountryCode> = {
  us: 'US',
  usa: 'US',
  uk: 'GB',
  gb: 'GB',
  tr: 'TR',
  türkiye: 'TR',
  turkey: 'TR',
  ca: 'CA',
  fr: 'FR',
  de: 'DE',
  au: 'AU',
  mx: 'MX',
  br: 'BR',
  in: 'IN',
  ae: 'AE',
}

/** Map free-text country (form field) to default phone country. */
export function countryToPhoneDefault(country?: string): CountryCode {
  const raw = country?.trim()
  if (!raw) return 'US'

  const lower = raw.toLowerCase()
  if (ISO_ALIASES[lower]) return ISO_ALIASES[lower]

  const exact = COUNTRY_NAME_TO_ISO[raw]
  if (exact) return exact

  for (const [name, iso] of Object.entries(COUNTRY_NAME_TO_ISO)) {
    const n = name.toLowerCase()
    if (lower.includes(n) || n.includes(lower)) return iso
  }

  if (lower.includes('united states')) return 'US'
  if (lower.includes('united kingdom')) return 'GB'
  if (lower.includes('türkiye') || lower.includes('turkey')) return 'TR'

  return 'US'
}

export function isValidPhone(value: string | undefined): boolean {
  const v = value?.trim()
  if (!v) return false
  return isValidPhoneNumber(v)
}

/** Normalize to E.164 when possible; otherwise returns trimmed input. */
export function toE164(value: string | undefined, defaultCountry?: CountryCode): string {
  const v = value?.trim()
  if (!v) return ''
  try {
    const parsed = parsePhoneNumber(v, defaultCountry)
    if (parsed?.isValid()) return parsed.format('E.164')
  } catch {
    /* keep raw */
  }
  return v
}

export function formatPhoneDisplay(value: string | undefined, defaultCountry?: CountryCode): string {
  const v = value?.trim()
  if (!v) return ''
  try {
    const parsed = parsePhoneNumber(v, defaultCountry ?? countryToPhoneDefault())
    if (parsed?.isValid()) return parsed.formatInternational()
  } catch {
    /* fall through */
  }
  return v
}
