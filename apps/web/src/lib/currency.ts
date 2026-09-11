/**
 * What money a house takes, and how the sign-up form works out a default.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `restaurants.currency` said `USD` on all fourteen production houses, measured
 * 2026-09-05 — two of them in Turkiye and one in London. Nobody had typed it:
 * the column carried `DEFAULT 'USD'` (`20260805000000_baseline_from_production
 * .sql:3576`) and the sign-up insert named no currency key at all, so the
 * default WAS the writer and an unanswered question was stored as an answer
 * (ADR 0117 Q25; the fault is [[absence-reported-as-health]]).
 *
 * The founder's call, 2026-09-05: *"correct three rows now, ask each house in
 * onboarding, but set a default based on location, edge case: there maybe
 * several diff currencies, so act accordingly to that"*.
 *
 * So the form ASKS, and this table is what lets it offer a sensible answer
 * without guessing when it cannot. `20260905120000_a_house_names_its_money.sql`
 * drops the column default; `RegisterRestaurantDto.currency` is optional and
 * writes NULL when absent. A stated default the manager confirms is a different
 * thing from a silent one, and ADR 0083 is why: the page says what it will
 * record before it records it.
 *
 * THE SOURCE, AND THE DATE
 * ------------------------
 * ISO 4217 alpha-3 codes, as published by SIX Financial Information for ISO
 * (the maintenance agency), list A1; country names are the ones this app's own
 * `COUNTRIES` list uses (`lib/countries.ts`, 194 entries), which is what the
 * sign-up form's combobox and Google Places both write into `country`.
 * Compiled 2026-09-05. No external call is made at any point — a form that
 * cannot fill a field without a third party is a form that breaks offline.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 *   * It does not cover every country. A country not in the table gets NO
 *     default and the manager picks — which is the honest outcome and the whole
 *     point. Adding a row is a one-line edit with a source; guessing one is the
 *     defect this file exists to remove.
 *   * It does not convert anything. There is no exchange rate in this system.
 *     A house's currency is what it REPORTS in; each recorded price carries the
 *     currency the vendor billed in (`price_history.currency`,
 *     `vendor_price_observations.currency`), and a reader that finds two
 *     currencies in one comparison refuses in words rather than converting.
 *   * It IS the validator of the world's currencies, as of 2026-09-06. The
 *     gateway used to check shape only (`/^[A-Z]{3}$/`), so "ZZZ" was filed as
 *     money; `apps/api-gateway/src/common/iso-4217.ts` now checks membership
 *     against a copy of the table below, and `iso-4217.spec.ts` reads this file
 *     as text so the copy cannot drift. "TL" and "$" cannot be typed in on
 *     either side.
 */

// RETIRED 2026-09-05, ADR 0117 Q33 (retire-to-write, CLAUDE.md §4).
//
// `COUNTRY_CURRENCY` (122 name -> ISO 4217 pairs) and its private
// `COUNTRY_ALIASES` map used to live here. They were the third table of the same
// fact, keyed by a display NAME, alongside `lib/countries.ts`'s 194 names and
// `PlacesAutocomplete`'s 113 name -> alpha-2 pairs — and the three disagreed:
// Google writes `Türkiye`, two of them said `Turkey`.
//
// One table now, keyed by ISO 3166-1 alpha-2, in `lib/countries.ts`. The
// currency lives on the country row beside the code and the display name, so a
// country cannot have a currency in one file and no code in another.
//
// What stays here is what is about MONEY rather than about countries: the codes
// a manager may pick, their names, and the formatter that refuses to print a
// symbol nobody earned.
export { currencyForCountry } from './countries';

/**
 * What the sign-up form and the agreement sheet will actually RECORD, given the
 * person's answer and the default that was offered.
 *
 * Three states, and keeping them distinct is the whole decision:
 *   - `choice === null`  untouched: the STATED default stands and is recorded.
 *   - `choice === ''`    "not yet": NOTHING is recorded. The column keeps NULL
 *                        and every screen says "currency not recorded".
 *   - anything else      the person confirmed or changed it.
 *
 * Exported so the form, the sheet and their tests exercise the same function
 * rather than three copies of one expression — a test that restates the logic it
 * checks passes whatever the component does.
 */
