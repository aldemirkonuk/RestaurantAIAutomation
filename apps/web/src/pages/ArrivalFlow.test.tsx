import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuImportReviewItem, MenuLine, MenuVersion } from '../services/api/menus'
import GetStarted from './GetStarted'
import HouseContents from './HouseContents'
import HouseMenu from './HouseMenu'

const {
  navigate,
  createFirstHouse,
  patch,
  get,
  addMenuItem,
  reviewMenuItem,
  listMenuVersions,
  getMenuVersion,
  importMenu,
  addCustomProvider,
  auth,
} = vi.hoisted(() => ({
  navigate: vi.fn(),
  createFirstHouse: vi.fn(),
  patch: vi.fn(),
  get: vi.fn(),
  addMenuItem: vi.fn(),
  reviewMenuItem: vi.fn(),
  listMenuVersions: vi.fn(),
  getMenuVersion: vi.fn(),
  importMenu: vi.fn(),
  addCustomProvider: vi.fn(),
  auth: { value: {} as Record<string, unknown> },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => auth.value,
}))
vi.mock('../services/api/client', () => ({
  apiClient: { patch, get },
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
  return { ...actual, reviewMenuItem, addMenuItem, listMenuVersions, getMenuVersion, importMenu }
})
vi.mock('../services/api/vendors', () => ({
  addCustomProvider,
}))

const SELIN = { userId: 'user-selin', name: 'Selin Kaya', emailVerified: true, restaurantId: '' }

function signedIn(user: Record<string, unknown> = SELIN) {
  auth.value = { user, loading: false, activeRestaurantId: 'house-1', createFirstHouse }
}

/** A kept menu of the house, as GET /menu-versions lists it. */
function menu(over: Partial<MenuVersion> = {}): MenuVersion {
  return {
    menuId: 'menu',
    name: null,
    status: 'draft',
    current: false,
    cadence: null,
    menuDate: null,
    menuDatePrecision: null,
    sourceMethod: 'scan',
    source: { kept: false, mime: null, bytes: null, failure: null },
    linesExtracted: 2,
    extractedAt: '2026-10-07T10:00:00Z',
    extractedBy: null,
    madeCurrentAt: null,
    madeCurrentBy: null,
    retiredAt: null,
    retiredBy: null,
    createdAt: '2026-10-07T10:00:00Z',
    ...over,
  }
}

/** A stored line, as GET /menu-versions/:menuId returns it. */
function line(id: string, name: string, over: Partial<MenuLine> = {}): MenuLine {
  return {
    id,
    name,
    producer: null,
    category: null,
    vintage: null,
    region: null,
    country: null,
    grape_variety: null,
    by_glass_price: null,
    bottle_price: null,
    wine_library_id: null,
    inventory_item_id: null,
    source: 'scan',
    status: 'approved',
    created_at: '2026-10-07T10:00:00Z',
    ...over,
  }
}

/** This tab's reading of a line, as the import returned it. */
function read(menuItemId: string, name: string, over: Partial<MenuImportReviewItem> = {}): MenuImportReviewItem {
  return {
    menuItemId,
    submissionId: null,
    name,
    producer: null,
    category: null,
    vintage: null,
    region: null,
    grapeVariety: null,
    byGlassPrice: null,
    bottlePrice: null,
    rawText: null,
    matched: true,
    needsReview: false,
    ...over,
  }
}

/** The server holds `lines` on the house's one kept menu. */
function serve(lines: MenuLine[], over: Partial<MenuVersion> = {}, root: Record<string, unknown> = {}) {
  const version = menu(over)
  listMenuVersions.mockResolvedValue({
    current: version.current ? version : null,
    lastUsed: null,
    versions: [version],
  })
  getMenuVersion.mockResolvedValue({ version, items: lines, ...root })
  return version
}

/** This tab just read `items` (stamped with a house and a person, ADR 0309). */
function keepReading(items: MenuImportReviewItem[], extra: Record<string, unknown> = {}) {
  sessionStorage.setItem(
    'mudavym:first-proof',
    JSON.stringify({
      menuId: 'menu',
      itemsExtracted: items.length,
      submissionsCreated: 0,
      restaurantId: 'house-1',
      userId: 'user-selin',
      items,
      ...extra,
    }),
  )
}

const LAGER = line('ink', 'House Lager', { category: 'beer', by_glass_price: 8 })
const SMOKY = line('pencil', 'Smoky No. 4', { bottle_price: 18 })
const LAGER_READ = read('ink', 'House Lager', { category: 'beer', byGlassPrice: 8, rawText: 'House Lager 8' })
const SMOKY_READ = read('pencil', 'Smoky No. 4', {
  bottlePrice: 18,
  rawText: 'Smoky No. 4 18',
  matched: false,
  needsReview: true,
})

beforeEach(() => {
  vi.clearAllMocks()
  signedIn()
  get.mockResolvedValue({ data: { houses: [], held: [], accessEnded: false } })
  reviewMenuItem.mockResolvedValue({})
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
    createFirstHouse.mockImplementation(async () => {
      // The house now exists: the entry check must not fire again mid-wizard.
      signedIn({ ...SELIN, restaurantId: 'house-1' })
      return 'house-1'
    })
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: /Welcome, Selin/ })).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/auth/houses')
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
    expect(navigate).not.toHaveBeenCalled()
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
    await screen.findByRole('heading', { name: /Welcome, Selin/ })
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
    await screen.findByRole('heading', { name: /Welcome, Selin/ })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Your restaurant' })
    fireEvent.click(screen.getByRole('button', { name: /Use my location/ }))
    expect(getCurrentPosition).toHaveBeenCalled()
    expect(await screen.findByText('Places biased to 41.01,28.97')).toBeInTheDocument()
    expect(screen.getByText('Restaurant search is now centred near you.')).toBeInTheDocument()
  })

    it('stamps the reading it keeps with the house it was read for', async () => {
    importMenu.mockResolvedValue({
      menuId: 'menu',
      itemsExtracted: 1,
      submissionsCreated: 0,
      items: [LAGER_READ],
    })
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    await screen.findByRole('heading', { name: /Welcome, Selin/ })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Your restaurant' })
    fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'Meyhane' } })
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '1 House Street' } })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Istanbul' } })
    fireEvent.click(screen.getByRole('button', { name: 'Choose Türkiye' }))
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    const photo = new File(['x'], 'menu.png', { type: 'image/png' })
    fireEvent.drop(screen.getByText('Drop the menu here'), { dataTransfer: { files: [photo] } })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/house/menu', { replace: true }), {
      timeout: 3000,
    })
    const kept = JSON.parse(sessionStorage.getItem('mudavym:first-proof') ?? 'null')
    expect(kept).toMatchObject({ menuId: 'menu', restaurantId: 'house-1', userId: 'user-selin' })
  })
})

