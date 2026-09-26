/**
 * The vendors page answers to `g v` and still to `g p` (founder, 2026-09-26,
 * round 6: "'g v', keep 'g p' working"). The new letter matches the word the
 * page is called by since ADR 0221; the old one stays so nobody's habit breaks.
 *
 * Driven through the real key handler rather than by reading GOTO_MAP, so a
 * handler that stopped consulting the map would fail here too.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { CommandProvider } from './CommandProvider'
import { GOTO_MAP, staticCommands } from './commands'

vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('./ShortcutsSheet', () => ({ ShortcutsSheet: () => null }))
vi.mock('./RecentlyViewed', () => ({ RecentlyViewed: () => null }))

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.pathname}</div>
}

function key(k: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <CommandProvider>
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </CommandProvider>
    </MemoryRouter>,
  )
})

describe('g then a letter reaches /vendors', () => {
  it('g v goes to /vendors', () => {
    key('g')
    key('v')
    expect(screen.getByTestId('where').textContent).toBe('/vendors')
  })

  it('g p still goes to /vendors', () => {
    key('g')
    key('p')
    expect(screen.getByTestId('where').textContent).toBe('/vendors')
  })

  it('a bare v without g goes nowhere', () => {
    key('v')
    expect(screen.getByTestId('where').textContent).toBe('/')
  })
})

describe('the palette names the new letter', () => {
  it('shows g v on the Vendors entry, and both letters map to /vendors', () => {
    const nav = staticCommands().find((c) => c.id === 'nav-providers')
    expect(nav?.shortcut).toBe('g v')
    expect(GOTO_MAP.v.href).toBe('/vendors')
    expect(GOTO_MAP.p.href).toBe('/vendors')
  })
})