export function currencyToRecord(
  choice: string | null,
  defaultFromCountry: string | null,
): string | null {
  if (choice === null) return defaultFromCountry
  return choice || null
}

/**
 * One row per ACTIVE ISO 4217 currency — the name a picker shows and the number
 * of decimal places the money actually has.
 *
 * WIDENED 2026-09-06, founder batch 67: *"The full active ISO 4217 list, in both
 * tables ... A Hong Kong or Macau vendor's invoice files instead of being
 * held."* It held 96 codes for one day, one per country in `lib/countries.ts`,
 * which meant the product could not name money that ~60 real currencies are
 * billed in — HKD, MOP, XOF, XAF, XCD, XPF among them — and the gateway, which
 * mirrors this table, HELD every invoice denominated in one.
 *
 * WHAT IS DELIBERATELY ABSENT. The 22 codes in ISO's list A1 that are not money
 * a vendor bills in: the precious metals (XAU, XAG, XPT, XPD), the test and
 * no-currency codes (XTS, XXX), the bond market units (XBA-XBD), the units of
 * account (XDR, XSU, XUA) and the funds codes (BOV, CHE, CHW, CLF, COU, MXV,
 * USN, UYI, UYW). 157 + 22 is the ~180 ISO publishes. Withdrawn codes are
 * absent too — HRK, CUC, SLL, ZWL, MRO, STD, VEF — so paper old enough to name
 * one says "currency not recorded" rather than being read as live money; ANG is
 * kept because XCG only just replaced it and invoices still carry it.
 *
 * `apps/api-gateway/src/common/iso-4217.ts` holds the same 157 codes and
 * `iso-4217.spec.ts` reads THIS FILE as text and fails on a one-code
 * difference in either direction. Adding a currency is two edits, and the
 * gateway suite is red until both are made.
 */
export interface CurrencyRow {
  /** What it is called, for a picker row and a sentence. */
  name: string
  /**
   * ISO 4217's minor-unit count — how many decimal places this money HAS.
   *
   * Not cosmetic. `formatMoney` printed two everywhere, so a 1200-yen invoice
   * rendered as JPY 1,200.00 (yen have no subunit) and a 1.500-dinar one as
   * BHD 1.50, which is a different amount. Sixteen currencies here take 0 and
   * seven take 3.
   */
  minor: 0 | 2 | 3
}

