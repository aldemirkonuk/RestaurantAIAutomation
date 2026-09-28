/**
 * The two sign-in doors that are not a password (ADR 0222 / ADR 0229; the
 * founder, 2026-09-25, item 29, confirmed reading): "a passkey (Face ID /
 * Touch ID) IS a sign-in method; logged out with no passkey -> emailed
 * one-time code", both beside the password and Google paths, which stay.
 *
 * The API module is mocked at its boundary; the ceremony and the code rules
 * are proven in the gateway (`passkeys.sign-in.spec.ts`,
 * `sign-in-codes.service.spec.ts`). These assert what the person sees and
 * that a session is taken only from a proof that succeeded.
 */

import { createElement, forwardRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const h = vi.hoisted(() => ({
  auth: {
    login: vi.fn(),
    clearError: vi.fn(),
    resolveSignInMethods: vi.fn(),
    signInWithSession: vi.fn(),
    error: null as string | null,
  },
  pk: {
    supported: true,
    signInWithPasskey: vi.fn(),
    requestSignInCode: vi.fn(),
    signInWithEmailCode: vi.fn(),
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => h.auth,
  LoginError: class LoginError extends Error {},
}))

vi.mock('../../services/api/passkeys', () => ({
  passkeysSupported: () => h.pk.supported,
  signInWithPasskey: (...a: unknown[]) => h.pk.signInWithPasskey(...a),
  requestSignInCode: (...a: unknown[]) => h.pk.requestSignInCode(...a),
  signInWithEmailCode: (...a: unknown[]) => h.pk.signInWithEmailCode(...a),
}))

vi.mock('../../components/auth/GoogleSignInButton', () => ({
  GoogleSignInButton: forwardRef(function FakeGoogle() {
    return createElement('span', null, 'google host')
  }),
}))

import { Login } from '../Login'
import { PUBLIC_OVERRIDE_KEY } from '../../lib/mudavym/publicDesign'

const PAIR = { accessToken: 'a.b.c', refreshToken: 'r' }
const SENT = 'If an account uses that address, a six-digit code is on its way. It works for ten minutes.'

function draw(path = '/login?redirect=/orders') {
  render(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/login', element: createElement(Login) }),
        createElement(Route, { path: '/orders', element: createElement('p', null, 'orders page') }),
      ),
    ),
  )
}

async function atMethodStep(methods = [{ id: 'password', label: 'Password', enabled: true, disabledReason: null }]) {
  h.auth.resolveSignInMethods.mockResolvedValue({
    email: 'mira@house.test',
    methods,
    unavailable: [],
    declared: [],
    noSignInMethod: methods.length === 0,
  })
  draw('/login?email=mira%40house.test&redirect=/orders')
  await screen.findByText('Change')
}

beforeEach(() => {
  window.localStorage.setItem(PUBLIC_OVERRIDE_KEY, 'on')
  vi.clearAllMocks()
  h.pk.supported = true
  h.auth.signInWithSession.mockResolvedValue(undefined)
})

afterEach(() => {
  window.localStorage.removeItem(PUBLIC_OVERRIDE_KEY)
})

describe('/login — a passkey signs you in', () => {
  it('offers "Sign in with a passkey" before any address is typed', () => {
    draw()
    expect(screen.getByRole('button', { name: 'Sign in with a passkey' })).toBeInTheDocument()
    // the password and Google paths are still there
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument()
    expect(screen.getByText('google host')).toBeInTheDocument()
  })

  it('does not offer it where the browser cannot run a passkey at all', () => {
    h.pk.supported = false
    draw()
    expect(screen.queryByRole('button', { name: 'Sign in with a passkey' })).not.toBeInTheDocument()
  })

  it('takes the session the gateway minted and goes where the person was headed', async () => {
    h.pk.signInWithPasskey.mockResolvedValue(PAIR)
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))
    expect(await screen.findByText('orders page')).toBeInTheDocument()
    expect(h.auth.signInWithSession).toHaveBeenCalledWith(PAIR)
  })

  it('a closed prompt (or no passkey on this device) points to the emailed code, and signs nobody in', async () => {
    h.pk.signInWithPasskey.mockRejectedValue(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }))
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))
    expect(await screen.findByText(/No passkey was used\. If this device has none/)).toBeInTheDocument()
    expect(screen.getByText(/Email me a sign-in code/)).toBeInTheDocument()
    expect(h.auth.signInWithSession).not.toHaveBeenCalled()
  })
})