describe('/get-started for an account that already has a house (SETUP-01)', () => {
  it('sends an account with an open house to /house and never shows the wizard', async () => {
    signedIn({ ...SELIN, restaurantId: 'house-1' })
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/house', { replace: true }))
    expect(screen.queryByRole('heading', { name: /Welcome, Selin/ })).not.toBeInTheDocument()
    expect(get).not.toHaveBeenCalled()
  })

  it('sends an account that holds houses but has none open to choose one', async () => {
    get.mockResolvedValue({
      data: { houses: [{ id: 'house-1', name: 'Meyhane' }], held: [], accessEnded: false },
    })
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/choose-house', { replace: true }))
    expect(screen.queryByRole('heading', { name: /Welcome, Selin/ })).not.toBeInTheDocument()
  })

  it('sends a membership waiting to be accepted to choose, too', async () => {
    get.mockResolvedValue({
      data: { houses: [], held: [{ id: 'house-2', name: 'Lokanta' }], accessEnded: false },
    })
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/choose-house', { replace: true }))
  })

  it('says a failed check failed instead of opening the wizard as if there were no house', async () => {
    get.mockRejectedValueOnce(new Error('Network Error'))
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not check whether this account already has a house: Network Error',
    )
    expect(screen.queryByRole('heading', { name: /Welcome, Selin/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: /Welcome, Selin/ })).toBeInTheDocument()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('reads a reply without a list of houses as a failed check, not as none', async () => {
    get.mockResolvedValueOnce({ data: {} })
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent(/came back without a list/)
    expect(screen.queryByRole('heading', { name: /Welcome, Selin/ })).not.toBeInTheDocument()
  })

  it('sends an unverified account to verify its email first', async () => {
    signedIn({ ...SELIN, emailVerified: false })
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/verify-email', { replace: true }))
    expect(get).not.toHaveBeenCalled()
  })

  it('waits for the session before deciding', async () => {
    auth.value = { user: null, loading: true, activeRestaurantId: null, createFirstHouse }
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent('Checking this account')
    expect(navigate).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })
})

describe('the first proof reads from the house (MENU-07)', () => {
  it('prints the first proof and expands only a pencilled line inline', async () => {
    serve([LAGER, SMOKY])
    keepReading([LAGER_READ, SMOKY_READ])
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    const counts = await screen.findByRole('group', { name: 'The reading count' })
    expect(counts).toHaveTextContent(/2read1set1pencilled/)
    expect(screen.queryByText('Smoky No. 4 18')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Smoky No. 4/ }))
    expect(await screen.findByText('Smoky No. 4 18')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/Not on this menu:/)).toBeInTheDocument())
    expect(screen.queryByText(/certain/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/likely/i)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/approve all/i)
    expect(screen.queryByText(/does not keep which wines matched/)).not.toBeInTheDocument()
    expect(getMenuVersion).toHaveBeenCalledWith('menu')
  })

  it("shows the house's stored lines in a tab that never read the menu", async () => {
    serve([LAGER, line('mystery', 'Mystery Bottle', { category: 'unknown', bottle_price: 40 })])
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(await screen.findByText('House Lager')).toBeInTheDocument()
    expect(screen.getByText('Mystery Bottle')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'The reading count' })).toHaveTextContent(
      /2read1set1pencilled/,
    )
    // The record keeps no match: the page says pencils follow the section alone.
    expect(screen.getByText(/does not keep which wines matched the library/)).toBeInTheDocument()
  })

  it("ignores another house's reading left in this tab", async () => {
    serve([LAGER])
    keepReading([read('ink', 'Another House Red', { category: 'red', rawText: 'Another House Red 30' })], {
      restaurantId: 'house-2',
    })
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(await screen.findByText('House Lager')).toBeInTheDocument()
    expect(screen.queryByText(/Another House Red/)).not.toBeInTheDocument()
    expect(screen.getByText(/does not keep which wines matched the library/)).toBeInTheDocument()
  })

  it("ignores another person's reading left in this tab", async () => {
    serve([SMOKY])
    keepReading([read('pencil', 'Smoky No. 4', { rawText: 'Smoky No. 4,18,7.20,Vini Ltd' })], {
      userId: 'user-owner',
    })
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Smoky No. 4/ }))
    expect(screen.queryByText(/Vini Ltd/)).not.toBeInTheDocument()
    expect(screen.getByText(/does not keep which wines matched the library/)).toBeInTheDocument()
  })

  it('splits by the house\'s kitchen_line and says a held-back raw line is an owner\'s or a manager\'s', async () => {
    // A staff reply under ADR 0309 option 1c: no raw line, each line's kitchen
    // split, and the lines that had a raw line say it was held back.
    serve(
      [
        line('barolo', 'Barolo', { bottle_price: 120, kitchen_line: false, raw_line_withheld: true }),
        line('tiramisu', 'Tiramisu', { bottle_price: 12, kitchen_line: true, raw_line_withheld: true }),
        line('lager', 'House Lager', { category: 'beer', by_glass_price: 8, kitchen_line: false }),
      ],
      {},
      { rawLineWithheld: true },
    )
    keepReading([read('barolo', 'Barolo', { rawText: 'Barolo,Vietti,2019,red,120,38.50,Vini Ltd,68%,Wines' })], {
      userId: 'user-owner',
    })
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(await screen.findByText(/1 kitchen line set aside/)).toBeInTheDocument()
    expect(screen.queryByText('Tiramisu')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Barolo/ }))
    expect(screen.getByRole('blockquote')).toHaveTextContent('Barolo')
    expect(
      screen.getByText(/The whole line as it was read is shown only to an owner or a manager/),
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/38\.50|Vini Ltd|68%/)
  })

  it("shows an owner or a manager the house's whole raw line, with no held-back sentence", async () => {
    serve([
      line('barolo', 'Barolo', {
        bottle_price: 120,
        kitchen_line: false,
        raw_extracted_text: 'Barolo,Vietti,2019,red,120,38.50,Vini Ltd,68%,Wines',
      }),
    ])
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Barolo/ }))
    expect(screen.getByRole('blockquote')).toHaveTextContent('Barolo,Vietti,2019,red,120,38.50,Vini Ltd,68%,Wines')
    expect(screen.queryByText(/shown only to an owner or a manager/)).not.toBeInTheDocument()
  })

  it('falls back to the raw line when the gateway sends no kitchen_line', async () => {
    serve([LAGER, line('lamb', 'Lamb', { raw_extracted_text: 'Lamb shank (kitchen) 24' })])
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(await screen.findByText(/1 kitchen line set aside/)).toBeInTheDocument()
    expect(screen.queryByText('Lamb')).not.toBeInTheDocument()
  })

  it('ignores a reading of an older menu of the same house', async () => {
    serve([SMOKY])
    keepReading([read('pencil', 'Smoky No. 4', { rawText: 'Old raw line' })], { menuId: 'older-menu' })
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Smoky No. 4/ }))
    expect(screen.queryByText('Old raw line')).not.toBeInTheDocument()
    // No raw line here, but none was held back either: a scan keeps none.
    expect(screen.queryByText(/shown only to an owner or a manager/)).not.toBeInTheDocument()
  })

  it('drops the reading when another person signs in to the same tab', async () => {
    serve([LAGER])
    keepReading([{ ...LAGER_READ, matched: false, needsReview: true }])
    const { rerender } = render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(await screen.findByRole('group', { name: 'The reading count' })).toHaveTextContent(/1pencilled/)
    auth.value = { ...auth.value, user: { ...SELIN, userId: 'user-staff' } }
    rerender(<MemoryRouter><HouseMenu /></MemoryRouter>)
    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'The reading count' })).toHaveTextContent(/0pencilled/),
    )
  })

  it('sends a house with no kept menu to the Menu page, never to the sign-up wizard', async () => {
    listMenuVersions.mockResolvedValue({ current: null, lastUsed: null, versions: [] })
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'No menu has been read yet.' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Read a menu' }))
    expect(navigate).toHaveBeenCalledWith('/menu')
    expect(navigate).not.toHaveBeenCalledWith('/get-started')
  })

  it('says a failed read failed, never that the house has no menu', async () => {
    listMenuVersions.mockRejectedValueOnce({ response: { data: { message: 'The menus could not be read.' } } })
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('The menus could not be read.')
    expect(screen.queryByText(/No menu has been read yet/)).not.toBeInTheDocument()
    serve([LAGER])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('House Lager')).toBeInTheDocument()
  })

  it('says a draft is not the house\'s current menu', async () => {
    serve([LAGER], { status: 'draft', current: false })
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(await screen.findByText(/Kept as a draft — not the house's current menu/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open the Menu page' }))
    expect(navigate).toHaveBeenCalledWith('/menu')
  })

  it('says when the menu shown is the current one', async () => {
    serve([LAGER], { status: 'active', current: true })
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(await screen.findByText("This is the house's current menu.")).toBeInTheDocument()
    expect(screen.queryByText(/Kept as a draft/)).not.toBeInTheDocument()
  })

  it('counts kitchen lines instead of dropping them, and never prints an empty failed proof', async () => {
    serve([LAGER, line('food', 'Grilled octopus', { category: 'food', bottle_price: 24 })])
    keepReading([
      LAGER_READ,
      read('food', 'Grilled octopus', {
        category: 'food',
        bottlePrice: 24,
        rawText: 'Grilled octopus starter 24',
        matched: false,
        needsReview: true,
      }),
    ])
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(await screen.findByText(/1 kitchen line set aside/)).toBeInTheDocument()
    expect(screen.queryByText('Grilled octopus')).not.toBeInTheDocument()
  })

  it('says the file could not be read instead of printing an empty proof', async () => {
    serve([], { linesExtracted: 0 })
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: /couldn't read this file/i })).toBeInTheDocument()
  })

  it('shows an honest empty crop when the original page was not kept', async () => {
    serve([SMOKY], { linesExtracted: 1 })
    keepReading([SMOKY_READ])
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Smoky No. 4/ }))
    expect(screen.queryByRole('button', { name: /Show my original/ })).not.toBeInTheDocument()
    expect(await screen.findByText(/the original page was not kept/)).toBeInTheDocument()
  })

  it('does not call a kept original lost when this view has no copy of it', async () => {
    serve([SMOKY], { linesExtracted: 1, source: { kept: true, mime: 'image/png', bytes: 10, failure: null } })
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Smoky No. 4/ }))
    expect(await screen.findByText(/the original is kept with the menu, but not in this view/)).toBeInTheDocument()
    expect(screen.queryByText(/was not kept/)).not.toBeInTheDocument()
  })

  it('splits the original page when a source image exists', async () => {
    serve([SMOKY], { linesExtracted: 1 })
    keepReading([SMOKY_READ], { sourceImage: 'data:image/png;base64,aaaa' })
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Show my original' }))
    expect(screen.getByAltText('Your original menu')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Smoky No. 4/ }))
    expect(await screen.findByText(/the reading did not return a box/)).toBeInTheDocument()
    expect(screen.queryByAltText('Crop of this line from the original')).not.toBeInTheDocument()
  })

  it('crops a line only when the extractor already returned a box', async () => {
    serve([SMOKY], { linesExtracted: 1 })
    keepReading([{ ...SMOKY_READ, bbox: { x: 10, y: 20, width: 80, height: 24, page: 1 } }], {
      sourceImage: 'data:image/png;base64,aaaa',
    })
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Smoky No. 4/ }))
    expect(await screen.findByAltText('Crop of this line from the original')).toBeInTheDocument()
  })

  it("adds an absent section line to the house's own menu", async () => {
    serve([LAGER], { menuId: 'server-menu', linesExtracted: 1 })
    keepReading([LAGER_READ], { menuId: 'server-menu' })
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Add it.' }))
    fireEvent.change(screen.getByLabelText('New menu line'), { target: { value: 'House Cider' } })
    fireEvent.change(screen.getByLabelText('New line section'), { target: { value: 'cider' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add this line' }))
    await waitFor(() =>
      expect(addMenuItem).toHaveBeenCalledWith('server-menu', { name: 'House Cider', category: 'cider' }),
    )
    expect(await screen.findByText('House Cider')).toBeInTheDocument()
  })
})

describe('a refused save says so (MENU-08)', () => {
  it('shows why a line was not added, and keeps the form', async () => {
    serve([LAGER], { linesExtracted: 1 })
    addMenuItem.mockRejectedValueOnce({
      response: { data: { message: 'Only an owner or a manager can add a menu line.' } },
    })
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Add it.' }))
    fireEvent.change(screen.getByLabelText('New menu line'), { target: { value: 'House Cider' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add this line' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The line was not added: Only an owner or a manager can add a menu line.',
    )
    expect(screen.getByLabelText('New menu line')).toHaveValue('House Cider')
    expect(screen.queryByText('House Cider')).not.toBeInTheDocument()
  })

  it('shows why a line was not placed, and leaves it pencilled', async () => {
    serve([SMOKY], { linesExtracted: 1 })
    keepReading([SMOKY_READ])
    reviewMenuItem.mockRejectedValueOnce(new Error('Network Error'))
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Smoky No. 4/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Beer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This line was not placed: Network Error')
    expect(screen.getByRole('group', { name: 'The reading count' })).toHaveTextContent(/1pencilled/)
  })

  it("keeps a placed line placed in this tab's reading", async () => {
    serve([SMOKY], { linesExtracted: 1 })
    keepReading([SMOKY_READ])
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Smoky No. 4/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Beer' }))
    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'The reading count' })).toHaveTextContent(/0pencilled/),
    )
    const kept = JSON.parse(sessionStorage.getItem('mudavym:first-proof') ?? 'null')
    expect(kept.items[0]).toMatchObject({ category: 'beer', needsReview: false, matched: true })
  })
})

