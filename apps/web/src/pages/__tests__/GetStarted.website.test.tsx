/** DD-r108-55: the first menu is read from the house's own website. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { navigate, createFirstHouse, importMenuFromUrl, nextPlace, maps } = vi.hoisted(() => ({
  maps: { on: true },
  navigate: vi.fn(),
  createFirstHouse: vi.fn(),
  importMenuFromUrl: vi.fn(),
  nextPlace: { current: null as Record<string, unknown> | null },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { name: 'Selin Kaya', restaurantId: '', role: null, emailVerified: true },
    loading: false,
    createFirstHouse,
    signInWithSession: vi.fn(),
  }),
}))
vi.mock('../../services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/client')>()),
  apiClient: { patch: vi.fn().mockResolvedValue({}) },
}))
vi.mock('../../services/api/menus', () => ({ importMenu: vi.fn(), importMenuFromUrl }))
vi.mock('../../lib/browserTimezone', () => ({ getBrowserTimezone: () => 'Europe/Istanbul' }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../lib/googleMaps', () => ({ isMapsConfigured: () => maps.on }))
vi.mock('../../components/ui/PlacesAutocomplete', () => ({
  warmPlaces: vi.fn(),
  PlacesAutocomplete: (props: { onPlaceSelect: (place: unknown) => void }) => (
    <button type="button" onClick={() => props.onPlaceSelect(nextPlace.current)}>
      Pick the place
    </button>
  ),
}))
vi.mock('../../components/ui/CountryCombobox', () => ({
  CountryCombobox: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <input aria-label="Country" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))
vi.mock('../../components/onboarding/MenuCsvUpload', () => ({ MenuCsvUpload: () => null }))
vi.mock('../../components/onboarding/MenuScanUpload', () => ({ MenuScanUpload: () => null }))
vi.mock('../../components/onboarding/MenuManualEntry', () => ({ MenuManualEntry: () => null }))

import GetStarted from '../GetStarted'
import { httpsAddress } from '../../components/onboarding/MenuFromWebsite'

const place = (over: Record<string, unknown>) => ({
  placeName: 'Meyhane',
  streetAddress: '1 House Street',
  city: 'Istanbul',
  stateProvince: '',
  postalCode: '',
  country: 'Türkiye',
  countryCode: 'TR',
  neighborhood: '',
  latitude: 41,
  longitude: 29,
  googlePlaceId: 'place-1',
  phone: '+90 212 555 0000',
  utcOffsetMinutes: 180,
  ...over,
})

async function openTheMenuStep(website?: string | null) {
  nextPlace.current = place(website === undefined ? {} : { websiteUri: website })
  render(<MemoryRouter><GetStarted /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Pick the place' }))
  fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
  await screen.findByRole('heading', { name: 'Your menu' })
}

const offer = () => screen.queryByRole('button', { name: /^Read the menu from / })

beforeEach(() => {
  vi.clearAllMocks()
  maps.on = true
  sessionStorage.clear()
  createFirstHouse.mockResolvedValue({ detailsLoaded: true })
})

describe('GetStarted: the menu from the house website', () => {
  it('a place with no website makes no offer until an address is typed', async () => {
    await openTheMenuStep(null)
    expect(offer()).toBeNull()
    fireEvent.change(screen.getByLabelText('Or the menu on your website'), { target: { value: 'meyhane.com.tr/menu' } })
    expect(offer()).toHaveTextContent('Read the menu from meyhane.com.tr')
  })

  it('a place with a website offers it by its domain, above the drop zone', async () => {
    await openTheMenuStep('http://www.meyhane.com.tr/')
    const button = offer()!
    expect(button).toHaveTextContent('Read the menu from meyhane.com.tr')
    const drop = screen.getByText('Drop the menu here')
    expect(button.compareDocumentPosition(drop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a 422 says its own words and stays on the step', async () => {
    const sentence = 'That page shows its menu only in a browser. Send a photo or a PDF instead.'
    importMenuFromUrl.mockRejectedValue({ response: { status: 422, data: { message: sentence } } })
    await openTheMenuStep('https://meyhane.com.tr')
    fireEvent.click(offer()!)
    expect(await screen.findByText(sentence)).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalledWith('/house/menu', expect.anything())
  })

  it('a fault never says the server’s words', async () => {
    importMenuFromUrl.mockRejectedValue({ response: { status: 500, data: { message: 'Internal server error' } } })
    await openTheMenuStep('https://meyhane.com.tr')
    fireEvent.click(offer()!)
    expect(await screen.findByText('We could not read that page. Send a photo or a PDF instead.')).toBeInTheDocument()
    expect(screen.queryByText('Internal server error')).toBeNull()
  })

  it('a read goes to /house/menu like a photo, asked as https', async () => {
    importMenuFromUrl.mockResolvedValue({ success: true, menuId: 'm-1', linesExtracted: 12, items: [] })
    await openTheMenuStep('http://meyhane.com.tr/menu')
    fireEvent.click(offer()!)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/house/menu', { replace: true }))
    expect(importMenuFromUrl).toHaveBeenCalledWith('https://meyhane.com.tr/menu')
  })

  it('with Maps off the typed address still reads', async () => {
    maps.on = false
    importMenuFromUrl.mockResolvedValue({ success: true, menuId: 'm-1', linesExtracted: 3, items: [] })
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'Meyhane' } })
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '1 House Street' } })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Istanbul' } })
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'Türkiye' } })
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(offer()).toBeNull()
    fireEvent.change(screen.getByLabelText('Or the menu on your website'), { target: { value: 'https://meyhane.com.tr' } })
    fireEvent.click(offer()!)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/house/menu', { replace: true }))
  })
})

describe('httpsAddress', () => {
  it('asks https only, never another scheme or a credential', () => {
    expect(httpsAddress('ftp://meyhane.com.tr')).toBeNull()
    expect(httpsAddress('javascript:alert(1)')).toBeNull()
    expect(httpsAddress('https://user:pw@meyhane.com.tr')).toBeNull()
    expect(httpsAddress('localhost')).toBeNull()
    expect(httpsAddress('')).toBeNull()
    expect(httpsAddress('meyhane.com.tr')?.url).toBe('https://meyhane.com.tr/')
  })
})
