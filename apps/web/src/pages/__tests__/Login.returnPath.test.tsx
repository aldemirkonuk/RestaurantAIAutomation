/**
 * F-213: a signed-out deep link must come back whole after sign-in. Mailed
 * links carry the part that matters in the query (`/inventory?wine=…`,
 * `/orders?station=recurring`); /login used to keep only the path, so the
 * owner landed on all stock instead of the wine the mail named. Only a path on
 * this site is ever followed.
 */

import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const h = vi.hoisted(() => ({
  auth: {
    login: vi.fn(),
    clearError: vi.fn(),
    resolveSignInMethods: vi.fn(),
    error: null as string | null,
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => h.auth,
  LoginError: class LoginError extends Error {},
}))

// The passkey and emailed-code paths are not under test; only the password one.
vi.mock('../../services/api/passkeys', () => ({
  passkeysSupported: () => false,
  requestSignInCode: vi.fn(),
  signInWithEmailCode: vi.fn(),
  signInWithPasskey: vi.fn(),
}))

vi.mock('../../components/auth/GoogleSignInButton', () => ({
  GoogleSignInButton: () => createElement('span', null, 'google host'),
}))

import { Login, returnPath } from '../Login'
import { PUBLIC_OVERRIDE_KEY } from '../../lib/mudavym/publicDesign'

function Where() {
  const l = useLocation()
  return createElement('p', { 'data-testid': 'where' }, `${l.pathname}${l.search}${l.hash}`)
}

async function signInFrom(state: unknown) {
  h.auth.resolveSignInMethods.mockResolvedValue({
    email: 'someone@house.test',
    methods: [{ id: 'password', label: 'Password', enabled: true, disabledReason: null }],
    unavailable: [],
    declared: [],
    noSignInMethod: false,
  })
  h.auth.login.mockResolvedValue(undefined)
  render(
    createElement(
      MemoryRouter,
      { initialEntries: [{ pathname: '/login', search: '?email=someone%40house.test', state }] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/login', element: createElement(Login) }),
        createElement(Route, { path: '*', element: createElement(Where) }),
      ),
    ),
  )
  await screen.findByText('Change')
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'right-one' } })
  fireEvent.submit(screen.getByLabelText('Password').closest('form')!)
  return (await screen.findByTestId('where')).textContent
}

beforeEach(() => {
  window.localStorage.setItem(PUBLIC_OVERRIDE_KEY, 'on')
  h.auth.login.mockReset()
  h.auth.resolveSignInMethods.mockReset()
})

afterEach(() => {
  window.localStorage.removeItem(PUBLIC_OVERRIDE_KEY)
})

describe('signing in returns to the whole link', () => {
  it('keeps the query and hash ProtectedRoute handed over', async () => {
    const from = { pathname: '/inventory', search: '?wine=w1', hash: '#lots' }
    expect(await signInFrom({ from })).toBe('/inventory?wine=w1#lots')
  })

  it('with no link to return to, opens the dashboard', async () => {
    expect(await signInFrom(null)).toBe('/')
  })
})

describe('returnPath', () => {
  it('builds path + query + hash from a location', () => {
    expect(returnPath({ pathname: '/orders', search: '?station=recurring', hash: '' })).toBe(
      '/orders?station=recurring',
    )
    expect(returnPath('/orders?station=recurring')).toBe('/orders?station=recurring')
  })

  it('follows only a path on this site', () => {
    for (const bad of ['https://evil.test/x', '//evil.test/x', '/\\evil.test', 'javascript:alert(1)', 'orders', '']) {
      expect(returnPath(bad)).toBe('/')
    }
    expect(returnPath({ pathname: '//evil.test', search: '', hash: '' })).toBe('/')
    expect(returnPath(undefined)).toBe('/')
  })
})
