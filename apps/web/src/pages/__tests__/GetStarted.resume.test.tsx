/**
 * r107 onboarding g4: /get-started opens on the restaurant for a named person
 * (the base already dropped the You step and the role), and what was typed on
 * that step survives a reload: sessionStorage, 30 minutes, the person's own,
 * gone once the house is opened.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { navigate, createFirstHouse, patch, who } = vi.hoisted(() => ({
  navigate: vi.fn(),
  createFirstHouse: vi.fn(),
  patch: vi.fn(),
  who: { name: 'Selin Kaya', userId: 'u1' as string | undefined },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { name: who.name, userId: who.userId, restaurantId: '', role: null, emailVerified: true },
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
vi.mock('../../lib/browserTimezone', () => ({ getBrowserTimezone: () => 'America/New_York' }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../lib/googleMaps', () => ({ isMapsConfigured: () => false }))
vi.mock('../../components/ui/PlacesAutocomplete', () => ({ PlacesAutocomplete: () => null }))
vi.mock('../../components/ui/CountryCombobox', () => ({
  CountryCombobox: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <input aria-label="Country" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))
vi.mock('../../components/onboarding/MenuCsvUpload', () => ({ MenuCsvUpload: () => null }))
vi.mock('../../components/onboarding/MenuScanUpload', () => ({ MenuScanUpload: () => null }))
vi.mock('../../components/onboarding/MenuManualEntry', () => ({ MenuManualEntry: () => null }))

import GetStarted from '../GetStarted'

const KEY = 'mudavym:get-started-draft'
const page = () => <MemoryRouter><GetStarted /></MemoryRouter>
const val = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value
function typeHouse() {
  fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'Meyhane' } })
  fireEvent.change(screen.getByLabelText('Address'), { target: { value: '1 House Street' } })
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Istanbul' } })
  fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'Türkiye' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  who.name = 'Selin Kaya'
  who.userId = 'u1'
  createFirstHouse.mockResolvedValue({ detailsLoaded: true })
  patch.mockResolvedValue({})
})
afterEach(cleanup)

describe('GetStarted: resumes where the person left', () => {
  it('a named person lands on the restaurant, name not asked again', () => {
    render(page())
    expect(screen.getByRole('heading', { name: 'Your restaurant' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Your name')).toBeNull()
  })

  it('an unnamed person is asked the name on the same step', () => {
    who.name = ''
    render(page())
    expect(screen.getByLabelText('Your name')).toBeInTheDocument()
  })

  it('a remount brings the typed restaurant fields back', () => {
    const a = render(page())
    typeHouse()
    a.unmount()
    expect(sessionStorage.getItem(KEY)).toContain('Meyhane')
    expect(localStorage.getItem(KEY)).toBeNull()
    render(page())
    expect(val('Restaurant name')).toBe('Meyhane')
    expect(val('Address')).toBe('1 House Street')
    expect(val('City')).toBe('Istanbul')
    expect(val('Country')).toBe('Türkiye')
  })

  it('opening the house clears the draft, and leaving the page does not bring it back', async () => {
    const a = render(page())
    typeHouse()
    await waitFor(() => expect(sessionStorage.getItem(KEY)).toContain('Meyhane'))
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(sessionStorage.getItem(KEY)).toBeNull()
    a.unmount()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('drops a draft older than 30 minutes', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ restaurantName: 'Old', u: 'u1', at: Date.now() - 31 * 60_000 }))
    render(page())
    expect(val('Restaurant name')).toBe('')
  })

  it('does not hand one account\'s draft to another', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ restaurantName: 'Theirs', u: 'u2', at: Date.now() }))
    render(page())
    expect(val('Restaurant name')).toBe('')
  })

  it('a hard reload: the session arrives after the first paint, and the draft is put back and kept', async () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ restaurantName: 'Meyhane', address: '1 House Street', city: 'Istanbul', country: 'Türkiye', stateProvince: '', postalCode: '', restaurantPhone: '', u: 'u1', at: Date.now() }),
    )
    who.userId = undefined
    const view = render(page())
    expect(val('Restaurant name')).toBe('')
    who.userId = 'u1'
    view.rerender(page())
    await waitFor(() => expect(val('Restaurant name')).toBe('Meyhane'))
    expect(val('City')).toBe('Istanbul')
    await new Promise((r) => setTimeout(r, 600))
    expect(JSON.parse(sessionStorage.getItem(KEY) as string).restaurantName).toBe('Meyhane')
  })

  it('a late session does not overwrite what the person already typed', async () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ restaurantName: 'Old', address: 'Old street', city: 'Old city', country: '', stateProvince: '', postalCode: '', restaurantPhone: '', u: 'u1', at: Date.now() }),
    )
    who.userId = undefined
    const view = render(page())
    fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'New' } })
    who.userId = 'u1'
    view.rerender(page())
    await new Promise((r) => setTimeout(r, 50))
    expect(val('Restaurant name')).toBe('New')
    expect(val('Address')).toBe('')
  })
})
