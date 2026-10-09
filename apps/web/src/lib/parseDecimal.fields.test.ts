/**
 * F-358, the rest: every free-text number field outside the first seven reads
 * its text through `parseDecimal`, so "12,50" is an amount and "1.250" is 1250
 * in a "."-grouping house. Each case below was a bare `Number()` before — the
 * comma spellings were refused or sent as NaN, and the grouped ones misread.
 */
import { describe, expect, it } from 'vitest'
import { readOptionalAmount } from './parseDecimal'
import {
  batchRowsToBulkLines,
  batchTotals,
  validateBatchRows,
  type BatchReceiveRow,
} from '../components/inventory/BatchReceiveGrid'
import { readPourInput, readTargetInputs } from '../pages/settings/next/TargetMarginSection'
import { readTyped } from '../pages/settings/next/CarryingCostSection'
import { toBody as settingsTermsBody } from '../pages/settings/next/VendorTermsSection'
import { readRuleLimit } from '../pages/settings/next/ThresholdsSection'
import { toBody as providerTermsBody } from '../pages/providers/next/TermsSection'
import { EMPTY_VENDOR, minimumOrderOf, vendorRefusals } from '../pages/providers/next/NewVendorSheet'
import { readGoalTarget } from '../pages/recommendations/next/Entry'
import { grantLimitOf } from '../pages/team/next/SendGrantsSection'
import { readTargetText } from '../pages/reports/next/rp-registers-goals'

describe('readOptionalAmount', () => {
  it('blank is nothing stated; text and negatives are refused', () => {
    expect(readOptionalAmount('  ')).toEqual({ ok: true, value: null })
    expect(readOptionalAmount('12,50')).toEqual({ ok: true, value: 12.5 })
    expect(readOptionalAmount('1.250', '.')).toEqual({ ok: true, value: 1250 })
    expect(readOptionalAmount('lots')).toEqual({ ok: false })
    expect(readOptionalAmount('-5')).toEqual({ ok: false })
  })
})

describe('batch receive grid', () => {
  const row = (cost: string): BatchReceiveRow => ({
    key: 'r1',
    wineId: 'w1',
    name: 'Kavaklıdere',
    quantity: 2,
    cost,
    isSample: false,
    selected: false,
  })

  it('a decimal comma is a cost, not a refusal', () => {
    expect(validateBatchRows([row('12,50')])).toEqual([])
    expect(batchRowsToBulkLines([row('12,50')])[0].costPerBottle).toBe(12.5)
    expect(batchTotals([row('12,50')]).cost).toBe(25)
  })

  it('"1.250" in a "."-grouping house is sent as 1250, and the total agrees', () => {
    expect(batchRowsToBulkLines([row('1.250')], undefined, '.')[0].costPerBottle).toBe(1250)
    expect(batchTotals([row('1.250')], '.').cost).toBe(2500)
  })

  it('text is still refused by name', () => {
    expect(validateBatchRows([row('abc')])[0].reason).toMatch(/not a number/)
  })
})

describe('settings: target margin and carrying cost', () => {
  const NONE = { bottlePct: null, glassPct: null, bandPct: null }

  it('reads "66,7" and "2,5" as percents', () => {
    expect(readTargetInputs('66,7', '', '2,5', NONE).body).toEqual({ bottlePct: 66.7, glassPct: null, bandPct: 2.5 })
  })

  it('still refuses text in the pour', () => {
    expect(readPourInput('abc', null).canConfirm).toBe(false)
    expect(readPourInput('150', null).ml).toBe(150)
  })

  it('reads "0,75" as three quarters of a percent', () => {
    const r = readTyped('0,75', null)
    expect(r.canRecord).toBe(true)
    expect(r.value).toBe(0.75)
  })
})

describe('vendor terms (settings and the vendor page)', () => {
  const before = { weekdays: [], cutoffTime: '', cutoffOffset: '', minimum: '', leadTime: '', paymentTerms: '' }

  for (const [where, toBody] of [
    ['settings', settingsTermsBody],
    ['vendor page', providerTermsBody],
  ] as const) {
    it(`${where}: "1.250,00" is sent as 1250, and an unreadable minimum is never sent`, () => {
      expect(toBody({ ...before, minimum: '1.250,00' }, before)).toEqual({ minimumOrderAmount: 1250 })
      expect(toBody({ ...before, minimum: '1.250' }, before, '.')).toEqual({ minimumOrderAmount: 1250 })
      expect(toBody({ ...before, minimum: '12,5x' }, before)).toEqual({})
    })
  }
})

describe('new vendor minimum order', () => {
  it('a comma amount is not refused, and is sent as the number it says', () => {
    const d = { ...EMPTY_VENDOR, minimumOrder: '1.250,00' }
    expect(vendorRefusals(d).minimumOrder).toBeUndefined()
    expect(minimumOrderOf(d)).toBe(1250)
    expect(minimumOrderOf({ ...EMPTY_VENDOR, minimumOrder: '1.250' }, '.')).toBe(1250)
    expect(minimumOrderOf(EMPTY_VENDOR)).toBeUndefined()
  })
})

describe('approval thresholds', () => {
  it('reads the rule number the way the house writes it', () => {
    expect(readRuleLimit('amount', '1.500', '.')).toEqual({ ok: true, amountLimit: 1500, percentLimit: null })
    expect(readRuleLimit('percent', '12,5')).toEqual({ ok: true, amountLimit: null, percentLimit: 12.5 })
    expect(readRuleLimit('amount', 'abc')).toEqual({ ok: false })
  })

  it('a recorded number left as shown is kept, never re-read', () => {
    expect(readRuleLimit('percent', '1.125', '.', 1.125)).toEqual({ ok: true, amountLimit: null, percentLimit: 1.125 })
  })
})

describe('goal targets and grant limits', () => {
  it('a goal from a recommendation reads "12,5" and "9.000"', () => {
    expect(readGoalTarget('12,5')).toBe(12.5)
    expect(readGoalTarget('9.000', '.')).toBe(9000)
    expect(readGoalTarget('0')).toBeNull()
  })

  it('the goals desk reads "9.000" in a "."-grouping house, and keeps a recorded target as shown', () => {
    expect(readTargetText('9.000', null, '.')).toBe(9000)
    expect(readTargetText('12,5', null)).toBe(12.5)
    expect(readTargetText('1.125', 1.125, '.')).toBe(1.125)
  })

  it('a grant limit reads "1.250,00"', () => {
    expect(grantLimitOf('1.250,00')).toBe(1250)
    expect(grantLimitOf('lots')).toBeNull()
  })
})
