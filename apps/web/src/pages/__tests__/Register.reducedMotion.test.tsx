/**
 * ADR 0112: reduced motion means no animation. The app is wrapped in
 * MotionConfig reducedMotion="user"; the /register step panels are plain divs
 * (the Endpaper page turn is the one motion, never doubled by a 20 px slide);
 * the raw spinners stop under reduced motion.
 */
import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { render, screen } from '@testing-library/react'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ registerAccount: vi.fn(), joinViaInvite: vi.fn(), error: null }),
}))
vi.mock('../../services/api/client', () => ({ apiClient: { get: vi.fn() } }))
vi.mock('../../components/auth/GoogleSignInButton', () => ({ GoogleSignInButton: () => null }))

import { Register } from '../Register'

const src = (rel: string) => readFileSync(resolve(process.cwd(), 'src', rel), 'utf8')

describe('reduced motion on the way in', () => {
  it('wraps the whole app in MotionConfig reducedMotion="user"', () => {
    expect(src('main.tsx')).toMatch(/<MotionConfig reducedMotion="user">\s*<App \/>\s*<\/MotionConfig>/)
  })

  it('draws the invite step as a plain panel: no slide in its style', () => {
    const { container } = render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/register?type=join'] },
        createElement(Routes, null, createElement(Route, { path: '/register', element: createElement(Register) })),
      ),
    )
    const field = screen.getByPlaceholderText('········')
    let el: HTMLElement | null = field
    while (el && el !== container) {
      expect(el.getAttribute('style') ?? '').not.toMatch(/transform|translate/)
      el = el.parentElement
    }
    expect(src('pages/Register.tsx')).not.toMatch(/x: 20|x: -20/)
  })

  it('stops every raw spinner under reduced motion', () => {
    for (const f of ['pages/Register.tsx', 'components/onboarding/MenuScanUpload.tsx']) {
      const lines = src(f).split('\n').filter((l) => l.includes('animate-spin'))
      expect(lines.length).toBeGreaterThan(0)
      for (const l of lines) expect(l).toContain('motion-reduce:animate-none')
    }
  })
})
