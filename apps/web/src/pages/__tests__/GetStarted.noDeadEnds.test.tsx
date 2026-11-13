/**
 * /get-started has no dead end (r21, 2026-11-13): an unverified address is
 * sent to verify before the form, a 403 says why and links to verify, an
 * empty field is named, Enter in a typed field opens the house, a signed-in
 * person can sign out, and a photo that is not read names the other ways in.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { navigate, createFirstHouse, signInWithSession, logout, patch, importMenu, auth } = vi.hoisted(() => ({
  navigate: vi.fn(),
  createFirstHouse: vi.fn(),
  signInWithSession: vi.fn(),
  logout: vi.fn(),
  patch: vi.fn(),
  importMenu: vi.fn(),
  auth: { user: null as Record<string, unknown> | null, loading: false },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ ...auth, createFirstHouse, signInWithSession, logout }),
}))
vi.mock('../../services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/client')>()),
  apiClient: { patch },
}))
vi.mock('../../services/api/menus', () => ({ importMenu }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../lib/googleMaps', () => ({ isMapsConfigured: () => false }))
vi.mock('../../components/ui/PlacesAutocomplete', () => ({ PlacesAutocomplete: () => null }))
vi.mock('../../components/ui/CountryCombobox', () => ({
  CountryCombobox: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange('Türkiye')}>Choose Türkiye</button>
  ),
}))
vi.mock('../../components/onboarding/MenuCsvUpload', () => ({ MenuCsvUpload: () => null }))
vi.mock('../../components/onboarding/MenuScanUpload', () => ({ MenuScanUpload: () => null }))
vi.mock('../../components/onboarding/MenuManualEntry', () => ({ MenuManualEntry: () => null }))

import GetStarted from '../GetStarted'

const page = () => <MemoryRouter><GetStarted /></MemoryRouter>
const newcomer = { name: 'Selin Kaya', restaurantId: '', role: null, emailVerified: true }
const owner = { name: 'Selin Kaya', restaurantId: 'house-1', role: 'owner', emailVerified: true }

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = null
  auth.loading = false
  patch.mockResolvedValue({})
  logout.mockResolvedValue(true)
  createFirstHouse.mockResolvedValue({ restaurantId: 'house-1', detailsLoaded: true })
  sessionStorage.clear()
  localStorage.clear()
})

const fill = (fields: Partial<Record<'Restaurant name' | 'Address' | 'City', string>>) => {
  for (const [label, value] of Object.entries(fields))
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('GetStarted: no dead ends', () => {
  it('sends an address not yet verified to verify it, before any form', () => {
    auth.user = { ...newcomer, emailVerified: false }
    render(page())
    expect(navigate).toHaveBeenCalledWith('/verify-email', { replace: true })
    expect(screen.queryByRole('heading', { name: 'Your restaurant' })).toBeNull()
  })

  it('still opens the form when the verified flag is simply absent', async () => {
    auth.user = { ...newcomer, emailVerified: undefined }
    render(page())
    expect(await screen.findByRole('heading', { name: 'Your restaurant' })).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('says a 403 is an unverified address and links to verify it', async () => {
    auth.user = newcomer
    createFirstHouse.mockRejectedValue({ response: { status: 403, data: { message: 'Verify your email before creating a house' } } })
    render(page())
    await screen.findByRole('heading', { name: 'Your restaurant' })
    fill({ 'Restaurant name': 'Meyhane', Address: '1 House Street', City: 'Istanbul' })
    fireEvent.click(screen.getByRole('button', { name: 'Choose Türkiye' }))
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Your email address is not verified yet, so the house was not opened. Verify it, then come back here.',
    )
    expect(screen.getByRole('link', { name: 'Verify your email' })).toHaveAttribute('href', '/verify-email')
  })

  it('names each empty field instead of "full address are required"', async () => {
    auth.user = newcomer
    render(page())
    await screen.findByRole('heading', { name: 'Your restaurant' })
    fill({ 'Restaurant name': 'Meyhane', Address: '1 House Street' })
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    expect(screen.getByRole('alert').textContent).toBe('Add the city and the country to open the house.')

    fill({ 'Restaurant name': '', City: 'Istanbul' })
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    expect(screen.getByRole('alert').textContent).toBe('Add the restaurant name and the country to open the house.')

    fill({ Address: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Choose Türkiye' }))
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
    expect(screen.getByRole('alert').textContent).toBe('Add the restaurant name and the address to open the house.')
    expect(createFirstHouse).not.toHaveBeenCalled()
  })

  it('opens the house on Enter in a typed field', async () => {
    auth.user = newcomer
    render(page())
    await screen.findByRole('heading', { name: 'Your restaurant' })
    fill({ 'Restaurant name': 'Meyhane', Address: '1 House Street', City: 'Istanbul' })
    fireEvent.click(screen.getByRole('button', { name: 'Choose Türkiye' }))
    fireEvent.keyDown(screen.getByLabelText('City'), { key: 'Enter' })
    expect(await screen.findByRole('heading', { name: 'Your menu' })).toBeInTheDocument()
    expect(createFirstHouse).toHaveBeenCalledTimes(1)
    expect(createFirstHouse).toHaveBeenCalledWith(expect.objectContaining({ restaurantName: 'Meyhane', city: 'Istanbul' }))
  })

  it('does not open the house on another key', async () => {
    auth.user = newcomer
    render(page())
    await screen.findByRole('heading', { name: 'Your restaurant' })
    fill({ 'Restaurant name': 'Meyhane', Address: '1 House Street', City: 'Istanbul' })
    fireEvent.click(screen.getByRole('button', { name: 'Choose Türkiye' }))
    fireEvent.keyDown(screen.getByLabelText('City'), { key: 'a' })
    expect(createFirstHouse).not.toHaveBeenCalled()
  })

  it('lets a signed-in person sign out from either step', async () => {
    for (const user of [newcomer, owner]) {
      navigate.mockClear()
      auth.user = user
      const view = render(page())
      fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }))
      view.unmount()
    }
    expect(logout).toHaveBeenCalledTimes(2)
  })

  it('stays put when sign-out is called off (unsent changes kept)', async () => {
    auth.user = owner
    logout.mockResolvedValue(false)
    render(page())
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(logout).toHaveBeenCalled())
    expect(navigate).not.toHaveBeenCalled()
  })

  it('the menu step says it is the last step, with no greyed invoice box', async () => {
    auth.user = owner
    render(page())
    expect(await screen.findByRole('heading', { name: 'Your menu' })).toBeInTheDocument()
    expect(screen.getByText('One last step')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/first inscription|Not a step now|last invoice/i)
  })

  it('a photo that is not read for another reason still names the other ways', async () => {
    auth.user = owner
    importMenu.mockRejectedValue(new Error('boom'))
    render(page())
    const photo = new File(['x'], 'menu.png', { type: 'image/png' })
    fireEvent.drop(await screen.findByText('Drop the menu here'), { dataTransfer: { files: [photo] } })
    expect((await screen.findByRole('alert')).textContent).toBe(
      'We could not read that photo. Try again, or send a file or type a few lines below instead.',
    )
  })
})
