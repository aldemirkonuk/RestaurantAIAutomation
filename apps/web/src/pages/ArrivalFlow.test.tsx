import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GetStarted from './GetStarted'
import HouseMenu from './HouseMenu'

const { navigate, createFirstHouse, patch } = vi.hoisted(() => ({
  navigate: vi.fn(),
  createFirstHouse: vi.fn(),
  patch: vi.fn(),
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
vi.mock('../components/ui/PlacesAutocomplete', () => ({
  PlacesAutocomplete: ({ onPlaceSelect }: { onPlaceSelect: (place: any) => void }) => (
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
  ),
}))
vi.mock('../components/onboarding/MenuCsvUpload', () => ({ MenuCsvUpload: () => null }))
vi.mock('../components/onboarding/MenuScanUpload', () => ({ MenuScanUpload: () => null }))
vi.mock('../components/onboarding/MenuManualEntry', () => ({ MenuManualEntry: () => null }))
vi.mock('../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../services/api/menus')>(
    '../services/api/menus',
  )
  return { ...actual, reviewMenuItem: vi.fn().mockResolvedValue({}) }
})

beforeEach(() => {
  vi.clearAllMocks()
  patch.mockResolvedValue({})
  createFirstHouse.mockResolvedValue('house-1')
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
    expect(screen.queryByText(/certain/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/likely/i)).not.toBeInTheDocument()
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
})
