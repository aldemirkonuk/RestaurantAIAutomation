/** After a verify the page moves on in place: the session is refreshed, the check settles 240 ms, no document reload. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  post: vi.fn(),
  progress: vi.fn(),
  navigate: vi.fn(),
  signIn: vi.fn(),
  auth: { user: null as null | { email: string }, loading: false, logout: vi.fn() },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ ...h.auth, signInWithSession: h.signIn }),
}))
vi.mock('../../services/api/client', () => ({
  apiClient: { get: vi.fn(), post: h.post },
  getErrorMessage: () => 'Request failed. Try again.',
}))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: h.progress }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
}))
import { VerifyEmail } from '../VerifyEmail'

// header.payload.sig; storeSession reads the house from the token's restaurantId
const claims = btoa(JSON.stringify({ sub: 'u1', email: 'a@b.co', restaurantId: '6b1f3c1e-9a4d-4c7b-8e2f-1a2b3c4d5e6f' }))
const jwt = `x.${claims}.y`

function mount() {
  return render(
    <MemoryRouter initialEntries={['/verify-email?token=3f2b8c1e-9a4d-4c7b-8e2f-1a2b3c4d5e6f']}>
      <Routes><Route path="/verify-email" element={<VerifyEmail />} /></Routes>
    </MemoryRouter>,
  )
}
function reduce(on: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
async function verify() {
  fireEvent.click(screen.getByRole('button', { name: /verify my email/i }))
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
  vi.clearAllMocks()
  localStorage.clear()
  localStorage.setItem('mudavym.design.public', 'true')
  h.auth.user = { email: 'a@b.co' }
  h.post.mockResolvedValue({ data: { accessToken: jwt, refreshToken: 'r' } })
  h.progress.mockResolvedValue({ menu_uploaded: false })
  h.signIn.mockResolvedValue(undefined)
  reduce(false)
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('VerifyEmail moves on in place', () => {
  it('refreshes the session, then navigates after the 240 ms settle, never by reload', async () => {
    mount()
    await verify()
    expect(h.signIn).toHaveBeenCalledWith({ accessToken: jwt, refreshToken: 'r' })
    expect(h.navigate).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(239) })
    expect(h.navigate).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(h.navigate).toHaveBeenCalledWith('/get-started', { replace: true })
  })

  it('under reduced motion swaps at once', async () => {
    reduce(true)
    mount()
    await verify()
    await act(async () => { vi.advanceTimersByTime(0) })
    expect(h.navigate).toHaveBeenCalledWith('/get-started', { replace: true })
  })
})
