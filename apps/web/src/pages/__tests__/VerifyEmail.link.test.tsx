import { beforeEach, afterEach, expect, it, vi, describe } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * Onboarding OB-6 (founder /goal 2026-11-07; proposal §3 OB-6, §4 F3): a
 * verification link opened where its person is signed in verifies by itself,
 * once, and the page moves on through AuthContext.signInWithSession and the
 * router: no 1.5 s wait, no full page load, and no navigation before the
 * session (and its /auth/me) has resolved. Signed out, the button stays.
 */
const HOUSE = '6b1f0c3e-2d4a-4b8e-9f10-2a3b4c5d6e7f'
const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims))}.s`
const PAIR = {
  accessToken: jwt({ sub: 'u1', restaurantId: HOUSE }),
  refreshToken: 'refresh-1',
}
const NO_HOUSE_PAIR = { accessToken: jwt({ sub: 'u1' }), refreshToken: 'refresh-2' }
const TOKEN = '3f2b8c1e-9a4d-4c7b-8e2f-1a2b3c4d5e6f'

const h = vi.hoisted(() => ({
  post: vi.fn(),
  progress: vi.fn(),
  toastSuccess: vi.fn(),
  auth: {
    user: { email: 'owner@house.test', emailVerified: false } as null | {
      email: string
      emailVerified: boolean
    },
    loading: false,
    logout: vi.fn(),
    signInWithSession: vi.fn(),
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../services/api/client', () => ({
  apiClient: { get: vi.fn(), post: h.post },
  getErrorMessage: (err: { response?: { data?: { message?: string } } }) =>
    err?.response?.data?.message ?? 'Request failed. Try again.',
}))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: h.progress }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: h.toastSuccess } }))
import { VerifyEmail } from '../VerifyEmail'

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/get-started" element={<p>get-started page</p>} />
        <Route path="/choose-house" element={<p>choose-house page</p>} />
        <Route path="/" element={<p>home page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

let hrefWrites: string[]
const realLocation = window.location

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_MUDAVYM_PUBLIC', '')
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('mudavym.design.public', 'true')
  h.auth.user = { email: 'owner@house.test', emailVerified: false }
  h.auth.loading = false
  h.auth.signInWithSession.mockResolvedValue(undefined)
  h.progress.mockResolvedValue(null)
  // Record any full-page navigation the page might attempt.
  hrefWrites = []
  const fake = { ...realLocation } as Location
  Object.defineProperty(fake, 'href', {
    get: () => 'http://localhost/verify-email',
    set: (v: string) => hrefWrites.push(v),
  })
  Object.defineProperty(window, 'location', { configurable: true, value: fake })
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('the link runs by itself (F3)', () => {
  it('t3: signed in with a token, the token is posted with no click', async () => {
    h.post.mockResolvedValue({ data: PAIR })
    mount(`/verify-email?token=${TOKEN}`)
    // Default findBy timeout is 1000 ms: the old 1500 ms wait cannot pass.
    expect(await screen.findByText('get-started page')).toBeInTheDocument()
    expect(h.post).toHaveBeenCalledTimes(1)
    expect(h.post).toHaveBeenCalledWith('/auth/verify-email', { token: TOKEN })
    expect(h.auth.signInWithSession).toHaveBeenCalledWith(PAIR)
    expect(hrefWrites).toEqual([])
  })

  it('a session in no house goes to the chooser; a house with its menu goes home', async () => {
    h.post.mockResolvedValueOnce({ data: NO_HOUSE_PAIR })
    mount(`/verify-email?token=${TOKEN}`)
    expect(await screen.findByText('choose-house page')).toBeInTheDocument()
    expect(h.progress).not.toHaveBeenCalled()
    cleanup()

    h.post.mockResolvedValueOnce({ data: PAIR })
    h.progress.mockResolvedValueOnce({ menu_uploaded: true })
    mount(`/verify-email?token=${TOKEN}`)
    expect(await screen.findByText('home page')).toBeInTheDocument()
    expect(hrefWrites).toEqual([])
  })

  it('navigates only after signInWithSession (and its /auth/me) resolves', async () => {
    let finish: () => void = () => undefined
    h.auth.signInWithSession.mockReturnValue(
      new Promise<void>((r) => {
        finish = r
      }),
    )
    h.post.mockResolvedValue({ data: PAIR })
    mount(`/verify-email?token=${TOKEN}`)
    await act(async () => {
      await Promise.resolve()
    })
    expect(h.auth.signInWithSession).toHaveBeenCalledWith(PAIR)
    expect(screen.queryByText('get-started page')).not.toBeInTheDocument()
    await act(async () => finish())
    expect(await screen.findByText('get-started page')).toBeInTheDocument()
  })

  it('a failed session read after the link says so and offers to try again', async () => {
    h.auth.signInWithSession.mockRejectedValueOnce(new Error('me failed'))
    h.post.mockResolvedValue({ data: PAIR })
    mount(`/verify-email?token=${TOKEN}`)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'your account could not be loaded just now',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('get-started page')).toBeInTheDocument()
    expect(h.post).toHaveBeenCalledTimes(1)
  })

  it('t4: signed out with a token, nothing is posted', async () => {
    h.auth.user = null
    mount(`/verify-email?token=${TOKEN}`)
    await act(async () => {
      await Promise.resolve()
    })
    expect(h.post).not.toHaveBeenCalled()
    expect(screen.getByTestId('verify-needs-sign-in')).toBeInTheDocument()
  })

  it('t4: while the session is still loading, nothing is posted', async () => {
    h.auth.loading = true
    h.auth.user = null
    mount(`/verify-email?token=${TOKEN}`)
    await act(async () => {
      await Promise.resolve()
    })
    expect(h.post).not.toHaveBeenCalled()
  })
})
