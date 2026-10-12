import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GetStarted from './GetStarted'
import HouseContents from './HouseContents'
import HouseMenu from './HouseMenu'
import { setHouseCurrency } from '../lib/houseCurrency'
import { formatMoney } from '../lib/currency'

const { navigate, createFirstHouse, patch, addMenuItem, addCustomProvider, reviewMenuItem, listMenuVersions, getMenuPlan, makeMenuCurrent, getOnboardingProgress, listMenuSections, auth } = vi.hoisted(() => ({
  navigate: vi.fn(),
  createFirstHouse: vi.fn(),
  patch: vi.fn(),
  addMenuItem: vi.fn(),
  addCustomProvider: vi.fn(),
  reviewMenuItem: vi.fn(),
  listMenuVersions: vi.fn(),
  getMenuPlan: vi.fn(),
  makeMenuCurrent: vi.fn(),
  getOnboardingProgress: vi.fn(),
  listMenuSections: vi.fn(),
  auth: {
    activeRestaurantId: undefined as string | undefined,
    user: { name: 'Selin Kaya', emailVerified: true } as {
      name: string
      emailVerified: boolean
      userId?: string
      restaurantId?: string
      role?: string
    },
  },
}))

const sonnerToast = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>()
  return { ...actual, toast: Object.assign(sonnerToast, actual.toast) }
})
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    createFirstHouse,
    activeRestaurantId: auth.activeRestaurantId,
  }),
}))
// The real getErrorStatus and isUnconfirmedWrite stay: the failure sentences
// are chosen by them (F-006).
vi.mock('../services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api/client')>()),
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
  return { ...actual, reviewMenuItem, addMenuItem, listMenuVersions, getMenuPlan, makeMenuCurrent, getOnboardingProgress, listMenuSections }
})
vi.mock('../services/api/vendors', () => ({
  addCustomProvider,
}))

const pencilLine = {
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
}

function proofWith(items: unknown[]) {
  return { menuId: 'menu', itemsExtracted: items.length, submissionsCreated: 0, items }
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.activeRestaurantId = undefined
  reviewMenuItem.mockResolvedValue({})
  listMenuVersions.mockResolvedValue({ current: null, lastUsed: null, versions: [] })
  patch.mockResolvedValue({})
  createFirstHouse.mockResolvedValue({ restaurantId: 'house-1', detailsLoaded: true })
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
  listMenuVersions.mockResolvedValue({ current: null, lastUsed: null, versions: [] })
  getOnboardingProgress.mockResolvedValue(null)
  listMenuSections.mockResolvedValue([])
  auth.user = { name: 'Selin Kaya', emailVerified: true }
  sessionStorage.clear()
  localStorage.clear()
})

function fillRestaurantStep() {
  fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'Meyhane' } })
  fireEvent.change(screen.getByLabelText('Address'), { target: { value: '1 House Street' } })
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Istanbul' } })
  fireEvent.click(screen.getByRole('button', { name: 'Choose Türkiye' }))
}

async function toRestaurantStep() {
  const view = render(<MemoryRouter><GetStarted /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { name: 'Your restaurant' })
  fillRestaurantStep()
  return view
}

const W1 =
  'We could not open the house with these details. Check the name, the address and the phone number. If you picked the address from the list, try typing it in yourself.'
const NOT_CREATED = 'We could not create the house.'
const UNCONFIRMED =
  'We could not confirm the house opened. Try again in a moment: if it did open, we will tell you, and no second house is opened.'
const ALREADY_OPEN = 'This account already has a house, so no second one was opened.'

