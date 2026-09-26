import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GetStarted from './GetStarted'
import HouseContents from './HouseContents'
import HouseMenu from './HouseMenu'

const { navigate, createFirstHouse, patch, addMenuItem, addCustomProvider } = vi.hoisted(() => ({
  navigate: vi.fn(),
  createFirstHouse: vi.fn(),
  patch: vi.fn(),
  addMenuItem: vi.fn(),
  addCustomProvider: vi.fn(),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { name: 'Selin Kaya', emailVerified: true },
    createFirstHouse,
  }),
}))
vi.mock('../services/api/client', () => ({
  apiClient: { patch },
}))
vi.mock('../components/brand/BrandMark', () => ({
  BrandMark: () => <span>Mudavym</span>,
}))
vi.mock('../components/ui/CountryCombobox', () => ({
  CountryCombobox: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange('Türkiye')}>Choose Türkiye</button>
  ),
}))
vi.mock('../lib/googleMaps', () => ({
  isMapsConfigured: () => true,
}))
vi.mock('../components/ui/PlacesAutocomplete', () => ({
  PlacesAutocomplete: ({
    onPlaceSelect,
    locationBias,
  }: {
    onPlaceSelect: (place: any) => void
    locationBias?: { latitude: number; longitude: number } | null
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onPlaceSelect({
            placeName: 'Meyhane',
            streetAddress: '1 House Street',
            city: 'Istanbul',
            country: 'Türkiye',
            stateProvince: 'Istanbul',
            postalCode: '34000',
            neighborhood: '',
            latitude: 41,
            longitude: 29,
            googlePlaceId: 'place-1',
          })
        }
      >
        Pick Meyhane
      </button>
      {locationBias && (
        <p>{`Places biased to ${locationBias.latitude},${locationBias.longitude}`}</p>
      )}
    </div>
  ),
}))
vi.mock('../components/onboarding/MenuCsvUpload', () => ({ MenuCsvUpload: () => null }))
vi.mock('../components/onboarding/MenuScanUpload', () => ({ MenuScanUpload: () => null }))
vi.mock('../components/onboarding/MenuManualEntry', () => ({ MenuManualEntry: () => null }))
vi.mock('../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../services/api/menus')>(
    '../services/api/menus',
  )
  return { ...actual, reviewMenuItem: vi.fn().mockResolvedValue({}), addMenuItem }
})
vi.mock('../services/api/vendors', () => ({
  addCustomProvider,
}))

beforeEach(() => {
  vi.clearAllMocks()
  patch.mockResolvedValue({})
  createFirstHouse.mockResolvedValue('house-1')
  addMenuItem.mockResolvedValue({
    menuItemId: 'added',
    submissionId: null,
    name: 'House Cider',
    producer: null,
    category: 'cider',
    vintage: null,
    region: null,
    grapeVariety: null,
    byGlassPrice: null,
    bottlePrice: null,
    rawText: null,
    matched: true,
    needsReview: false,
  })
  addCustomProvider.mockResolvedValue({ id: 'vendor-1', name: 'Suvla' })
  sessionStorage.clear()
})

