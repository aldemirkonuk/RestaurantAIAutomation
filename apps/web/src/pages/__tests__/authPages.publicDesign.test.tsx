/**
 * `/login` and `/register` wear one look: the house (r58 deleted the legacy
 * class fork; `usePublicDesign()` no longer decides anything on these two).
 * What this file holds them to:
 *
 *   1. Exactly one `.mudavym` node and it is the page root, so `.dark .mudavym`
 *      turns the whole page; no literal colour (hex, rgb, rgba, hsl) in any
 *      rendered class or style.
 *   2. Every class string in the source carries tokens, not the old neutral
 *      palette (gray, slate, white, black, wine).
 *   3. The stylesheet is tokens only with the focus ring inherited.
 *
 * Every state is driven through the real page: the email step, the
 * resolved-methods step, the invite code (valid and not), the email
 * availability check (taken and free), and the three sections of the house form.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

import { Login } from '../Login'
import { Register } from '../Register'

beforeEach(() => {
  h.auth.error = null
  h.auth.resolveSignInMethods.mockReset()
  h.get.mockReset()
})

/* ── the states ─────────────────────────────────────────────────────────── */

type Provider = 'password' | 'google' | 'microsoft' | 'apple'
const method = (id: Provider, label: string, enabled = true, disabledReason: string | null = null) => ({
  id,
  label,
  enabled,
  disabledReason,
})

function renderAt(ui: ReactElement, url: string) {
  return render(createElement(MemoryRouter, { initialEntries: [url] }, ui))
}

const WAIT = { timeout: 3000 }

/*
 * Where the endpaper (sketch 118 B, founder's build directions 2026-09-19)
 * words a state differently from today's page, a reach waits for either
 * wording: the state reached is the same one. Account-only create (ADR 0213)
 * titles the leaf "Your Account" off the house path and "Who keeps this
 * book?" on it.
 */
const CREATE_ACCOUNT = /^(Your Account|Who keeps this book\?)$/

async function loginResolved(result: {
  methods: ReturnType<typeof method>[]
  unavailable?: ReturnType<typeof method>[]
  noSignInMethod?: boolean
}) {
  h.auth.resolveSignInMethods.mockResolvedValue({
    email: 'someone@house.test',
    methods: result.methods,
    unavailable: result.unavailable ?? [],
    declared: [],
    noSignInMethod: result.noSignInMethod ?? false,
  })
  const r = renderAt(createElement(Login), '/login?email=someone%40house.test')
  await screen.findByText('Change', undefined, WAIT)
  return r.container
}

