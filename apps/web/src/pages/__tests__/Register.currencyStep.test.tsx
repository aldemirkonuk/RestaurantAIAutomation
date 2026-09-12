/**
 * The sign-up currency step — ADR 0117 Q25, founder 2026-09-05:
 * *"correct three rows now, ask each house in onboarding, but set a default
 * based on location"*.
 *
 * WHAT THIS PROVES, AND WHY EACH ONE IS LOAD-BEARING
 *   1. The default is DERIVED from the address's country, and the screen SAYS
 *      what it will record before it records it (ADR 0083).
 *   2. A country the table has no row for produces NO default, and the step says
 *      so rather than quietly offering the one currency the code knows.
 *   3. Choosing "not yet" records NOTHING. The gateway then writes NULL and the
 *      screens say "currency not recorded". It must never fall back to USD —
 *      which is exactly how two houses in Turkiye and one in London came to
 *      assert dollars.
 *   4. The copy tells the manager this field does not convert their invoices.
 *      A manager who believes it does will read every total wrong.
 *
 * PRE-FIX PROOF, measured on this tree 2026-09-05:
 *
 *     git show HEAD:apps/web/src/pages/Register.tsx | grep -c currency
 *     0
 *
 * The form had no currency field of any kind. The value came from the column
 * default (`20260805000000_baseline_from_production.sql:3576`), so no test here
 * could have caught it — which is why this file is new rather than amended.
 *
 * The step is asserted through its own component rather than by driving the
 * four sign-up sections in front of it: the wizard's navigation is a different
 * subject, and a test that spends its length getting there tests that instead.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CurrencyStep } from '../../components/onboarding/CurrencyStep'
import { currencyToRecord } from '../../lib/currency'

function step(country: string, choice: string | null = null) {
  const onChange = vi.fn()
  render(<CurrencyStep country={country} choice={choice} onChange={onChange} />)
  return {
    select: screen.getByLabelText('Currency') as HTMLSelectElement,
    statement: () => screen.getByTestId('currency-statement').textContent ?? '',
    onChange,
  }
}

describe('the sign-up currency step', () => {
  it('defaults a Fethiye house to TRY and says what it will record', () => {
    const { select, statement } = step('Türkiye')
    expect(select.value).toBe('TRY')
    expect(statement()).toContain('Defaulted from Türkiye')
    expect(statement()).toContain('We will record TRY')
  })

  it('defaults a London house to GBP', () => {
    expect(step('United Kingdom').select.value).toBe('GBP')
  })

  it('offers NO default for a country it cannot place, and says so', () => {
    const { select, statement } = step('Ruritania')
    // The empty option is "Not yet". Falling back to USD here is the defect.
    expect(select.value).toBe('')
    expect(statement()).toContain('could not work out a currency for Ruritania')
    expect(statement()).toContain('currency not recorded')
  })

  it('records nothing when the manager chooses "not yet", and never USD', () => {
    const { statement } = step('Türkiye', '')
    expect(statement()).toContain('Nothing will be recorded')
    expect(statement()).toContain('currency not recorded')
    expect(statement()).not.toContain('USD')
  })

  it('records the manager’s change over the default', () => {
    expect(step('Türkiye', 'EUR').statement()).toContain('We will record EUR')
  })

  it('reports the choice back as the empty string for "not yet"', () => {
    const { select, onChange } = step('Türkiye')
    fireEvent.change(select, { target: { value: '' } })
    // Not `null`, not `undefined`: the empty string is how the form tells
    // "answered, and the answer is not yet" apart from "untouched".
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('tells the manager it does not convert their invoices', () => {
    step('Türkiye')
    expect(screen.getByText(/nothing is converted/i)).toBeTruthy()
  })

  it('offers "not yet" as the first option, so it is reachable without scrolling', () => {
    const { select } = step('Türkiye')
    expect(select.options[0].value).toBe('')
    expect(select.options[0].textContent).toContain('Not yet')
  })
})

/**
 * The resolver the form submits through, exercised directly.
 *
 * It is the SAME function the step and `Register.tsx` call — not a copy of the
 * expression. A test that restates the logic it checks passes whatever the
 * component does.
 */
describe('what reaches the gateway, in each of the step’s three states', () => {
  it('sends the stated default when the manager leaves it standing', () => {
    expect(currencyToRecord(null, 'TRY')).toBe('TRY')
  })

  it('sends the manager’s change', () => {
    expect(currencyToRecord('EUR', 'TRY')).toBe('EUR')
  })

  it('sends NOTHING for "not yet" — and never USD', () => {
    expect(currencyToRecord('', 'TRY')).toBeNull()
    expect(currencyToRecord('', 'USD')).toBeNull()
    expect(currencyToRecord('', null)).toBeNull()
  })

  it('sends nothing when the country yields no default', () => {
    expect(currencyToRecord(null, null)).toBeNull()
  })
})