describe('approved arrival flow', () => {
  it('creates the house on the restaurant screen and offers skip only on menu', async () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: /Welcome, Selin/ })).toBeInTheDocument()
    expect(screen.queryByText(/Skip for now/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Your restaurant' })
    expect(patch).toHaveBeenCalledWith('/auth/me', {
      name: 'Selin Kaya',
      phone: undefined,
    })
    expect(screen.queryByText(/Skip for now/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'Meyhane' } })
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '1 House Street' } })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Istanbul' } })
    fireEvent.click(screen.getByRole('button', { name: 'Choose Türkiye' }))
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(createFirstHouse).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantName: 'Meyhane',
        address: '1 House Street',
        city: 'Istanbul',
        country: 'Türkiye',
        currency: 'TRY',
      }),
    )
    expect(screen.getByText('Skip for now — open the house')).toBeInTheDocument()
    expect(screen.getByText('Drop the menu here')).toBeInTheDocument()
    expect(screen.getByText(/Your last invoice — read the same way/)).toBeInTheDocument()
    expect(screen.queryByText('Photograph the menu')).not.toBeInTheDocument()
    expect(screen.queryByText(/certain/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/likely/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Skip for now — open the house'))
    expect(navigate).toHaveBeenCalledWith('/house', { replace: true })
  })

  it('shows SMS consent only after a mobile number is entered', async () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(screen.queryByText(/the account does not depend on it/i)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: '+90 532 000 00 00' } })
    expect(screen.getByText(/the account does not depend on it/i)).toBeInTheDocument()
    expect(screen.getByText('STOP')).toBeInTheDocument()
  })

  it('passes Use my location into Places as a search bias', async () => {
    const getCurrentPosition = vi.fn((ok: (pos: { coords: { latitude: number; longitude: number } }) => void) => {
      ok({ coords: { latitude: 41.01, longitude: 28.97 } })
    })
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    })
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Your restaurant' })
    fireEvent.click(screen.getByRole('button', { name: /Use my location/ }))
    expect(getCurrentPosition).toHaveBeenCalled()
    expect(await screen.findByText('Places biased to 41.01,28.97')).toBeInTheDocument()
    expect(screen.getByText('Restaurant search is now centred near you.')).toBeInTheDocument()
  })

  it('prints the first proof and expands only a pencilled line inline', async () => {
    sessionStorage.setItem(
      'mudavym:first-proof',
      JSON.stringify({
        menuId: 'menu',
        itemsExtracted: 2,
        submissionsCreated: 0,
        items: [
          {
            menuItemId: 'ink',
            submissionId: null,
            name: 'House Lager',
            producer: null,
            category: 'beer',
            vintage: null,
            region: null,
            grapeVariety: null,
            byGlassPrice: 8,
            bottlePrice: null,
            rawText: 'House Lager 8',
            matched: true,
            needsReview: false,
          },
          {
            menuItemId: 'pencil',
            submissionId: null,
            name: 'Smoky No. 4',
            producer: null,
            category: null,
            vintage: null,
            region: null,
            grapeVariety: null,
            byGlassPrice: null,
            bottlePrice: 18,
            rawText: 'Smoky No. 4 18',
            matched: false,
            needsReview: true,
          },
        ],
      }),
    )
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    const counts = screen.getByRole('group', { name: 'The reading count' })
    expect(counts).toHaveTextContent(/2read1set1pencilled/)
    expect(screen.queryByText('Smoky No. 4 18')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Smoky No. 4/ }))
    expect(await screen.findByText('Smoky No. 4 18')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/Not on this menu:/)).toBeInTheDocument())
    expect(screen.queryByText(/certain/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/likely/i)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/approve all/i)
  })

  it('counts kitchen lines instead of dropping them, and never prints an empty failed proof', () => {
    sessionStorage.setItem(
      'mudavym:first-proof',
      JSON.stringify({
        menuId: 'menu',
        itemsExtracted: 2,
        submissionsCreated: 0,
        items: [
          {
            menuItemId: 'beer',
            submissionId: null,
            name: 'House Lager',
            producer: null,
            category: 'beer',
            vintage: null,
            region: null,
            grapeVariety: null,
            byGlassPrice: 8,
            bottlePrice: null,
            rawText: 'House Lager 8',
            matched: true,
            needsReview: false,
          },
          {
            menuItemId: 'food',
            submissionId: null,
            name: 'Grilled octopus',
            producer: null,
            category: 'food',
            vintage: null,
            region: null,
            grapeVariety: null,
            byGlassPrice: null,
            bottlePrice: 24,
            rawText: 'Grilled octopus starter 24',
            matched: false,
            needsReview: true,
          },
        ],
      }),
    )
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(screen.getByText(/1 kitchen line set aside/)).toBeInTheDocument()
    expect(screen.queryByText('Grilled octopus')).not.toBeInTheDocument()
  })

  it('says the file could not be read instead of printing an empty proof', () => {
    sessionStorage.setItem(
      'mudavym:first-proof',
      JSON.stringify({ menuId: 'empty', itemsExtracted: 0, submissionsCreated: 0, items: [] }),
    )
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: /couldn't read this file/i })).toBeInTheDocument()
  })

  it('shows an honest empty crop when the original page was not kept', async () => {
    sessionStorage.setItem(
      'mudavym:first-proof',
      JSON.stringify({
        menuId: 'menu',
        itemsExtracted: 1,
        submissionsCreated: 0,
        items: [{
          menuItemId: 'pencil',
          submissionId: null,
          name: 'Smoky No. 4',
          producer: null,
          category: null,
          vintage: null,
          region: null,
          grapeVariety: null,
          byGlassPrice: null,
          bottlePrice: 18,
          rawText: 'Smoky No. 4 18',
          matched: false,
          needsReview: true,
        }],
      }),
    )
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: /Show my original/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Smoky No. 4/ }))
    expect(await screen.findByText(/No crop of this line/)).toBeInTheDocument()
  })

  it('splits the original page when a source image exists', async () => {
    sessionStorage.setItem(
      'mudavym:first-proof',
      JSON.stringify({
        menuId: 'menu',
        itemsExtracted: 1,
        submissionsCreated: 0,
        sourceImage: 'data:image/png;base64,aaaa',
        items: [{
          menuItemId: 'pencil',
          submissionId: null,
          name: 'Smoky No. 4',
          producer: null,
          category: null,
          vintage: null,
          region: null,
          grapeVariety: null,
          byGlassPrice: null,
          bottlePrice: 18,
          rawText: 'Smoky No. 4 18',
          matched: false,
          needsReview: true,
        }],
      }),
    )
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Show my original' }))
    expect(screen.getByAltText('Your original menu')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Smoky No. 4/ }))
    expect(await screen.findByText(/the reading did not return a box/)).toBeInTheDocument()
    expect(screen.queryByAltText('Crop of this line from the original')).not.toBeInTheDocument()
  })

  it('crops a line only when the extractor already returned a box', async () => {
    sessionStorage.setItem(
      'mudavym:first-proof',
      JSON.stringify({
        menuId: 'menu',
        itemsExtracted: 1,
        submissionsCreated: 0,
        sourceImage: 'data:image/png;base64,aaaa',
        items: [{
          menuItemId: 'pencil',
          submissionId: null,
          name: 'Smoky No. 4',
          producer: null,
          category: null,
          vintage: null,
          region: null,
          grapeVariety: null,
          byGlassPrice: null,
          bottlePrice: 18,
          rawText: 'Smoky No. 4 18',
          matched: false,
          needsReview: true,
          bbox: { x: 10, y: 20, width: 80, height: 24, page: 1 },
        }],
      }),
    )
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /Smoky No. 4/ }))
    expect(await screen.findByAltText('Crop of this line from the original')).toBeInTheDocument()
  })

  it('adds an absent section line from the footer', async () => {
    sessionStorage.setItem(
      'mudavym:first-proof',
      JSON.stringify({
        menuId: 'menu',
        itemsExtracted: 1,
        submissionsCreated: 0,
        items: [{
          menuItemId: 'ink',
          submissionId: null,
          name: 'House Lager',
          producer: null,
          category: 'beer',
          vintage: null,
          region: null,
          grapeVariety: null,
          byGlassPrice: 8,
          bottlePrice: null,
          rawText: 'House Lager 8',
          matched: true,
          needsReview: false,
        }],
      }),
    )
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Add it.' }))
    fireEvent.change(screen.getByLabelText('New menu line'), { target: { value: 'House Cider' } })
    fireEvent.change(screen.getByLabelText('New line section'), { target: { value: 'cider' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add this line' }))
    await waitFor(() => expect(addMenuItem).toHaveBeenCalledWith('menu', { name: 'House Cider', category: 'cider' }))
    expect(await screen.findByText('House Cider')).toBeInTheDocument()
  })

  it('opens the house contents page with exactly one ask', async () => {
    sessionStorage.setItem(
      'mudavym:first-proof',
      JSON.stringify({
        menuId: 'menu',
        itemsExtracted: 1,
        submissionsCreated: 0,
        items: [{
          menuItemId: 'pencil',
          submissionId: null,
          name: 'Smoky No. 4',
          producer: null,
          category: null,
          vintage: null,
          region: null,
          grapeVariety: null,
          byGlassPrice: null,
          bottlePrice: 18,
          rawText: 'Smoky No. 4 18',
          matched: false,
          needsReview: true,
        }],
      }),
    )
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    expect(screen.getByText('1 pencilled')).toBeInTheDocument()
    expect(screen.getByText(/The one ask/)).toBeInTheDocument()
    expect(screen.getByLabelText('Supplier')).toBeInTheDocument()
    expect(screen.getByText(/Last invoice · later/)).toBeInTheDocument()
    expect(screen.getByText(/Cellar registers · later/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open later' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add this supplier/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Suvla' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add this supplier' }))
    await waitFor(() => expect(addCustomProvider).toHaveBeenCalledWith({ name: 'Suvla' }))
    expect(screen.queryByLabelText('Wines register')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    const file = new File(['x'], 'suvla-sept.pdf', { type: 'application/pdf' })
    fireEvent.drop(screen.getByText(/Drop the last invoice here/), {
      dataTransfer: { files: [file] },
    })
    expect(screen.getByText(/Last invoice · kept for later — suvla-sept.pdf/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open later' }))
    expect(navigate).toHaveBeenCalledWith('/settings?tab=cellar')
  })
})
