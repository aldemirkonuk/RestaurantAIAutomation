/**
 * OB-11, part 1: a refused sign-up is said in words.
 *   t1. A 429 renders the seconds from Retry-After, in words, and holds the button.
 *   An address already in use offers Sign in under the sentence.
 *   t2. Typing an email makes 0 check-email calls (no address probe).
 * (The confirm field goes in the next branch of the stack.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { signUpRefusal } from '../../lib/authWords'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
  return {
    auth: {
      registerAccount: vi.fn(),
      registerRestaurant: vi.fn(),
      joinViaInvite: vi.fn(),
      registerAccountWithGoogle: vi.fn(),
      error: null as string | null,
    },
    get: vi.fn(),
    navigate: vi.fn(),
  }
})

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../services/api/client', () => ({ apiClient: { get: h.get } }))
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
}))
vi.mock('../../components/auth/GoogleSignInButton', () => ({ GoogleSignInButton: () => null }))

import { Register } from '../Register'

function open(url = '/register?type=new') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Register />
    </MemoryRouter>,
  )
}
const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.error = null
  h.get.mockImplementation((url: string) =>
    url.startsWith('/auth/invite/')
      ? Promise.resolve({ data: { valid: true, restaurant: 'Kaya', inviter: 'Ayşe', role: 'staff' } })
      : Promise.resolve({ data: { available: true } }),
  )
})

describe('Register — OB-11', () => {
  it('t2: typing an email asks the gateway nothing', async () => {
    open()
    type(/^Email/, 'a@b')
    type(/^Email/, 'ayse@kaya.test')
    await new Promise((r) => setTimeout(r, 500))
    expect(h.get.mock.calls.filter(([u]) => String(u).includes('check-email'))).toHaveLength(0)
  })

  it('t1: a 429 says the seconds from Retry-After and holds the button', async () => {
    h.auth.registerAccount.mockRejectedValue(
      Object.assign(new Error('ThrottlerException: Too Many Requests'), { status: 429, retryAfter: '42' }),
    )
    open()
    type(/^Full Name/, 'Ayşe Kaya')
    type(/^Email/, 'ayse@kaya.test')
    type(/^Password/, 'long-enough-1')
    type(/^Confirm Password/, 'long-enough-1')
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText(/Wait 42 seconds, then try again\./)).toBeInTheDocument()
    expect(screen.queryByText(/Throttler/)).toBeNull()
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled()
  })

  it('t1b: when the wait has passed, the button comes back and the wait sentence goes', async () => {
    h.auth.registerAccount.mockRejectedValue(
      Object.assign(new Error('ThrottlerException: Too Many Requests'), { status: 429, retryAfter: '2' }),
    )
    open()
    type(/^Full Name/, 'Ayşe Kaya')
    type(/^Email/, 'ayse@kaya.test')
    type(/^Password/, 'long-enough-1')
    type(/^Confirm Password/, 'long-enough-1')
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText(/Wait 2 seconds, then try again\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('button', { name: /create account/i })).toBeEnabled(), {
      timeout: 3500,
    })
    expect(screen.queryByText(/Wait 2 seconds/)).toBeNull()
  })

  it('an address already in use offers Sign in', async () => {
    h.auth.registerAccount.mockRejectedValue(
      Object.assign(new Error('Email already registered'), { status: 400 }),
    )
    open()
    type(/^Full Name/, 'Ayşe Kaya')
    type(/^Email/, 'ayse@kaya.test')
    type(/^Password/, 'long-enough-1')
    type(/^Confirm Password/, 'long-enough-1')
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText(/already has an account/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })
})

describe('signUpRefusal', () => {
  it('words each refusal without the gateway text', () => {
    expect(signUpRefusal({ status: 429, retryAfter: '9' }, 'account')).toMatchObject({ kind: 'wait', seconds: 9 })
    expect(signUpRefusal({ status: 429 }, 'account').text).toBe(
      'Too many tries from this connection. Wait a minute, then try again.',
    )
    expect(signUpRefusal({ status: 409, message: 'already_member' }, 'join').kind).toBe('exists')
    expect(signUpRefusal({ status: 503 }, 'join').text).not.toMatch(/503|Service/)
    expect(signUpRefusal({ status: null, message: 'Network Error' }, 'account').kind).toBe('offline')
    expect(signUpRefusal({ status: 400, message: 'password must be longer' }, 'account')).toEqual({
      kind: 'refused',
      text: 'password must be longer',
    })
  })
})
