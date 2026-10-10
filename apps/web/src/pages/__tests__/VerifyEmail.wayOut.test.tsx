import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

/**
 * F-636: someone waiting for the verification mail could neither sign out nor
 * fix a mistyped address from /verify-email. There is no way to change an
 * address before it is verified, so a wrong one is signing out and signing up
 * again; plain sign-out is offered too. Both go through the real sign-out,
 * which asks first about unsent changes and stays put when told to.
 */

const h = vi.hoisted(() => ({
  auth: {
    user: null as null | Record<string, unknown>,
    loading: false,
    logout: vi.fn(),
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../services/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  getErrorMessage: () => 'Request failed. Try again.',
}))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
import { VerifyEmail } from '../VerifyEmail'

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}
function mount() {
  return render(
    <MemoryRouter initialEntries={['/verify-email']}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  h.auth.user = { userId: 'u-1', email: 'mira@hosue.test', emailVerified: false }
  h.auth.logout.mockResolvedValue(true)
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe.each([
  ['the house design', 'true'],
  ['the older card', 'false'],
])('/verify-email in %s (F-636)', (_label, flag) => {
  beforeEach(() => {
    localStorage.setItem('mudavym.design.public', flag)
    vi.stubEnv('VITE_MUDAVYM_PUBLIC', '')
  })

  it('a wrong address: sign out and start again at sign-up', async () => {
    mount()
    expect(screen.getByText(/Wrong address\?/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out and use another address' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/register')
    expect(h.auth.logout).toHaveBeenCalledTimes(1)
  })

  it('or just sign out', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/login')
  })

  it('stays when the person keeps the session to save unsent changes', async () => {
    h.auth.logout.mockResolvedValue(false)
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await vi.waitFor(() => expect(h.auth.logout).toHaveBeenCalled())
    expect(screen.queryByTestId('where')).not.toBeInTheDocument()
  })

  it('offers nothing to sign out of when nobody is signed in', () => {
    h.auth.user = null
    mount()
    expect(screen.queryByTestId('verify-way-out')).not.toBeInTheDocument()
  })
})
