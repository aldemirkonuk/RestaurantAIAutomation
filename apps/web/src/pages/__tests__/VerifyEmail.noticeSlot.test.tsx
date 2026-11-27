import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, afterEach, expect, it, vi, describe } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * r106 onboarding-2: the "cannot check just now" line made the centred column
 * jump 34 px (CLS 0.0524 at 375, reduced motion included) because it was added
 * to a plate that had no room for it. The live region now exists from the first
 * paint and the words go into it in place. jsdom has no layout, so the pin is
 * structural: the same live-region node before and after, and a hidden copy of
 * the sentence in the same grid cell that holds the height.
 */
const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims))}.s`
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  auth: {
    user: { email: 'owner@house.test', emailVerified: false } as null | { email: string; emailVerified: boolean },
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
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: vi.fn().mockResolvedValue(null) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
import { VerifyEmail } from '../VerifyEmail'

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/verify-email']}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/login" element={<p>login page</p>} />
      </Routes>
    </MemoryRouter>,
  )
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubEnv('VITE_MUDAVYM_PUBLIC', '')
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('mudavym.design.public', 'true')
  h.auth.user = { email: 'owner@house.test', emailVerified: false }
  h.auth.loading = false
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('the poll notice has its room from the first paint', () => {
  beforeEach(() => {
    localStorage.setItem('accessToken', jwt({ sub: 'u1' }))
    localStorage.setItem('refreshToken', 'r1')
  })

  it('the live region is on the page before the sentence and is the same node after', async () => {
    h.get.mockRejectedValue({ response: { status: 429 } })
    mount()
    const slot = screen.getByTestId('verify-poll-slot')
    const live = slot.querySelector('[role="status"]') as HTMLElement
    expect(live).not.toBeNull()
    expect(live.textContent).toBe('')
    expect(screen.queryByTestId('verify-poll-trouble')).not.toBeInTheDocument()
    await advance(5_000)
    expect(screen.getByTestId('verify-poll-slot')).toBe(slot)
    expect(slot.querySelector('[role="status"]')).toBe(live)
    expect(live).toHaveTextContent('We cannot check just now')
  })

  it('a hidden copy of the sentence shares the live cell, so the height does not change', async () => {
    h.get.mockRejectedValue({ response: { status: 429 } })
    mount()
    const slot = screen.getByTestId('verify-poll-slot')
    const ghost = slot.querySelector('[aria-hidden="true"]') as HTMLElement
    const live = slot.querySelector('[role="status"]') as HTMLElement
    expect(ghost.textContent).toMatch(/We cannot check just now/)
    expect(ghost.style.visibility).toBe('hidden')
    expect(ghost.style.gridArea).toBe(live.style.gridArea)
    expect(ghost.className).toBe(live.className)
    await advance(5_000)
    expect(slot.querySelectorAll('p')).toHaveLength(2)
  })
})

describe('with no session', () => {
  it('says to sign in after verifying, with one link to do it', () => {
    h.auth.user = null
    mount()
    expect(screen.getByText('After you verify, sign in to continue.')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'I verified it, sign in' })
    expect(link).toHaveAttribute('href', '/login')
    expect(link).toHaveClass('mdv-pub__verified')
    expect(screen.queryByTestId('verify-poll-slot')).not.toBeInTheDocument()
  })
})

describe('the verified-it link is a 44px, centred target', () => {
  it('has a rule that gives it 44px and centres it', () => {
    const css = readFileSync(
      resolve(__dirname, '../../components/mudavym/public-shell.css'),
      'utf8',
    )
    const rule = css.match(/\.mdv-pub__stack > a\.mdv-pub__verified \{([^}]*)\}/)
    expect(rule).not.toBeNull()
    expect(rule![1]).toMatch(/min-height:\s*44px/)
    expect(rule![1]).toMatch(/display:\s*inline-flex/)
    expect(rule![1]).toMatch(/justify-self:\s*center/)
    expect(rule![1]).not.toMatch(/transition|animation/)
  })
})
