/** /get-started entry rule and menu step (QA BL-1, B-1, B-12, B-14; F8). */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { navigate, createFirstHouse, signInWithSession, patch, importMenu, auth } = vi.hoisted(() => ({
  navigate: vi.fn(),
  createFirstHouse: vi.fn(),
  signInWithSession: vi.fn(),
  patch: vi.fn(),
  importMenu: vi.fn(),
  auth: { user: null as Record<string, unknown> | null, loading: false },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ ...auth, createFirstHouse, signInWithSession }),
}))
vi.mock('../../services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/client')>()),
  apiClient: { patch },
}))
vi.mock('../../services/api/menus', () => ({ importMenu }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../lib/googleMaps', () => ({ isMapsConfigured: () => true }))
vi.mock('../../components/ui/PlacesAutocomplete', () => ({ PlacesAutocomplete: () => null }))
vi.mock('../../components/ui/CountryCombobox', () => ({
  CountryCombobox: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange('Türkiye')}>Choose Türkiye</button>
  ),
}))
vi.mock('../../components/onboarding/MenuCsvUpload', () => ({ MenuCsvUpload: () => null }))
vi.mock('../../components/onboarding/MenuScanUpload', () => ({ MenuScanUpload: () => null }))
vi.mock('../../components/onboarding/MenuManualEntry', () => ({
  MenuManualEntry: ({ onSuccess }: { onSuccess: (result: unknown) => void }) => (
    <button
      type="button"
      onClick={() => onSuccess({ menuId: 'menu-1', itemsExtracted: 1, submissionsCreated: 0, items: [] })}
    >
      Send these lines
    </button>
  ),
}))

import GetStarted from '../GetStarted'

const ALREADY_OPEN = /already has a house/
const page = () => <MemoryRouter><GetStarted /></MemoryRouter>
const owner = { name: 'Selin Kaya', restaurantId: 'house-1', role: 'owner', emailVerified: true }

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = null
  auth.loading = false
  patch.mockResolvedValue({})
  sessionStorage.clear()
  localStorage.clear()
})

describe('GetStarted entry rule', () => {
  it('(t1) an owner with a house resumes at the menu step, with no Welcome while auth loads', () => {
    auth.loading = true
    const view = render(page())
    expect(screen.queryByText('Welcome')).toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()

    auth.loading = false
    auth.user = owner
    view.rerender(page())
    expect(screen.getByRole('heading', { name: 'Your menu' })).toBeInTheDocument()
    expect(screen.queryByText('Welcome')).toBeNull()
  })

  it('(t1) a house with no role named is treated as the owner', () => {
    auth.user = { ...owner, role: null }
    render(page())
    expect(screen.getByRole('heading', { name: 'Your menu' })).toBeInTheDocument()
  })

  it('(t2) staff or a manager with a house goes to the desk, never owner onboarding', () => {
    for (const role of ['staff', 'manager']) {
      navigate.mockClear()
      auth.user = { ...owner, role }
      const view = render(page())
      expect(navigate).toHaveBeenCalledWith('/', { replace: true })
      expect(screen.queryByText('Welcome')).toBeNull()
      view.unmount()
    }
  })

  it('(t3) an anonymous visitor is sent to sign in and back here', () => {
    render(page())
    expect(navigate).toHaveBeenCalledWith('/login?redirect=%2Fget-started', { replace: true })
    expect(screen.queryByText('Welcome')).toBeNull()
  })

  it('(t4) a 409 re-reads the session and steps into the house it found', async () => {
    auth.user = { name: 'Selin Kaya', restaurantId: '', role: null, emailVerified: true }
    localStorage.setItem('accessToken', 'access')
    localStorage.setItem('refreshToken', 'refresh')
    createFirstHouse.mockRejectedValue({ response: { status: 409, data: { message: 'x' } } })
    signInWithSession.mockImplementation(async () => {
      auth.user = { ...owner }
    })
    render(page())
    await screen.findByRole('heading', { name: 'Your restaurant' })
    fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'Meyhane' } })
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '1 House Street' } })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Istanbul' } })
    fireEvent.click(screen.getByRole('button', { name: 'Choose Türkiye' }))
    fireEvent.click(screen.getByRole('button', { name: 'This is us' }))

    expect(await screen.findByRole('heading', { name: 'Your menu' })).toBeInTheDocument()
    expect(signInWithSession).toHaveBeenCalledWith({ accessToken: 'access', refreshToken: 'refresh' })
    expect(document.body.textContent).not.toMatch(ALREADY_OPEN)
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('GetStarted menu step', () => {
  it('(t5) a dropped photo that is not read says so, in words from the status', async () => {
    auth.user = owner
    importMenu.mockRejectedValue({ response: { status: 500, data: { message: 'parser exploded: idx_menu' } } })
    render(page())
    const photo = new File(['x'], 'menu.png', { type: 'image/png' })
    fireEvent.drop(screen.getByText('Drop the menu here'), { dataTransfer: { files: [photo] } })

    const alert = await screen.findByRole('alert')
    // r21: every refusal names a way on (a 503 is also the reader switched off).
    expect(alert.textContent).toBe(
      'We could not read that photo just now. Try again in a moment, or send a file or type a few lines below instead.',
    )
    expect(document.body.textContent).not.toContain('parser exploded')
  })

  it('(t6) a person who arrives after the first render fills the name', () => {
    auth.loading = true
    const view = render(page())
    auth.loading = false
    auth.user = { name: 'Selin Kaya', restaurantId: '', role: null, emailVerified: true }
    view.rerender(page())
    expect(screen.getByText(/Welcome, Selin\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change your name' }))
    expect(screen.getByLabelText('Your name')).toHaveValue('Selin Kaya')
  })

  it('(t7) a finished read opens the first proof at once, with no timer', async () => {
    auth.user = owner
    render(page())
    fireEvent.click(screen.getByRole('button', { name: /Type a few lines/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Send these lines' }))
    // No timer advance: it has already happened.
    expect(navigate).toHaveBeenCalledWith('/house/menu', { replace: true })
    expect(JSON.parse(sessionStorage.getItem('mudavym:first-proof') ?? 'null')).toMatchObject({ menuId: 'menu-1' })
    await waitFor(() => expect(screen.queryByText('The facts are settling.')).toBeNull())
  })
})
