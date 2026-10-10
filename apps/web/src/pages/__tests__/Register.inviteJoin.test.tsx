import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Typing an invite code on /register (Path A), wave 34 (S137):
 *  - F-894: a check that got no answer is not a bad code, and can be asked again.
 *  - F-895: the card says what is left of the invite, not a fixed "7 days".
 *  - F-897: the name is capped where the account keeps it; spaces are no name.
 *  - F-896: a join that went through is never shown as failed.
 */

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
  return {
    get: vi.fn(),
    post: vi.fn(),
    navigate: vi.fn(),
    auth: {
      registerAccount: vi.fn(),
      registerRestaurant: vi.fn(),
      joinViaInvite: vi.fn(),
      error: null,
    },
  }
})
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../services/api/client', () => ({ apiClient: { get: h.get, post: h.post } }))
vi.mock('../../components/auth/GoogleSignInButton', () => ({ GoogleSignInButton: () => null }))
vi.mock('../../components/ui/PlacesAutocomplete', () => ({ PlacesAutocomplete: () => null }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => h.navigate }
})
import { Register } from '../Register'

const WAIT = { timeout: 3000 }
const DAY = 24 * 60 * 60 * 1000

function preview(expiresAt?: string) {
  return {
    data: {
      valid: true,
      restaurant: 'Kaya Meyhane',
      city: 'Fethiye',
      inviter: 'Ayşe',
      role: 'manager',
      ...(expiresAt ? { expiresAt } : {}),
    },
  }
}

function open() {
  render(
    <MemoryRouter initialEntries={['/register?invite=abcdefgh']}>
      <Register />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  h.post.mockResolvedValue({ data: { available: true, email: 'x' } })
})
afterEach(() => cleanup())

describe('the invite code check (F-894)', () => {
  it('says a check with no answer apart from a bad code, and asks again on Try again', async () => {
    h.get.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { response: undefined }))
    open()
    expect(await screen.findByText(/We could not check this code just now/, undefined, WAIT)).toBeInTheDocument()
    expect(screen.queryByText('Code not found, expired, or already used')).not.toBeInTheDocument()

    h.get.mockResolvedValueOnce(preview(new Date(Date.now() + 3 * DAY + 60_000).toISOString()))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Invited by', undefined, WAIT)).toBeInTheDocument()
    expect(h.get).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/We could not check this code/)).not.toBeInTheDocument()
  })

  it('still calls a code the gateway refused a bad code', async () => {
    h.get.mockResolvedValueOnce({ data: { valid: false, reason: 'not_found' } })
    open()
    expect(await screen.findByText('Code not found, expired, or already used', undefined, WAIT)).toBeInTheDocument()
  })
})

describe('what is left of the invite (F-895)', () => {
  it('says the days left, not the full seven', async () => {
    h.get.mockResolvedValueOnce(preview(new Date(Date.now() + 1 * DAY + 60_000).toISOString()))
    open()
    await screen.findByText('Invited by', undefined, WAIT)
    expect(screen.getByText('Time left')).toBeInTheDocument()
    expect(screen.getByText('1 day')).toBeInTheDocument()
    expect(screen.queryByText('7 days')).not.toBeInTheDocument()
  })

  it('says nothing about time when the gateway did not say', async () => {
    h.get.mockResolvedValueOnce(preview())
    open()
    await screen.findByText('Invited by', undefined, WAIT)
    expect(screen.queryByText('Time left')).not.toBeInTheDocument()
    expect(screen.queryByText('7 days')).not.toBeInTheDocument()
  })
})

async function toAccountStep() {
  h.get.mockResolvedValue(preview(new Date(Date.now() + 5 * DAY).toISOString()))
  open()
  await screen.findByText('Invited by', undefined, WAIT)
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
  await screen.findByLabelText('Full Name *', undefined, WAIT)
  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  type('Email *', 'deniz@house.test')
  type('Password *', 'long-enough-1')
  type('Confirm Password *', 'long-enough-1')
  await screen.findByText('Email is available', undefined, WAIT)
  return type
}

describe('the join name (F-897)', () => {
  it('is capped at 100, and a name of spaces cannot join', async () => {
    const type = await toAccountStep()
    expect(screen.getByLabelText('Full Name *')).toHaveAttribute('maxLength', '100')
    type('Full Name *', '    ')
    expect(screen.getByRole('button', { name: 'Join Restaurant' })).toBeDisabled()
    type('Full Name *', '  Deniz Kaya  ')
    expect(screen.getByRole('button', { name: 'Join Restaurant' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Join Restaurant' }))
    await waitFor(() => expect(h.auth.joinViaInvite).toHaveBeenCalledTimes(1))
    expect(h.auth.joinViaInvite.mock.calls[0][0]).toMatchObject({ name: 'Deniz Kaya' })
  })
})

describe('a join that went through (F-896)', () => {
  it('goes on into the app by a fresh load when only the details failed to load', async () => {
    const replace = vi.fn()
    const location = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...location, replace } })
    try {
      h.auth.joinViaInvite.mockResolvedValue({ detailsLoaded: false })
      const type = await toAccountStep()
      type('Full Name *', 'Deniz Kaya')
      fireEvent.click(screen.getByRole('button', { name: 'Join Restaurant' }))
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
      expect(screen.queryByText(/Failed to join/)).not.toBeInTheDocument()
      expect(h.navigate).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: location })
    }
  })
})