describe('approved arrival flow', () => {
  it('creates the house on the restaurant screen and offers skip only on menu', async () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: /Welcome, Selin/ })).toBeInTheDocument()
    expect(screen.queryByText(/Skip for now/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Your restaurant' })
    expect(patch).toHaveBeenCalledWith('/auth/me', { name: 'Selin Kaya' })
    expect(screen.queryByText(/Skip for now/)).not.toBeInTheDocument()

    fillRestaurantStep()
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
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

  it('says a refused house plainly and keeps the form (F-006)', async () => {
    createFirstHouse.mockRejectedValue({
      response: { status: 400, data: { message: 'value too long for type character varying(100)' } },
    })
    await toRestaurantStep()
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    expect((await screen.findByRole('alert')).textContent).toBe(W1)
    expect(screen.getByRole('heading', { name: 'Your restaurant' })).toBeInTheDocument()
    expect(screen.getByLabelText('Restaurant name')).toHaveValue('Meyhane')
    expect(screen.getByLabelText('City')).toHaveValue('Istanbul')
    expect(document.body.textContent).not.toContain('character varying')
  })

  it('says every 400 the same way, never in the gateway\'s words (F-006)', async () => {
    const placeTooLong =
      'The place picked from the list is longer than we can keep, so nothing was recorded. Type the address in yourself instead of picking it from the list.'
    for (const message of [placeTooLong, ['property foo should not exist']]) {
      createFirstHouse.mockRejectedValueOnce({ response: { status: 400, data: { message } } })
      const { unmount } = await toRestaurantStep()
      fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
      expect((await screen.findByRole('alert')).textContent).toBe(W1)
      expect(document.body.textContent).not.toContain('nothing was recorded')
      expect(document.body.textContent).not.toContain('should not exist')
      unmount()
    }
  })

  it('says a 5xx or a lost answer as unconfirmed, with no raw text (F-006)', async () => {
    const serverError = {
      response: {
        status: 500,
        data: {
          message:
            'Restaurant creation failed: duplicate key value violates unique constraint "idx_restaurants_google_place_id"',
        },
      },
    }
    const noAnswer = Object.assign(new Error('timeout of 20000ms exceeded'), {
      isAxiosError: true,
      request: {},
    })
    for (const cause of [serverError, noAnswer]) {
      createFirstHouse.mockRejectedValueOnce(cause)
      const { unmount } = await toRestaurantStep()
      fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
      expect((await screen.findByRole('alert')).textContent).toBe(UNCONFIRMED)
      for (const raw of ['duplicate', 'idx_', 'constraint', 'timeout'])
        expect(document.body.textContent).not.toContain(raw)
      unmount()
    }
  })

  it('says a press after a lost answer met the house it opened (F-006, OPEN-2 unbuilt)', async () => {
    createFirstHouse
      .mockRejectedValueOnce(Object.assign(new Error('Network Error'), { isAxiosError: true, request: {} }))
      .mockRejectedValueOnce({
        response: { status: 409, data: { message: 'This account already has a house' } },
      })
    await toRestaurantStep()
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    expect((await screen.findByRole('alert')).textContent).toBe(UNCONFIRMED)
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(ALREADY_OPEN))
    // Where the person goes from here is F-006 OPEN-2; nothing moves yet.
    expect(screen.getByRole('heading', { name: 'Your restaurant' })).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('keeps the fallback for anything that is not an answer (F-006)', async () => {
    createFirstHouse.mockRejectedValue(new Error('createFirstHouse is not a function'))
    await toRestaurantStep()
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    expect((await screen.findByRole('alert')).textContent).toBe(NOT_CREATED)
    expect(document.body.textContent).not.toContain('not a function')
  })

  it('says a throttled press in words (F-006)', async () => {
    createFirstHouse.mockRejectedValue({ response: { status: 429, data: { message: 'ThrottlerException' } } })
    await toRestaurantStep()
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Too many tries in a short time. Wait a minute, then try again.',
    )
  })

  it('opens the menu step when only the account details failed to load (F-006)', async () => {
    createFirstHouse.mockResolvedValue({ restaurantId: 'house-1', detailsLoaded: false })
    await toRestaurantStep()
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(screen.getByRole('status').textContent).toBe(
      'The house is open. Your account details did not load just now; they will catch up the next time the page loads.',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('promises no texts for a mobile number: SMS is off until turned on (F-1212)', async () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(screen.queryByText(/the account does not depend on it/i)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: '+90 532 000 00 00' } })
    expect(screen.getByText(/the account does not depend on it/i)).toBeInTheDocument()
    expect(screen.getByText(/We send no texts unless you turn them on in Settings/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/STOP|stock alert/i)
    expect(screen.getByLabelText('Mobile')).not.toHaveAttribute('placeholder', expect.stringMatching(/alert/i))
  })

  it('keeps the mobile read in the house\'s country, not as typed or as +1 (F-1212)', async () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: '0532 123 45 67' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Your restaurant' })
    expect(patch).toHaveBeenCalledWith('/auth/me', { name: 'Selin Kaya' })
    fillRestaurantStep()
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(patch).toHaveBeenCalledWith('/auth/me', { phone: '+905321234567' })
    expect(patch).not.toHaveBeenCalledWith('/auth/me', expect.objectContaining({ phone: '0532 123 45 67' }))
  })

  it('says so when the mobile was not kept, with the house open (F-1212)', async () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: '0532 123 45 67' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Your restaurant' })
    patch.mockRejectedValueOnce(new Error('offline'))
    fillRestaurantStep()
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(screen.getByRole('status')).toHaveTextContent('Your mobile number was not saved')
  })

  it('keeps a mobile restored after a reload when the owner goes on (F-1237)', async () => {
    // The house opened, then the page reloaded before the mobile was kept:
    // the draft still carries it, and the menu step comes back.
    auth.user = { name: 'Selin Kaya', emailVerified: true, userId: 'user-1', restaurantId: 'house-1' }
    localStorage.setItem(
      'mudavym:arrival-draft',
      JSON.stringify({
        userId: 'user-1', role: 'owner', restaurantName: 'Meyhane', address: '1 House Street',
        city: 'Istanbul', country: 'Türkiye', stateProvince: '', postalCode: '', restaurantPhone: '',
        placePoint: null, currencyChoice: null, mobile: '0532 123 45 67',
      }),
    )
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(patch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Skip for now/ }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/house', { replace: true }))
    expect(patch).toHaveBeenCalledWith('/auth/me', { phone: '+905321234567' })
  })

  it('tries a mobile not kept when the house opened again on going on, and says a second miss (F-1237)', async () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: '0532 123 45 67' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Your restaurant' })
    patch.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'))
    fillRestaurantStep()
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    fireEvent.click(screen.getByRole('button', { name: /Skip for now/ }))
    await waitFor(() =>
      expect(patch.mock.calls.filter(([, body]) => body?.phone === '+905321234567')).toHaveLength(2),
    )
    // The first press opens the house anyway (F-1280), and the miss goes
    // with the owner on the house's toast instead of a line left behind.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/house', { replace: true }))
    expect(sonnerToast).toHaveBeenCalledWith('Your mobile number was not saved; you can add it on your profile.')
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

  // F-1001: the proof printed "45.5 glass · 1250 bottle" bare while /menu
  // printed the same line in lira.
  it('prints the proof prices in the house currency, not bare', () => {
    setHouseCurrency('TRY')
    sessionStorage.setItem(
      'mudavym:first-proof',
      JSON.stringify({
        menuId: 'menu',
        itemsExtracted: 1,
        submissionsCreated: 0,
        items: [
          {
            menuItemId: 'yakut',
            submissionId: null,
            name: 'Kavaklıdere Yakut',
            producer: null,
            category: 'red',
            vintage: null,
            region: null,
            grapeVariety: null,
            byGlassPrice: 45.5,
            bottlePrice: 1250,
            rawText: 'Yakut 45,50 / 1.250',
            matched: true,
            needsReview: false,
          },
        ],
      }),
    )
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    const line = screen.getByText(/glass ·/)
    expect(line).not.toHaveTextContent('45.5 glass')
    expect(line).toHaveTextContent(/(₺|TRY)\s?45[.,]50 glass · (₺|TRY)\s?1[.,]250[.,]00 bottle/)
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

  // F-272: a failed write said nothing; the spinner cleared and the line sat.
  it('says on the line when placing it failed, and keeps it pencilled', async () => {
    reviewMenuItem.mockRejectedValue(new Error('500'))
    sessionStorage.setItem('mudavym:first-proof', JSON.stringify(proofWith([pencilLine])))
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /Smoky No. 4/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cocktail' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This line was not placed. Nothing changed — try again.')
    expect(screen.getByRole('group', { name: 'The reading count' })).toHaveTextContent(/1pencilled/)
  })

  it('says when adding a line failed, and keeps what was typed', async () => {
    addMenuItem.mockRejectedValue(new Error('500'))
    sessionStorage.setItem('mudavym:first-proof', JSON.stringify(proofWith([pencilLine])))
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Add it.' }))
    fireEvent.change(screen.getByLabelText('New menu line'), { target: { value: 'House Cider' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add this line' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This line was not added. What you typed is still here — try again.')
    expect(screen.getByLabelText('New menu line')).toHaveValue('House Cider')
  })

  // F-273: the proof lives in one tab; the menu lives on the server.
  it('does not offer to read the menu again when the house already holds one', async () => {
    listMenuVersions.mockResolvedValue({ current: { menuId: 'm1' }, lastUsed: null, versions: [{ menuId: 'm1' }] })
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Your menu is already with us.' })).toBeInTheDocument()
    expect(screen.queryByText('No menu has been read yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Read a menu' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open your menu' }))
    expect(navigate).toHaveBeenCalledWith('/menu')
  })

  it('says no menu was read only when the house holds none', async () => {
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'No menu has been read yet.' })).toBeInTheDocument()
  })

  it('does not claim no menu was read when it could not check', async () => {
    listMenuVersions.mockRejectedValue(new Error('offline'))
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'We could not check for your menu just now.' })).toBeInTheDocument()
    expect(screen.queryByText('No menu has been read yet.')).not.toBeInTheDocument()
  })

  it('does not show another house’s first proof after a house switch', async () => {
    auth.activeRestaurantId = 'house-2'
    sessionStorage.setItem(
      'mudavym:first-proof',
      JSON.stringify({ ...proofWith([pencilLine]), restaurantId: 'house-1' }),
    )
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(screen.queryByText(/Smoky No. 4/)).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'No menu has been read yet.' })).toBeInTheDocument()
  })

  it('shows the first proof read for this house', () => {
    auth.activeRestaurantId = 'house-1'
    sessionStorage.setItem(
      'mudavym:first-proof',
      JSON.stringify({ ...proofWith([pencilLine]), restaurantId: 'house-1' }),
    )
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /Smoky No. 4/ })).toBeInTheDocument()
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
    // F-588: only the name is noted (sessionStorage), never the file, so the
    // page must not say the invoice is kept.
    expect(screen.getByText(/Last invoice · noted, not kept — suvla-sept.pdf/)).toBeInTheDocument()
    expect(screen.getByText(/The file itself is not kept yet/)).toBeInTheDocument()
    expect(screen.queryByText(/kept for later/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open later' }))
    expect(navigate).toHaveBeenCalledWith('/settings?tab=cellar')
  })

  it('says the supplier is on the book even when the progress mark fails (F-587)', async () => {
    patch.mockRejectedValueOnce(new Error('Onboarding progress not found'))
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Suvla' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add this supplier' }))
    expect(await screen.findByText('Suvla is on the book.')).toBeInTheDocument()
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/onboarding/progress', { vendor_added: true }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add this supplier' })).toBeNull()
    expect(addCustomProvider).toHaveBeenCalledTimes(1)
  })

  function storeProof(menuId: string, items: Array<{ id: string; name: string; category: string | null }>) {
    sessionStorage.setItem(
      'mudavym:first-proof',
      JSON.stringify({
        menuId,
        itemsExtracted: items.length,
        submissionsCreated: 0,
        items: items.map((item) => ({
          menuItemId: item.id,
          submissionId: null,
          name: item.name,
          producer: null,
          category: item.category,
          vintage: null,
          region: null,
          grapeVariety: null,
          byGlassPrice: null,
          bottlePrice: 40,
          rawText: `${item.name} 40`,
          matched: true,
          needsReview: false,
        })),
      }),
    )
  }

  it('says a menu already held in the books is with us, not "no menu read yet" (F-1211)', async () => {
    listMenuVersions.mockResolvedValue({ current: { menuId: 'm1' }, lastUsed: null, versions: [{ menuId: 'm1' }] })
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    expect(await screen.findByText('Your menu is already with us.')).toBeInTheDocument()
    expect(screen.queryByText('No menu read yet.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Read your menu' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open your menu' }))
    expect(navigate).toHaveBeenCalledWith('/menu')
  })

  it('never invites a second read when the books cannot be checked (F-1211)', async () => {
    listMenuVersions.mockRejectedValue(new Error('offline'))
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    expect(await screen.findByText('We could not check for your menu just now.')).toBeInTheDocument()
    expect(screen.queryByText('No menu read yet.')).toBeNull()
  })

  it('still offers a read when the house holds no menu (F-1063)', async () => {
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    expect(await screen.findByText('No menu read yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Read your menu' }))
    expect(navigate).toHaveBeenCalledWith('/get-started')
  })

  it('does not ask for a supplier again once one is on the book (F-1211)', async () => {
    getOnboardingProgress.mockResolvedValue({ vendor_added: true })
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    expect(await screen.findByText('A supplier is already on the book.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Supplier')).toBeNull()
  })

  it('leads on from the house contents page, never a dead end (F-025)', () => {
    storeProof('menu', [{ id: 'a', name: 'Yakut', category: 'red' }])
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Continue to the dashboard' }))
    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('says the menu just read is a draft and where to make it current (F-031)', async () => {
    storeProof('menu', [{ id: 'a', name: 'Yakut', category: 'red' }])
    listMenuVersions.mockResolvedValue({ current: null, lastUsed: null, versions: [] })
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    expect(await screen.findByText(/Kept as a draft: it is not the house's current menu yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Make it current on Menu' }))
    expect(navigate).toHaveBeenCalledWith('/menu')
  })

  it('says so once the menu read is the current one, and never guesses when it cannot read (F-031)', async () => {
    storeProof('menu', [{ id: 'a', name: 'Yakut', category: 'red' }])
    listMenuVersions.mockResolvedValue({ current: { menuId: 'menu' }, lastUsed: null, versions: [] })
    const view = render(<MemoryRouter><HouseContents /></MemoryRouter>)
    expect(await screen.findByText("It is the house's current menu.")).toBeInTheDocument()
    expect(screen.queryByText(/Kept as a draft/)).toBeNull()
    view.unmount()

    listMenuVersions.mockRejectedValue(new Error('offline'))
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    expect(await screen.findByText(/could not be read/)).toBeInTheDocument()
    expect(screen.queryByText(/Kept as a draft/)).toBeNull()
  })

  it('does not tell a menu of wines and soft drinks it has no wine or soft drinks (F-024)', () => {
    storeProof('menu', [
      { id: 'a', name: 'Yakut', category: 'red' },
      { id: 'b', name: 'Ayran', category: 'non-alcoholic' },
      { id: 'c', name: 'Muscat de Beaumes-de-Venise', category: 'dessert' },
    ])
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    const footer = screen.getByText(/Not on this menu:/)
    expect(footer).not.toHaveTextContent(/Wine/)
    expect(footer).not.toHaveTextContent(/Soft drinks/)
    // The dessert wine is a wine, not a kitchen line (F-022).
    expect(screen.queryByText(/kitchen line/)).toBeNull()
    expect(screen.getByText(/Muscat de Beaumes-de-Venise/)).toBeInTheDocument()
  })
})

