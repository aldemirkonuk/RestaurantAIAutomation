/**
 * r107 onboarding g2 fix: a Google sign-up finishes the draft, and a re-write
 * of an unchanged draft does not slide its 30 minutes.
 */
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    navigate: vi.fn(),
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
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => h.navigate }
})
// The real button loads Google's script; this stand-in only reports a success.
vi.mock('../../components/auth/GoogleSignInButton', async () => {
  const React = await import('react')
  return {
    GoogleSignInButton: (props: { onSuccess: () => void }) =>
      React.createElement('button', { type: 'button', onClick: props.onSuccess }, 'Google done'),
  }
})
vi.mock('../../components/ui/PlacesAutocomplete', async () => {
  const React = await import('react')
  return {
    PlacesAutocomplete: (props: { id?: string; value: string; onChange: (v: string) => void }) =>
      React.createElement('input', {
        id: props.id,
        value: props.value,
        onChange: (e: { target: { value: string } }) => props.onChange(e.target.value),
      }),
  }
})

import { Register } from '../Register'
import { readRegisterDraft, writeRegisterDraft, type RegisterDraft } from '../../lib/registerDraft'

const KEY = 'mudavym:register-draft'

beforeEach(() => {
  window.sessionStorage.clear()
  h.get.mockReset()
  h.get.mockResolvedValue({ data: { available: true, email: 'x' } })
  h.navigate.mockReset()
})
afterEach(cleanup)

describe('the sign-up draft and Google', () => {
  it('a Google sign-up clears the typed name and email, and unmount does not write them back', () => {
    const view = render(createElement(MemoryRouter, { initialEntries: ['/register?type=new'] }, createElement(Register)))
    fireEvent.change(screen.getByLabelText('Full Name *'), { target: { value: 'Deniz Kaya' } })
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'deniz@house.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Google done' }))
    expect(h.navigate).toHaveBeenCalledWith('/get-started', { replace: true })
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
    view.unmount()
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })
})

describe('the draft clock', () => {
  const d: RegisterDraft = {
    mode: 'create', name: 'Deniz Kaya', email: 'deniz@house.test', restaurantName: '', address: '', city: '', country: '', postalCode: '', phone: '',
  }
  it('re-writing an unchanged draft keeps the first time stamp', () => {
    writeRegisterDraft(d, 1_000_000)
    writeRegisterDraft({ ...d }, 1_000_000 + 25 * 60_000)
    expect(JSON.parse(window.sessionStorage.getItem(KEY) as string).at).toBe(1_000_000)
    // 31 minutes after the last keystroke the draft is gone, however often it was re-written
    expect(readRegisterDraft('create', 1_000_000 + 31 * 60_000)).toBeNull()
  })
  it('a changed draft restarts the clock', () => {
    writeRegisterDraft(d, 1_000_000)
    writeRegisterDraft({ ...d, name: 'Deniz K' }, 1_000_000 + 25 * 60_000)
    expect(JSON.parse(window.sessionStorage.getItem(KEY) as string).at).toBe(1_000_000 + 25 * 60_000)
  })
})
