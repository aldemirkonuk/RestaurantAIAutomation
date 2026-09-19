/**
 * `/login` and `/register` under the public door's one switch (ADR 0133
 * §Decision 1, `lib/mudavym/publicDesign.ts`).
 *
 * The founder refused a redraw of these two pages twice and chose "Improve
 * today's pages in place, no redraw" (ADR 0143 §1 keeps them out of
 * `PublicShell`). So the switch may change COLOUR and nothing else, and this
 * file proves the three claims that makes:
 *
 *   1. OFF is today's page. No `.mudavym` scope anywhere, today's ground on
 *      the root. (The byte-for-byte proof against the pre-change tree was a
 *      one-time capture — see the `capture` block at the bottom.)
 *   2. ON wears the house. Exactly one `.mudavym` node and it is the page
 *      root, so `.dark .mudavym` turns the whole page charcoal; and no literal
 *      colour (hex, rgb, rgba, hsl) is left in any rendered class or style.
 *   3. Nothing moves. In every state, the ON tree has the same elements in the
 *      same order, the same text, the same attributes and the same layout
 *      classes as the OFF tree. The ONLY classes allowed to differ are colour,
 *      shadow, ring/outline and opacity utilities — see `isColourClass`.
 *
 * Every state is driven through the real page, not a fixture of it: the email
 * step, the resolved-methods step, the invite code (valid and not), the email
 * availability check (taken and free), and the three sections of the house
 * form. Two claims are read from source instead of a render: every house-side
 * class string in the three files, including states no test drives (claim 4),
 * and the stylesheet, which jsdom does not resolve (claim 5).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => {
  // Module-level env reads happen at import time, so they are pinned here,
  // before any import below evaluates them. Empty means: no Google client id
  // (the Google button renders its "not configured" line and loads no
  // script), no Maps key, and no deployment switch — the localStorage
  // override is the only thing that turns the house on in this file.
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
  vi.stubEnv('VITE_MUDAVYM_PUBLIC', '')
  return {
    auth: {
      login: vi.fn(),
      clearError: vi.fn(),
      resolveSignInMethods: vi.fn(),
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
import { PUBLIC_OVERRIDE_KEY } from '../../lib/mudavym/publicDesign'

/* ── the switch ─────────────────────────────────────────────────────────── */

function setSwitch(on: boolean) {
  window.localStorage.setItem(PUBLIC_OVERRIDE_KEY, on ? 'on' : 'off')
}

beforeEach(() => {
  window.localStorage.removeItem(PUBLIC_OVERRIDE_KEY)
  h.auth.error = null
  h.auth.resolveSignInMethods.mockReset()
  h.get.mockReset()
})

afterEach(() => {
  window.localStorage.removeItem(PUBLIC_OVERRIDE_KEY)
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
  await screen.findByText('Your Account', undefined, WAIT)
  type('Full Name *', 'Deniz Kaya')
  type('Email *', 'deniz@house.test')
  type('Password *', 'long-enough-1')
  type('Confirm Password *', 'long-enough-1')
  await screen.findByText(emailAvailable ? 'Email is available' : /already registered/, undefined, WAIT)
  return r.container
}

async function createToSection(section: 1 | 2 | 3) {
  gateway({ emailAvailable: true })
  const r = renderAt(createElement(Register), '/register?type=new')
  await screen.findByText('Step 1 of 2', undefined, WAIT)
  type('Full Name *', 'Deniz Kaya')
  type('Email *', 'deniz@house.test')
  type('Password *', 'long-enough-1')
  type('Confirm Password *', 'long-enough-1')
  await screen.findByText('Email is available', undefined, WAIT)
  fireEvent.click(screen.getByRole('button', { name: /next: restaurant details/i }))
  await screen.findByText('Restaurant Identity', undefined, WAIT)
  if (section >= 2) {
    fireEvent.click(screen.getByRole('button', { name: /next: location/i }))
    await screen.findByText('Where is your restaurant located?', undefined, WAIT)
  }
  if (section === 3) {
    fireEvent.click(screen.getByRole('button', { name: /next: contact/i }))
    await screen.findByText('Contact Details', undefined, WAIT)
  }
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
      await screen.findByText('Login Failed', undefined, WAIT)
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
    name: 'register-selector',
    page: 'register',
    reach: async () => {
      const r = renderAt(createElement(Register), '/register')
      await screen.findByText('Join Your Team', undefined, WAIT)
      return r.container
    },
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
    reach: async () => {
      gateway({ emailAvailable: false })
      const r = renderAt(createElement(Register), '/register?type=new')
      await screen.findByText('Step 1 of 2', undefined, WAIT)
      type('Email *', 'taken@house.test')
      await screen.findByText(/already registered/, undefined, WAIT)
      return r.container
    },
  },
  { name: 'register-create-identity', page: 'register', reach: () => createToSection(1) },
  { name: 'register-create-location', page: 'register', reach: () => createToSection(2) },
  {
    name: 'register-create-contact-with-error',
    page: 'register',
    reach: async () => {
      h.auth.error = 'Registration failed at the gateway.'
      return createToSection(3)
    },
  },
]

