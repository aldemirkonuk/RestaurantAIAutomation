/**
 * F-213: a signed-out deep link comes back WHOLE after sign-in — the query
 * and hash the mail's link carried, not only the path — and never to another
 * site. F-637: a person opening /login while someone is already signed in on
 * this device is offered that person's way in or a real sign-out first, so a
 * second sign-in never lands on top of the first person's session.
 */

import { createElement, forwardRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const h = vi.hoisted(() => ({
  auth: {
    login: vi.fn(),
    clearError: vi.fn(),
    resolveSignInMethods: vi.fn(),
    signInWithSession: vi.fn(),
    logout: vi.fn(),
    forgetEndedSession: vi.fn(),
    error: null as string | null,
    loading: false,
    user: null as null | { userId: string; name: string; email: string },
  },
  pk: { signInWithPasskey: vi.fn() },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => h.auth,
  LoginError: class LoginError extends Error {},
}))

vi.mock('../../services/api/passkeys', () => ({
  passkeysSupported: () => true,
  signInWithPasskey: (...a: unknown[]) => h.pk.signInWithPasskey(...a),
  requestSignInCode: vi.fn(),
  signInWithEmailCode: vi.fn(),
}))

vi.mock('../../components/auth/GoogleSignInButton', () => ({
  GoogleSignInButton: forwardRef(function FakeGoogle() {
    return createElement('span', null, 'google host')
  }),
}))

import { Login } from '../Login'
import { PUBLIC_OVERRIDE_KEY } from '../../lib/mudavym/publicDesign'

function Where() {
  const l = useLocation()
  return createElement('p', null, `at ${l.pathname}${l.search}${l.hash}`)
}

function draw(entry: string | { pathname: string; search?: string; state?: unknown }) {
  render(
    createElement(
      MemoryRouter,
      { initialEntries: [entry] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/login', element: createElement(Login) }),
        createElement(Route, { path: '*', element: createElement(Where) }),
      ),
    ),
  )
}

beforeEach(() => {
  window.localStorage.setItem(PUBLIC_OVERRIDE_KEY, 'on')
  vi.clearAllMocks()
  h.auth.user = null
  h.auth.loading = false
  h.auth.signInWithSession.mockResolvedValue(undefined)
  h.pk.signInWithPasskey.mockResolvedValue({ accessToken: 'a.b.c', refreshToken: 'r' })
})

afterEach(() => {
  window.localStorage.removeItem(PUBLIC_OVERRIDE_KEY)
})

describe('/login — where sign-in sends you (F-213)', () => {
  it('returns to the deep link with its query and hash', async () => {
    draw({
      pathname: '/login',
      state: { from: { pathname: '/inventory', search: '?item=42', hash: '#lots' } },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))
    expect(await screen.findByText('at /inventory?item=42#lots')).toBeInTheDocument()
  })

  it('never follows a redirect to another site', async () => {
    draw('/login?redirect=%2F%2Fevil.example%2Fsteal')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))
    expect(await screen.findByText('at /')).toBeInTheDocument()
  })
})

describe('/login — someone is already signed in here (F-637)', () => {
  beforeEach(() => {
    h.auth.user = { userId: 'u-1', name: 'Mira', email: 'mira@house.test' }
  })

  it('says who, and shows no sign-in form over their session', () => {
    draw('/login?redirect=%2Forders')
    expect(screen.getByText(/You are signed in as/)).toHaveTextContent('Mira (mira@house.test)')
    expect(screen.queryByLabelText('Email Address')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in with a passkey' })).not.toBeInTheDocument()
  })

  it('lets them carry on as that person', async () => {
    draw('/login?redirect=%2Forders')
    fireEvent.click(screen.getByRole('button', { name: 'Continue as Mira' }))
    expect(await screen.findByText('at /orders')).toBeInTheDocument()
  })

  it('signs that person out properly before the form is shown', async () => {
    h.auth.logout.mockImplementation(async () => {
      h.auth.user = null
      return true
    })
    draw('/login')
    fireEvent.click(screen.getByRole('button', { name: 'Sign out to use another account' }))
    await waitFor(() => expect(h.auth.logout).toHaveBeenCalledTimes(1))
    expect(await screen.findByLabelText('Email Address')).toBeInTheDocument()
  })

  it('stays put when they keep the session (unsent changes)', async () => {
    h.auth.logout.mockResolvedValue(false)
    draw('/login')
    fireEvent.click(screen.getByRole('button', { name: 'Sign out to use another account' }))
    await waitFor(() => expect(h.auth.logout).toHaveBeenCalled())
    expect(screen.getByText(/You are signed in as/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Email Address')).not.toBeInTheDocument()
  })

  // F-1142: "Sign in here" on the session-ended panel arrives with ended=1
  // while the tab still holds the person whose session is gone.
  it('after the session ended, shows the form and why, never "signed in as"', () => {
    draw('/login?redirect=%2Forders&ended=1')
    expect(screen.queryByText(/You are signed in as/)).not.toBeInTheDocument()
    expect(screen.getByTestId('login-session-ended')).toHaveTextContent('This session was signed out.')
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument()
    expect(h.auth.forgetEndedSession).toHaveBeenCalledTimes(1)
    // their unsent changes are not thrown away to get here
    expect(h.auth.logout).not.toHaveBeenCalled()
  })

  it('after the session ended, still says who when a session is back on this device', () => {
    window.localStorage.setItem('accessToken', 'a.b.c')
    try {
      draw('/login?redirect=%2Forders&ended=1')
      expect(screen.getByText(/You are signed in as/)).toBeInTheDocument()
      expect(h.auth.forgetEndedSession).not.toHaveBeenCalled()
    } finally {
      window.localStorage.removeItem('accessToken')
    }
  })

  it('waits for the device session to be known before deciding', () => {
    h.auth.user = null
    h.auth.loading = true
    draw('/login')
    // nothing decided yet: the form shows; the panel does not
    expect(screen.queryByText(/You are signed in as/)).not.toBeInTheDocument()
  })
})
