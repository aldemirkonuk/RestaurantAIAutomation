/**
 * r36 onboarding gap 6: /get-started lets a house leave its money "Not set
 * yet". An invoice that names no money and comes with no order is then
 * withheld (invoice-currency.ts, `filed.kind === "none"`), so the first
 * paper a new house checks puts no cost on. /house says so, beside the
 * invoice row, and only when the read answered that no money is set.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { houseCurrency, getOnboardingProgress } = vi.hoisted(() => ({
  houseCurrency: vi.fn(),
  getOnboardingProgress: vi.fn(),
}))

vi.mock('../../services/api/settings', () => ({ settingsApi: { houseCurrency } }))
vi.mock('../../services/api/vendors', () => ({ addCustomProvider: vi.fn() }))
vi.mock('../../services/api/menus', () => ({ updateOnboardingProgress: vi.fn(), getOnboardingProgress }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))

import HouseContents from '../HouseContents'

const money = (over: Record<string, unknown>) => ({
  restaurantId: 'r1',
  code: null,
  country: 'TR',
  readable: true,
  reason: null,
  statedAt: null,
  ...over,
})

const page = () => render(<MemoryRouter><HouseContents /></MemoryRouter>)
const SAID = 'The house’s money is not set yet. An invoice that names none, and comes with no order, waits for it before its costs go on.'

beforeEach(() => {
  vi.clearAllMocks()
  getOnboardingProgress.mockResolvedValue(null)
  sessionStorage.clear()
})

describe('/house says invoice costs wait for the house’s money', () => {
  it('says it, with the way to Settings, when no money is set', async () => {
    houseCurrency.mockResolvedValue(money({ code: null }))
    page()
    const line = await screen.findByTestId('house-money-unset')
    expect(line).toHaveTextContent(SAID)
    expect(screen.getByRole('link', { name: 'Set the money in Settings' })).toHaveAttribute('href', '/settings?tab=currency')
  })

  it('says nothing when the money is set', async () => {
    houseCurrency.mockResolvedValue(money({ code: 'TRY' }))
    page()
    await waitFor(() => expect(houseCurrency).toHaveBeenCalledTimes(1))
    await new Promise((settle) => setTimeout(settle, 0))
    expect(screen.queryByTestId('house-money-unset')).toBeNull()
    expect(screen.queryByText(/money is not set/)).toBeNull()
  })

  it('never takes a read that failed for "not set"', async () => {
    houseCurrency.mockResolvedValue(money({ code: null, readable: false, reason: 'restaurants read failed' }))
    page()
    await waitFor(() => expect(houseCurrency).toHaveBeenCalledTimes(1))
    await new Promise((settle) => setTimeout(settle, 0))
    expect(screen.queryByTestId('house-money-unset')).toBeNull()
  })

  it('says nothing when the read is refused', async () => {
    houseCurrency.mockRejectedValue(new Error('Network Error'))
    page()
    await waitFor(() => expect(houseCurrency).toHaveBeenCalledTimes(1))
    await new Promise((settle) => setTimeout(settle, 0))
    expect(screen.queryByTestId('house-money-unset')).toBeNull()
  })

  it('keeps the invoice row and its way to Receipts either way', async () => {
    houseCurrency.mockResolvedValue(money({ code: null }))
    page()
    await screen.findByTestId('house-money-unset')
    expect(screen.getByText('Next · for your costs')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Receipts' })).toHaveAttribute('href', '/receipts')
  })
})
