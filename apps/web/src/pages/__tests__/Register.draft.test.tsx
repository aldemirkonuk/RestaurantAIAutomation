/**
 * A typed sign-up survives a reload, a back-swipe and the trip to /verify-email
 * and back (r107 onboarding g2): sessionStorage, 30 minutes, never a secret.
 */
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => {
  // Module-level env reads happen at import time, so they are pinned here,
  // before any import below evaluates them. Empty means: no Google client id
  // (the Google button renders its "not configured" line and loads no
  // script), no Maps key, and `VITE_MUDAVYM_PUBLIC` unset — which no longer
  // matters (decision 0149 row 37): the house design is on unconditionally,
  // and the only thing this file's localStorage override can do is turn it
  // back OFF for a QA comparison.
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

/* framer-motion animates inline styles on animation frames, so two renders of
   the same state can serialise differently. Its components are replaced with
   the plain element they wrap, minus the animation props. Nothing this lane
   changes is a motion prop, and the source diff shows it. */
vi.mock('framer-motion', async () => {
  const React = await import('react')
  const MOTION_PROPS = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'whileHover',
    'whileTap',
    'whileFocus',
    'layout',
    'layoutId',
    'variants',
  ])
  const cache = new Map<string, unknown>()
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) => {
        if (!cache.has(tag)) {
          const Plain = React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
            const rest: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(props)) if (!MOTION_PROPS.has(k)) rest[k] = v
            return React.createElement(tag, { ...rest, ref })
          })
          cache.set(tag, Plain)
        }
        return cache.get(tag)
      },
    },
  )
  const AnimatePresence = ({ children }: { children?: unknown }) =>
    React.createElement(React.Fragment, null, children as never)
  return { motion, AnimatePresence }
})

/* The Places widget loads Google Maps. Its stand-in keeps the one thing the
   page owns — the className Register passes it — and nothing of its own. */
vi.mock('../../components/ui/PlacesAutocomplete', async () => {
  const React = await import('react')
  return {
    PlacesAutocomplete: (props: {
      id?: string
      value: string
      onChange: (v: string) => void
      placeholder?: string
      className?: string
    }) =>
      React.createElement('input', {
        id: props.id,
        value: props.value,
        placeholder: props.placeholder,
        className: props.className,
        'data-stand-in': 'PlacesAutocomplete',
        onChange: (e: { target: { value: string } }) => props.onChange(e.target.value),
      }),
  }
})

import { Register } from '../Register'

const KEY = 'mudavym:register-draft'
const PASSWORD = 'sw0rdfish-secret-1'

function mount(url = '/register?type=new') {
  return render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(Register)))
}
function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement

beforeEach(() => {
  window.sessionStorage.clear()
  h.get.mockReset()
  h.get.mockResolvedValue({ data: { available: true, email: 'x' } })
  h.auth.registerAccount.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the sign-up draft', () => {
  it('brings the typed fields back after an unmount, and the password boxes are empty', async () => {
    const a = mount()
    type('Full Name *', 'Deniz Kaya')
    type('Email *', 'deniz@house.test')
    type('Password *', PASSWORD)
    type('Confirm Password *', PASSWORD)
    a.unmount()

    const stored = window.sessionStorage.getItem(KEY) ?? ''
    expect(stored).toContain('Deniz Kaya')
    expect(stored).not.toContain(PASSWORD)
    expect(stored).not.toMatch(/password|confirm/i)
    expect(window.localStorage.getItem(KEY)).toBeNull()

    mount()
    expect(input('Full Name *').value).toBe('Deniz Kaya')
    expect(input('Email *').value).toBe('deniz@house.test')
    expect(input('Password *').value).toBe('')
    expect(input('Confirm Password *').value).toBe('')
  })

  it('writes 400 ms after the last key, not on every key', () => {
    vi.useFakeTimers()
    mount()
    type('Full Name *', 'Den')
    act(() => void vi.advanceTimersByTime(399))
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
    act(() => void vi.advanceTimersByTime(2))
    expect(window.sessionStorage.getItem(KEY)).toContain('Den')
  })

  it('is gone after a successful sign-up', async () => {
    h.auth.registerAccount.mockResolvedValue(undefined)
    mount()
    type('Full Name *', 'Deniz Kaya')
    type('Email *', 'deniz@house.test')
    type('Password *', PASSWORD)
    type('Confirm Password *', PASSWORD)
    await waitFor(() => expect(screen.getByText('Email is available')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /continue|create|next/i }))
    await waitFor(() => expect(h.auth.registerAccount).toHaveBeenCalled())
    await waitFor(() => expect(window.sessionStorage.getItem(KEY)).toBeNull())
    cleanup() // unmount must not write it back
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })

  it('ignores a draft older than 30 minutes', () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ mode: 'create', name: 'Old Name', email: 'old@house.test', at: Date.now() - 31 * 60_000 }),
    )
    mount()
    expect(input('Full Name *').value).toBe('')
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })

  it('keeps a draft younger than 30 minutes', () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ mode: 'create', name: 'Fresh Name', email: 'f@house.test', at: Date.now() - 29 * 60_000 }),
    )
    mount()
    expect(input('Full Name *').value).toBe('Fresh Name')
  })
  // r108 g16: a restore says so, and can be cleared.
  it('says "We kept what you typed." only after a restore, and Start over empties fields and storage', async () => {
    mount()
    expect(screen.queryByTestId('draft-kept-note')).toBeNull() // a fresh visit
    cleanup()
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ mode: 'create', name: 'Fresh Name', email: 'f@house.test', at: Date.now() - 60_000 }),
    )
    mount()
    expect(screen.getByText('We kept what you typed.')).toBeTruthy()
    const start = screen.getByRole('button', { name: 'Start over' })
    expect(start.className).toContain('min-h-11')
    fireEvent.click(start)
    expect(input('Full Name *').value).toBe('')
    expect(input('Email *').value).toBe('')
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
    expect(screen.queryByTestId('draft-kept-note')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(input('Full Name *')))
  })
})
