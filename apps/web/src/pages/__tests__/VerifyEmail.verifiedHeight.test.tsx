import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * r105 (onboarding walk r104, row 7): the verified state is one line, so the
 * column shrank 622 to 316 px and jumped down 153 px under reduced motion
 * (CLS 0.1319 at 375). The plate keeps the height it had while waiting as a
 * floor. No fade, no slide (ADR 0112). jsdom has no layout, so the plate's
 * offsetHeight is stood in for here; the real number was measured in a browser.
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
  apiClient: { get: vi.fn(), post: h.post },
  getErrorMessage: () => 'Request failed. Try again.',
}))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
import { VerifyEmail } from '../VerifyEmail'

const realHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
beforeEach(() => {
  localStorage.setItem('mudavym.design.public', 'true')
  vi.stubEnv('VITE_MUDAVYM_PUBLIC', '')
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('mdv-pub__plate') ? 622 : 0
    },
  })
  // The verified state stays on screen: the session read never settles.
  h.auth.signInWithSession.mockReturnValue(new Promise(() => undefined))
  h.post.mockResolvedValue({ data: PAIR })
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  if (realHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realHeight)
})

it('the verified plate holds the height the waiting plate had', async () => {
  render(
    <MemoryRouter initialEntries={['/verify-email']}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.change(screen.getByLabelText('Code from the email'), {
    target: { value: '123456' },
  })
  const status = await screen.findByText('Your address is verified. Opening your workspace…')
  const plate = status.closest('.mdv-pub__plate') as HTMLElement
  expect(plate.style.minHeight).toBe('622px')
})
