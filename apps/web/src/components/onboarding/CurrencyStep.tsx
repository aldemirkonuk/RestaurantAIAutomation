/**
 * "What money does this house report in?" — asked at sign-up, defaulted from
 * the address, never assumed.
 *
 * WHY IT EXISTS
 * -------------
 * `restaurants.currency` carried `DEFAULT 'USD'` and the sign-up insert named no
 * currency key, so the COLUMN was the writer: measured on production 2026-09-05,
 * `USD` on all fourteen houses, two of them in Turkiye and one in London, none
 * of them ever asked. ADR 0117 Q25; founder the same day: *"correct three rows
 * now, ask each house in onboarding, but set a default based on location, edge
 * case: there maybe several diff currencies, so act accordingly to that"*.
 *
 * THE THREE RULES IT IMPLEMENTS
 *   1. **A stated default, not a silent one.** The sentence under the field says
 *      what will be recorded before it is recorded (ADR 0083), and names the
 *      country it was derived from so the manager can see the reasoning and
 *      disagree with it.
 *   2. **"Not yet" is an answer.** It records NOTHING — the row keeps NULL and
 *      every screen says "currency not recorded". There is no fallback to USD,
 *      because a fallback is what put dollars on a restaurant in Fethiye.
 *   3. **The house's currency is not a price's currency.** It is what this house
 *      REPORTS in; each invoice keeps the currency its vendor billed in
 *      (`price_history.currency`, `vendor_price_observations.currency`), and
 *      nothing is ever converted. The copy says so, because a manager who thinks
 *      this field converts their Turkish invoices will read every total wrong.
 *
 * It is a separate component rather than markup inside `Register.tsx` so the
 * decision can be rendered and asserted on its own — the sign-up wizard's four
 * preceding sections are not what this rule is about.
 */

import { CURRENCY_CODES, currencyForCountry, currencyLabel, currencyToRecord } from '../../lib/currency'

export interface CurrencyStepProps {
  /** The country as the address step left it — the default is derived from this. */
  country: string
  /**
   * `null` while the manager has not touched the field (the stated default
   * stands), a code once they confirm or change it, and `''` for "not yet".
   */
  choice: string | null
  onChange: (next: string) => void
}

export function CurrencyStep({ country, choice, onChange }: CurrencyStepProps) {
  const fromCountry = currencyForCountry(country)
  const willRecord = currencyToRecord(choice, fromCountry)
  const countryNamed = country.trim().length >= 2

  const statement = willRecord
    ? choice === null && fromCountry
      ? `Defaulted from ${country.trim()}. We will record ${willRecord}. Change it if that is wrong.`
      : `We will record ${willRecord}.`
    : countryNamed && !fromCountry
      ? `We could not work out a currency for ${country.trim()}, so nothing will be recorded and your screens will say "currency not recorded" until you choose one.`
      : 'Nothing will be recorded, and your screens will say "currency not recorded" until you choose one.'

  return (
    <div className="mt-[18px] pt-[18px] border-t border-gray-200/70">
      <label
        htmlFor="restaurant-currency"
        className="block text-sm font-medium text-gray-700 mb-1"
      >
        Currency
      </label>
      <p className="text-xs text-gray-500 mb-2">
        The money this house reports in. Each invoice still carries the currency
        your vendor billed in — nothing is converted.
      </p>
      <select
        id="restaurant-currency"
        value={choice ?? fromCountry ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full px-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
      >
        <option value="">Not yet — I will set this later</option>
        {CURRENCY_CODES.map((code) => (
          <option key={code} value={code}>
            {currencyLabel(code)}
          </option>
        ))}
      </select>
      <p data-testid="currency-statement" className="text-xs text-gray-500 mt-1">
        {statement}
      </p>
    </div>
  )
}