describe('a new owner is told what each step does, and a reload resumes it', () => {
  it('says the timezone is this device\'s clock, not the address\'s (F-003)', async () => {
    await toRestaurantStep()
    expect(screen.queryByText(/address sets the house's timezone/)).not.toBeInTheDocument()
    expect(
      screen.getByText(/The timezone is this device's clock, not the address's/),
    ).toHaveTextContent('change it in Settings once the house is open')
  })

  it('says how to go on when the restaurant is not on Google yet (F-005)', async () => {
    await toRestaurantStep()
    expect(screen.getByText(/New, or not on Google yet\?/)).toHaveTextContent(
      'Type the name and address in the boxes below',
    )
    expect(screen.queryByText(/VITE_GOOGLE_MAPS_API_KEY/)).not.toBeInTheDocument()
  })

  it('caps the name where the account keeps it (F-243)', () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(screen.getByLabelText('Your name')).toHaveAttribute('maxLength', '100')
  })

  it('comes back on step 02 with the role and what was typed after a reload (F-007)', async () => {
    auth.user = { name: 'Selin Kaya', emailVerified: true, userId: 'user-1', restaurantId: '' }
    const first = render(<MemoryRouter><GetStarted /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Owner' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Your restaurant' })
    fillRestaurantStep()
    first.unmount()

    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Your restaurant' })).toBeInTheDocument()
    expect(screen.getByLabelText('Restaurant name')).toHaveValue('Meyhane')
    expect(screen.getByLabelText('Address')).toHaveValue('1 House Street')
    expect(screen.getByLabelText('City')).toHaveValue('Istanbul')
    expect(screen.getByLabelText('Currency')).toHaveValue('TRY')
  })

  it('keeps the role chip chosen on step 01 across a reload (F-007)', async () => {
    // The role is stored under the signed-in account's id (F-984), so this
    // reload needs a real account behind it. The restaurant draft is dropped
    // so the reload lands on step 01 and only the tab's kept role remains.
    auth.user = { name: 'Selin Kaya', emailVerified: true, userId: 'user-1' }
    const first = render(<MemoryRouter><GetStarted /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Owner' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Your restaurant' })
    first.unmount()
    localStorage.removeItem('mudavym:arrival-draft')

    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Owner' }).className).toContain('bg-[#1a5e6b]')
  })

  it('comes back on the menu step only when the house is really open (F-007)', async () => {
    auth.user = { name: 'Selin Kaya', emailVerified: true, userId: 'user-1', restaurantId: '' }
    const first = render(<MemoryRouter><GetStarted /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Your restaurant' })
    fillRestaurantStep()
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    first.unmount()

    auth.user = { ...auth.user, restaurantId: 'house-1' }
    const second = render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Your menu' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Skip for now/ }))
    expect(navigate).toHaveBeenCalledWith('/house', { replace: true })
    second.unmount()

    // Skipping on to the house ends the arrival; the open house comes back
    // to read a menu, never to step 01 and its 409 (F-893).
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Your menu' })).toBeInTheDocument()
  })

  it('opens an open house straight on the menu step, as /house/menu sends it (F-893)', () => {
    auth.user = { name: 'Selin Kaya', emailVerified: true, userId: 'user-1', restaurantId: 'house-1' }
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Your menu' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'This is us' })).not.toBeInTheDocument()
  })

  it('asks the currency, defaulted from the country, and sends the answer (F-900, ADR 0117 Q25)', async () => {
    await toRestaurantStep()
    expect(screen.getByLabelText('Currency')).toHaveValue('TRY')
    expect(screen.getByTestId('currency-statement')).toHaveTextContent('Defaulted from Türkiye')
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'EUR' } })
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(createFirstHouse).toHaveBeenCalledWith(expect.objectContaining({ currency: 'EUR' }))
  })

  it('records no currency when the owner says not yet (F-900)', async () => {
    await toRestaurantStep()
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(createFirstHouse).toHaveBeenCalledWith(expect.objectContaining({ currency: undefined }))
  })

  it('never resumes another account\'s half-finished arrival (F-007)', async () => {
    auth.user = { name: 'Selin Kaya', emailVerified: true, userId: 'user-1', restaurantId: '' }
    const first = render(<MemoryRouter><GetStarted /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Your restaurant' })
    fillRestaurantStep()
    first.unmount()

    auth.user = { name: 'Deniz Ak', emailVerified: true, userId: 'user-2', restaurantId: '' }
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: /Welcome, Deniz/ })).toBeInTheDocument()
  })
})

