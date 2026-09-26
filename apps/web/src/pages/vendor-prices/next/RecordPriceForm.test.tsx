/**
 * "Add a price you were quoted" — currency is fork 2(c) (ADR 0160 §112,
 * README `354-383`): the vendor's usual currency where a matching provider
 * has stated one, else required with no default. Never a guess, never
 * overwriting what a person already typed.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mutate = vi.hoisted(() => vi.fn())

const mock = vi.hoisted(() => ({
  providers: [] as Array<{ id: string; name: string }>,
  usualCurrency: { data: undefined as { code: string | null } | undefined, isLoading: false },
}))

vi.mock('./useVendorPricesNextData', () => ({
  useRecordPrice: () => ({ mutate, isPending: false, isError: false, error: null, reset: vi.fn() }),
  useProviderUsualCurrency: () => mock.usualCurrency,
}))

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-1' }),
}))

vi.mock('../../../hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: mock.providers, isLoading: false, isError: false }),
}))

import { RecordPriceForm } from './RecordPriceForm'

function fillRequiredFieldsExceptCurrency(vendor = 'Empire Merchants') {
  fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: vendor } })
  fireEvent.change(screen.getByLabelText('Price'), { target: { value: '30' } })
}

beforeEach(() => {
  mutate.mockClear()
  mock.providers = []
  mock.usualCurrency = { data: undefined, isLoading: false }
})

describe('RecordPriceForm — currency required, no default when no provider states one (fork 2, direction C\'s (a) as the floor)', () => {
  it('keeps submit disabled with vendor and price filled but no currency', () => {
    render(<RecordPriceForm open onClose={vi.fn()} wineId="wine-1" productName="Chablis" />)
    fillRequiredFieldsExceptCurrency()
    expect(screen.getByRole('button', { name: /record this price/i })).toBeDisabled()
  })

  it('enables submit once a currency is entered, and sends it uppercased', () => {
    render(<RecordPriceForm open onClose={vi.fn()} wineId="wine-1" productName="Chablis" />)
    fillRequiredFieldsExceptCurrency()
    fireEvent.change(screen.getByLabelText(/Currency/), { target: { value: 'try' } })
    const submit = screen.getByRole('button', { name: /record this price/i })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ masterWineId: 'wine-1', currency: 'TRY', vendorName: 'Empire Merchants', price: 30 }),
      expect.anything(),
    )
  })

  it('never defaults to USD — an empty currency field is never silently filled', () => {
    render(<RecordPriceForm open onClose={vi.fn()} wineId="wine-1" productName="Chablis" />)
    fillRequiredFieldsExceptCurrency()
    expect(screen.getByLabelText(/Currency/)).toHaveValue('')
  })

  it('says "required, no default" when the typed vendor matches no known provider', () => {
    render(<RecordPriceForm open onClose={vi.fn()} wineId="wine-1" productName="Chablis" />)
    fillRequiredFieldsExceptCurrency('Someone Not On File')
    expect(screen.getByText(/required, no default/)).toBeInTheDocument()
  })
})

describe('RecordPriceForm — fork 2(c): the vendor\'s usual currency where stated', () => {
  it('defaults the currency once a matching provider\'s stated usual currency arrives, and says so', async () => {
    mock.providers = [{ id: 'prov-1', name: 'Empire Merchants' }]
    render(<RecordPriceForm open onClose={vi.fn()} wineId="wine-1" productName="Chablis" />)
    fillRequiredFieldsExceptCurrency('Empire Merchants')
    // Simulate the query resolving after the vendor name matched a provider,
    // then force a real re-render (a no-op change would bail out under
    // React's Object.is check and prove nothing) so the mock is read again.
    mock.usualCurrency = { data: { code: 'TRY' }, isLoading: false }
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '31' } })
    await waitFor(() => expect(screen.getByLabelText(/Currency/)).toHaveValue('TRY'))
    expect(screen.getByText(/defaulted from Empire Merchants.s stated currency/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /record this price/i })).toBeEnabled()
  })

  it('never overwrites a currency the person already typed, once they have touched the field', async () => {
    mock.providers = [{ id: 'prov-1', name: 'Empire Merchants' }]
    render(<RecordPriceForm open onClose={vi.fn()} wineId="wine-1" productName="Chablis" />)
    fillRequiredFieldsExceptCurrency('Empire Merchants')
    fireEvent.change(screen.getByLabelText(/Currency/), { target: { value: 'usd' } })
    mock.usualCurrency = { data: { code: 'TRY' }, isLoading: false }
    // Force the same real re-render as above; the typed USD must survive it.
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '31' } })
    await waitFor(() => expect(screen.getByLabelText('Price')).toHaveValue(31))
    expect(screen.getByLabelText(/Currency/)).toHaveValue('USD')
  })

  it('sends the matched provider\'s id alongside the free-typed vendor name', () => {
    mock.providers = [{ id: 'prov-1', name: 'Empire Merchants' }]
    render(<RecordPriceForm open onClose={vi.fn()} wineId="wine-1" productName="Chablis" />)
    fillRequiredFieldsExceptCurrency('Empire Merchants')
    fireEvent.change(screen.getByLabelText(/Currency/), { target: { value: 'usd' } })
    fireEvent.click(screen.getByRole('button', { name: /record this price/i }))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'prov-1', vendorName: 'Empire Merchants' }),
      expect.anything(),
    )
  })

  it('clears a stale default when the vendor changes away from the provider that supplied it, rather than leaving it orphaned', async () => {
    mock.providers = [{ id: 'prov-1', name: 'Empire Merchants' }]
    render(<RecordPriceForm open onClose={vi.fn()} wineId="wine-1" productName="Chablis" />)
    fillRequiredFieldsExceptCurrency('Empire Merchants')
    mock.usualCurrency = { data: { code: 'TRY' }, isLoading: false }
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '31' } })
    await waitFor(() => expect(screen.getByLabelText(/Currency/)).toHaveValue('TRY'))

    // Now type a name that matches no known provider — the mock's data does
    // not change (react-query would key a disabled query differently and
    // return no data), modelling that transition directly.
    mock.usualCurrency = { data: undefined, isLoading: false }
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'Someone Else Entirely' } })
    await waitFor(() => expect(screen.getByLabelText(/Currency/)).toHaveValue(''))
    expect(screen.getByText(/required, no default/)).toBeInTheDocument()
  })

  it('matches case-insensitively, and matches nothing (no providerId) for an unlisted vendor', () => {
    mock.providers = [{ id: 'prov-1', name: 'Empire Merchants' }]
    render(<RecordPriceForm open onClose={vi.fn()} wineId="wine-1" productName="Chablis" />)
    fillRequiredFieldsExceptCurrency('EMPIRE merchants')
    fireEvent.change(screen.getByLabelText(/Currency/), { target: { value: 'usd' } })
    fireEvent.click(screen.getByRole('button', { name: /record this price/i }))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'prov-1' }),
      expect.anything(),
    )
  })
})