/** Answers the two GETs Register makes: the invite preview and the email check. */
function gateway(opts: { invite?: 'valid' | 'invalid'; emailAvailable?: boolean }) {
  h.get.mockImplementation((url: string) => {
    if (url.startsWith('/auth/invite/')) {
      if (opts.invite === 'invalid') return Promise.reject(new Error('404'))
      return Promise.resolve({
        data: { valid: true, restaurant: 'Kaya Meyhane', city: 'Fethiye', inviter: 'Ayşe', role: 'manager' },
      })
    }
    if (url.startsWith('/auth/check-email')) {
      return Promise.resolve({ data: { available: opts.emailAvailable ?? true, email: 'x' } })
    }
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

async function joinAccount(emailAvailable: boolean) {
  gateway({ invite: 'valid', emailAvailable })
  const r = renderAt(createElement(Register), '/register?invite=abcdefgh')
  await screen.findByText('Invited by', undefined, WAIT)
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
  await screen.findByText(/^(Your Account|Who is joining\?)$/, undefined, WAIT)
  type('Full Name *', 'Deniz Kaya')
  type('Email *', 'deniz@house.test')
  type('Password *', 'long-enough-1')
  type('Confirm Password *', 'long-enough-1')
  await screen.findByText(emailAvailable ? 'Email is available' : /already registered/, undefined, WAIT)
  return r.container
}

async function createAccountTaken() {
  gateway({ emailAvailable: false })
  const r = renderAt(createElement(Register), '/register?type=new')
  await screen.findByText(CREATE_ACCOUNT, undefined, WAIT)
  type('Email *', 'taken@house.test')
  await screen.findByText(/already registered/, undefined, WAIT)
  return r.container
}

const STATES: { name: string; page: 'login' | 'register'; reach: () => Promise<HTMLElement> }[] = [
  {
    name: 'login-email',
    page: 'login',
    reach: async () => {
      const r = renderAt(createElement(Login), '/login')
      await screen.findByLabelText('Email Address', undefined, WAIT)
      return r.container
    },
  },
  {
    name: 'login-email-with-error',
    page: 'login',
    reach: async () => {
      h.auth.error = 'The gateway refused the sign-in.'
      const r = renderAt(createElement(Login), '/login')
      await screen.findByText(/^(Login Failed|Sign-in didn’t go through\.)$/, undefined, WAIT)
      return r.container
    },
  },
  {
    name: 'login-password-and-google',
    page: 'login',
    reach: () => loginResolved({ methods: [method('password', 'Password'), method('google', 'Google')] }),
  },
  {
    name: 'login-no-method-greyed-unrenderable',
    page: 'login',
    reach: () =>
      loginResolved({
        methods: [method('apple', 'Apple')],
        unavailable: [method('microsoft', 'Microsoft', false, 'Microsoft sign-in is not available here.')],
        noSignInMethod: true,
      }),
  },
  {
    name: 'login-nothing-works',
    page: 'login',
    reach: () => loginResolved({ methods: [] }),
  },
  {
    name: 'register-join-code-valid',
    page: 'register',
    reach: async () => {
      gateway({ invite: 'valid' })
      const r = renderAt(createElement(Register), '/register?invite=abcdefgh')
      await screen.findByText('Invited by', undefined, WAIT)
      return r.container
    },
  },
  {
    name: 'register-join-code-invalid',
    page: 'register',
    reach: async () => {
      gateway({ invite: 'invalid' })
      const r = renderAt(createElement(Register), '/register?invite=abcdefgh')
      await screen.findByText('Code not found, expired, or already used', undefined, WAIT)
      return r.container
    },
  },
  {
    name: 'register-join-account-available-with-error',
    page: 'register',
    reach: async () => {
      h.auth.error = 'The invite could not be redeemed.'
      return joinAccount(true)
    },
  },
  {
    name: 'register-join-account-taken',
    page: 'register',
    reach: () => joinAccount(false),
  },
  {
    name: 'register-create-account-taken',
    page: 'register',
    reach: () => createAccountTaken(),
  },
]

const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(/

/* ── 2. ON wears the house ──────────────────────────────────────────────── */

describe('the house, from tokens', () => {
  it.each(STATES)('$name has one .mudavym node, on the page root', async ({ reach }) => {
    const container = await reach()
    const scopes = container.querySelectorAll('.mudavym')
    expect(scopes).toHaveLength(1)
    // The root, so `.dark .mudavym` and the pre-hydration query turn the whole
    // page — and no `data-ground`, so the page follows the visitor's theme.
    expect(scopes[0]).toBe(container.firstElementChild)
    expect(scopes[0]).toHaveClass('mdv-auth')
    // The endpaper states its own ground (paper), same convention as every
    // other rebuilt page (`shellGround.ts`) — mudavym.css's bare `.mudavym`
    // resolves to Warm Charcoal now, so paper needs the explicit escape.
    expect(scopes[0].getAttribute('data-ground')).toBe('paper')
    expect(scopes[0]).not.toHaveClass('bg-[#FAF7F5]')
  })

  it('absence is on: with no override and no env, the page wears the house', async () => {
    // No setSwitch() call at all — publicDesign.ts now resolves true unless
    // an explicit "off" override says otherwise (decision 0149 row 37).
    // The chooser that used to open here is retired (ADR 0344); the
    // landing's "Start free" asks for the new-house form.
    const r = renderAt(createElement(Register), '/register?type=new')
    await screen.findByText(CREATE_ACCOUNT, undefined, WAIT)
    const scopes = r.container.querySelectorAll('.mudavym')
    expect(scopes).toHaveLength(1)
    expect(scopes[0]).toBe(r.container.firstElementChild)
    expect(scopes[0]).toHaveClass('mdv-auth')
  })

  it.each(STATES)('$name leaves no literal colour in any class or inline style', async ({ reach }) => {
    const container = await reach()
    const offenders = Array.from(container.querySelectorAll('*'))
      .filter((el) => LITERAL.test(el.getAttribute('class') ?? '') || LITERAL.test(el.getAttribute('style') ?? ''))
      .map((el) => `<${el.tagName.toLowerCase()} class="${el.getAttribute('class')}" style="${el.getAttribute('style') ?? ''}">`)
    expect(offenders).toEqual([])
  })
})

/* ── 3b. Google on the first page — the house path only ─────────────────── */

/*
 * The founder, 2026-09-19 (ADR 0149 row 35): on the endpaper, "Sign in with
 * Google" also sits under the address on the first page. Today’s page keeps
 * today’s flow — Google only once the address resolves to it. The host is
 * the same mounted element either way (One Tap needs it mounted); only
 * whether it is shown differs, so the control lists above stay equal.
 */
describe('Google on the first page', () => {
  // No client id is configured in this file (see the stubbed env above), so
  // Google sign-in is not offered on this deployment. A guest is not told so:
  // the row, the sentence about the deployment and the "or" rule above it are
  // all absent (design critic 2026-11-18, round 2, need 12).
  it('draws no Google row, no deployment sentence and no "or" rule when Google is not set up', async () => {
    await STATES.find((st) => st.name === 'login-email')!.reach()
    expect(screen.queryByText(/Google sign-in isn.t configured/)).toBeNull()
    expect(screen.queryByText(/Sign in with Google/)).toBeNull()
    expect(screen.queryByText('or')).toBeNull()
  })

})

/* ── 3c. The front matter — /login's endpaper only ───────────────────────── */

/*
 * The founder's Easter egg (2026-09-19): the endpaper on /login turns back to
 * the front matter. It belongs to /login's house path alone — not /register,
 * and not today's page.
 */
describe('the front matter — /login only', () => {
  const TURN = 'Turn back to the front of the book'
  const reachOf = (name: string) => STATES.find((st) => st.name === name)!.reach

  it('/login offers the turn', async () => {
    await reachOf('login-email')()
    expect(screen.getByRole('button', { name: TURN })).toBeInTheDocument()
  })

  it('/register does not', async () => {
    await reachOf('register-create-account-taken')()
    expect(screen.queryByRole('button', { name: TURN })).toBeNull()
  })

})

/* ── 4. The house-side strings, read from source ────────────────────────── */

/**
 * The render tests above can only see the states they drive. This one reads
 * every house-side class string in the three files — the first branch of each
 * `on ? … : …` and `house ? … : …` — so a state no test reaches (a spinner, a
 * disabled button, the invalid phone line) is held to the same rule.
 *
 * Neutral legacy palette classes (gray, slate, white, black, wine) may not
 * appear there. Status hues (red, green, amber, rose) may: mudavym.css has no
 * status token, so those keep today's classes. The one wine class allowed is
 * the link on the amber plate — see the comment above it in Login.tsx.
 */
describe('house-side class strings carry tokens, not today’s palette', () => {
  const HOUSE_SIDE = /(?:'([^'\n]*)'|`([^`\n]*)`)/g
  const NEUTRAL_LEGACY = /(^|[:!])-?(bg|text|border|ring|divide|placeholder|from|to|shadow)-(gray|slate|white|black|wine|brand)(\b|\/|-)/
  const AMBER_PLATE_LINK = new Set(['text-wine-800', 'hover:text-wine-900'])

  it.each(['src/pages/Login.tsx', 'src/pages/Register.tsx'])('%s', (file) => {
    const src = readFileSync(resolve(process.cwd(), file), 'utf8')
    const house = [...src.matchAll(HOUSE_SIDE)].map((m) => m[1] ?? m[2])
    expect(house.length).toBeGreaterThan(0)
    const legacy = house
      .flatMap((str) => str.split(/\s+/))
      .filter((t) => NEUTRAL_LEGACY.test(t) && !AMBER_PLATE_LINK.has(t))
    expect(legacy).toEqual([])
    expect(house.filter((str) => LITERAL.test(str))).toEqual([])
  })
})

/* ── 5. The stylesheet the house path imports ───────────────────────────── */

describe('auth-house.css — tokens only, focus inherited', () => {
  // Read inside each test, not at collection, so a missing file fails these
  // three rather than the whole suite. Declarations only: a comment that names
  // a hex to explain its absence must not fail the check, and a hex hidden in
  // a comment must not pass it.
  const rules = () =>
    readFileSync(resolve(process.cwd(), 'src/components/brand/auth-house.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    )

  it('defines no colour outside the token column and no theme branch', () => {
    expect(rules()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(rules()).not.toMatch(/\b(rgba?|hsla?)\(/)
    expect(rules()).not.toContain('prefers-color-scheme')
    expect(rules()).not.toContain('[data-theme')
  })

  it('is scoped to the house path', () => {
    const selectors = rules().match(/[^{}]+(?=\{)/g) ?? []
    expect(selectors.length).toBeGreaterThan(0)
    for (const s of selectors) {
      for (const part of s.split(',')) expect(part).toMatch(/\.mudavym\.mdv-auth/)
    }
  })

  it('draws the house focus ring — the seal outline on a gap — and cancels the app’s wine ring', () => {
    expect(rules()).toContain(':focus-visible')
    expect(rules()).toContain('outline: 2px solid var(--seal)')
    expect(rules()).toContain('box-shadow: none')
  })
})

/*
 * ADR 0229 fork 9 (the founder, 2026-09-27, item 77, "Email invite + (c)
 * interim (Recommended)"): the invite mail's link carries a second secret in
 * its fragment, and the join sends it. Only a join carrying it can verify.
 */
describe('the invite mail secret reaches the join', () => {
  const SECRET = 'Zx8_-abcdefghijklmnopqrstuvwxyz0123456789AB'

  async function joinFrom(url: string) {
    h.auth.joinViaInvite.mockReset()
    h.auth.joinViaInvite.mockResolvedValue(undefined)
    gateway({ invite: 'valid', emailAvailable: true })
    renderAt(createElement(Register), url)
    await screen.findByText('Invited by', undefined, WAIT)
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await screen.findByText(/^(Your Account|Who is joining\?)$/, undefined, WAIT)
    type('Full Name *', 'Deniz Kaya')
    type('Email *', 'deniz@house.test')
    type('Password *', 'long-enough-1')
    type('Confirm Password *', 'long-enough-1')
    await screen.findByText('Email is available', undefined, WAIT)
    fireEvent.click(screen.getByRole('button', { name: 'Join Restaurant' }))
    await vi.waitFor(() => expect(h.auth.joinViaInvite).toHaveBeenCalledTimes(1))
    return h.auth.joinViaInvite.mock.calls[0][0] as Record<string, unknown>
  }

  it('a join opened from the mail sends the secret', async () => {
    const sent = await joinFrom(`/register?invite=abcdefgh#k=${SECRET}`)
    expect(sent).toMatchObject({ email: 'deniz@house.test', emailSecret: SECRET })
  })

  it('a join from a copied link sends no secret', async () => {
    const sent = await joinFrom('/register?invite=abcdefgh')
    expect(sent).not.toHaveProperty('emailSecret')
  })
})
