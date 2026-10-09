import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { type ReactElement } from 'react'

/**
 * The invite and the account around it (F-274 to F-277, F-288): an unverified
 * account verifies first and is brought back to the invite; the invite page
 * names who will join; signing out of /no-access leaves it; Cancel works from a
 * tab opened from a mail.
 */

const U = '11111111-1111-4111-8111-111111111111'
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  auth: {
    user: null as null | Record<string, unknown>,
    loading: false,
    isAuthenticated: false,
    logout: vi.fn(),
    refreshBranches: vi.fn(),
    setActiveRestaurantId: vi.fn(),
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: h.post },
  getErrorMessage: () => 'Request failed. Try again.',
}))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
import { InviteLanding } from '../InviteLanding'
import { NoAccess } from '../NoAccess'
import { VerifyEmail } from '../VerifyEmail'
import { JOIN_RESUME_KEY, pendingJoin, rememberJoin } from '../../lib/joinResume'

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}
function mount(el: ReactElement, path: string, route: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={el} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}
const signedIn = (emailVerified: boolean) => {
  h.auth.user = { userId: U, email: 'server@house.test', emailVerified }
  h.auth.isAuthenticated = true
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_MUDAVYM_PUBLIC', '')
  localStorage.clear()
  localStorage.setItem('mudavym.design.public', 'true')
  h.auth.user = null
  h.auth.loading = false
  h.auth.isAuthenticated = false
  h.get.mockResolvedValue({
    data: { valid: true, restaurant: 'Tuzlu Rüzgar', role: 'staff' },
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

it('F-274: an unverified account is asked to confirm its email, and the invite is kept for it', async () => {
  signedIn(false)
  mount(<InviteLanding />, '/invite/AB12CD34', '/invite/:code')
  await screen.findByRole('heading', { name: 'You are invited' })
  expect(
    screen.queryByRole('button', { name: 'Join Tuzlu Rüzgar' }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm my email' }))
  expect(screen.getByTestId('where')).toHaveTextContent('/verify-email')
  expect(pendingJoin(U)).toBe('/invite/AB12CD34')
  expect(h.post).not.toHaveBeenCalled()
})

it('F-274: a verified account still joins in one tap, and landing on the invite drops what was kept', async () => {
  signedIn(true)
  rememberJoin('/invite/AB12CD34', U)
  mount(<InviteLanding />, '/invite/AB12CD34', '/invite/:code')
  expect(
    await screen.findByRole('button', { name: 'Join Tuzlu Rüzgar' }),
  ).toBeInTheDocument()
  expect(localStorage.getItem(JOIN_RESUME_KEY)).toBeNull()
})

it('F-275: the invite page names the signed-in account and offers to sign out first', async () => {
  signedIn(true)
  mount(<InviteLanding />, '/invite/AB12CD34', '/invite/:code')
  expect(await screen.findByTestId('invite-signed-in-as')).toHaveTextContent(
    'You are signed in as server@house.test.',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Not you? Sign out' }))
  expect(h.auth.logout).toHaveBeenCalledTimes(1)
})

it('F-277: Cancel, go back leaves for the home page when the tab has no history', async () => {
  signedIn(true)
  mount(<InviteLanding />, '/invite/AB12CD34', '/invite/:code')
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel, go back' }))
  expect(screen.getByTestId('where').textContent).toBe('/')
})

it('F-276: signing out of /no-access goes to sign-in, and nobody signed in is never shown the account message', async () => {
  h.auth.user = { userId: U, email: 'reader@house.test' }
  h.auth.isAuthenticated = true
  h.auth.logout.mockResolvedValue(true)
  mount(<NoAccess />, '/no-access', '/no-access')
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  await waitFor(() =>
    expect(screen.getByTestId('where')).toHaveTextContent('/login'),
  )
  cleanup()

  h.auth.user = null
  h.auth.isAuthenticated = false
  mount(<NoAccess />, '/no-access', '/no-access')
  expect(screen.getByTestId('where')).toHaveTextContent('/login')
  expect(screen.queryByText(/no restaurant access/)).not.toBeInTheDocument()
})

it('F-274/F-288: verifying sends the account back to the invite it was joining, not to the chooser', async () => {
  const realLocation = window.location
  const loc = { ...realLocation, href: '' }
  Object.defineProperty(window, 'location', { configurable: true, value: loc })
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    signedIn(false)
    rememberJoin('/studio/invite/tok_123', U)
    h.post.mockResolvedValueOnce({
      data: { accessToken: 'not-a-jwt', refreshToken: 'r' },
    })
    mount(<VerifyEmail />, '/verify-email?token=t', '/verify-email')
    fireEvent.click(screen.getByRole('button', { name: 'Verify my email' }))
    await screen.findByRole('heading', { name: 'Email verified' })
    vi.advanceTimersByTime(1600)
    expect(loc.href).toBe('/studio/invite/tok_123')
  } finally {
    vi.useRealTimers()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: realLocation,
    })
  }
})
