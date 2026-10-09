/**
 * The promotions panel reads `discount_value` in the shape the extractor
 * writes it — `percent` / `amount` / `free_shipping` / `currency`
 * (promotion-extractor.service.ts) — so an extracted promotion shows its
 * discount line (sim F-346). An older `{ value, type }` row still reads.
 * No "Saved" figure: the table stores no realized savings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProviderPromotionsPanel } from './ProviderPromotionsPanel'
import { fetchProviderPromotions, type Promotion } from '../../services/api/provider-intelligence'

vi.mock('../../services/api/provider-intelligence', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/provider-intelligence')>(
    '../../services/api/provider-intelligence',
  )
  return { ...actual, fetchProviderPromotions: vi.fn() }
})

function promo(id: string, discount_value: Record<string, unknown>, extra: Partial<Promotion> = {}): Promotion {
  return {
    id,
    provider_id: 'p1',
    name: `Offer ${id}`,
    promo_type: 'seasonal',
    discount_value,
    ...extra,
  } as Promotion
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ProviderPromotionsPanel providerId="p1" mode="provider" />
    </QueryClientProvider>,
  )
}

describe('ProviderPromotionsPanel discount line (F-346)', () => {
  beforeEach(() => vi.mocked(fetchProviderPromotions).mockReset())

  it('shows the discount the extractor wrote', async () => {
    vi.mocked(fetchProviderPromotions).mockResolvedValue([
      promo('a', { percent: 15 }),
      promo('b', { amount: 40, currency: 'EUR' }),
      promo('c', { free_shipping: true }),
    ])
    renderPanel()
    expect(await screen.findByText('15% off')).toBeInTheDocument()
    expect(screen.getByText(/40.*off/)).toBeInTheDocument()
    expect(screen.getByText(/€/)).toBeInTheDocument()
    expect(screen.getByText('Free delivery')).toBeInTheDocument()
  })

  it('still reads an older value/type row', async () => {
    vi.mocked(fetchProviderPromotions).mockResolvedValue([
      promo('a', { value: 10, type: 'percentage' }),
      promo('b', { value: 25, type: 'fixed' }),
    ])
    renderPanel()
    expect(await screen.findByText('10% off')).toBeInTheDocument()
    expect(screen.getByText('25 off')).toBeInTheDocument()
  })

  it('shows no invented savings figure', async () => {
    vi.mocked(fetchProviderPromotions).mockResolvedValue([
      promo('a', { percent: 15 }, { savings_realized: 99 }),
    ])
    renderPanel()
    await screen.findByText('15% off')
    expect(screen.queryByText(/Saved/)).not.toBeInTheDocument()
  })
})
