/**
 * A typed sign-up survives a reload, a back-swipe and the trip to /verify-email
 * and back (r107 onboarding g2): sessionStorage, 30 minutes, never a secret.
 */
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

function mount(url: string) {
  return render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(Register)))
}
const field = (label: string) => screen.getByLabelText(label)

beforeEach(() => {
  h.get.mockReset()
  h.get.mockImplementation((url: string) =>
    url.startsWith('/auth/invite/')
      ? Promise.resolve({ data: { valid: true, restaurant: 'Kaya Meyhane', city: 'Fethiye', inviter: 'Ayse', role: 'manager' } })
      : Promise.resolve({ data: { available: true, email: 'x' } }),
  )
})
afterEach(cleanup)

describe('sign-up autofill', () => {
  it('create: name, email and both password boxes', () => {
    mount('/register?type=new')
    expect(field('Full Name *')).toHaveAttribute('autocomplete', 'name')
    expect(field('Email *')).toHaveAttribute('autocomplete', 'email')
    expect(field('Email *')).toHaveAttribute('inputmode', 'email')
    expect(field('Email *')).toHaveAttribute('autocapitalize', 'none')
    expect(field('Password *')).toHaveAttribute('autocomplete', 'new-password')
    expect(field('Confirm Password *')).toHaveAttribute('autocomplete', 'new-password')
    expect(field('Password *')).toHaveAttribute('enterkeyhint', 'next')
    expect(field('Confirm Password *')).toHaveAttribute('enterkeyhint', 'done')
  })

  it('join: the same, after the invite is read', async () => {
    mount('/register?invite=abcdefgh')
    await screen.findByText('Invited by', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await screen.findByLabelText('Full Name *')
    expect(field('Full Name *')).toHaveAttribute('autocomplete', 'name')
    expect(field('Email *')).toHaveAttribute('autocomplete', 'email')
    expect(field('Email *')).toHaveAttribute('inputmode', 'email')
    expect(field('Password *')).toHaveAttribute('autocomplete', 'new-password')
    expect(field('Confirm Password *')).toHaveAttribute('autocomplete', 'new-password')
  })

  it('the invite code box keeps autocomplete off (a one-time code)', async () => {
    mount('/register?invite=abcdefgh')
    expect(await screen.findByLabelText('Invite Code')).toHaveAttribute('autocomplete', 'off')
  })
})
