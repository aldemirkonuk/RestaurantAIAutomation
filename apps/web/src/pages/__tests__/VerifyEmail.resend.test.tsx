import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * Round 2 B-4 / B-5, round 6 #789: the resend button said "check your inbox"
 * whatever the mailer answered, and an expired link offered only the same
 * Verify button. The resend now says a refused send in words, and a refused
 * link offers a fresh one.
 */
const h = vi.hoisted(() => ({
  post: vi.fn(),
  toastSuccess: vi.fn(),
  auth: {
    user: { email: 'owner@house.test', emailVerified: false } as null | {
      email: string
      emailVerified: boolean
    },
    loading: false,
    logout: vi.fn(),
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../services/api/client', () => ({
  apiClient: { get: vi.fn(), post: h.post },
  getErrorMessage: (err: { response?: { data?: { message?: string } } }) =>
    err?.response?.data?.message ?? 'Request failed. Try again.',
}))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: h.toastSuccess } }))
import { VerifyEmail } from '../VerifyEmail'

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_MUDAVYM_PUBLIC', '')
  localStorage.clear()
  localStorage.setItem('mudavym.design.public', 'true')
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

it('says a refused resend in words and never says to check the inbox', async () => {
  h.post.mockResolvedValueOnce({
    data: { success: true, sent: false, verificationMail: 'not_sent' },
  })
  mount('/verify-email')
  fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'We could not send the verification email',
  )
  expect(h.toastSuccess).not.toHaveBeenCalled()
  expect(screen.queryByText(/was sent at/)).not.toBeInTheDocument()
  expect(h.post).toHaveBeenCalledWith('/auth/resend-verification')
})

it('says a resend left only when the gateway said sent', async () => {
  h.post.mockResolvedValueOnce({
    data: { success: true, sent: true, verificationMail: 'sent' },
  })
  mount('/verify-email')
  fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }))

  expect(await screen.findByText(/was sent at/)).toBeInTheDocument()
  expect(h.toastSuccess).toHaveBeenCalledWith(
    'We sent a new verification email to owner@house.test. Check your inbox.',
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('offers a new link when the link itself was refused (expired or used)', async () => {
  h.post
    .mockRejectedValueOnce({
      response: {
        status: 400,
        data: { message: 'Verification token expired. Please resend.' },
      },
    })
    .mockResolvedValueOnce({
      data: { success: true, sent: true, verificationMail: 'sent' },
    })
  // OB-6 (F3): signed in, the link runs by itself; no click is needed for
  // the gateway to refuse it.
  mount('/verify-email?token=3f2b8c1e-9a4d-4c7b-8e2f-1a2b3c4d5e6f')
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Verification token expired',
  )
  expect(h.post).toHaveBeenNthCalledWith(1, '/auth/verify-email', {
    token: '3f2b8c1e-9a4d-4c7b-8e2f-1a2b3c4d5e6f',
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send me a new link' }))

  expect(await screen.findByText(/was sent at/)).toBeInTheDocument()
  expect(h.post).toHaveBeenLastCalledWith('/auth/resend-verification')
})
