import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { createElement } from 'react'

/**
 * F-288: someone signed out opens an invite, then makes a brand-new account.
 * A new Google account is verified already, so it goes straight back to the
 * invite this tab held instead of to /get-started.
 */

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
  return {
    onSuccess: { current: null as null | (() => void) },
    auth: {
      registerAccount: vi.fn(),
      registerRestaurant: vi.fn(),
      joinViaInvite: vi.fn(),
      error: null,
    },
  }
})
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../services/api/client', () => ({ apiClient: { get: vi.fn() } }))
vi.mock('../../components/auth/GoogleSignInButton', () => ({
  GoogleSignInButton: (props: { onSuccess?: () => void }) => {
    h.onSuccess.current = props.onSuccess ?? null
    return createElement('span', null, 'google')
  },
}))
vi.mock('../../components/ui/PlacesAutocomplete', () => ({
  PlacesAutocomplete: () => null,
}))
import { Register } from '../Register'
import { holdJoin, takeHeldJoin } from '../../lib/joinResume'

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}
function signUpWithGoogle() {
  render(
    <MemoryRouter initialEntries={['/register?type=new']}>
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
  expect(h.onSuccess.current).toBeTypeOf('function')
  act(() => h.onSuccess.current!())
  return screen.getByTestId('where').textContent
}

beforeEach(() => {
  sessionStorage.clear()
  h.onSuccess.current = null
})
afterEach(() => {
  cleanup()
})

it('a new Google account goes back to the invite this tab held, and the hold is used up', () => {
  holdJoin('/studio/invite/tok_123')
  expect(signUpWithGoogle()).toBe('/studio/invite/tok_123')
  expect(takeHeldJoin()).toBeNull()
})

it('with nothing held, it goes on to open a restaurant as before', () => {
  expect(signUpWithGoogle()).toBe('/get-started')
})
