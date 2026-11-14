import { beforeEach, afterEach, expect, it, vi, describe } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * r36 onboarding gap 4: an address verified somewhere else (the link opened
 * on the phone) left the laptop tab saying "Check your email" for good, and
 * after a reload it had no code box, no way on, and a Resend the gateway
 * answers 409. The tab now moves on by itself, with the session it already
 * holds, once the house says the address is verified.
 *
 * Gap 3 (VerifyEmail half): a house whose menu is only a draft was sent to
 * the desk as if done. It goes to /menu, where the menu is made current.
 */
const HOUSE = '6b1f0c3e-2d4a-4b8e-9f10-2a3b4c5d6e7f'
const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims))}.s`
const ACCESS = jwt({ sub: 'u1', restaurantId: HOUSE })

const h = vi.hoisted(() => ({
  get: vi.fn(),
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
  apiClient: { get: h.get, post: h.post },
  getErrorMessage: () => 'Request failed. Try again.',
}))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: h.progress }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: h.toastSuccess } }))
import { VerifyEmail } from '../VerifyEmail'
import { afterVerifyIn } from '../../lib/afterVerifyIn'

function mount(path = '/verify-email') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/get-started" element={<p>get-started page</p>} />
        <Route path="/choose-house" element={<p>choose-house page</p>} />
        <Route path="/menu" element={<p>menu page</p>} />
        <Route path="/" element={<p>home page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const said = { user: { emailVerified: true } }
const notYet = { user: { emailVerified: false } }
let visibility: DocumentVisibilityState = 'visible'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_MUDAVYM_PUBLIC', '')
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('mudavym.design.public', 'true')
  localStorage.setItem('accessToken', ACCESS)
  localStorage.setItem('refreshToken', 'refresh-1')
  h.auth.user = { email: 'owner@house.test', emailVerified: false }
  h.auth.loading = false
  h.auth.signInWithSession.mockResolvedValue(undefined)
  h.progress.mockResolvedValue(null)
  h.get.mockResolvedValue({ data: notYet })
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('a tab whose address was verified elsewhere', () => {
  it('after a reload that reads it verified, moves on with this session: no Resend, no 409', async () => {
    h.auth.user = { email: 'owner@house.test', emailVerified: true }
    h.progress.mockResolvedValue({ menu_uploaded: true, menu_current: true })
    mount()
    expect(await screen.findByText('home page')).toBeInTheDocument()
    expect(h.auth.signInWithSession).toHaveBeenCalledWith({ accessToken: ACCESS, refreshToken: 'refresh-1' })
    expect(h.auth.signInWithSession).toHaveBeenCalledTimes(1)
    expect(h.post).not.toHaveBeenCalled()
  })

  it('a waiting tab asks again when it is looked at, and moves on once verified', async () => {
    mount()
    expect(screen.getByLabelText('Code from the email')).toBeInTheDocument()
    h.get.mockResolvedValue({ data: said })
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(await screen.findByText('get-started page')).toBeInTheDocument()
    expect(h.get).toHaveBeenCalledWith('/auth/me')
    expect(h.auth.signInWithSession).toHaveBeenCalledWith({ accessToken: ACCESS, refreshToken: 'refresh-1' })
  })

  it('shown again (visibility) counts as looked at', async () => {
    mount()
    h.get.mockResolvedValue({ data: said })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(await screen.findByText('get-started page')).toBeInTheDocument()
  })

  it('a hidden tab does not ask', async () => {
    mount()
    visibility = 'hidden'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(h.get).not.toHaveBeenCalled()
  })

  it('asks every 30 s while shown', async () => {
    vi.useFakeTimers()
    mount()
    expect(h.get).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(29_000)
    })
    expect(h.get).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(1_000)
    })
    expect(h.get).toHaveBeenCalledTimes(1)
  })

  it('not verified yet, or not read: the tab keeps waiting with its code box', async () => {
    mount()
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    h.get.mockRejectedValue(new Error('down'))
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(h.get).toHaveBeenCalledTimes(2)
    expect(h.auth.signInWithSession).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Code from the email')).toBeInTheDocument()
  })

  it('with no session stored here, nothing is borrowed: the tab stays', async () => {
    localStorage.removeItem('refreshToken')
    h.auth.user = { email: 'owner@house.test', emailVerified: true }
    mount()
    await act(async () => undefined)
    expect(h.auth.signInWithSession).not.toHaveBeenCalled()
  })

  it('a session read that fails after it says so, with Try again', async () => {
    h.auth.user = { email: 'owner@house.test', emailVerified: true }
    h.auth.signInWithSession.mockRejectedValue(new Error('me failed'))
    mount()
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('a house whose menu is only a draft goes to /menu, not the desk', async () => {
    h.auth.user = { email: 'owner@house.test', emailVerified: true }
    h.progress.mockResolvedValue({ menu_uploaded: true, menu_current: false })
    mount()
    expect(await screen.findByText('menu page')).toBeInTheDocument()
  })

  it('stops asking once it has moved on', async () => {
    mount()
    h.get.mockResolvedValue({ data: said })
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(h.auth.signInWithSession).toHaveBeenCalledTimes(1))
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(h.auth.signInWithSession).toHaveBeenCalledTimes(1)
  })
})

describe('afterVerifyIn: where a verified house goes', () => {
  it('current → desk, draft → /menu, none → /get-started, unknown current → as before', () => {
    expect(afterVerifyIn({ menu_uploaded: true, menu_current: true })).toBe('/')
    expect(afterVerifyIn({ menu_uploaded: false, menu_current: true })).toBe('/')
    expect(afterVerifyIn({ menu_uploaded: true, menu_current: false })).toBe('/menu')
    expect(afterVerifyIn({ menu_uploaded: true })).toBe('/')
    expect(afterVerifyIn({ menu_uploaded: false, menu_current: false })).toBe('/get-started')
    expect(afterVerifyIn(null)).toBe('/get-started')
  })
})
