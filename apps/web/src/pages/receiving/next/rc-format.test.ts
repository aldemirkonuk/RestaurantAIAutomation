import { describe, expect, it } from 'vitest'
import {
  CURRENCY_UNRECORDED,
  EM,
  currencyCode,
  fmtMoney,
  fmtMoneyWhole,
  fmtMoneyWholeCcy,
  fmtMoneyWholeFloor,
} from './rc-format'
import { recoveryGroups, trendByCurrencyOf } from './useReceivingNextData'
import type { CreditStats, ProcurementCredit } from '@/services/api/credits'

/**
 * /receiving's money, in the currency it is in (scenario walk 2026-10-07,
 * PROCURE-03). The formatters used to be pinned to US dollars and to fall back
 * to them for an order with no currency; the owner ledger summed every
 * currency into one figure. `Intl` separates a code from its number with a
 * no-break space, so results are compared with it turned into a space.
 */
const sp = (s: string) => s.replace(/\u00a0/g, ' ')

describe('rc-format money — never dollars by default', () => {
  it('prints a stated currency in its own money and its own decimal places', () => {
    expect(fmtMoney(12.5, 'EUR')).toBe('€12.50')
    expect(sp(fmtMoney(250, 'try'))).toBe('TRY 250.00')
    expect(fmtMoney(1200, 'JPY')).toBe('¥1,200')
    expect(sp(fmtMoney(1.5, 'BHD'))).toBe('BHD 1.500')
    expect(fmtMoneyWhole(900.4, 'EUR')).toBe('€900')
  })

  it('says the currency is not recorded when none is stated, on every formatter', () => {
    expect(fmtMoney(88.5, null)).toBe('88.50 (currency not recorded)')
    expect(fmtMoney(88.5, undefined)).toBe('88.50 (currency not recorded)')
    expect(fmtMoneyWhole(12000, null)).toBe('12,000 (currency not recorded)')
    expect(fmtMoneyWholeCcy(40, null)).toBe('40 (currency not recorded)')
    expect(fmtMoneyWholeFloor(900, true, null)).toBe('≥900 (currency not recorded)')
  })

  it('reads the gateway’s unrecorded key and blank codes as not recorded', () => {
    expect(currencyCode(CURRENCY_UNRECORDED)).toBeNull()
    expect(currencyCode('  ')).toBeNull()
    expect(currencyCode(' eur ')).toBe('EUR')
    expect(fmtMoney(5, CURRENCY_UNRECORDED)).toBe('5.00 (currency not recorded)')
  })

  it('keeps an unknown amount a dash, whatever the currency', () => {
    expect(fmtMoney(null, 'EUR')).toBe(EM)
    expect(fmtMoneyWholeFloor(null, true, 'EUR')).toBe(EM)
  })

  it('puts the floor marker in front of the stated money', () => {
    expect(sp(fmtMoneyWholeFloor(250, true, 'TRY'))).toBe('≥TRY 250')
    expect(fmtMoneyWholeFloor(250, false, 'EUR')).toBe('€250')
  })
})

describe('the owner ledger’s money model — one group per currency', () => {
  const claim = (o: Partial<ProcurementCredit>): ProcurementCredit =>
    ({
      id: 'c',
      restaurant_id: 'r',
      provider_id: null,
      order_id: null,
      document_id: null,
      state: 'credited',
      claimed_amount: 0,
      credited_amount: 0,
      credit_document_id: 'memo',
      reason: null,
      notes: null,
      self_evidenced: false,
      opened_at: '2026-01-01T00:00:00.000Z',
      requested_at: null,
      promised_at: null,
      settled_at: null,
      ...o,
    }) as ProcurementCredit
  const figures = (recovered: number) => ({
    recovered,
    outstanding: 0,
    promised: 0,
    rejected: 0,
    openClaims: 0,
    oldestOpenDays: null,
    settlementRate: null,
  })
  // Mid-month, local time, so neither month is a boundary case.
  const now = new Date(2026, 9, 15, 12)

  it('sums settled money per claim currency, this month and last, never across them', () => {
    const t = trendByCurrencyOf(
      [
        claim({ currency: 'EUR', credited_amount: 90, settled_at: new Date(2026, 9, 2, 9).toISOString() }),
        claim({ currency: 'TRY', credited_amount: 250, settled_at: new Date(2026, 9, 3, 9).toISOString() }),
        claim({ currency: 'try', credited_amount: 100, settled_at: new Date(2026, 8, 20, 9).toISOString() }),
        claim({ currency: null, credited_amount: 7, settled_at: new Date(2026, 9, 4, 9).toISOString() }),
        claim({ currency: 'TRY', credited_amount: 999, settled_at: new Date(2026, 6, 1, 9).toISOString() }),
      ],
      now,
    )
    expect(t).toEqual({
      EUR: { thisMonth: 90, lastMonth: 0 },
      TRY: { thisMonth: 250, lastMonth: 100 },
      [CURRENCY_UNRECORDED]: { thisMonth: 7, lastMonth: 0 },
    })
  })

  it('keeps a month unknown when one of its claims has no readable credited amount', () => {
    const t = trendByCurrencyOf(
      [
        claim({ currency: 'EUR', credited_amount: 90, settled_at: new Date(2026, 9, 2, 9).toISOString() }),
        claim({ currency: 'EUR', credited_amount: null, settled_at: new Date(2026, 9, 5, 9).toISOString() }),
        claim({ currency: 'EUR', credited_amount: 40, settled_at: new Date(2026, 8, 5, 9).toISOString() }),
      ],
      now,
    )
    // Not 90: the second claim's money is unknown, so this month's sum is.
    expect(t).toEqual({ EUR: { thisMonth: null, lastMonth: 40 } })
  })

  it('makes one group per currency either read carries, and none for an empty ledger', () => {
    const stats = {
      ...figures(340),
      selfEvidencedOpen: 0,
      byCurrency: { EUR: figures(90), TRY: figures(250) },
    } as CreditStats
    const groups = recoveryGroups(stats, { TRY: { thisMonth: 250, lastMonth: 0 } })
    expect(groups.map((g) => g.code)).toEqual(['EUR', 'TRY'])
    expect(groups[0]).toEqual({ code: 'EUR', figures: figures(90), trend: { thisMonth: 0, lastMonth: 0 } })
    expect(groups[1].figures?.recovered).toBe(250)
    // No group is ever the combined 340.
    expect(groups.some((g) => g.figures?.recovered === 340)).toBe(false)

    expect(recoveryGroups({ ...figures(0), selfEvidencedOpen: 0, byCurrency: {} } as CreditStats, {})).toEqual([])
  })

  it('keeps the trend unknown while the settled list is unread', () => {
    const stats = { ...figures(90), selfEvidencedOpen: 0, byCurrency: { EUR: figures(90) } } as CreditStats
    expect(recoveryGroups(stats, null)).toEqual([{ code: 'EUR', figures: figures(90), trend: null }])
  })

  it('shows an older gateway’s combined figures once, with no currency and no trend', () => {
    const stats = { ...figures(900), selfEvidencedOpen: 0 } as CreditStats
    expect(recoveryGroups(stats, { EUR: { thisMonth: 1, lastMonth: 0 } })).toEqual([
      { code: null, figures: stats, trend: null },
    ])
  })
})
