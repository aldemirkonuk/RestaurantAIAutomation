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
  sources: {
    data: undefined as
      | {
          messages: Array<Record<string, unknown>>
          contacts: Array<{ id: string; name: string | null; email: string | null; role: string | null }>
        }
      | undefined,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  sourcesAskedFor: [] as Array<string | null>,
}))

const attachPaper = vi.hoisted(() => vi.fn())

vi.mock('./useVendorPricesNextData', () => ({
  useRecordPrice: () => ({ mutate, isPending: false, isError: false, error: null, reset: vi.fn() }),
  useProviderUsualCurrency: () => mock.usualCurrency,
  useObservationSources: (providerId: string | null) => {
    mock.sourcesAskedFor.push(providerId)
    return mock.sources
  },
}))

vi.mock('../../../services/api/vendorIntel', async (orig) => ({
  ...(await orig<typeof import('../../../services/api/vendorIntel')>()),
  attachPaper,
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
  attachPaper.mockReset()
  mock.providers = []
  mock.usualCurrency = { data: undefined, isLoading: false }
  mock.sources = { data: undefined, isLoading: false, isError: false, error: null }
  mock.sourcesAskedFor = []
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

describe('RecordPriceForm — fork 6(a): the paper, the message and the person (ADR 0160 §112)', () => {
  const DOC = '66666666-6666-4666-8666-666666666666'

  function fillAll(vendor = 'Empire Merchants') {
    fillRequiredFieldsExceptCurrency(vendor)
    fireEvent.change(screen.getByLabelText(/Currency/), { target: { value: 'eur' } })
  }

  it('uploads the attached paper first and records the price with the id the document door returned', async () => {
    attachPaper.mockResolvedValue({ documentId: DOC, duplicate: false })
    mock.providers = [{ id: 'prov-1', name: 'Empire Merchants' }]
    mock.sources = { data: { messages: [], contacts: [] }, isLoading: false, isError: false, error: null }
    render(<RecordPriceForm open onClose={vi.fn()} wineId="wine-1" productName="Chablis" />)
    fillAll()
    const file = new File(['%PDF-1.4'], 'quote.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText(/Attach the paper/), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: /record this price/i }))
    await waitFor(() => expect(mutate).toHaveBeenCalled())
    expect(attachPaper).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'quote.pdf', mimeType: 'application/pdf', providerId: 'prov-1' }),
    )
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ documentId: DOC }), expect.anything())
  })

  it('records nothing when the paper did not arrive, and says so', async () => {
    attachPaper.mockRejectedValue(new Error('The paper was not stored'))
    render(<RecordPriceForm open onClose={vi.fn()} wineId="wine-1" productName="Chablis" />)
    fillAll('Someone Not On File')
    fireEvent.change(screen.getByLabelText(/Attach the paper/), {
      target: { files: [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: /record this price/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not stored/))
    expect(mutate).not.toHaveBeenCalled()
  })

  it("offers this house's messages and contacts only once the vendor is one of its rows, and sends the picks", () => {
    render(<RecordPriceForm open onClose={vi.fn()} wineId="wine-1" productName="Chablis" />)
    fillAll('Someone Not On File')
    expect(screen.queryByLabelText('The message it came from')).toBeNull()
    expect(mock.sourcesAskedFor.every((id) => id === null)).toBe(true)
  })

  it('sends the message and person picked for a matched vendor', () => {
    mock.providers = [{ id: 'prov-1', name: 'Empire Merchants' }]
    mock.sources = {
      data: {
        messages: [
          { id: 'msg-1', channel: 'whatsapp', direction: 'inbound', at: '2026-09-20T09:00:00Z', subject: null, excerpt: '28.50 on three cases', textDeletedAt: null, orderId: null },
        ],
        contacts: [{ id: 'contact-1', name: 'Ayşe Demir', email: null, role: 'Sales rep' }],
      },
      isLoading: false,
      isError: false,
      error: null,
    }
    render(<RecordPriceForm open onClose={vi.fn()} wineId="wine-1" productName="Chablis" />)
    fillAll()
    expect(mock.sourcesAskedFor).toContain('prov-1')
    fireEvent.change(screen.getByLabelText('The message it came from'), { target: { value: 'msg-1' } })
    fireEvent.change(screen.getByLabelText('Who gave the price'), { target: { value: 'contact-1' } })
    expect(screen.getByRole('option', { name: /28.50 on three cases/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ayşe Demir, Sales rep' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /record this price/i }))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ conversationMessageId: 'msg-1', contactId: 'contact-1', documentId: undefined }),
      expect.anything(),
    )
    expect(attachPaper).not.toHaveBeenCalled()
  })

  it('says a failed read of the messages is a failed read, and still lets the price be recorded', () => {
    mock.providers = [{ id: 'prov-1', name: 'Empire Merchants' }]
    mock.sources = { data: undefined, isLoading: false, isError: true, error: new Error('gateway down') }
    render(<RecordPriceForm open onClose={vi.fn()} wineId="wine-1" productName="Chablis" />)
    fillAll()
    expect(screen.getByText(/messages and contacts could not be read/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /record this price/i })).toBeEnabled()
  })
})
