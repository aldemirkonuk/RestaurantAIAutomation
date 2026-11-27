/** r109 onboarding g1: the house's opening hours come with the Places pick. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaceResult } from '../../components/ui/PlacesAutocomplete'

const { patch, createFirstHouse, putOperatingHours } = vi.hoisted(() => ({
  patch: vi.fn(),
  createFirstHouse: vi.fn(),
  putOperatingHours: vi.fn(),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: 'u1', name: 'Ada', restaurantId: '', role: null, emailVerified: true },
    loading: false,
    createFirstHouse,
    signInWithSession: vi.fn(),
  }),
}))
vi.mock('../../services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/client')>()),
  apiClient: { patch },
}))
vi.mock('../../services/api/restaurants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/restaurants')>()),
  restaurantsApi: { putOperatingHours },
}))
vi.mock('../../services/api/menus', () => ({ importMenu: vi.fn() }))
vi.mock('../../services/api/settings', () => ({ settingsApi: { houseCurrency: vi.fn(() => Promise.resolve(null)) } }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../lib/googleMaps', () => ({ isMapsConfigured: () => true }))

let pick: PlaceResult
vi.mock('../../components/ui/PlacesAutocomplete', () => ({
  warmPlaces: vi.fn(),
  PlacesAutocomplete: ({ onPlaceSelect }: { onPlaceSelect: (p: PlaceResult) => void }) => (
    <button type="button" onClick={() => onPlaceSelect(pick)}>Pick the place</button>
  ),
}))
vi.mock('../../components/ui/CountryCombobox', () => ({ CountryCombobox: () => null }))
vi.mock('../../components/onboarding/MenuCsvUpload', () => ({ MenuCsvUpload: () => null }))
vi.mock('../../components/onboarding/MenuScanUpload', () => ({ MenuScanUpload: () => null }))
vi.mock('../../components/onboarding/MenuManualEntry', () => ({ MenuManualEntry: () => null }))

import GetStarted from '../GetStarted'
import { HOURS_UNSAVED_KEY } from '../../lib/houseHoursNote'

const pt = (day: number, hour: number, minute = 0) => ({ day, hour, minute })
// Tue..Sun 17:00 to 01:00 the next day; Places' Sunday is 0, so Sun closes on Mon (1).
const EVENINGS = [2, 3, 4, 5, 6, 0].map((d) => ({ open: pt(d, 17), close: pt((d + 1) % 7, 1) }))

const place = (openingPeriods: PlaceResult['openingPeriods']): PlaceResult => ({
  placeName: 'Meyhane',
  streetAddress: '1 Kale Sk',
  city: 'Antalya',
  stateProvince: '',
  postalCode: '07100',
  country: 'Turkey',
  countryCode: 'TR',
  neighborhood: '',
  latitude: 36.88,
  longitude: 30.7,
  googlePlaceId: 'gp1',
  phone: null,
  utcOffsetMinutes: 180,
  openingPeriods,
})

const night = { open: '17:00', close: '01:00' }
const WEEK = { mon: [], tue: [night], wed: [night], thu: [night], fri: [night], sat: [night], sun: [night] }

async function pickAndOpen(untick = false) {
  render(<MemoryRouter><GetStarted /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Pick the place' }))
  if (untick) fireEvent.click(screen.getByRole('checkbox', { name: 'Use these hours' }))
  fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
  await waitFor(() => expect(createFirstHouse).toHaveBeenCalledTimes(1))
}

beforeEach(() => {
  sessionStorage.clear()
  patch.mockReset().mockResolvedValue({})
  createFirstHouse.mockReset().mockResolvedValue({ restaurantId: 'h1', detailsLoaded: true })
  putOperatingHours.mockReset().mockResolvedValue({})
  pick = place(EVENINGS)
})

describe('GetStarted: hours from the Places pick', () => {
  it('shows the summary with a ticked 44 px box', async () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Pick the place' }))
    expect(screen.getByText('Open Tue–Sun 17:00–01:00, from Google')).toBeInTheDocument()
    const box = screen.getByRole('checkbox', { name: 'Use these hours' })
    expect(box).toBeChecked()
    expect(box.closest('label')).toHaveClass('min-h-11')
  })

  it('writes the exact week once, after the house opens', async () => {
    await pickAndOpen()
    await waitFor(() => expect(putOperatingHours).toHaveBeenCalledTimes(1))
    expect(putOperatingHours).toHaveBeenCalledWith('h1', WEEK)
    expect(createFirstHouse.mock.invocationCallOrder[0]).toBeLessThan(putOperatingHours.mock.invocationCallOrder[0])
  })

  it('writes nothing when the box is unticked', async () => {
    await pickAndOpen(true)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'This is us' })).not.toBeInTheDocument())
    expect(putOperatingHours).not.toHaveBeenCalled()
  })

  it('writes nothing when the house does not open', async () => {
    createFirstHouse.mockRejectedValue(Object.assign(new Error('no'), { response: { status: 500 } }))
    await pickAndOpen()
    await screen.findByRole('alert')
    expect(putOperatingHours).not.toHaveBeenCalled()
  })

  it('a failed write does not hold the next step and leaves a note for /house', async () => {
    putOperatingHours.mockRejectedValue(new Error('down'))
    await pickAndOpen()
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem(HOURS_UNSAVED_KEY) ?? '{}')).toEqual({ houseId: 'h1' }))
    expect(screen.queryByRole('button', { name: 'This is us' })).not.toBeInTheDocument()
  })

  it('offers nothing when Google has no usable hours (24/7 has no close)', async () => {
    pick = place([{ open: pt(0, 0), close: null }])
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Pick the place' }))
    expect(screen.queryByRole('checkbox', { name: 'Use these hours' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await waitFor(() => expect(createFirstHouse).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'This is us' })).not.toBeInTheDocument())
    expect(putOperatingHours).not.toHaveBeenCalled()
  })
})
