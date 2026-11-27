/**
 * Guard (r107 onboarding g1): no raw `animate-spin` in the sign-up pages or the
 * onboarding components. Every wait goes through <Pending>, which stops under
 * prefers-reduced-motion (ADR 0112). Pending.tsx is the one place it lives.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const src = path.resolve(__dirname, '../..')
const files = [
  ...['Register', 'VerifyEmail', 'Login'].map((n) => path.join(src, 'pages', `${n}.tsx`)),
  ...readdirSync(__dirname)
    .filter((f) => f.endsWith('.tsx') && !/\.test\.tsx$/.test(f) && f !== 'Pending.tsx')
    .map((f) => path.join(__dirname, f)),
]

describe('no raw animate-spin in onboarding', () => {
  it('scans the pages and the components', () => {
    expect(files.length).toBeGreaterThan(8)
  })
  it.each(files.map((f) => [path.relative(src, f), f]))('%s', (_n, f) => {
    expect(readFileSync(f, 'utf8')).not.toContain('animate-spin')
  })
})

describe('a wait with no words is marked decorative', () => {
  it.each(files.map((f) => [path.relative(src, f), f]))('%s', (_n, f) => {
    const calls = readFileSync(f, 'utf8').match(/<Pending\b[\s\S]*?\/>/g) ?? []
    for (const call of calls) {
      expect(/\blabel=/.test(call) || /\bdecorative\b/.test(call), call).toBe(true)
    }
  })
})