/* ── what counts as "colour" ────────────────────────────────────────────── */

const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(/

/** The switch itself: the token scope and the page's stylesheet hook. */
const HOUSE_SCOPE = new Set(['mudavym', 'mdv-auth'])

/**
 * True when a utility class changes only paint — colour, shadow, focus ring,
 * outline, opacity — and never position, size, spacing or type. These are the
 * only classes the switch may add or remove. Anything else differing between
 * ON and OFF is something that moved.
 */
export function isColourClass(token: string): boolean {
  // Strip variants (`hover:`, `sm:`, `focus-visible:`, `dark:`) — but not the
  // colons inside an arbitrary value like `text-[color:var(--x)]`.
  // A variant name never contains `[`, so the colon inside an arbitrary value
  // is never mistaken for one.
  let base = token
  for (let m = /^([a-z0-9-]+):(.+)$/.exec(base); m; m = /^([a-z0-9-]+):(.+)$/.exec(base)) base = m[2]
  base = base.replace(/^!/, '')
  if (/^(shadow|ring|outline|opacity)(-|$)/.test(base)) return true
  if (/^(fill|stroke|placeholder|divide|from|via|to|decoration|caret|accent)-/.test(base)) {
    // `stroke-[3]` and `stroke-2` are widths.
    return !/^stroke-(\d|\[\d)/.test(base)
  }
  if (base.startsWith('bg-')) {
    return !/^bg-(fixed|local|scroll|clip-|origin-|repeat|no-repeat|cover|contain|auto|center|top|bottom|left|right|blend-)/.test(base)
  }
  if (base.startsWith('text-')) {
    const v = base.slice(5)
    if (/^(xs|sm|base|lg|\d?xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/.test(v)) return false
    if (/^\[(\d|\.|calc)/.test(v)) return false // text-[0.8rem], text-[15px]
    return true
  }
  if (/^border(-[xytrbl])?$/.test(base)) return false // `border`, `border-t`: widths
  if (/^border(-[xytrbl])?-/.test(base)) {
    const v = base.replace(/^border(-[xytrbl])?-/, '')
    if (/^(\d+|\[\d[^\]]*\]|solid|dashed|dotted|double|hidden|none|collapse|separate)$/.test(v)) return false
    return true
  }
  return false
}

function classTokens(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

/** Inline declarations with the paint ones removed. */
function layoutStyle(el: Element): string {
  return (el.getAttribute('style') ?? '')
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => !/^(box-shadow|background|background-color|background-image|color|border-color|outline|opacity)\s*:/.test(d))
    .join('; ')
}

/** A structural fingerprint of a tree: everything except paint. */
function fingerprint(root: Element): string[] {
  const out: string[] = []
  const walk = (el: Element, depth: number) => {
    const attrs = Array.from(el.attributes)
      .filter((a) => a.name !== 'class' && a.name !== 'style')
      .map((a) => `${a.name}=${a.value}`)
      .sort()
    const layout = classTokens(el)
      .filter((t) => !isColourClass(t) && !HOUSE_SCOPE.has(t))
      .sort()
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join('')
    out.push(
      `${'  '.repeat(depth)}<${el.tagName.toLowerCase()} ${attrs.join(' ')}> [${layout.join(' ')}] {${layoutStyle(el)}} "${ownText}"`,
    )
    Array.from(el.children).forEach((c) => walk(c, depth + 1))
  }
  walk(root, 0)
  return out
}

/* ── 1. OFF is today's page ─────────────────────────────────────────────── */

describe('public switch OFF — today’s page', () => {
  it.each(STATES)('$name carries no .mudavym scope and today’s paper ground', async ({ reach }) => {
    setSwitch(false)
    const container = await reach()
    expect(container.querySelector('.mudavym')).toBeNull()
    expect(container.querySelector('.mdv-auth')).toBeNull()
    // Today's ground literal, on the page root, exactly as it ships.
    expect(container.firstElementChild).toHaveClass('bg-[#FAF7F5]')
  })

  it('absence is off: with no override and no env, the page is today’s', async () => {
    // No setSwitch() call at all — publicDesign.ts precedence step 3.
    const r = renderAt(createElement(Register), '/register')
    await screen.findByText('Join Your Team', undefined, WAIT)
    expect(r.container.querySelector('.mudavym')).toBeNull()
  })
})

/* ── 2. ON wears the house ──────────────────────────────────────────────── */

describe('public switch ON — the house, from tokens', () => {
  it.each(STATES)('$name has one .mudavym node, on the page root', async ({ reach }) => {
    setSwitch(true)
    const container = await reach()
    const scopes = container.querySelectorAll('.mudavym')
    expect(scopes).toHaveLength(1)
    // The root, so `.dark .mudavym` and the pre-hydration query turn the whole
    // page — and no `data-ground`, so the page follows the visitor's theme.
    expect(scopes[0]).toBe(container.firstElementChild)
    expect(scopes[0]).toHaveClass('mdv-auth')
    expect(scopes[0].hasAttribute('data-ground')).toBe(false)
    expect(scopes[0]).not.toHaveClass('bg-[#FAF7F5]')
  })

  it.each(STATES)('$name leaves no literal colour in any class or inline style', async ({ reach }) => {
    setSwitch(true)
    const container = await reach()
    const offenders = Array.from(container.querySelectorAll('*'))
      .filter((el) => LITERAL.test(el.getAttribute('class') ?? '') || LITERAL.test(el.getAttribute('style') ?? ''))
      .map((el) => `<${el.tagName.toLowerCase()} class="${el.getAttribute('class')}" style="${el.getAttribute('style') ?? ''}">`)
    expect(offenders).toEqual([])
  })
})

/* ── 3. Nothing moves ───────────────────────────────────────────────────── */

describe('the switch changes paint and nothing else', () => {
  it.each(STATES)('$name: same elements, order, text, attributes and layout classes', async ({ reach }) => {
    setSwitch(false)
    const off = fingerprint((await reach()).firstElementChild as Element)
    cleanup()
    setSwitch(true)
    const on = fingerprint((await reach()).firstElementChild as Element)
    expect(on).toEqual(off)
  })

  it('the classifier keeps layout classes out of the paint set', () => {
    for (const layout of ['text-sm', 'text-[0.8rem]', 'border', 'border-2', 'border-t', 'stroke-[3]', 'rounded-xl', 'p-8', 'sm:grid', 'h-[2px]', 'backdrop-blur-md', 'bg-cover']) {
      expect([layout, isColourClass(layout)]).toEqual([layout, false])
    }
    for (const paint of ['text-inkm-1', 'bg-paper-0', 'border-paper-2', 'hover:bg-seal-deep', 'focus:ring-4', 'shadow-none', 'outline-none', 'opacity-80', 'bg-[radial-gradient(ellipse_at_20%_0%,var(--seal-tint),transparent_50%)]', '!text-inkm-3', 'text-[color:var(--ink-1)]']) {
      expect([paint, isColourClass(paint)]).toEqual([paint, true])
    }
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
  const HOUSE_SIDE = /\b(?:on|house)\s*\?\s*(?:'([^']*)'|`([^`]*)`)/g
  const NEUTRAL_LEGACY = /(^|[:!])-?(bg|text|border|ring|divide|placeholder|from|to|shadow)-(gray|slate|white|black|wine|brand)(\b|\/|-)/
  const AMBER_PLATE_LINK = new Set(['text-wine-800', 'hover:text-wine-900'])

  it.each(['src/pages/Login.tsx', 'src/pages/Register.tsx', 'src/components/brand/AuthShell.tsx'])('%s', (file) => {
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

  it('is scoped to the house path, so OFF is untouched by it', () => {
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

/* ── capture (one-time proof, off by default) ───────────────────────────── */

/**
 * `AUTHPAGES_CAPTURE_DIR=/abs/dir vitest run <this file> -t capture` writes
 * every state's rendered HTML, switch OFF and ON, to `<dir>/{off,on}/`. It was
 * run once on the untouched tree and once after the change; `diff -r` of the
 * two `off/` directories is the byte-for-byte proof that OFF is today's page.
 */
describe.runIf(Boolean(process.env.AUTHPAGES_CAPTURE_DIR))('capture', () => {
  const dir = process.env.AUTHPAGES_CAPTURE_DIR as string
  it.each(STATES)('capture $name', async ({ name, reach }) => {
    for (const on of [false, true]) {
      cleanup()
      setSwitch(on)
      const container = await reach()
      mkdirSync(resolve(dir, on ? 'on' : 'off'), { recursive: true })
      writeFileSync(resolve(dir, on ? 'on' : 'off', `${name}.html`), `${container.innerHTML}\n`)
    }
  })
})
