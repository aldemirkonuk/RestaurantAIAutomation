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
 *   * It is not a validator of the world's currencies. The gateway checks shape
 *     only (`/^[A-Z]{3}$/`); the codes a manager can choose are exactly the ones
 *     below, so "TL" and "$" cannot be typed in.
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
import { COUNTRIES } from './countries';

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

/** Every code a manager may choose, sorted. Exactly the codes above — no free text. */
export const CURRENCY_CODES: readonly string[] = Array.from(
  new Set(
    COUNTRIES.map((c) => c.currency).filter(
      (code): code is string => typeof code === 'string',
    ),
  ),
).sort()

/**
 * What a code is called, for the picker. Only the codes above need a name; a
 * code with none is shown as itself, which is still unambiguous.
 */
const CURRENCY_NAMES: Readonly<Record<string, string>> = {
  AED: 'UAE dirham', AFN: 'Afghan afghani', ALL: 'Albanian lek', AMD: 'Armenian dram',
  AOA: 'Angolan kwanza', ARS: 'Argentine peso', AUD: 'Australian dollar',
  AZN: 'Azerbaijani manat', BAM: 'Bosnia-Herzegovina mark', BBD: 'Barbadian dollar',
  BDT: 'Bangladeshi taka', BGN: 'Bulgarian lev', BHD: 'Bahraini dinar',
  BND: 'Brunei dollar', BOB: 'Bolivian boliviano', BRL: 'Brazilian real',
  BWP: 'Botswanan pula', BYN: 'Belarusian rouble', BZD: 'Belize dollar',
  CAD: 'Canadian dollar', CHF: 'Swiss franc', CLP: 'Chilean peso',
  CNY: 'Chinese yuan', COP: 'Colombian peso', CRC: 'Costa Rican colon',
  CUP: 'Cuban peso', CZK: 'Czech koruna', DKK: 'Danish krone',
  DOP: 'Dominican peso', DZD: 'Algerian dinar', EGP: 'Egyptian pound',
  ETB: 'Ethiopian birr', EUR: 'Euro', FJD: 'Fijian dollar', GBP: 'Pound sterling',
  GEL: 'Georgian lari', GHS: 'Ghanaian cedi', GTQ: 'Guatemalan quetzal',
  HNL: 'Honduran lempira', HUF: 'Hungarian forint', IDR: 'Indonesian rupiah',
  ILS: 'Israeli shekel', INR: 'Indian rupee', IQD: 'Iraqi dinar',
  IRR: 'Iranian rial', ISK: 'Icelandic krona', JMD: 'Jamaican dollar',
  JOD: 'Jordanian dinar', JPY: 'Japanese yen', KES: 'Kenyan shilling',
  KHR: 'Cambodian riel', KRW: 'South Korean won', KWD: 'Kuwaiti dinar',
  KZT: 'Kazakhstani tenge', LBP: 'Lebanese pound', LKR: 'Sri Lankan rupee',
  LYD: 'Libyan dinar', MAD: 'Moroccan dirham', MDL: 'Moldovan leu',
  MKD: 'Macedonian denar', MNT: 'Mongolian tugrik', MXN: 'Mexican peso',
  MYR: 'Malaysian ringgit', NGN: 'Nigerian naira', NIO: 'Nicaraguan cordoba',
  NOK: 'Norwegian krone', NPR: 'Nepalese rupee', NZD: 'New Zealand dollar',
  OMR: 'Omani rial', PAB: 'Panamanian balboa', PEN: 'Peruvian sol',
  PHP: 'Philippine peso', PKR: 'Pakistani rupee', PLN: 'Polish zloty',
  PYG: 'Paraguayan guarani', QAR: 'Qatari riyal', RON: 'Romanian leu',
  RSD: 'Serbian dinar', RUB: 'Russian rouble', SAR: 'Saudi riyal',
  SEK: 'Swedish krona', SGD: 'Singapore dollar', THB: 'Thai baht',
  TND: 'Tunisian dinar', TRY: 'Turkish lira', TWD: 'New Taiwan dollar',
  TZS: 'Tanzanian shilling', UAH: 'Ukrainian hryvnia', UGX: 'Ugandan shilling',
  USD: 'US dollar', UYU: 'Uruguayan peso', UZS: 'Uzbekistani som',
  VES: 'Venezuelan bolivar', VND: 'Vietnamese dong', ZAR: 'South African rand',
  ZMW: 'Zambian kwacha',
}

/** `TRY - Turkish lira`, for a picker row. */
export function currencyLabel(code: string): string {
  const name = CURRENCY_NAMES[code]
  return name ? `${code} - ${name}` : code
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
  const digits = opts.maximumFractionDigits ?? 2
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
