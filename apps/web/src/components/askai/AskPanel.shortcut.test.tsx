/**
 * ⌘⇧K opens the ONE Ask panel (ADR 0145, "One panel, two modes", founder,
 * 2026-09-26) — end to end through the real `CommandProvider`, which owns the
 * global keyboard, and the real panel. Before this, ⌘⇧K opened the separate
 * propose bar (`AskAiBar`, retired).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CommandProvider } from '../command/CommandProvider'
import { AskAiSurface } from './AskAiSurface'

vi.mock('../command/CommandPalette', () => ({
  CommandPalette: ({ open }: { open: boolean }) => (open ? <div data-testid="palette-open" /> : null),
}))
vi.mock('../command/ShortcutsSheet', () => ({ ShortcutsSheet: () => null }))
vi.mock('../command/RecentlyViewed', () => ({ RecentlyViewed: () => null }))
vi.mock('../../services/api/askAi', async (orig) => ({
  ...(await orig<typeof import('../../services/api/askAi')>()),
  listOpenProposals: vi.fn(async () => []),
  listCandidates: vi.fn(async () => null),
  proposeAction: vi.fn(),
}))

function pressAskChord() {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'K', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }),
    )
  })
}

beforeEach(() => {
  render(
    <MemoryRouter>
      <CommandProvider>
        <AskAiSurface />
      </CommandProvider>
    </MemoryRouter>,
  )
})

describe('⌘⇧K', () => {
  it('opens the Ask panel on Ask the books, with both modes on offer, and not the palette', async () => {
    pressAskChord()
    expect(await screen.findByRole('dialog', { name: /ask mudavym/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /ask the books/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /propose an action/i })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByTestId('palette-open')).toBeNull()
  })

  it('closes it when pressed again', async () => {
    pressAskChord()
    await screen.findByRole('dialog', { name: /ask mudavym/i })
    pressAskChord()
    expect(screen.queryByRole('dialog', { name: /ask mudavym/i })).toBeNull()
  })
})
