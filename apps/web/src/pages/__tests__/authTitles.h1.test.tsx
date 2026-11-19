/**
 * Every door of the auth family names its page with one H1. The page turn
 * (lib/mudavym/viewTransition.ts) carries the first H1 across the change of
 * page, so a door whose title was an H2 had nothing to carry, and a page with
 * no H1 is also a fault for anyone who navigates by headings.
 */
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    login: vi.fn(),
    clearError: vi.fn(),
    resolveSignInMethods: vi.fn(),
    registerAccount: vi.fn(),
    registerRestaurant: vi.fn(),
    joinViaInvite: vi.fn(),
    loginWithGoogle: vi.fn(),
    registerAccountWithGoogle: vi.fn(),
    error: null,
  }),
  LoginError: class LoginError extends Error {},
}))
vi.mock('../../lib/googleIdentity', () => ({
  getGoogleClientId: () => '',
  loadGoogleIdentityScript: () => Promise.reject(new Error('no script')),
}))

import { Login } from '../Login'
import { Register } from '../Register'
import { ForgotPassword } from '../ForgotPassword'

function at(path: string, page: () => ReturnType<typeof createElement>) {
  render(createElement(MemoryRouter, { initialEntries: [path] }, page()))
}

describe('the auth pages carry one H1', () => {
  it('login: "Welcome back." is the H1 and nothing else is', () => {
    at('/login', () => createElement(Login))
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back.' })).toHaveClass('mdv-ep-leaf-title')
  })

  it('register: the leaf title is the H1', () => {
    at('/register', () => createElement(Register))
    const h1 = screen.getAllByRole('heading', { level: 1 })
    expect(h1).toHaveLength(1)
    expect(h1[0]).toHaveClass('mdv-ep-leaf-title')
  })

  it('forgot password: the spread title is the H1', () => {
    at('/forgot-password', () => createElement(ForgotPassword))
    expect(screen.getByRole('heading', { level: 1, name: 'Reset your password' })).toBeInTheDocument()
  })
})
