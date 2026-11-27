import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/** Resend says its own wait and disables itself (r105 onboarding g5). */
const h = vi.hoisted(() => ({
  post: vi.fn(),
  toastError: vi.fn(),
  auth: { user: { email: 'owner@house.test', emailVerified: false }, loading: false, logout: vi.fn() },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../services/api/client', () => ({
  apiClient: { get: vi.fn(), post: h.post },
  getErrorMessage: () => 'Request failed. Try again.',
}))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: h.toastError, success: vi.fn() } }))
import { VerifyEmail } from '../VerifyEmail'

const SENT = { data: { success: true, sent: true, verificationMail: 'sent' } }
const resendButton = () => screen.getByRole('button', { name: /^Resend/ })

async function pressResend() {
  await act(async () => {
    fireEvent.click(resendButton())
  })
}
async function tick(seconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(seconds * 1000)
  })
}

describe('VerifyEmail resend cooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.stubEnv('VITE_MUDAVYM_PUBLIC', '')
    localStorage.clear()
    localStorage.setItem('mudavym.design.public', 'true')
    render(
      <MemoryRouter initialEntries={['/verify-email']}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmail />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('disables after a send, counts down once a second, and returns at 0', async () => {
    h.post.mockResolvedValue(SENT)
    await pressResend()
    expect(resendButton()).toBeDisabled()
    expect(resendButton()).toHaveTextContent('Resend in 60 s')
    await tick(1)
    expect(resendButton()).toHaveTextContent('Resend in 59 s')
    await tick(58)
    expect(resendButton()).toHaveTextContent('Resend in 1 s')
    await tick(1)
    expect(resendButton()).toBeEnabled()
    expect(resendButton()).toHaveTextContent('Resend verification email')
    expect(h.toastError).not.toHaveBeenCalled()
  })

  it('sends no request for a press inside the wait', async () => {
    h.post.mockResolvedValue(SENT)
    await pressResend()
    await tick(10)
    await pressResend()
    expect(h.post).toHaveBeenCalledTimes(1)
    expect(h.toastError).not.toHaveBeenCalled()
  })

  it("seeds the wait from the server's Retry-After on a 429", async () => {
    h.post.mockRejectedValueOnce({
      response: { status: 429, headers: { 'retry-after': '30' }, data: { message: 'Too many' } },
    })
    await pressResend()
    expect(resendButton()).toBeDisabled()
    expect(resendButton()).toHaveTextContent('Resend in 30 s')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(h.toastError).not.toHaveBeenCalled()
    await tick(30)
    expect(resendButton()).toBeEnabled()
  })

  it('keeps the label width fixed with tabular numerals', () => {
    expect(resendButton().style.fontVariantNumeric).toBe('tabular-nums')
  })
})
