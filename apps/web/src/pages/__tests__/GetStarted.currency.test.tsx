/**
 * r28 onboarding gaps 4 and 9: /get-started asks the house's money.
 *
 * The country offers a default (ADR 0117 Q25: "ask each house in onboarding,
 * set a default from location"); the owner can change it, leave it unset, or
 * choose one where the country gives none. An owner sent back to the menu step
 * holds no country on the page, so the money is read from the house.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { navigate, createFirstHouse, patch, placeProps, nextPlace, browserZone, maps, who, houseCurrency } = vi.hoisted(() => ({
  who: { current: { name: 'Selin Kaya', restaurantId: '', role: null as string | null, emailVerified: true } },
  houseCurrency: vi.fn(),
  maps: { on: true },
  navigate: vi.fn(),
  createFirstHouse: vi.fn(),
  patch: vi.fn(),
  placeProps: { current: null as Record<string, unknown> | null },
  nextPlace: { current: null as Record<string, unknown> | null },
  browserZone: { current: 'America/New_York' as string | undefined },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: who.current,
    loading: false,
    createFirstHouse,
    signInWithSession: vi.fn(),
  }),
}))
vi.mock('../../services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/client')>()),
  apiClient: { patch },
}))
vi.mock('../../services/api/menus', () => ({ importMenu: vi.fn() }))
vi.mock('../../services/api/settings', () => ({ settingsApi: { houseCurrency } }))
vi.mock('../../lib/browserTimezone', () => ({ getBrowserTimezone: () => browserZone.current }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../lib/googleMaps', () => ({ isMapsConfigured: () => maps.on }))
vi.mock('../../components/ui/PlacesAutocomplete', () => ({
  PlacesAutocomplete: (props: { onPlaceSelect: (place: unknown) => void }) => {
    placeProps.current = props as unknown as Record<string, unknown>
    return (
      <button type="button" onClick={() => props.onPlaceSelect(nextPlace.current)}>
        Pick the place
      </button>
    )
  },
}))
vi.mock('../../components/ui/CountryCombobox', () => ({
  CountryCombobox: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <label>
      Country: {value}
      <input aria-label="Country" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  ),
}))
vi.mock('../../components/onboarding/MenuCsvUpload', () => ({ MenuCsvUpload: () => null }))
vi.mock('../../components/onboarding/MenuScanUpload', () => ({ MenuScanUpload: () => null }))
vi.mock('../../components/onboarding/MenuManualEntry', () => ({
  MenuManualEntry: ({ currency }: { currency?: string | null }) => <output data-testid="typed-money">{currency ?? 'none'}</output>,
}))

import GetStarted from '../GetStarted'

const page = () => <MemoryRouter><GetStarted /></MemoryRouter>

beforeEach(() => {
  vi.clearAllMocks()
  maps.on = false
  browserZone.current = 'Europe/Istanbul'
  who.current = { name: 'Selin Kaya', restaurantId: '', role: null, emailVerified: true }
  sessionStorage.clear()
  createFirstHouse.mockResolvedValue({ detailsLoaded: true })
  patch.mockResolvedValue({})
  houseCurrency.mockResolvedValue({ restaurantId: 'r1', code: 'TRY', country: 'TR', readable: true, reason: null, statedAt: null })
})

const fill = (country: string) => {
  fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'Meyhane' } })
  fireEvent.change(screen.getByLabelText('Address'), { target: { value: '1 House Street' } })
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Istanbul' } })
  fireEvent.change(screen.getByLabelText('Country'), { target: { value: country } })
}
const money = () => screen.getByLabelText("The house's money") as HTMLSelectElement
const open = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
  await screen.findByRole('heading', { name: 'Your menu' })
}

describe('GetStarted: the house names its money', () => {
  // r36 onboarding gaps 6 and 11: an unset money stops the costs of an
  // invoice that names none; the choice says so where it is made, and the
  // place line no longer says the address sets the money.
  describe('what an unset money does to invoice costs', () => {
    const COST = 'Until it is set, an invoice that names no money waits for it before its costs go on.'

    it('says it when the owner leaves a known money unset', () => {
      render(page())
      fill('Türkiye')
      expect(screen.queryByTestId('money-unset-cost')).not.toBeInTheDocument()
      fireEvent.change(money(), { target: { value: '' } })
      expect(screen.getByTestId('money-unset-cost')).toHaveTextContent(COST)
      fireEvent.change(money(), { target: { value: 'TRY' } })
      expect(screen.queryByTestId('money-unset-cost')).not.toBeInTheDocument()
    })

    it('says it where the country gives no money, until one is chosen', () => {
      render(page())
      fill('Zimbabwe')
      expect(screen.getByTestId('money-unset-cost')).toHaveTextContent(COST)
      fireEvent.change(money(), { target: { value: 'USD' } })
      expect(screen.queryByTestId('money-unset-cost')).not.toBeInTheDocument()
    })

    it('says nothing before a country is chosen', () => {
      render(page())
      expect(screen.queryByTestId('money-unset-cost')).not.toBeInTheDocument()
    })

    it('says the place suggests the money, never that it sets it', () => {
      render(page())
      expect(screen.getByText("Its country sets the house's clock and suggests its money.")).toBeInTheDocument()
      expect(screen.queryByText(/reporting currency/)).not.toBeInTheDocument()
    })

    it('names the menu step "Next", not "One last step"', async () => {
      render(page())
      fill('Türkiye')
      await open()
      expect(screen.getByText('Next')).toBeInTheDocument()
      expect(screen.queryByText('One last step')).not.toBeInTheDocument()
    })
  })

  it('offers the country’s currency, says where it came from, and records it', async () => {
    render(page())
    fill('Türkiye')
    expect(money().value).toBe('TRY')
    expect(screen.getByText('(from the country)')).toBeInTheDocument()
    await open()
    expect(createFirstHouse).toHaveBeenCalledWith(expect.objectContaining({ currency: 'TRY' }))
  })

  it('records the money the owner changes it to', async () => {
    render(page())
    fill('Türkiye')
    fireEvent.change(money(), { target: { value: 'EUR' } })
    expect(money().value).toBe('EUR')
    expect(screen.queryByText('(from the country)')).not.toBeInTheDocument()
    await open()
    expect(createFirstHouse).toHaveBeenCalledWith(expect.objectContaining({ currency: 'EUR' }))
  })

  it('records nothing when the owner leaves it unset', async () => {
    render(page())
    fill('Türkiye')
    fireEvent.change(money(), { target: { value: '' } })
    // The country's money is known; it is only not chosen, so nothing says otherwise.
    expect(screen.queryByText(/Not known from the country/)).not.toBeInTheDocument()
    await open()
    expect(createFirstHouse).toHaveBeenCalledWith(expect.objectContaining({ currency: undefined }))
  })

  it('undoes a pick when the country changes, as the clock’s is', () => {
    render(page())
    fill('Türkiye')
    fireEvent.change(money(), { target: { value: 'EUR' } })
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'Japan' } })
    expect(money().value).toBe('JPY')
    expect(screen.getByText('(from the country)')).toBeInTheDocument()
  })

  it('asks where the country gives no default, and records the choice', async () => {
    render(page())
    fill('Zimbabwe')
    expect(money().value).toBe('')
    expect(screen.getByRole('option', { name: 'Choose…' })).toBeInTheDocument()
    expect(screen.getByText(/Not known from the country: choose it, or set it later in Settings › Currency\./)).toBeInTheDocument()
    fireEvent.change(money(), { target: { value: 'USD' } })
    expect(screen.queryByText(/Not known from the country/)).not.toBeInTheDocument()
    await open()
    expect(createFirstHouse).toHaveBeenCalledWith(expect.objectContaining({ currency: 'USD' }))
  })

  it('names no missing money before a country is chosen', () => {
    render(page())
    expect(money().value).toBe('')
    expect(screen.queryByText(/Not known from the country/)).not.toBeInTheDocument()
  })

  it('gives the typed lines the money chosen on this visit', async () => {
    render(page())
    fill('Türkiye')
    fireEvent.change(money(), { target: { value: 'GBP' } })
    await open()
    fireEvent.click(screen.getByRole('button', { name: /Type a few lines/ }))
    expect(screen.getByTestId('typed-money')).toHaveTextContent('GBP')
    expect(houseCurrency).not.toHaveBeenCalled()
  })
})

describe('GetStarted: an owner sent back to the menu step (gap 9)', () => {
  it('reads the house’s money, so the typed lines keep it', async () => {
    who.current = { name: 'Selin Kaya', restaurantId: 'r1', role: 'owner', emailVerified: true }
    render(page())
    await screen.findByRole('heading', { name: 'Your menu' })
    fireEvent.click(screen.getByRole('button', { name: /Type a few lines/ }))
    await waitFor(() => expect(screen.getByTestId('typed-money')).toHaveTextContent('TRY'))
    expect(houseCurrency).toHaveBeenCalledTimes(1)
  })

  it('guesses no money when the house’s money cannot be read', async () => {
    who.current = { name: 'Selin Kaya', restaurantId: 'r1', role: 'owner', emailVerified: true }
    houseCurrency.mockRejectedValue(new Error('Network Error'))
    render(page())
    await screen.findByRole('heading', { name: 'Your menu' })
    fireEvent.click(screen.getByRole('button', { name: /Type a few lines/ }))
    await waitFor(() => expect(houseCurrency).toHaveBeenCalled())
    expect(screen.getByTestId('typed-money')).toHaveTextContent('none')
  })

  it('takes no money from a read the gateway says it could not vouch for', async () => {
    who.current = { name: 'Selin Kaya', restaurantId: 'r1', role: 'owner', emailVerified: true }
    houseCurrency.mockResolvedValue({ restaurantId: 'r1', code: 'USD', country: 'TR', readable: false, reason: 'read failed', statedAt: null })
    render(page())
    await screen.findByRole('heading', { name: 'Your menu' })
    fireEvent.click(screen.getByRole('button', { name: /Type a few lines/ }))
    await waitFor(() => expect(houseCurrency).toHaveBeenCalled())
    expect(screen.getByTestId('typed-money')).toHaveTextContent('none')
  })

  it('guesses no money when the house has none recorded', async () => {
    who.current = { name: 'Selin Kaya', restaurantId: 'r1', role: 'owner', emailVerified: true }
    houseCurrency.mockResolvedValue({ restaurantId: 'r1', code: null, country: 'ZW', readable: true, reason: null, statedAt: null })
    render(page())
    await screen.findByRole('heading', { name: 'Your menu' })
    fireEvent.click(screen.getByRole('button', { name: /Type a few lines/ }))
    await waitFor(() => expect(houseCurrency).toHaveBeenCalled())
    expect(screen.getByTestId('typed-money')).toHaveTextContent('none')
  })
})
