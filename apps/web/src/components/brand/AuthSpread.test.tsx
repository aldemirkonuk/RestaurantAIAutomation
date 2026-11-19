import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ loginWithGoogle: vi.fn(), registerAccountWithGoogle: vi.fn() }),
}))
vi.mock('../../lib/googleIdentity', () => ({
  getGoogleClientId: () => '',
  loadGoogleIdentityScript: () => Promise.reject(new Error('no script')),
}))

import { AuthSpread } from './AuthSpread'
import { GoogleSignInButton } from '../auth/GoogleSignInButton'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')
const css = () => read('src/components/brand/endpaper.css')
/** Rules only: a comment that names a property to explain its absence must not fail the check. */
const rules = () => css().replace(/\/\*[\s\S]*?\*\//g, '')

describe('AuthSpread', () => {
  it('is one H1, one main landmark, the eyebrow on the endpaper and the folio on the leaf', () => {
    render(
      <AuthSpread eyebrow="Account access" title="Reset your password" voice="Enter the address you use." folio="01 · You" footer={<a href="/login">Back to sign in</a>}>
        <p>Body</p>
      </AuthSpread>,
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Reset your password' })).toHaveClass('mdv-spread-title')
    expect(screen.getByRole('main')).toHaveClass('mdv-spread')
    expect(screen.getByText('Account access')).toHaveClass('mdv-ep-kicker')
    expect(screen.getByText('01 · You')).toHaveClass('mdv-ep-folio')
    expect(screen.getByText('Enter the address you use.')).toHaveClass('mdv-spread-lede')
    expect(screen.getByText('Back to sign in').closest('footer')).toHaveClass('mdv-spread-foot')
  })
})

describe('the doors wear the one shell', () => {
  it.each(['ForgotPassword', 'NoAccess', 'ResetPassword', 'VerifyEmail'])(
    '%s is built on AuthSpread, not on a card or the old public shell',
    (page) => {
      const src = read(`src/pages/${page}.tsx`)
      expect(src).toMatch(/from '..\/components\/brand\/AuthSpread'/)
      expect(src).not.toMatch(/AuthShell|AuthCard|PublicShell|usePublicDesign|BrandMark/)
    },
  )
})

describe('endpaper.css — the spread', () => {
  it('sets the H1 in Fraunces and every field 52px tall on a hairline at 16px', () => {
    const r = rules()
    expect(r).toMatch(/\.mdv-spread-title \{[^}]*font-family: 'Fraunces'/)
    const field = r.match(/\.mdv-spread :is\(input[^{]*\{([^}]*)\}/)
    expect(field?.[1]).toMatch(/(?:^|[;\s])height: 52px/)
    expect(field?.[1]).toMatch(/min-height: 52px/)
    expect(field?.[1]).toMatch(/font-size: 16px/)
    // the hairline is the leaf's one-pixel bottom rule, which the spread inherits
    expect(r).toMatch(/border-width: 0 0 1px 0 !important/)
  })

  it('centres the book vertically on a wide viewport, and hangs it from the top on a phone', () => {
    const r = rules()
    const page = r.match(/\.mudavym\.mdv-auth\.mdv-endpaper \{([^}]*)\}/)
    expect(page?.[1]).toMatch(/align-items: center/)
    expect(r).toMatch(/@media \(max-width: 700px\) \{\s*\.mudavym\.mdv-auth\.mdv-endpaper \{[^}]*align-items: flex-start/)
  })

  it('pins the wordmark to full ink', () => {
    expect(rules()).toMatch(/\.mdv-endpaper \.mdv-ep-wordmark \{[^}]*color: var\(--ink-1\);[^}]*opacity: 1/)
  })

  it('animates only transform and opacity, never `all`, and stops under reduced motion', () => {
    const r = rules()
    const rise = r.match(/@keyframes mdv-spread-rise \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(rise).toMatch(/opacity/)
    expect(rise).toMatch(/transform/)
    expect(rise.replace(/opacity|transform|from|to|[\s{};:\d.()-]|translateY|px|none/g, '')).toBe('')
    expect(r).not.toMatch(/transition:\s*all|transition-property:\s*all/)
    // every transition the spread declares, commas inside cubic-bezier() set aside
    const spread = r.slice(r.indexOf('.mdv-spread-main'))
    const transitions = [...spread.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1])
    expect(transitions.length).toBeGreaterThan(0)
    for (const t of transitions) {
      for (const part of t.replace(/\([^)]*\)/g, '').split(',')) {
        const prop = part.trim().split(/\s+/)[0]
        if (prop !== 'none') expect(prop).toMatch(/^(transform|opacity)$/)
      }
    }
    expect(r).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.mdv-spread > \*,\s*\.mdv-spread-stack > \* \{\s*animation: none/)
  })
})

describe('Google sign-in that is not set up', () => {
  it('draws nothing at all, and says so to its caller once', async () => {
    const onUnavailable = vi.fn()
    const { container } = render(
      <MemoryRouter>
        <GoogleSignInButton onSuccess={() => {}} onUnavailable={onUnavailable} />
      </MemoryRouter>,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText(/configured on this deployment/)).toBeNull()
    expect(onUnavailable).toHaveBeenCalledTimes(1)
  })
})
