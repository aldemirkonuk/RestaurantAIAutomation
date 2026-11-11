import { beforeEach, afterEach, expect, it, vi, describe } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * Onboarding OB-6 (founder /goal 2026-11-07; proposal §3 OB-6): the sign-up's
 * mail outcome reaches /verify-email. `registerAccount` keeps the gateway's
 * `verificationMail` under `mudavym:verification-mail`; the page seeds one
 * mail state from it, a resend writes its answer back, and the key is cleared
 * at sign-out and once the address is verified. A resend the mailer did
 * not confirm in time is said as such, never as sent.
 */
const h = vi.hoisted(() => ({
  post: vi.fn(),
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
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: h.toastSuccess } }))
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

const KEY = 'mudavym:verification-mail'
/** The note as sign-up keeps it: the outcome and the address it was mailed to. */
const kept = (outcome: string, email = 'owner@house.test') => JSON.stringify({ outcome, email })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_MUDAVYM_PUBLIC', '')
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('mudavym.design.public', 'true')
  h.auth.user = { email: 'owner@house.test', emailVerified: false }
  h.auth.loading = false
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe("the sign-up's mail outcome", () => {
  it('QA r19 (#914): a note kept for another address says nothing to this account', () => {
    sessionStorage.setItem(KEY, kept('not_sent', 'someone.else@house.test'))
    mount()
    expect(screen.queryByText(/We could not send the verification email/)).not.toBeInTheDocument()
  })

  it('QA r19 (#914): an account already verified is never told its mail did not leave', () => {
    h.auth.user = { email: 'owner@house.test', emailVerified: true }
    sessionStorage.setItem(KEY, kept('not_sent'))
    mount()
    expect(screen.queryByText(/We could not send the verification email/)).not.toBeInTheDocument()
  })

  it("t5: 'not_sent' says it could not send, with the resend button right there", () => {
    sessionStorage.setItem(KEY, kept('not_sent'))
    mount()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'We could not send the verification email',
    )
    expect(
      screen.getByRole('button', { name: 'Resend verification email' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Open the verification link in your inbox/),
    ).not.toBeInTheDocument()
    // Kept for the session, so a reload says the same thing.
    expect(sessionStorage.getItem(KEY)).toBe(kept('not_sent'))
  })

  it("t6: 'unconfirmed' says the mail may still arrive", () => {
    sessionStorage.setItem(KEY, kept('unconfirmed'))
    mount()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Sending is taking longer than usual. The email may still arrive',
    )
  })

  it("'sent' keeps today's words", () => {
    sessionStorage.setItem(KEY, kept('sent'))
    mount()
    expect(
      screen.getByText(/Open the verification link in your inbox/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('storage that throws still renders the page', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      mount()
      expect(
        screen.getByRole('button', { name: 'Resend verification email' }),
      ).toBeInTheDocument()
    } finally {
      get.mockRestore()
      remove.mockRestore()
    }
  })

  it('a resend the mailer did not confirm is said as such, never as sent', async () => {
    h.post.mockResolvedValueOnce({
      data: { success: true, sent: false, verificationMail: 'unconfirmed' },
    })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'The email may still arrive',
    )
    expect(h.toastSuccess).not.toHaveBeenCalled()
    expect(screen.queryByText(/was sent at/)).not.toBeInTheDocument()
  })

  it('one state: a not_sent resend after an unconfirmed note replaces it, never stacks', async () => {
    sessionStorage.setItem(KEY, kept('unconfirmed'))
    h.post.mockResolvedValueOnce({
      data: { success: true, sent: false, verificationMail: 'not_sent' },
    })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }))
    await screen.findByRole('alert')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.queryByText(/may still arrive/)).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Open the verification link in your inbox/),
    ).not.toBeInTheDocument()
  })

  it('one state: a not_sent sign-up then a not_sent resend shows one sentence, not two', async () => {
    sessionStorage.setItem(KEY, kept('not_sent'))
    h.post.mockResolvedValueOnce({
      data: { success: true, sent: false, verificationMail: 'not_sent' },
    })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }))
    await screen.findByRole('alert')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getAllByText(/We could not send the verification email/)).toHaveLength(1)
  })

  it('one state: a sent resend clears an earlier note', async () => {
    sessionStorage.setItem(KEY, kept('not_sent'))
    h.post.mockResolvedValueOnce({
      data: { success: true, sent: true, verificationMail: 'sent' },
    })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }))
    expect(await screen.findByText(/was sent at/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('the legacy page does not list "Open the email" steps under a could-not-send note', () => {
    localStorage.setItem('mudavym.design.public', 'false')
    sessionStorage.setItem(KEY, kept('not_sent'))
    mount()
    expect(screen.getByRole('alert')).toHaveTextContent('We could not send')
    expect(screen.getByText('Check Your Email')).toBeInTheDocument()
    expect(screen.queryByText('Open the email from Mudavym')).not.toBeInTheDocument()
  })

  it('a reload keeps the not_sent note (sign-up)', () => {
    sessionStorage.setItem(KEY, kept('not_sent'))
    const first = mount()
    first.unmount()
    mount()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'We could not send the verification email',
    )
  })

  it('a reload keeps the note a not_sent resend left', async () => {
    h.post.mockResolvedValueOnce({
      data: { success: true, sent: false, verificationMail: 'not_sent' },
    })
    const first = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }))
    await screen.findByRole('alert')
    first.unmount()
    mount()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'We could not send the verification email',
    )
  })

  it('a reload after a sent resend shows the usual words', async () => {
    sessionStorage.setItem(KEY, kept('not_sent'))
    h.post.mockResolvedValueOnce({
      data: { success: true, sent: true, verificationMail: 'sent' },
    })
    const first = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }))
    await screen.findByText(/was sent at/)
    first.unmount()
    mount()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a verified link clears the note, so it never returns for this account', async () => {
    sessionStorage.setItem(KEY, kept('not_sent'))
    h.post.mockResolvedValueOnce({
      data: { accessToken: 'x.e30.sig', refreshToken: 'r' },
    })
    render(
      <MemoryRouter initialEntries={['/verify-email?token=t1']}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmail />} />
        </Routes>
      </MemoryRouter>,
    )
    // Signed in, the link verifies by itself (F3, this PR): no click.
    await vi.waitFor(() => expect(h.toastSuccess).toHaveBeenCalled())
    expect(h.auth.signInWithSession).toHaveBeenCalled()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })
})
