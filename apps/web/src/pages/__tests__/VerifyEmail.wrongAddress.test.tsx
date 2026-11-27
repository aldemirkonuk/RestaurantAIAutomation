import { beforeEach, afterEach, expect, it, vi, describe } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * r104 onboarding gap 2: a typo in the sign-up address left the check page
 * with only Resend (to the wrong address) and "Back to sign in". The inline
 * "Wrong address? Change it" form moves the unverified account to the right
 * address and takes the new session the gateway hands back.
 */
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  toastSuccess: vi.fn(),
  auth: {
    user: { email: 'selin@typo.test', emailVerified: false } as null | { email: string; emailVerified: boolean },
    loading: false,
    logout: vi.fn(),
    signInWithSession: vi.fn(),
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: h.post },
  getErrorMessage: () => 'Request failed. Try again.',
}))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: h.toastSuccess } }))
import { VerifyEmail } from '../VerifyEmail'

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/verify-email']}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_MUDAVYM_PUBLIC', '')
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('mudavym.design.public', 'true')
  h.auth.user = { email: 'selin@typo.test', emailVerified: false }
  h.auth.signInWithSession.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('Wrong address? Change it', () => {
  it('is closed until asked, and opens an address field in place', async () => {
    mount()
    expect(screen.queryByLabelText('The address you meant')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Wrong address? Change it' }))
    expect(screen.getByLabelText('The address you meant')).toBeInTheDocument()
  })

  it('posts the new address, takes the new session, and says where the mail went', async () => {
    h.post.mockResolvedValue({ data: { accessToken: 'a2', refreshToken: 'r2', email: 'selin@house.test' } })
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Wrong address? Change it' }))
    await userEvent.type(screen.getByLabelText('The address you meant'), 'selin@house.test')
    await userEvent.click(screen.getByRole('button', { name: 'Send it to this address' }))
    await waitFor(() =>
      expect(h.post).toHaveBeenCalledWith('/auth/change-unverified-email', { email: 'selin@house.test' }),
    )
    await waitFor(() => expect(h.auth.signInWithSession).toHaveBeenCalledWith({ accessToken: 'a2', refreshToken: 'r2' }))
    expect(h.toastSuccess).toHaveBeenCalledWith(expect.stringContaining('selin@house.test'))
    expect(screen.queryByLabelText('The address you meant')).toBeNull()
  })

  it('a taken address says so in its own sentence and keeps the form open', async () => {
    h.post.mockRejectedValue({ response: { status: 409, data: { code: 'EMAIL_TAKEN' } } })
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Wrong address? Change it' }))
    await userEvent.type(screen.getByLabelText('The address you meant'), 'taken@house.test')
    await userEvent.click(screen.getByRole('button', { name: 'Send it to this address' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That address already has an account')
    expect(h.auth.signInWithSession).not.toHaveBeenCalled()
    expect(screen.getByLabelText('The address you meant')).toBeInTheDocument()
  })

  it('a refused rate limit says wait a minute; any other failure says it failed', async () => {
    h.post.mockRejectedValueOnce({ response: { status: 429, data: {} } })
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Wrong address? Change it' }))
    await userEvent.type(screen.getByLabelText('The address you meant'), 'a@b.test')
    await userEvent.click(screen.getByRole('button', { name: 'Send it to this address' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Wait a minute')
    h.post.mockRejectedValueOnce(new Error('network'))
    await userEvent.click(screen.getByRole('button', { name: 'Send it to this address' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Request failed. Try again.'))
  })

  it('a signed-out visitor is not offered it', () => {
    h.auth.user = null
    mount()
    expect(screen.queryByRole('button', { name: 'Wrong address? Change it' })).toBeNull()
  })
})