const CURRENCIES: Readonly<Record<string, CurrencyRow>> = {
  AED: { name: 'UAE dirham', minor: 2 },
  AFN: { name: 'Afghan afghani', minor: 2 },
  ALL: { name: 'Albanian lek', minor: 2 },
  AMD: { name: 'Armenian dram', minor: 2 },
  ANG: { name: 'Netherlands Antillean guilder', minor: 2 },
  AOA: { name: 'Angolan kwanza', minor: 2 },
  ARS: { name: 'Argentine peso', minor: 2 },
  AUD: { name: 'Australian dollar', minor: 2 },
  AWG: { name: 'Aruban florin', minor: 2 },
  AZN: { name: 'Azerbaijani manat', minor: 2 },
  BAM: { name: 'Bosnia-Herzegovina mark', minor: 2 },
  BBD: { name: 'Barbadian dollar', minor: 2 },
  BDT: { name: 'Bangladeshi taka', minor: 2 },
  BGN: { name: 'Bulgarian lev', minor: 2 },
  BHD: { name: 'Bahraini dinar', minor: 3 },
  BIF: { name: 'Burundian franc', minor: 0 },
  BMD: { name: 'Bermudian dollar', minor: 2 },
  BND: { name: 'Brunei dollar', minor: 2 },
  BOB: { name: 'Bolivian boliviano', minor: 2 },
  BRL: { name: 'Brazilian real', minor: 2 },
  BSD: { name: 'Bahamian dollar', minor: 2 },
  BTN: { name: 'Bhutanese ngultrum', minor: 2 },
  BWP: { name: 'Botswanan pula', minor: 2 },
  BYN: { name: 'Belarusian rouble', minor: 2 },
  BZD: { name: 'Belize dollar', minor: 2 },
  CAD: { name: 'Canadian dollar', minor: 2 },
  CDF: { name: 'Congolese franc', minor: 2 },
  CHF: { name: 'Swiss franc', minor: 2 },
  CLP: { name: 'Chilean peso', minor: 0 },
  CNY: { name: 'Chinese yuan', minor: 2 },
  COP: { name: 'Colombian peso', minor: 2 },
  CRC: { name: 'Costa Rican colon', minor: 2 },
  CUP: { name: 'Cuban peso', minor: 2 },
  CVE: { name: 'Cape Verdean escudo', minor: 2 },
  CZK: { name: 'Czech koruna', minor: 2 },
  DJF: { name: 'Djiboutian franc', minor: 0 },
  DKK: { name: 'Danish krone', minor: 2 },
  DOP: { name: 'Dominican peso', minor: 2 },
  DZD: { name: 'Algerian dinar', minor: 2 },
  EGP: { name: 'Egyptian pound', minor: 2 },
  ERN: { name: 'Eritrean nakfa', minor: 2 },
  ETB: { name: 'Ethiopian birr', minor: 2 },
  EUR: { name: 'Euro', minor: 2 },
  FJD: { name: 'Fijian dollar', minor: 2 },
  FKP: { name: 'Falkland Islands pound', minor: 2 },
  GBP: { name: 'Pound sterling', minor: 2 },
  GEL: { name: 'Georgian lari', minor: 2 },
  GHS: { name: 'Ghanaian cedi', minor: 2 },
  GIP: { name: 'Gibraltar pound', minor: 2 },
  GMD: { name: 'Gambian dalasi', minor: 2 },
  GNF: { name: 'Guinean franc', minor: 0 },
  GTQ: { name: 'Guatemalan quetzal', minor: 2 },
  GYD: { name: 'Guyanese dollar', minor: 2 },
  HKD: { name: 'Hong Kong dollar', minor: 2 },
  HNL: { name: 'Honduran lempira', minor: 2 },
  HTG: { name: 'Haitian gourde', minor: 2 },
  HUF: { name: 'Hungarian forint', minor: 2 },
  IDR: { name: 'Indonesian rupiah', minor: 2 },
  ILS: { name: 'Israeli shekel', minor: 2 },
  INR: { name: 'Indian rupee', minor: 2 },
  IQD: { name: 'Iraqi dinar', minor: 3 },
  IRR: { name: 'Iranian rial', minor: 2 },
  ISK: { name: 'Icelandic krona', minor: 0 },
  JMD: { name: 'Jamaican dollar', minor: 2 },
  JOD: { name: 'Jordanian dinar', minor: 3 },
  JPY: { name: 'Japanese yen', minor: 0 },
  KES: { name: 'Kenyan shilling', minor: 2 },
  KGS: { name: 'Kyrgyzstani som', minor: 2 },
  KHR: { name: 'Cambodian riel', minor: 2 },
  KMF: { name: 'Comorian franc', minor: 0 },
  KPW: { name: 'North Korean won', minor: 2 },
  KRW: { name: 'South Korean won', minor: 0 },
  KWD: { name: 'Kuwaiti dinar', minor: 3 },
  KYD: { name: 'Cayman Islands dollar', minor: 2 },
  KZT: { name: 'Kazakhstani tenge', minor: 2 },
  LAK: { name: 'Lao kip', minor: 2 },
  LBP: { name: 'Lebanese pound', minor: 2 },
  LKR: { name: 'Sri Lankan rupee', minor: 2 },
  LRD: { name: 'Liberian dollar', minor: 2 },
  LSL: { name: 'Lesotho loti', minor: 2 },
  LYD: { name: 'Libyan dinar', minor: 3 },
  MAD: { name: 'Moroccan dirham', minor: 2 },
  MDL: { name: 'Moldovan leu', minor: 2 },
  MGA: { name: 'Malagasy ariary', minor: 2 },
  MKD: { name: 'Macedonian denar', minor: 2 },
  MMK: { name: 'Myanmar kyat', minor: 2 },
  MNT: { name: 'Mongolian tugrik', minor: 2 },
  MOP: { name: 'Macanese pataca', minor: 2 },
  MRU: { name: 'Mauritanian ouguiya', minor: 2 },
  MUR: { name: 'Mauritian rupee', minor: 2 },
  MVR: { name: 'Maldivian rufiyaa', minor: 2 },
  MWK: { name: 'Malawian kwacha', minor: 2 },
  MXN: { name: 'Mexican peso', minor: 2 },
  MYR: { name: 'Malaysian ringgit', minor: 2 },
  MZN: { name: 'Mozambican metical', minor: 2 },
  NAD: { name: 'Namibian dollar', minor: 2 },
  NGN: { name: 'Nigerian naira', minor: 2 },
  NIO: { name: 'Nicaraguan cordoba', minor: 2 },
  NOK: { name: 'Norwegian krone', minor: 2 },
  NPR: { name: 'Nepalese rupee', minor: 2 },
  NZD: { name: 'New Zealand dollar', minor: 2 },
  OMR: { name: 'Omani rial', minor: 3 },
  PAB: { name: 'Panamanian balboa', minor: 2 },
  PEN: { name: 'Peruvian sol', minor: 2 },
  PGK: { name: 'Papua New Guinean kina', minor: 2 },
  PHP: { name: 'Philippine peso', minor: 2 },
  PKR: { name: 'Pakistani rupee', minor: 2 },
  PLN: { name: 'Polish zloty', minor: 2 },
  PYG: { name: 'Paraguayan guarani', minor: 0 },
  QAR: { name: 'Qatari riyal', minor: 2 },
  RON: { name: 'Romanian leu', minor: 2 },
  RSD: { name: 'Serbian dinar', minor: 2 },
  RUB: { name: 'Russian rouble', minor: 2 },
  RWF: { name: 'Rwandan franc', minor: 0 },
  SAR: { name: 'Saudi riyal', minor: 2 },
  SBD: { name: 'Solomon Islands dollar', minor: 2 },
  SCR: { name: 'Seychellois rupee', minor: 2 },
  SDG: { name: 'Sudanese pound', minor: 2 },
  SEK: { name: 'Swedish krona', minor: 2 },
  SGD: { name: 'Singapore dollar', minor: 2 },
  SHP: { name: 'Saint Helena pound', minor: 2 },
  SLE: { name: 'Sierra Leonean leone', minor: 2 },
  SOS: { name: 'Somali shilling', minor: 2 },
  SRD: { name: 'Surinamese dollar', minor: 2 },
  SSP: { name: 'South Sudanese pound', minor: 2 },
  STN: { name: 'Sao Tome and Principe dobra', minor: 2 },
  SVC: { name: 'Salvadoran colon', minor: 2 },
  SYP: { name: 'Syrian pound', minor: 2 },
  SZL: { name: 'Swazi lilangeni', minor: 2 },
  THB: { name: 'Thai baht', minor: 2 },
  TJS: { name: 'Tajikistani somoni', minor: 2 },
  TMT: { name: 'Turkmenistani manat', minor: 2 },
  TND: { name: 'Tunisian dinar', minor: 3 },
  TOP: { name: 'Tongan pa-anga', minor: 2 },
  TRY: { name: 'Turkish lira', minor: 2 },
  TTD: { name: 'Trinidad and Tobago dollar', minor: 2 },
  TWD: { name: 'New Taiwan dollar', minor: 2 },
  TZS: { name: 'Tanzanian shilling', minor: 2 },
  UAH: { name: 'Ukrainian hryvnia', minor: 2 },
  UGX: { name: 'Ugandan shilling', minor: 0 },
  USD: { name: 'US dollar', minor: 2 },
  UYU: { name: 'Uruguayan peso', minor: 2 },
  UZS: { name: 'Uzbekistani som', minor: 2 },
  VED: { name: 'Venezuelan bolivar digital', minor: 2 },
  VES: { name: 'Venezuelan bolivar', minor: 2 },
  VND: { name: 'Vietnamese dong', minor: 0 },
  VUV: { name: 'Vanuatu vatu', minor: 0 },
  WST: { name: 'Samoan tala', minor: 2 },
  XAF: { name: 'CFA franc BEAC', minor: 0 },
  XCD: { name: 'East Caribbean dollar', minor: 2 },
  XCG: { name: 'Caribbean guilder', minor: 2 },
  XOF: { name: 'CFA franc BCEAO', minor: 0 },
  XPF: { name: 'CFP franc', minor: 0 },
  YER: { name: 'Yemeni rial', minor: 2 },
  ZAR: { name: 'South African rand', minor: 2 },
  ZMW: { name: 'Zambian kwacha', minor: 2 },
  ZWG: { name: 'Zimbabwe gold', minor: 2 },
}

