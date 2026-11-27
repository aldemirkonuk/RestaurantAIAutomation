import { beforeEach, afterEach, expect, it, vi, describe } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * r104 onboarding gap 1: the "Check your email" tab did not notice an address
 * verified on a phone or in another tab until the person found it and
 * reloaded. It now asks again every few seconds (slower as it waits, for ten
 * minutes at most), when another tab stores a session, and when looked at.
 */
const HOUSE = '6b1f0c3e-2d4a-4b8e-9f10-2a3b4c5d6e7f'
const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims))}.s`
const ACCESS = jwt({ sub: 'u1', restaurantId: HOUSE })

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  progress: vi.fn(),
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
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
import { VerifyEmail } from '../VerifyEmail'

function mount() {
  return render(
    <MemoryRouter initialEntries={['/verify-email']}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/get-started" element={<p>get-started page</p>} />
        <Route path="/" element={<p>home page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

let visibility: DocumentVisibilityState = 'visible'
const said = (v: boolean) => ({ data: { user: { emailVerified: v } } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
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
  h.get.mockResolvedValue(said(false))
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('the check-your-email tab waits for a verify done elsewhere', () => {
  it('asks /auth/me by itself: false, then true, then moves on to /get-started', async () => {
    h.get.mockResolvedValueOnce(said(false)).mockResolvedValue(said(true))
    mount()
    await advance(4_900)
    expect(h.get).not.toHaveBeenCalled()
    await advance(200)
    expect(h.get).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('get-started page')).toBeNull()
    await advance(8_000)
    expect(h.get).toHaveBeenCalledTimes(2)
    expect(h.auth.signInWithSession).toHaveBeenCalledWith({ accessToken: ACCESS, refreshToken: 'refresh-1' })
    await advance(50)
    expect(screen.getByText('get-started page')).toBeInTheDocument()
  })

  it('a session stored by another tab (storage event) is asked about at once', async () => {
    h.get.mockResolvedValue(said(true))
    mount()
    expect(h.get).not.toHaveBeenCalled()
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'accessToken', newValue: 'x' }))
    })
    expect(h.get).toHaveBeenCalledTimes(1)
    await advance(50)
    expect(screen.getByText('get-started page')).toBeInTheDocument()
  })

  it('an unrelated storage key asks nothing', async () => {
    mount()
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'x' }))
    })
    expect(h.get).not.toHaveBeenCalled()
  })

  it('no poll runs while the tab is hidden', async () => {
    visibility = 'hidden'
    mount()
    await advance(60_000)
    expect(h.get).not.toHaveBeenCalled()
  })

  it('slows down while it waits, and stops the timer after ten minutes', async () => {
    mount()
    await advance(60_000)
    const inFirstMinute = h.get.mock.calls.length
    expect(inFirstMinute).toBeGreaterThanOrEqual(4)
    expect(inFirstMinute).toBeLessThan(12) // slower than every 5 s
    await advance(11 * 60_000)
    const atEnd = h.get.mock.calls.length
    await advance(5 * 60_000)
    expect(h.get.mock.calls.length).toBe(atEnd)
  })

  it('unmounting clears the timer and the listeners', async () => {
    const { unmount } = mount()
    unmount()
    await advance(60_000)
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'accessToken', newValue: 'x' }))
    })
    expect(h.get).not.toHaveBeenCalled()
  })
})

describe('a poll that cannot read says so (ADR 0020, r105)', () => {
  const tooMany = { response: { status: 429 } }

  it('a 429 on the first read puts one calm sentence on the page', async () => {
    h.get.mockRejectedValue(tooMany)
    mount()
    expect(screen.queryByTestId('verify-poll-trouble')).not.toBeInTheDocument()
    await advance(5_000)
    expect(screen.getByTestId('verify-poll-trouble')).toHaveTextContent(
      'We cannot check just now whether this address was verified.',
    )
  })

  it('a refusal that is not a 429 is said on the second read, not the first', async () => {
    h.get.mockRejectedValue(new Error('offline'))
    mount()
    await advance(5_000)
    expect(screen.queryByTestId('verify-poll-trouble')).not.toBeInTheDocument()
    await advance(8_000)
    expect(screen.getByTestId('verify-poll-trouble')).toBeInTheDocument()
  })

  it('the sentence goes when a read comes back', async () => {
    h.get.mockRejectedValueOnce(tooMany)
    h.get.mockResolvedValue(said(false))
    mount()
    await advance(5_000)
    expect(screen.getByTestId('verify-poll-trouble')).toBeInTheDocument()
    await advance(12_000)
    expect(screen.queryByTestId('verify-poll-trouble')).not.toBeInTheDocument()
  })

  it('once the timer has stopped, the words say so, not "keeps trying" (r107)', async () => {
    h.get.mockRejectedValue(tooMany)
    mount()
    await advance(60_000)
    expect(screen.getByTestId('verify-poll-trouble')).toHaveTextContent('keeps trying')
    await advance(11 * 60_000)
    const atEnd = h.get.mock.calls.length
    await advance(30 * 60_000)
    expect(h.get.mock.calls.length).toBe(atEnd)
    expect(screen.queryByTestId('verify-poll-trouble')).not.toBeInTheDocument()
    expect(screen.getByTestId('verify-poll-stopped')).toHaveTextContent('This page has stopped checking.')
  })

  it('after ten minutes of healthy reads the stopped line is said too (r106)', async () => {
    mount()
    await advance(60_000)
    expect(screen.queryByTestId('verify-poll-stopped')).not.toBeInTheDocument()
    await advance(11 * 60_000)
    expect(screen.queryByTestId('verify-poll-trouble')).not.toBeInTheDocument()
    expect(screen.getByTestId('verify-poll-stopped')).toHaveTextContent('This page has stopped checking.')
  })

  it('a timer that is still running never says it has stopped', async () => {
    h.get.mockRejectedValue(tooMany)
    mount()
    await advance(60_000)
    expect(screen.queryByTestId('verify-poll-stopped')).not.toBeInTheDocument()
  })
})
