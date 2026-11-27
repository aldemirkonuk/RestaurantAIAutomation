import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * DD-r108-14: "Your address is verified, but your account could not be loaded"
 * never recovered by itself. The cause was the 10-per-minute /auth/ bucket on
 * GET /auth/me (fixed in the gateway); this pins the secondary: the read asks
 * again at 2 s, 4 s and 8 s while the tab is visible, then stops, and the plate
 * keeps the waiting height with "Try again" and a "Sign in" link on it.
 */
const PAIR = { accessToken: 'h.e30.s', refreshToken: 'r' }
const h = vi.hoisted(() => ({
  post: vi.fn(),
  auth: {
    user: { email: 'owner@house.test', emailVerified: false },
    loading: false,
    logout: vi.fn(),
    signInWithSession: vi.fn(),
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../services/api/client', () => ({
  apiClient: { get: vi.fn().mockResolvedValue({ data: {} }), post: h.post },
  getErrorMessage: () => 'Request failed. Try again.',
}))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
import { VerifyEmail } from '../VerifyEmail'

const realHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
let hidden = false
beforeEach(() => {
  vi.useFakeTimers()
  hidden = false
  localStorage.setItem('mudavym.design.public', 'true')
  vi.stubEnv('VITE_MUDAVYM_PUBLIC', '')
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('mdv-pub__plate') ? 622 : 0
    },
  })
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  })
  h.auth.signInWithSession.mockReset()
  h.auth.signInWithSession.mockRejectedValue(new Error('429'))
  h.post.mockResolvedValue({ data: PAIR })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  if (realHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realHeight)
})

const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

async function failAfterTheCode() {
  render(
    <MemoryRouter initialEntries={['/verify-email']}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.change(screen.getByLabelText('Code from the email'), { target: { value: '123456' } })
  await flush()
  expect(screen.getByText(/could not be\s+loaded just now/)).toBeTruthy()
  expect(h.auth.signInWithSession).toHaveBeenCalledTimes(1)
}

it('asks again at 2 s, 4 s and 8 s, then stops, holding the plate height', async () => {
  await failAfterTheCode()
  await flush(1999)
  expect(h.auth.signInWithSession).toHaveBeenCalledTimes(1)
  await flush(1)
  expect(h.auth.signInWithSession).toHaveBeenCalledTimes(2)
  await flush(3999)
  expect(h.auth.signInWithSession).toHaveBeenCalledTimes(2)
  await flush(1)
  expect(h.auth.signInWithSession).toHaveBeenCalledTimes(3)
  await flush(8000)
  expect(h.auth.signInWithSession).toHaveBeenCalledTimes(4)
  await flush(120_000)
  expect(h.auth.signInWithSession).toHaveBeenCalledTimes(4)

  const plate = screen.getByRole('alert').closest('.mdv-pub__plate') as HTMLElement
  expect(plate.style.minHeight).toBe('622px')
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  const signIn = screen.getByRole('link', { name: 'Sign in' })
  expect(signIn.getAttribute('href')).toBe('/login')
  // 44 px: `.mdv-pub__stack > a.mdv-pub__verified` (public-shell.css).
  expect(signIn.classList.contains('mdv-pub__verified')).toBe(true)
})

it('a hidden tab holds its turn until it is shown', async () => {
  await failAfterTheCode()
  hidden = true
  await flush(30_000)
  expect(h.auth.signInWithSession).toHaveBeenCalledTimes(1)
  hidden = false
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(h.auth.signInWithSession).toHaveBeenCalledTimes(2)
})
