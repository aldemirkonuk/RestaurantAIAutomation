/**
 * OB-11: sign-up says "wait" and stops probing.
 *   t1. A 429 renders the seconds from Retry-After, in words, and holds the button.
 *   t2. Typing an email makes 0 check-email calls.
 *   t3. There is no confirm field; a show/hide toggle reveals the password.
 *   Enter submits (browser walk 2026-11-11: it did not).
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
      clearError: vi.fn(),
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

  it('t3: no confirm field, and the toggle shows and hides the password', () => {
    open()
    expect(screen.queryByLabelText(/confirm/i)).toBeNull()
    const box = screen.getByLabelText(/^Password/) as HTMLInputElement
    expect(box.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(box.type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(box.type).toBe('password')
  })

  it('Enter in the form submits the account', async () => {
    h.auth.registerAccount.mockResolvedValue(undefined)
    open()
    type(/^Full Name/, 'Ayşe Kaya')
    type(/^Email/, 'ayse@kaya.test')
    type(/^Password/, 'long-enough-1')
    fireEvent.submit(screen.getByLabelText(/^Password/).closest('form')!)
    await waitFor(() =>
      expect(h.auth.registerAccount).toHaveBeenCalledWith({
        name: 'Ayşe Kaya',
        email: 'ayse@kaya.test',
        password: 'long-enough-1',
      }),
    )
    expect(h.navigate).toHaveBeenCalledWith('/verify-email', { replace: true })
  })

  it('t1: a 429 says the seconds from Retry-After and holds the button', async () => {
    h.auth.registerAccount.mockRejectedValue(
      Object.assign(new Error('ThrottlerException: Too Many Requests'), { status: 429, retryAfter: '42' }),
    )
    open()
    type(/^Full Name/, 'Ayşe Kaya')
    type(/^Email/, 'ayse@kaya.test')
    type(/^Password/, 'long-enough-1')
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
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText(/Wait 2 seconds, then try again\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('button', { name: /create account/i })).toBeEnabled(), {
      timeout: 3500,
    })
    expect(screen.queryByText(/Wait 2 seconds/)).toBeNull()
    // The context's own sentence for the same 429 is cleared too, so nothing
    // generic shows through once the wait sentence goes.
    expect(h.auth.clearError).toHaveBeenCalled()
  })

  it('an address already in use offers Sign in', async () => {
    h.auth.registerAccount.mockRejectedValue(
      Object.assign(new Error('Email already registered'), { status: 400 }),
    )
    open()
    type(/^Full Name/, 'Ayşe Kaya')
    type(/^Email/, 'ayse@kaya.test')
    type(/^Password/, 'long-enough-1')
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText(/already has an account/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })
})

describe('Register — one step for a new owner (walk r23, register-step2)', () => {
  it('asks only for the account: three named, required boxes and no house fields', () => {
    open()
    const name = screen.getByRole('textbox', { name: 'Full Name' })
    const email = screen.getByRole('textbox', { name: 'Email' })
    const password = screen.getByLabelText(/^Password/)
    for (const box of [name, email, password]) expect(box).toBeRequired()
    expect(name).toHaveAttribute('autocomplete', 'name')
    expect(password).toHaveAccessibleName('Password')
    expect(password).toHaveAccessibleDescription('Min. 8 characters')
    // The restaurant step (country, address, cuisine) was unreachable and is
    // gone: the house is opened at /get-started after verification (ADR 0213).
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByText(/country/i)).toBeNull()
    expect(screen.getByRole('button', { name: /create account/i })).toBeEnabled()
  })

  it('a press with nothing typed names all three, marks them and moves to the first', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Add your name, your email address and a password of at least 8 characters.',
    )
    const name = screen.getByRole('textbox', { name: 'Full Name' })
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/^Password/)).toHaveAccessibleDescription(
      'Min. 8 characters Add your name, your email address and a password of at least 8 characters.',
    )
    expect(name).toHaveFocus()
    expect(h.auth.registerAccount).not.toHaveBeenCalled()
  })

  it('the sentence follows the boxes and goes when they are filled', async () => {
    open()
    type(/^Full Name/, 'Ayşe Kaya')
    type(/^Email/, 'ayse')
    fireEvent.submit(screen.getByLabelText(/^Password/).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Add an email address with an @ in it and a password of at least 8 characters.',
    )
    expect(screen.getByRole('textbox', { name: 'Full Name' })).not.toHaveAttribute('aria-invalid')
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveFocus()
    expect(h.auth.registerAccount).not.toHaveBeenCalled()
    type(/^Email/, 'ayse@kaya.test')
    expect(screen.getByRole('alert')).toHaveTextContent('Add a password of at least 8 characters.')
    type(/^Password/, 'long-enough-1')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText(/^Password/)).not.toHaveAttribute('aria-invalid')
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
