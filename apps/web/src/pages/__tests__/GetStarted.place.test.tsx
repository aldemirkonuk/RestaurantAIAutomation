/** OB-7: the place fills the house; the You step and the role are gone. */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { offsetMinutesOf } from '../../lib/zoneForPlace'

const { navigate, createFirstHouse, patch, placeProps, nextPlace, browserZone, maps } = vi.hoisted(() => ({
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
    user: { name: 'Selin Kaya', restaurantId: '', role: null, emailVerified: true },
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
vi.mock('../../components/onboarding/MenuManualEntry', () => ({ MenuManualEntry: () => null }))

import GetStarted from '../GetStarted'

const page = () => <MemoryRouter><GetStarted /></MemoryRouter>
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

beforeEach(() => {
  vi.clearAllMocks()
  browserZone.current = 'America/New_York'
  maps.on = true
  sessionStorage.clear()
  createFirstHouse.mockResolvedValue({ detailsLoaded: true })
  patch.mockResolvedValue({})
})

describe('GetStarted: the place fills the house', () => {
  it('(t5) opens on the restaurant, with no You step, role or mobile asked', () => {
    render(page())
    expect(screen.getByRole('heading', { name: 'Your restaurant' })).toBeInTheDocument()
    expect(screen.getByText(/Welcome, Selin\./)).toBeInTheDocument()
    expect(screen.queryByText(/Role/)).toBeNull()
    expect(screen.queryByLabelText('Mobile')).toBeNull()
    expect(screen.getByText('01 · Your restaurant')).toBeInTheDocument()
    expect(placeProps.current?.withContact).toBe(true)
  })

  it('(t1) a pick with a phone fills the phone; (t2) Türkiye names Istanbul over the browser', async () => {
    nextPlace.current = place({})
    render(page())
    fireEvent.click(screen.getByRole('button', { name: 'Pick the place' }))
    expect(screen.getByLabelText('Restaurant phone')).toHaveValue('+90 212 555 0000')
    expect(screen.getByText(/Clock · Istanbul · .+, UTC\+3 \(from the country\)/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(createFirstHouse).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'Europe/Istanbul', restaurantPhone: '+90 212 555 0000' }),
    )
    // (t4) the role is never written; the unchanged name is not re-saved.
    expect(sessionStorage.getItem('mudavym:arrival-role')).toBeNull()
    expect(patch).not.toHaveBeenCalled()
  })

  it('(t3) a place whose clock differs from the browser asks for a pick before opening', async () => {
    const la = offsetMinutesOf('America/Los_Angeles')!
    nextPlace.current = place({ country: 'United States', countryCode: 'US', city: 'Los Angeles', utcOffsetMinutes: la })
    render(page())
    fireEvent.click(screen.getByRole('button', { name: 'Pick the place' }))
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Choose the house's clock/)
    expect(createFirstHouse).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText("The house's clock"), { target: { value: 'America/Los_Angeles' } })
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(createFirstHouse).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'America/Los_Angeles' }))
  })

  it('a changed name is saved before the house opens; Maps off names no setting', async () => {
    maps.on = false
    render(page())
    expect(screen.getByText('Search is off here; type the address.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('VITE_')
    fireEvent.click(screen.getByRole('button', { name: 'Change your name' }))
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Selin K.' } })
    fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'Meyhane' } })
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '1 House Street' } })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Istanbul' } })
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'Türkiye' } })
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(patch).toHaveBeenCalledWith('/auth/me', { name: 'Selin K.' })
    expect(patch.mock.invocationCallOrder[0]).toBeLessThan(createFirstHouse.mock.invocationCallOrder[0])
  })

  // Fix round (#1055).
  it('an owner in Bogota opening a US house at the same offset is asked for the clock', async () => {
    browserZone.current = 'America/Bogota'
    const ny = offsetMinutesOf('America/New_York')!
    nextPlace.current = place({ country: 'United States', countryCode: 'US', city: 'New York', utcOffsetMinutes: ny })
    render(page())
    fireEvent.click(screen.getByRole('button', { name: 'Pick the place' }))
    expect(screen.queryByText(/America\/Bogota/)).toBeNull()
    const select = screen.getByLabelText("The house's clock")
    // Named as an owner reads it; the value sent is still the IANA name (r32).
    expect(select.textContent).toContain('New York · Eastern Time')
    expect(select.textContent).not.toContain('America/New_York')
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Choose the house's clock/)
    expect(createFirstHouse).not.toHaveBeenCalled()
  })

  it('a pick with nothing to offer opens the house with no clock', async () => {
    nextPlace.current = place({ country: 'Nowhere', countryCode: null, utcOffsetMinutes: 7 })
    render(page())
    fireEvent.click(screen.getByRole('button', { name: 'Pick the place' }))
    expect(screen.queryByLabelText("The house's clock")).toBeNull()
    expect(screen.getByText(/Clock · Not detected\. Set it in Settings › Time zone/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(createFirstHouse).toHaveBeenCalledWith(expect.objectContaining({ timezone: undefined }))
  })

  it('changing the country after a pick drops the earlier place\'s clock', async () => {
    nextPlace.current = place({})
    render(page())
    fireEvent.click(screen.getByRole('button', { name: 'Pick the place' }))
    // Named as an owner reads it (r32); the zone sent is still the IANA name.
    expect(screen.getByText(/Clock · Istanbul · .+, UTC\+3 \(from the country\)/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'United States' } })
    expect(screen.queryByText(/Clock · Istanbul/)).toBeNull()
    expect(screen.getByText(/Clock · New York · Eastern Time, UTC−\d \(from this browser\)/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(createFirstHouse).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'America/New_York', country: 'United States' }))
  })

  // Walk 2026-11-11: with Maps off the find box and "Use my location" were
  // still drawn; the location button then said to search by name, which
  // there is no way to do. Neither is drawn; the typed fields are the form.
  it('Maps off draws no find box and no location button', () => {
    maps.on = false
    render(page())
    expect(screen.queryByRole('button', { name: 'Pick the place' })).toBeNull()
    expect(screen.queryByText('Find your restaurant')).toBeNull()
    expect(screen.queryByRole('button', { name: /Use my location/ })).toBeNull()
    expect(screen.queryByText(/Find the exact place/)).toBeNull()
    expect(screen.getByLabelText('Address')).toBeInTheDocument()
  })

  it('Maps on still draws the find box and the location button', () => {
    render(page())
    expect(screen.getByRole('button', { name: 'Pick the place' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Use my location/ })).toBeInTheDocument()
    expect(screen.getByText(/Find the exact place/)).toBeInTheDocument()
  })
})