describe('/house reads the house (MENU-07)', () => {
  it('opens the house contents page with exactly one ask', async () => {
    serve([SMOKY], { linesExtracted: 1 })
    keepReading([SMOKY_READ])
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    expect(await screen.findByText('1 pencilled')).toBeInTheDocument()
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
    expect(screen.getByText(/Last invoice · noted — suvla-sept.pdf/)).toBeInTheDocument()
    expect(screen.getByText(/Only its name is noted, in this tab: the file is not sent, read or kept yet/)).toBeInTheDocument()
    expect(screen.queryByText(/kept for later/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open later' }))
    expect(navigate).toHaveBeenCalledWith('/settings?tab=cellar')
  })

  it("never shows the last house's invoice note after a house switch", async () => {
    serve([SMOKY], { linesExtracted: 1 })
    const { rerender } = render(<MemoryRouter><HouseContents /></MemoryRouter>)
    await screen.findByText(/pencilled|The first proof is set/)
    const file = new File(['x'], 'suvla-sept.pdf', { type: 'application/pdf' })
    fireEvent.drop(screen.getByText(/Drop the last invoice here/), {
      dataTransfer: { files: [file] },
    })
    expect(screen.getByText(/Last invoice · noted — suvla-sept.pdf/)).toBeInTheDocument()
    auth.value = { ...auth.value, activeRestaurantId: 'house-2' }
    rerender(<MemoryRouter><HouseContents /></MemoryRouter>)
    expect(screen.queryByText(/suvla-sept.pdf/)).toBeNull()
    await waitFor(() => expect(screen.queryByText(/Reading the house/)).toBeNull())
    expect(screen.queryByText(/suvla-sept.pdf/)).toBeNull()
    expect(screen.getByText('Last invoice · later')).toBeInTheDocument()
  })

  it("never shows another person's invoice note in the same tab", async () => {
    serve([SMOKY], { linesExtracted: 1 })
    sessionStorage.setItem(
      'mudavym:last-invoice-later',
      JSON.stringify({ restaurantId: 'house-1', userId: 'user-owner', name: 'vini-ltd-sept.pdf' }),
    )
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    await screen.findByText(/pencilled|The first proof is set/)
    expect(screen.queryByText(/vini-ltd-sept.pdf/)).toBeNull()
    expect(screen.getByText('Last invoice · later')).toBeInTheDocument()
  })

  it("counts a line the house calls a kitchen line out of the pencils", async () => {
    serve([LAGER, line('tiramisu', 'Tiramisu', { bottle_price: 12, kitchen_line: true })], { linesExtracted: 2 })
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: 'The first proof is set.' })).toBeInTheDocument()
  })

  it("shows the house's menu in a tab that never read it", async () => {
    serve([LAGER], { linesExtracted: 1 })
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'The first proof is set.' }))
    expect(navigate).toHaveBeenCalledWith('/house/menu')
    expect(screen.queryByText('No menu read yet.')).not.toBeInTheDocument()
  })

  it('says a failed read failed, never "No menu read yet"', async () => {
    listMenuVersions.mockRejectedValueOnce(new Error('Network Error'))
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent("The house's menu could not be read: Network Error")
    expect(screen.queryByText('No menu read yet.')).not.toBeInTheDocument()
  })

  it('offers the Menu page when the house has kept no menu', async () => {
    listMenuVersions.mockResolvedValue({ current: null, lastUsed: null, versions: [] })
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    expect(await screen.findByText('No menu read yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Read a menu' }))
    expect(navigate).toHaveBeenCalledWith('/menu')
  })
})