/**
 * Every code a manager may choose, sorted. Exactly the table above — no free
 * text, and nothing the gateway would refuse.
 *
 * IT USED TO BE THE COUNTRY TABLE'S 96 (`COUNTRIES[].currency`), which made the
 * picker narrower than the money this product accepts: a house billed in HKD
 * could have the invoice filed but could not name HKD anywhere itself. One
 * table now answers both questions, and `currencyForCountry` still supplies the
 * DEFAULT from the country — an offer, never an application (ADR 0117 Q25).
 */
export const CURRENCY_CODES: readonly string[] = Object.keys(CURRENCIES).sort()

/** `TRY - Turkish lira`, for a picker row. */
export function currencyLabel(code: string): string {
  const row = CURRENCIES[code]
  return row ? `${code} - ${row.name}` : code
}

/**
 * How many decimal places this money HAS, or `null` for a code we do not hold.
 *
 * `null` is not "two". A caller that gets `null` has been handed a code this
 * product does not stand behind, and guessing two for it is how BHD (three) and
 * JPY (zero) both came to print as if they were dollars.
 */
export function currencyMinorUnits(code: string | null | undefined): number | null {
  if (typeof code !== 'string') return null
  const row = CURRENCIES[code.trim().toUpperCase()]
  return row ? row.minor : null
}

