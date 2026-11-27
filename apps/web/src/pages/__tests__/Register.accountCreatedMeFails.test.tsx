import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * A sign-up that created the account but whose `/auth/me` read failed still
 * moves on to /verify-email (r105 onboarding g1). The page runs on the real
 * AuthProvider; only the wire is faked. Before the change `registerAccount`
 * threw on the failed read, the person stayed on /register, and the next
 * press met their own new row as "already registered".
 */

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
  const instance = {
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    get: vi.fn(),
    post: vi.fn(),
  }
  const isAxiosError = (e: unknown) => Boolean((e as { isAxiosError?: boolean } | null)?.isAxiosError)
  return { instance, globalPost: vi.fn(), isAxiosError }
})

vi.mock('axios', () => ({
  default: { create: () => h.instance, post: h.globalPost, isAxiosError: h.isAxiosError },
  create: () => h.instance,
  post: h.globalPost,
  isAxiosError: h.isAxiosError,
}))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  const MOTION = new Set(['initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap', 'whileFocus', 'layout', 'layoutId', 'variants'])
  const motion = new Proxy({}, {
    get: (_t, tag: string) =>
      React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
        const rest: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(props)) if (!MOTION.has(k)) rest[k] = v
        return React.createElement(tag, { ...rest, ref })
      }),
  })
  return { motion, AnimatePresence: ({ children }: { children?: unknown }) => React.createElement(React.Fragment, null, children as never) }
})

import { AuthProvider } from '../../contexts/AuthContext'
import { Register } from '../Register'
import { VerifyEmail } from '../VerifyEmail'

const tooMany = Object.assign(new Error('Request failed with status code 429'), {
  isAxiosError: true,
  response: { status: 429, data: {} },
})

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`
}

const calls = (m: ReturnType<typeof vi.fn>, part: string) =>
  m.mock.calls.filter((c) => String(c[0]).includes(part)).length

describe('Register: account created, /auth/me fails', () => {
  beforeEach(() => {
    localStorage.clear()
    h.instance.get.mockReset()
    h.instance.post.mockReset()
    h.instance.get.mockImplementation(async (url: string) => {
      if (url.startsWith('/auth/check-email')) return { data: { available: true, email: 'x' } }
      if (url === '/api/v1/auth/me') throw tooMany
      return { data: [] }
    })
    h.instance.post.mockImplementation(async (url: string) => {
      if (url === '/api/v1/auth/register/account')
        return { status: 201, data: { accessToken: jwt({ sub: 'u1', restaurantId: null }), refreshToken: 'r' } }
      throw new Error(`unexpected POST ${url}`)
    })
  })
  afterEach(cleanup)

  it('moves on to /verify-email, says nothing is registered twice, and probes once, at the press', async () => {
    render(
      <MemoryRouter initialEntries={['/register?type=new']}>
        <AuthProvider>
          <Routes>
            <Route path="/register" element={<Register />} />
            <Route path="/verify-email" element={<p>verify-email page</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    const change = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    await screen.findByLabelText('Email *')
    change('Full Name *', 'Deniz Kaya')
    change('Email *', 'deniz@house.test')
    change('Password *', 'long-enough-1')
    change('Confirm Password *', 'long-enough-1')
    // Pressed inside the 400 ms debounce: the press probes at once, and the
    // typing's own timer is still pending when the page is left.
    expect(calls(h.instance.get, '/auth/check-email')).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await screen.findByText('verify-email page', undefined, { timeout: 4000 })
    expect(calls(h.instance.post, '/auth/register/account')).toBe(1)
    expect(calls(h.instance.get, '/auth/me')).toBe(1)
    expect(screen.queryByText(/already registered/i)).toBeNull()
    // Past the debounce, a count taken once: a late timer would add a second probe.
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(calls(h.instance.get, '/auth/check-email')).toBe(1)
  })

  // r105 review: with /auth/me failing once, nothing read it again, so
  // /verify-email showed "Sign in to resend" with a valid session in storage.
  it('/verify-email reads /auth/me again, and the Resend button comes back', async () => {
    localStorage.setItem('accessToken', jwt({ sub: 'u1', restaurantId: null }))
    localStorage.setItem('refreshToken', 'r')
    let meCalls = 0
    h.instance.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/auth/me') {
        meCalls += 1
        if (meCalls === 1) throw tooMany
        return { data: { user: { userId: 'u1', email: 'deniz@house.test', name: 'Deniz', role: 'owner', emailVerified: false, restaurantId: null } } }
      }
      return { data: [] }
    })
    render(
      <MemoryRouter initialEntries={['/verify-email']}>
        <AuthProvider>
          <Routes>
            <Route path="/verify-email" element={<VerifyEmail />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('button', { name: /resend verification email/i }, { timeout: 4000 })).toBeInTheDocument()
    expect(meCalls).toBe(2)
  })
})
