/**
 * r107 onboarding g1 fix: the invite-code lookup says its state in words under
 * reduced motion, and a ring with no words is a decoration, not a second
 * empty live region.
 */
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
  vi.stubEnv('VITE_MUDAVYM_PUBLIC', '')
  return {
    auth: {
      login: vi.fn(),
      clearError: vi.fn(),
      resolveSignInMethods: vi.fn(),
      registerAccount: vi.fn(),
      registerAccountWithGoogle: vi.fn(),
      registerRestaurant: vi.fn(),
      joinViaInvite: vi.fn(),
      error: null as string | null,
    },
    get: vi.fn(),
  }
})

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => h.auth,
  LoginError: class LoginError extends Error {
    code = ''
    provider = ''
  },
}))
vi.mock('../../services/api/client', () => ({ apiClient: { get: h.get } }))
vi.mock('../../components/ui/PlacesAutocomplete', async () => {
  const React = await import('react')
  return { PlacesAutocomplete: () => React.createElement('input') }
})

import { Register } from '../Register'

beforeEach(() => {
  window.sessionStorage.clear()
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
  h.get.mockReset()
  h.get.mockReturnValue(new Promise(() => {})) // the lookup never answers
})
afterEach(cleanup)

describe('the invite-code lookup under reduced motion', () => {
  it('says "Checking the code…" in words, in the one status region', async () => {
    render(createElement(MemoryRouter, { initialEntries: ['/register?invite=abcdefgh'] }, createElement(Register)))
    expect(await screen.findByText('Checking the code…', undefined, { timeout: 3000 })).toBeTruthy()
    const regions = screen.getAllByRole('status')
    expect(regions.map((r) => r.textContent)).toEqual(['Checking the code…'])
    // the ring inside the box is still, and carries no live region of its own
    expect(document.querySelector('[data-pending-ring="still"][aria-hidden="true"], [aria-hidden="true"] [data-pending-ring="still"]')).not.toBeNull()
  })
})
