/**
 * ADR 0112: reduced motion means no animation. The app is wrapped in
 * MotionConfig reducedMotion="user"; the /register step panels are plain divs
 * (the Endpaper page turn is the one motion, never doubled by a 20 px slide);
 * the raw spinners stop under reduced motion.
 */
import { renderToString } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ registerAccount: vi.fn(), joinViaInvite: vi.fn(), error: null }),
}))
const get = vi.hoisted(() => vi.fn())
vi.mock('../../services/api/client', () => ({ apiClient: { get } }))
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

  it('stops every spinner under reduced motion: waits go through Pending, never a raw animate-spin', () => {
    for (const f of ['pages/Register.tsx', 'components/onboarding/MenuScanUpload.tsx']) {
      const text = src(f)
      expect(text).not.toContain('animate-spin')
      expect(text).toContain("from '@/components/onboarding/Pending'")
    }
  })

  // r103 (DD-r102-3): reduced means no animation, opacity fades included.
  it('gives every framer duration through dur(), which is 0 under reduced motion', () => {
    const reg = src('pages/Register.tsx')
    expect(reg).toMatch(/const dur = \(seconds: number\) => \(prefersReducedMotion\(\) \? 0 : seconds\)/)
    const durations = reg.match(/duration: [^,}\s]+/g) ?? []
    expect(durations.length).toBeGreaterThan(5)
    for (const d of durations) expect(d).toMatch(/^duration: (dur\(|0$)/)
    expect(reg).not.toMatch(/transition=\{\{ delay/)
  })

  it('takes the colour and opacity transitions off the inputs and Continue under reduced motion', () => {
    const reg = src('pages/Register.tsx')
    const all = reg.match(/transition-all[^'`\s]*(\s+[^'`\s]+)?/g) ?? []
    expect(all.length).toBeGreaterThan(0)
    for (const m of all) expect(m).toContain('motion-reduce:transition-none')
    const buttons = reg.split('<Button').slice(1)
    expect(buttons.length).toBe(3)
    for (const b of buttons) expect(b.slice(0, 300)).toContain('motion-reduce:transition-none')
  })

  it('holds the invite card\'s room while its read is out, then gives it up', async () => {
    let settle: (v: unknown) => void = () => {}
    get.mockReturnValue(new Promise((r) => { settle = r }))
    render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/register?type=join'] },
        createElement(Routes, null, createElement(Route, { path: '/register', element: createElement(Register) })),
      ),
    )
    expect(screen.queryByTestId('invite-card-room')).toBeNull()
    fireEvent.change(screen.getByLabelText('Invite Code'), { target: { value: 'ABCD2345' } })
    expect(screen.getByTestId('invite-card-room')).toHaveStyle({ minHeight: '142px' })
    settle({ data: { valid: false, reason: 'not_found' } })
    await waitFor(() => expect(screen.queryByTestId('invite-card-room')).toBeNull())
  })

  it('holds that room on the very first render of an invite link (not one effect later)', () => {
    const html = renderToString(
      createElement(
        MemoryRouter,
        { initialEntries: ['/register?invite=abcd2345'] },
        createElement(Routes, null, createElement(Route, { path: '/register', element: createElement(Register) })),
      ),
    )
    expect(html).toContain('data-testid="invite-card-room"')
    expect(html).toContain('value="ABCD2345"')
  })
})