describe('/login — an emailed one-time code', () => {
  it('is offered at the method step beside the password', async () => {
    await atMethodStep()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Email me a sign-in code' })).toBeInTheDocument()
  })

  it('is offered to an account with no password and no provider, and the note names it', async () => {
    await atMethodStep([])
    expect(screen.getByRole('button', { name: 'Email me a sign-in code' })).toBeInTheDocument()
    expect(screen.getByText(/Email yourself a sign-in code below, or set a password/)).toBeInTheDocument()
  })

  it('sends the code, asks for it in a one-time-code field, and signs in with it', async () => {
    h.pk.requestSignInCode.mockResolvedValue({ message: SENT, expiresInSeconds: 600 })
    h.pk.signInWithEmailCode.mockResolvedValue(PAIR)
    await atMethodStep()
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in code' }))

    const field = await screen.findByLabelText('Sign-in code')
    expect(h.pk.requestSignInCode).toHaveBeenCalledWith('mira@house.test')
    expect(screen.getByText(SENT)).toBeInTheDocument()
    expect(field).toHaveAttribute('autocomplete', 'one-time-code')
    expect(field).toHaveAttribute('inputmode', 'numeric')
    // the password form steps aside while the code is asked for
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()

    const go = screen.getByRole('button', { name: 'Sign In' })
    expect(go).toBeDisabled()
    fireEvent.change(field, { target: { value: '04291' } })
    expect(go).toBeDisabled()
    fireEvent.change(field, { target: { value: '042917' } })
    expect(go).toBeEnabled()
    fireEvent.submit(field.closest('form')!)
    expect(await screen.findByText('orders page')).toBeInTheDocument()
    expect(h.pk.signInWithEmailCode).toHaveBeenCalledWith('mira@house.test', '042917')
    expect(h.auth.signInWithSession).toHaveBeenCalledWith(PAIR)
  })

  it('a refused code says so and signs nobody in', async () => {
    h.pk.requestSignInCode.mockResolvedValue({ message: SENT, expiresInSeconds: 600 })
    h.pk.signInWithEmailCode.mockRejectedValue(new Error('That code is not right, or it has expired.'))
    await atMethodStep()
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in code' }))
    const field = await screen.findByLabelText('Sign-in code')
    fireEvent.change(field, { target: { value: '111111' } })
    fireEvent.submit(field.closest('form')!)
    expect(await screen.findByText(/That code is not right, or it has expired\./)).toBeInTheDocument()
    expect(h.auth.signInWithSession).not.toHaveBeenCalled()
  })

  it('can send a new code, or go back to the other ways in', async () => {
    h.pk.requestSignInCode.mockResolvedValue({ message: SENT, expiresInSeconds: 600 })
    await atMethodStep()
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in code' }))
    await screen.findByLabelText('Sign-in code')
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }))
    await waitFor(() => expect(h.pk.requestSignInCode).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in another way' }))
    expect(await screen.findByLabelText('Password')).toBeInTheDocument()
    expect(screen.queryByLabelText('Sign-in code')).not.toBeInTheDocument()
  })

  it('a limit reached is said in the gateway’s words', async () => {
    h.pk.requestSignInCode.mockRejectedValue(new Error('Several codes were already sent to this address in the last hour.'))
    await atMethodStep()
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in code' }))
    expect(await screen.findByText(/Several codes were already sent/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Sign-in code')).not.toBeInTheDocument()
  })
})
