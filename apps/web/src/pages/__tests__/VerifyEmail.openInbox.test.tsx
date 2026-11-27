import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/** "Check your email" opens the person's inbox for the big webmail hosts (r105 onboarding g4). */
const h = vi.hoisted(() => ({
  auth: { user: null as null | { email: string; emailVerified: boolean }, loading: false, logout: vi.fn() },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../services/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  getErrorMessage: () => 'Request failed. Try again.',
}))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
import { VerifyEmail } from '../VerifyEmail'

function mount() {
  return render(
    <MemoryRouter initialEntries={['/verify-email']}>
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

it('offers Gmail as a new-tab link above Resend, carrying no address', () => {
  h.auth.user = { email: 'Owner@Gmail.com', emailVerified: false }
  mount()
  const link = screen.getByRole('link', { name: 'Open Gmail' })
  expect(link).toHaveAttribute('href', 'https://mail.google.com/mail/u/0/#search/from%3Amudavym+newer_than%3A1d')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  expect(link.getAttribute('href')).not.toMatch(/owner/i)
  const resend = screen.getByRole('button', { name: 'Resend verification email' })
  expect(link.compareDocumentPosition(resend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('offers no button for a domain it does not know', () => {
  h.auth.user = { email: 'owner@house.test', emailVerified: false }
  mount()
  expect(screen.queryByTestId('verify-open-inbox')).toBeNull()
  expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeInTheDocument()
})