/** The sentence every screen shows where a house has not answered the question. */
export const CURRENCY_NOT_RECORDED = 'currency not recorded'

/**
 * Money, in the currency it is actually in — or the sentence saying there is
 * none.
 *
 * Never falls back to USD, and never to a bare `$`. That fallback is the reason
 * a house in Fethiye was shown dollars: the code assumed the one currency it
 * knew, and nothing downstream could tell an assumption from an answer. A
 * caller with no currency gets a number and a caveat, which is honest and
 * legible, rather than a wrong symbol, which is neither.
 */
export function formatMoney(
  amount: number | null | undefined,
  currency: string | null | undefined,
  opts: { maximumFractionDigits?: number } = {},
): string {
  if (amount == null || !Number.isFinite(amount)) return '-'
  // The CURRENCY'S own decimal places, not two. Yen have no subunit and a
  // Bahraini dinar has three, so a flat two printed 1200 JPY as `1,200.00` and
  // rounded a 1.500 BHD line to `1.50` — a different amount, on a screen a
  // person reconciles an invoice against. A caller may still override, and a
  // code this product does not hold falls back to two rather than to nothing.
  const digits = opts.maximumFractionDigits ?? currencyMinorUnits(currency) ?? 2
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    return `${amount.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })} (${CURRENCY_NOT_RECORDED})`
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount)
  } catch {
    // A well-formed code `Intl` does not know still names the money. Printing
    // the number beside the code is right; falling back to dollars is not.
    return `${amount.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })} ${currency}`
  }
}
