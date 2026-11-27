import { beforeEach, afterEach, expect, it, vi, describe } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * Onboarding OB-6 (founder /goal 2026-11-07; proposal §3 OB-6, §4 F3): the
 * verification mail's code gets a box on /verify-email for a signed-in person
 * with no link. Six digits post `{ code }` once; a refusal is worded from its
 * status and code, never the server's prose. A right code finishes the way the
 * link does (`VerifyEmail.link.test.tsx`): signInWithSession, then the router.
 */
const HOUSE = '6b1f0c3e-2d4a-4b8e-9f10-2a3b4c5d6e7f'
const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims))}.s`
const PAIR = {
  accessToken: jwt({ sub: 'u1', restaurantId: HOUSE }),
  refreshToken: 'refresh-1',
}

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

const codeBox = () => screen.getByLabelText('Code from the email')

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

describe('the code box (signed in, no link)', () => {
  it('t1: typing six digits posts { code } once', async () => {
    h.post.mockReturnValue(new Promise(() => undefined))
    mount('/verify-email')
    const box = codeBox()
    expect(box).toHaveAttribute('inputmode', 'numeric')
    expect(box).toHaveAttribute('autocomplete', 'one-time-code')

    fireEvent.change(box, { target: { value: '12345' } })
    expect(h.post).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: '123456' } })
    // A second change while the first post is open does not post again.
    fireEvent.change(box, { target: { value: '123456' } })

    expect(h.post).toHaveBeenCalledTimes(1)
    expect(h.post).toHaveBeenCalledWith('/auth/verify-email', { code: '123456' })
    expect(codeBox()).toBeDisabled()
  })

  it('a pasted code with spaces or a dash is stripped to its digits and submits', async () => {
    h.post.mockReturnValue(new Promise(() => undefined))
    mount('/verify-email')
    fireEvent.change(codeBox(), { target: { value: ' 123-456 ' } })
    expect(h.post).toHaveBeenCalledWith('/auth/verify-email', { code: '123456' })
  })

  it('t2: success stores the session through signInWithSession, then routes on; no page load', async () => {
    h.post.mockResolvedValue({ data: PAIR })
    mount('/verify-email')
    fireEvent.change(codeBox(), { target: { value: '123456' } })

    // Default findBy timeout is 1000 ms: the old 1500 ms wait cannot pass.
    expect(await screen.findByText('get-started page')).toBeInTheDocument()
    expect(h.auth.signInWithSession).toHaveBeenCalledWith(PAIR)
    expect(hrefWrites).toEqual([])
  })

  it('t7: a wrong code is worded from its status and code, never the server prose', async () => {
    h.post.mockRejectedValue({
      response: {
        status: 400,
        data: { code: 'CODE_REFUSED', message: 'SERVER PROSE MUST NOT SHOW' },
      },
    })
    mount('/verify-email')
    fireEvent.change(codeBox(), { target: { value: '000000' } })
    const alert = await screen.findByTestId('verify-code-refusal')
    expect(alert).toHaveTextContent('That code is not right, or it has expired.')
    expect(screen.queryByText(/SERVER PROSE/)).not.toBeInTheDocument()
  })

  it('a spent code (fifth wrong try) says to send a new email, with the resend button', async () => {
    h.post.mockRejectedValue({
      response: { status: 400, data: { code: 'CODE_SPENT', message: 'x' } },
    })
    mount('/verify-email')
    fireEvent.change(codeBox(), { target: { value: '000000' } })
    expect(await screen.findByTestId('verify-code-refusal')).toHaveTextContent(
      'Too many tries for this code. Send a new email',
    )
    expect(
      screen.getByRole('button', { name: 'Resend verification email' }),
    ).toBeInTheDocument()
  })

  it("the address's daily lock has its own sentence", async () => {
    h.post.mockRejectedValue({
      response: { status: 429, data: { code: 'CODE_LOCKED_FOR_THE_DAY' } },
    })
    mount('/verify-email')
    fireEvent.change(codeBox(), { target: { value: '000000' } })
    expect(await screen.findByTestId('verify-code-refusal')).toHaveTextContent(
      'Too many wrong codes for this address today',
    )
  })

  it('a signed-out person sees no code box and keeps the sign-in path', () => {
    h.auth.user = null
    mount('/verify-email')
    expect(screen.queryByLabelText('Code from the email')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in to resend' })).toBeInTheDocument()
  })
})

// Walk 2026-11-11: the sixth digit submits, the refusal line clears, and
// Resend moves under the pointer; its press mailed a new code to an address
// verified 18 ms before. No resend while a code is being checked.
describe('resend while a code is being checked', () => {
  it('is disabled and posts nothing while the code is in flight', async () => {
    h.post.mockReturnValue(new Promise(() => undefined))
    mount('/verify-email')
    const resend = screen.getByRole('button', { name: 'Resend verification email' })
    expect(resend).toBeEnabled()
    fireEvent.change(codeBox(), { target: { value: '123456' } })
    expect(resend).toBeDisabled()
    fireEvent.click(resend)
    expect(h.post).toHaveBeenCalledTimes(1)
    expect(h.post).toHaveBeenCalledWith('/auth/verify-email', { code: '123456' })
  })

  it('comes back after a refused code', async () => {
    h.post.mockRejectedValueOnce({
      response: { status: 400, data: { code: 'CODE_REFUSED', message: 'x' } },
    })
    mount('/verify-email')
    fireEvent.change(codeBox(), { target: { value: '000000' } })
    await screen.findByTestId('verify-code-refusal')
    expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeEnabled()
  })
})

describe('the code box when storage is blocked', () => {
  it('storage that throws still renders the page, box and all', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      mount('/verify-email')
      expect(screen.getByLabelText('Code from the email')).toBeInTheDocument()
    } finally {
      get.mockRestore()
      remove.mockRestore()
    }
  })
})