// F-1295: the nudge 'Make your menu current' lands here, so a menu read but
// not current is said so, and an owner or a manager can choose it here.
describe('the first proof says whether its menu is current (F-1295)', () => {
  const mountWithQuery = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><HouseMenu /></MemoryRouter>
      </QueryClientProvider>,
    )

  it('a menu read but not current is "read", and an owner makes it current from here', async () => {
    auth.user = { name: 'Selin Kaya', emailVerified: true, role: 'owner' }
    sessionStorage.setItem('mudavym:first-proof', JSON.stringify(proofWith([pencilLine])))
    listMenuVersions.mockResolvedValue({ current: null, lastUsed: null, versions: [{ menuId: 'menu' }] })
    getMenuPlan.mockResolvedValue({
      menuId: 'menu',
      current: false,
      readAt: null,
      generatedAt: '2026-10-11T12:00:00Z',
      fingerprint: 'fp-menu',
      lines: [
        {
          menuItemId: 'pencil',
          name: 'Smoky No. 4',
          producer: null,
          vintage: null,
          wineLibraryId: null,
          inventoryId: null,
          house: null,
          bottle: { kind: 'bottle', menuPrice: 18, housePrice: null, result: 'not_linked', lastSet: null, setAfterRead: false, lock: null },
          glass: { kind: 'glass', menuPrice: null, housePrice: null, result: 'not_linked', lastSet: null, setAfterRead: false, lock: null },
          flag: null,
          returned: false,
          vintageMismatch: false,
        },
      ],
      counts: { change: 0, unchanged: 0, held_by_lock: 0, blank_kept: 0, blank_never_priced: 0, not_linked: 2, new_wine: 0 },
      dormantLocks: [],
      retiring: [],
      namesReadable: true,
      namesReason: null,
    })
    makeMenuCurrent.mockResolvedValue({ outcome: 'made_current', menuId: 'menu', previousMenuIds: [], lines: 1, priceSync: { not_linked: 1 }, flagged: 0, failed: [] })
    mountWithQuery()
    expect(await screen.findByTestId('proof-not-current')).toHaveTextContent('It is read but not yet your current menu, so no price has changed.')
    expect(screen.getByRole('heading', { name: 'Your menu, read by Mudavym.' })).toBeInTheDocument()
    expect(screen.queryByText('Your menu, set by Mudavym.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Make it current' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }))
    await waitFor(() => expect(makeMenuCurrent).toHaveBeenCalledWith('menu', 'fp-menu'))
    expect(await screen.findByRole('status')).toHaveTextContent('This is now the current menu: 1 line')
    expect(screen.getByRole('heading', { name: 'Your menu, set by Mudavym.' })).toBeInTheDocument()
    expect(screen.queryByTestId('proof-not-current')).not.toBeInTheDocument()
  })

  // F-1362: the choice printed its prices bare ("1,250.00"), while /menu
  // printed the same prices in the house's money.
  it('the choice made here prints its prices in the house currency', async () => {
    auth.user = { name: 'Selin Kaya', emailVerified: true, role: 'owner' }
    setHouseCurrency('TRY')
    sessionStorage.setItem('mudavym:first-proof', JSON.stringify(proofWith([pencilLine])))
    listMenuVersions.mockResolvedValue({ current: null, lastUsed: null, versions: [{ menuId: 'menu' }] })
    const kind = (over: object) => ({ menuPrice: null, housePrice: null, result: 'not_linked', lastSet: null, setAfterRead: false, lock: null, ...over })
    getMenuPlan.mockResolvedValue({
      menuId: 'menu', current: false, readAt: null, generatedAt: '2026-10-11T12:00:00Z', fingerprint: 'fp-menu',
      lines: [{
        menuItemId: 'pencil', name: 'Smoky No. 4', producer: null, vintage: null, wineLibraryId: 'w1', inventoryId: 'i1', house: null,
        bottle: kind({ kind: 'bottle', menuPrice: 1250, housePrice: 1000, result: 'change' }),
        glass: kind({ kind: 'glass' }),
        flag: null, returned: false, vintageMismatch: false,
      }],
      counts: { change: 1, unchanged: 0, held_by_lock: 0, blank_kept: 0, blank_never_priced: 0, not_linked: 1, new_wine: 0 },
      dormantLocks: [], retiring: [], namesReadable: true, namesReason: null,
    })
    makeMenuCurrent.mockResolvedValue({
      outcome: 'made_current', menuId: 'menu', previousMenuIds: [], lines: 1, priceSync: { locked: 1 }, flagged: 0, failed: [],
      held: [{ menuItemId: 'pencil', name: 'Smoky No. 4', kind: 'bottle', lockId: 'l1', lockedPrice: 1250, lockedBy: null, lockedAt: null }],
    })
    mountWithQuery()
    fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }))
    await waitFor(() => expect(document.body.textContent).toContain(`becomes ${formatMoney(1250, 'TRY')} (now ${formatMoney(1000, 'TRY')})`))
    fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(`Smoky No. 4 (bottle, locked at ${formatMoney(1250, 'TRY')})`))
  })

  it('staff are told who chooses, and offered no choice', async () => {
    auth.user = { name: 'Deniz Ak', emailVerified: true, role: 'staff' }
    sessionStorage.setItem('mudavym:first-proof', JSON.stringify(proofWith([pencilLine])))
    mountWithQuery()
    expect(await screen.findByTestId('proof-not-current')).toHaveTextContent('An owner or a manager chooses whether it becomes the current menu.')
    expect(screen.queryByRole('button', { name: 'Make it current' })).not.toBeInTheDocument()
  })

  it('the current menu is "set", with nothing to choose', async () => {
    auth.user = { name: 'Selin Kaya', emailVerified: true, role: 'owner' }
    sessionStorage.setItem('mudavym:first-proof', JSON.stringify(proofWith([pencilLine])))
    listMenuVersions.mockResolvedValue({ current: { menuId: 'menu' }, lastUsed: null, versions: [{ menuId: 'menu' }] })
    mountWithQuery()
    expect(await screen.findByRole('heading', { name: 'Your menu, set by Mudavym.' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make it current' })).not.toBeInTheDocument()
  })

  // ADR 0340 lane 6b: a read split by kind made a Drinks and a Food draft.
  // The first proof shows each kind, offers every draft not yet live in one
  // tap, and offers a kind the plan left a draft again (no dead end).
  const drinkLine = { ...pencilLine, menuItemId: 'd1', name: 'Yakut', category: 'red', rawText: 'Yakut 40', bottlePrice: 40, matched: true, needsReview: false }
  const dishLine = { ...pencilLine, menuItemId: 'f1', name: 'Grilled octopus', category: 'Starters', rawText: 'Grilled octopus starter 24', bottlePrice: null, needsReview: false }
  function splitProof(drafts: Array<[string, string, unknown[]]>) {
    const items = drafts.flatMap(([, , lines]) => lines)
    return {
      menuId: (drafts.find(([, kind]) => kind === 'beverage') ?? drafts[0])[0],
      itemsExtracted: items.length,
      submissionsCreated: 0,
      items,
      drafts: drafts.map(([menuId, kind, lines]) => ({ menuId, kind, items: lines })),
      readTogetherId: 'rt-1',
    }
  }
  const BOTH: Array<[string, string, unknown[]]> = [['m-drinks', 'beverage', [drinkLine]], ['m-food', 'food', [dishLine]]]
  const planKind = (kind: string) => ({ kind, menuPrice: null, housePrice: null, result: 'not_linked', lastSet: null, setAfterRead: false, lock: null })
  const planLine = (menuItemId: string, name: string, menuId: string, menuKind: string) => ({
    menuItemId, name, producer: null, vintage: null, wineLibraryId: null, inventoryId: null, house: null,
    bottle: planKind('bottle'), glass: planKind('glass'), flag: null, returned: false, vintageMismatch: false,
    menuId, menuKind, lineKind: menuKind === 'food' ? 'dish' : 'drink', sectionId: null,
  })
  const planMenu = (menuId: string, kind: string) => ({ menuId, kind, current: false, partRead: null, lines: 1, unsure: 0, conflicts: 0 })
  const counts = { change: 0, unchanged: 0, held_by_lock: 0, blank_kept: 0, blank_never_priced: 0, not_linked: 1, new_wine: 0 }
  const made = (menuId: string, kind: string) => ({ menuId, kind, outcome: 'made_current', madeCurrentAt: null, recarried: false, carryFinished: true, lines: 1 })

  it('shows each kind the read found, a Food line on its own menu and never set aside', () => {
    sessionStorage.setItem('mudavym:first-proof', JSON.stringify(splitProof(BOTH)))
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(screen.getByTestId('proof-kinds')).toHaveTextContent('Drinks 1 · Food 1')
    expect(screen.getByTestId('proof-kind-food')).toHaveTextContent('Grilled octopus')
    expect(screen.queryByText(/kitchen line/)).toBeNull()
  })

  it('makes every draft of the read live in one tap, and is "set" once all are', async () => {
    auth.user = { name: 'Selin Kaya', emailVerified: true, role: 'owner' }
    sessionStorage.setItem('mudavym:first-proof', JSON.stringify(splitProof(BOTH)))
    listMenuVersions.mockResolvedValue({ current: null, currentByKind: { beverage: null, food: null, desserts: null }, lastUsed: null, versions: [{ menuId: 'm-drinks' }, { menuId: 'm-food' }] })
    getMenuPlan.mockResolvedValue({
      menuId: 'm-drinks', current: false, readAt: null, generatedAt: '2026-10-12T12:00:00Z', fingerprint: 'fp-both',
      lines: [planLine('d1', 'Yakut', 'm-drinks', 'beverage'), planLine('f1', 'Grilled octopus', 'm-food', 'food')],
      counts, dormantLocks: [], retiring: [], namesReadable: true, namesReason: null,
      menus: [planMenu('m-drinks', 'beverage'), planMenu('m-food', 'food')], gone: [], unsure: [], conflicts: [],
    })
    makeMenuCurrent.mockResolvedValue({
      outcome: 'made_current', menuId: 'm-drinks', previousMenuIds: [], lines: 2, priceSync: { not_linked: 1 }, flagged: 0, failed: [],
      menus: [made('m-drinks', 'beverage'), made('m-food', 'food')],
    })
    mountWithQuery()
    fireEvent.click(await screen.findByRole('button', { name: 'Make Drinks and Food current' }))
    await waitFor(() => expect(getMenuPlan).toHaveBeenCalledWith('m-drinks', ['m-food']))
    fireEvent.click(await screen.findByRole('button', { name: 'Make Drinks + Food live' }))
    await waitFor(() =>
      expect(makeMenuCurrent).toHaveBeenCalledWith('m-drinks', 'fp-both', false, { menuIds: ['m-food'], picks: [], partReadAcceptedKinds: [] }),
    )
    expect(await screen.findByRole('heading', { name: 'Your menu, set by Mudavym.' })).toBeInTheDocument()
    expect(screen.queryByTestId('proof-not-current')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Drinks + Food updated')
    expect(screen.getByTestId('proof-kind-food')).toHaveTextContent('now current')
  })

  it('offers a kind the plan left a draft again, alone', async () => {
    auth.user = { name: 'Selin Kaya', emailVerified: true, role: 'owner' }
    sessionStorage.setItem('mudavym:first-proof', JSON.stringify(splitProof(BOTH)))
    listMenuVersions.mockResolvedValue({ current: null, currentByKind: { beverage: null, food: null, desserts: null }, lastUsed: null, versions: [{ menuId: 'm-drinks' }, { menuId: 'm-food' }] })
    getMenuPlan.mockResolvedValue({
      menuId: 'm-drinks', current: false, readAt: null, generatedAt: '2026-10-12T12:00:00Z', fingerprint: 'fp-both',
      lines: [planLine('d1', 'Yakut', 'm-drinks', 'beverage'), planLine('f1', 'Grilled octopus', 'm-food', 'food')],
      counts, dormantLocks: [], retiring: [], namesReadable: true, namesReason: null,
      menus: [planMenu('m-drinks', 'beverage'), planMenu('m-food', 'food')], gone: [], unsure: [], conflicts: [],
    })
    // The reply names only Drinks: Food stayed a draft.
    makeMenuCurrent.mockResolvedValue({
      outcome: 'made_current', menuId: 'm-drinks', previousMenuIds: [], lines: 1, priceSync: { not_linked: 1 }, flagged: 0, failed: [],
      menus: [made('m-drinks', 'beverage')],
    })
    mountWithQuery()
    fireEvent.click(await screen.findByRole('button', { name: 'Make Drinks and Food current' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Make Drinks + Food live' }))
    expect(await screen.findByTestId('proof-not-current')).toHaveTextContent('Food is still a draft, not current, so nothing on it has changed.')
    expect(screen.getByRole('heading', { name: 'Your menu, read by Mudavym.' })).toBeInTheDocument()
    getMenuPlan.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Make it current' }))
    await waitFor(() => expect(getMenuPlan).toHaveBeenCalledWith('m-food', []))
  })

  it('offers no drink line to add when the read made no Drinks draft', async () => {
    sessionStorage.setItem('mudavym:first-proof', JSON.stringify(splitProof([['m-food', 'food', [dishLine]]])))
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(screen.getByTestId('proof-kind-food')).toHaveTextContent('Grilled octopus')
    expect(screen.queryByText(/Not on this menu/)).toBeNull()
  })

  it('with the split off, one menu is offered exactly as before', async () => {
    auth.user = { name: 'Selin Kaya', emailVerified: true, role: 'owner' }
    sessionStorage.setItem('mudavym:first-proof', JSON.stringify(proofWith([pencilLine])))
    mountWithQuery()
    expect(screen.queryByTestId('proof-kinds')).toBeNull()
    expect(await screen.findByRole('button', { name: 'Make it current' })).toBeInTheDocument()
  })

  it('with no proof in this tab, a kept menu that is not current is said so', async () => {
    listMenuVersions.mockResolvedValue({ current: null, lastUsed: null, versions: [{ menuId: 'm1' }] })
    mountWithQuery()
    expect(await screen.findByRole('heading', { name: 'Your menu is read, but not yet current.' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open your menu' }))
    expect(navigate).toHaveBeenCalledWith('/menu')
  })
})
