/**
 * The endpaper's refusal note (sketch 118 frames 06-07, the founder's build
 * directions of 2026-09-19): what /login says when a sign-in is refused, on
 * the house path. The note keys on the gateway's HTTP status, never on its
 * message text, and a refusal it has named must never outlive the attempt
 * that produced it — found by PR #397's audit plan: a password mismatch
 * followed by a refused Google sign-in on the same step used to keep saying
 * "That password did not match." over the Google message.
 */

import { createElement, forwardRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const h = vi.hoisted(() => {
  class LoginError extends Error {
    constructor(
      message: string,
      public code?: string,
      public provider?: 'google' | 'microsoft',
      public status?: number,
    ) {
      super(message)
    }
  }
  return {
    LoginError,
    auth: {
      login: vi.fn(),
      clearError: vi.fn(),
      resolveSignInMethods: vi.fn(),
      error: null as string | null,
    },
    googleError: { current: null as null | ((message: string) => void) },
  }
})

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => h.auth,
  LoginError: h.LoginError,
}))

// Google's own script cannot load in jsdom; this stand-in hands the page's
// onError to the test, which is the only part of the button under test here.
vi.mock('../../components/auth/GoogleSignInButton', () => ({
  GoogleSignInButton: forwardRef(function FakeGoogle(props: { onError?: (m: string) => void }, _ref) {
    h.googleError.current = props.onError ?? null
    return createElement('span', null, 'google host')
  }),
}))

import { Login } from '../Login'
import { PUBLIC_OVERRIDE_KEY } from '../../lib/mudavym/publicDesign'

const method = (id: 'password' | 'google', label: string) => ({ id, label, enabled: true, disabledReason: null })

async function atPasswordStep() {
  h.auth.resolveSignInMethods.mockResolvedValue({
    email: 'someone@house.test',
    methods: [method('password', 'Password'), method('google', 'Google')],
    unavailable: [],
    declared: [],
    noSignInMethod: false,
  })
  render(createElement(MemoryRouter, { initialEntries: ['/login?email=someone%40house.test'] }, createElement(Login)))
  await screen.findByText('Change')
}

async function submitPassword() {
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'not-the-one' } })
  fireEvent.submit(screen.getByLabelText('Password').closest('form')!)
}

beforeEach(() => {
  window.localStorage.setItem(PUBLIC_OVERRIDE_KEY, 'on')
  h.auth.login.mockReset()
  h.auth.resolveSignInMethods.mockReset()
  h.googleError.current = null
})

afterEach(() => {
  window.localStorage.removeItem(PUBLIC_OVERRIDE_KEY)
})

describe('the refusal note on the endpaper', () => {
  it('a plain 401 reads as a password that did not match', async () => {
    h.auth.login.mockRejectedValue(new h.LoginError('Invalid credentials', undefined, undefined, 401))
    await atPasswordStep()
    await submitPassword()
    expect(await screen.findByText('That password did not match.')).toBeInTheDocument()
  })

  it('a 429 reads as a pause, and names the connection, not the address', async () => {
    h.auth.login.mockRejectedValue(new h.LoginError('Too many requests', undefined, undefined, 429))
    await atPasswordStep()
    await submitPassword()
    expect(await screen.findByText('Too many tries — wait a moment.')).toBeInTheDocument()
    expect(screen.getByText(/This connection has made too many sign-in attempts/)).toBeInTheDocument()
  })

  it('a refusal that carries a code keeps the gateway’s own words', async () => {
    h.auth.login.mockRejectedValue(new h.LoginError('Set a password to sign in.', 'NO_SIGNIN_METHOD', undefined, 401))
    await atPasswordStep()
    await submitPassword()
    expect(await screen.findByText('Set a password to sign in.')).toBeInTheDocument()
    expect(screen.queryByText('That password did not match.')).toBeNull()
  })

  it('a Google refusal after a password mismatch is shown as itself, never as the mismatch', async () => {
    h.auth.login.mockRejectedValue(new h.LoginError('Invalid credentials', undefined, undefined, 401))
    await atPasswordStep()
    await submitPassword()
    await screen.findByText('That password did not match.')
    expect(h.googleError.current).toBeTypeOf('function')
    h.googleError.current!('This Google account has no Mudavym account.')
    expect(await screen.findByText('This Google account has no Mudavym account.')).toBeInTheDocument()
    expect(screen.queryByText('That password did not match.')).toBeNull()
  })
})

// F-335: a refused sign-in sends the person here with ?ended=1 and the page
// they were on. Say why, and go back only to a page on this site.
describe('sent back to sign in after a session ended', () => {
  function Where() {
    const l = useLocation()
    return createElement('p', { 'data-testid': 'where' }, l.pathname)
  }

  async function signInFrom(url: string) {
    h.auth.login.mockResolvedValue(undefined)
    h.auth.resolveSignInMethods.mockResolvedValue({
      email: 'someone@house.test',
      methods: [method('password', 'Password')],
      unavailable: [],
      declared: [],
      noSignInMethod: false,
    })
    render(
      createElement(
        MemoryRouter,
        { initialEntries: [url] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/login', element: createElement(Login) }),
          createElement(Route, { path: '*', element: createElement(Where) }),
        ),
      ),
    )
    await screen.findByText('Change')
  }

  it('says the session was signed out', async () => {
    await signInFrom('/login?email=someone%40house.test&ended=1&redirect=%2Forders')
    expect(screen.getByTestId('login-session-ended').textContent).toContain('This session was signed out. Sign in again.')
  })

  it('goes back to the page the person was on', async () => {
    await signInFrom('/login?email=someone%40house.test&ended=1&redirect=%2Forders')
    await submitPassword()
    expect((await screen.findByTestId('where')).textContent).toBe('/orders')
  })

  it('never follows a redirect off this site', async () => {
    await signInFrom('/login?email=someone%40house.test&redirect=%2F%2Fevil.test%2Fx')
    await submitPassword()
    expect((await screen.findByTestId('where')).textContent).toBe('/')
  })
})
