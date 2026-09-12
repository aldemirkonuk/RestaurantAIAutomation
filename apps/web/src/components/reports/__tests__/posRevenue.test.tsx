import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChannelDonutChart } from '../molecules/ChannelDonutChart'
import { LaborSpendOverlay } from '../molecules/LaborSpendOverlay'
import { PurchasedWinesTable } from '../molecules/PurchasedWinesTable'

/**
 * OD-85 — the four Reports surfaces that had no sales figure to read.
 *
 * The single rule under test: a restaurant with no POS connected must be TOLD
 * that, on every surface. Never a zero, never an estimate dressed as a fact.
 * A chart that renders $0 of revenue is making a claim about the business; a
 * chart that says "connect a POS" is making a claim about our data, which is
 * the only one we can support. ADR 0020.
 */

vi.mock('../../../services/api/client', () => ({
  apiClient: { get: vi.fn() },
  getErrorMessage: (e: any) => String(e?.message ?? e),
}))

describe('getPosRevenue (shared client)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls the guarded gateway route through apiClient, not fetch', async () => {
    const { apiClient } = await import('../../../services/api/client')
    const { getPosRevenue } = await import('../../../services/api/analytics')
    ;(apiClient.get as any).mockResolvedValue({
      data: {
        restaurantId: 'r1',
        from: '2026-07-28',
        to: '2026-08-26',
        days: 30,
        posConnected: true,
        revenue: 4200,
        checkCount: 61,
        dailySeries: [{ date: '2026-08-26', revenue: 4200 }],
        consumption: [],
      },
    })

    const result = await getPosRevenue('r1', 30)

    expect(apiClient.get).toHaveBeenCalledWith('/analytics/pos-revenue/r1', {
      params: { days: 30 },
    })
    expect(result.revenue).toBe(4200)
  })

  it('never turns a missing revenue into a zero', async () => {
    const { apiClient } = await import('../../../services/api/client')
    const { getPosRevenue } = await import('../../../services/api/analytics')
    ;(apiClient.get as any).mockResolvedValue({
      data: { posConnected: false, revenue: null, checkCount: null },
    })

    const result = await getPosRevenue('r1')

    expect(result.revenue).toBeNull()
    expect(result.posConnected).toBe(false)
    expect(result.consumption).toEqual([])
    expect(result.dailySeries).toEqual([])
  })
})

describe('COGS Ratio tile', () => {
  const metrics = {
    totalSpent: 3000,
    totalBottlesPurchased: 100,
    totalOrders: 10,
    avgCostPerBottle: 30,
  }

  it('says the POS is missing instead of printing a ratio', () => {
    render(
      <PurchasedWinesTable
        purchaseData={[]}
        metrics={metrics}
        posRevenue={null}
        isOpen
        onToggle={() => {}}
      />,
    )
    expect(
      screen.getByText(/needs sales revenue from a connected pos/i),
    ).toBeInTheDocument()
  })

  it('computes cost ÷ real POS revenue once revenue is wired', () => {
    render(
      <PurchasedWinesTable
        purchaseData={[]}
        metrics={metrics}
        posRevenue={12000}
        isOpen
        onToggle={() => {}}
      />,
    )
    // 3000 / 12000 = 25.0%
    expect(screen.getByText('25.0%')).toBeInTheDocument()
  })
})

describe('ChannelDonutChart', () => {
  it('renders no slices and no figures when the POS is not connected', () => {
    render(<ChannelDonutChart posRevenue={null} posConnected={false} />)

    expect(screen.getByText(/no pos connected/i)).toBeInTheDocument()
    // The old version sliced vendor SPEND into service channels and showed
    // percentages regardless. Neither may appear without sales data.
    expect(screen.queryByText('54%')).not.toBeInTheDocument()
  })

  it('keeps the split labelled as an estimate even when POS revenue is real', () => {
    render(<ChannelDonutChart posRevenue={10000} posConnected />)

    // `pos_checks` carries no channel/service-type column, so the split cannot
    // be measured. It stays an estimate, said out loud, always.
    expect(screen.getByText(/estimated, not measured/i)).toBeInTheDocument()
    expect(screen.getByText(/Dine-in \(est\.\)/i)).toBeInTheDocument()
  })
})

describe('LaborSpendOverlay', () => {
  const days = [
    { date: 'Aug 1', spend: 100 },
    { date: 'Aug 2', spend: 200 },
  ]

  it('drops the labour estimate entirely when there is no POS revenue to base it on', () => {
    render(
      <LaborSpendOverlay
        purchaseDayData={days}
        posRevenueByDate={{}}
        posConnected={false}
      />,
    )

    // Labour is ~a share of SALES, not of purchasing. With no revenue there is
    // no defensible base, so the line is absent rather than guessed off spend.
    expect(screen.queryByText(/^Labor/)).not.toBeInTheDocument()
    expect(screen.getByText(/connect a pos/i)).toBeInTheDocument()
  })

  it('plots real sales revenue and labels the labour line as an estimate', () => {
    render(
      <LaborSpendOverlay
        purchaseDayData={days}
        posRevenueByDate={{ 'Aug 1': 500, 'Aug 2': 700 }}
        posConnected
      />,
    )

    expect(screen.getByText(/sales revenue/i)).toBeInTheDocument()
    expect(screen.getByText(/labor \(est/i)).toBeInTheDocument()
  })
})
