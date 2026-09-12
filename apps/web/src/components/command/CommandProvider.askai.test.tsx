/**
 * ⌘⇧K opens Ask AI — and, just as importantly, does NOT open the ⌘K palette.
 *
 * The palette's ⌘K handler runs in the CAPTURE phase and does not inspect
 * `shiftKey`, so before this change ⌘⇧K toggled the palette. Registering Ask AI
 * as a second capture listener elsewhere would have raced that one and the
 * winner would have depended on mount order. This test pins the resolution:
 * one owner, two bindings, no overlap.
 *
 * The palette's children are stubbed because they reach for the auth and toast
 * contexts, which have nothing to do with what is being asserted here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CommandProvider } from './CommandProvider'
import { ASK_AI_OPEN_EVENT } from '../askai/events'

vi.mock('./CommandPalette', () => ({
  CommandPalette: ({ open }: { open: boolean }) =>
    open ? <div data-testid="palette-open" /> : null,
}))
vi.mock('./ShortcutsSheet', () => ({
  ShortcutsSheet: ({ open }: { open: boolean }) =>
    open ? <div data-testid="shortcuts-open" /> : null,
}))
vi.mock('./RecentlyViewed', () => ({
  RecentlyViewed: ({ open }: { open: boolean }) =>
    open ? <div data-testid="recent-open" /> : null,
}))

/** The handler is a raw window listener, so the state it sets needs `act`. */
function press(key: string, mods: { shiftKey?: boolean } = {}) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        metaKey: true,
        bubbles: true,
        cancelable: true,
        ...mods,
      }),
    )
  })
}

let askAiOpens: number
const countOpen = () => {
  askAiOpens += 1
}

beforeEach(() => {
  askAiOpens = 0
  window.addEventListener(ASK_AI_OPEN_EVENT, countOpen)
  render(
    <MemoryRouter>
      <CommandProvider>
        <div />
      </CommandProvider>
    </MemoryRouter>,
  )
})
afterEach(() => window.removeEventListener(ASK_AI_OPEN_EVENT, countOpen))

describe('⌘⇧K', () => {
  it('asks for Ask AI and leaves the command palette closed', () => {
    press('K', { shiftKey: true })

    expect(askAiOpens).toBe(1)
    expect(screen.queryByTestId('palette-open')).not.toBeInTheDocument()
  })

  it('still lets plain ⌘K open the palette, and does not fire Ask AI', () => {
    press('k')

    expect(screen.getByTestId('palette-open')).toBeInTheDocument()
    expect(askAiOpens).toBe(0)
  })

  it('leaves ⌘⇧O on the recently-viewed switcher', () => {
    press('O', { shiftKey: true })

    expect(screen.getByTestId('recent-open')).toBeInTheDocument()
    expect(askAiOpens).toBe(0)
  })
})
