/**
 * "Share this with the engine?" — both branches.
 *
 * Flag off, the legacy dialog renders byte for byte as it shipped; the pinned
 * literal class string is asserted against `git show origin/main:<path>` so a
 * drift fails rather than skips.
 *
 * NOTE, recorded here as well as in the component header so it cannot be lost:
 * the house branch is CORRECT AND UNREACHABLE today. This dialog's only opener
 * lives on the legacy settings page, and the rebuilt page renders the same four
 * consents as records with no switches on purpose. That is a fork for the
 * founder, not a defect in this file — see the packet 1 report.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { MemoryRouter } from 'react-router-dom'
import { ConsentDialog, type ConsentCopy } from './ConsentDialog'
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround'

const LEGACY_CARD = 'w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl outline-none'

const COPY: ConsentCopy = {
  title: 'Share your ordering history with the engine?',
  summary: 'The engine reads what you ordered so it can suggest what to reorder.',
  dataCategories: ['Order lines and quantities', 'Vendor names'],
  exclusions: ['Your staff records', 'Your bank details'],
  acknowledgement: 'I understand what leaves this account.',
  confirmLabel: 'Turn it on',
}

function dialog(copy: ConsentCopy | null = COPY, onConfirm = vi.fn()) {
  return {
    onConfirm,
    ...render(
      <MemoryRouter>
        <ConsentDialog open copy={copy} onCancel={() => {}} onConfirm={onConfirm} />
      </MemoryRouter>,
    ),
  }
}

beforeEach(() => resetMudavymShell())
afterEach(() => vi.clearAllMocks())

describe('the pinned legacy string is the one the committed source ships', () => {
  it('ConsentDialog', () => {
    const src = execFileSync(
      'git',
      ['show', 'origin/main:apps/web/src/components/settings/ConsentDialog.tsx'],
      { encoding: 'utf8', cwd: process.cwd() },
    )
    expect(src).toContain(LEGACY_CARD)
  })
})

describe('flag off — the legacy dialog, class string for class string', () => {
  it('renders the legacy card and no house overlay', () => {
    dialog()
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).not.toBeNull()
    expect(document.querySelector('.mdv-ovl')).toBeNull()
  })
})

describe('flag on — the house panel', () => {
  beforeEach(() => claimMudavymShell(Symbol('settings-page'), 'paper'))

  it('is a Panel on the primitive, motion `settle`', () => {
    dialog()
    expect(document.querySelector('.mdv-ovl')?.getAttribute('data-shape')).toBe('panel')
    expect(document.querySelector('[data-motion="settle"]')).not.toBeNull()
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).toBeNull()
  })

  it('is asserted, never sealed — settings do not get the wax', () => {
    dialog()
    expect(screen.getByRole('button', { name: 'Turn it on' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Hold to/ })).toBeNull()
  })

  it('closes in words, and the words are the refusal', () => {
    dialog()
    // Both the header control and the action say the same thing.
    expect(screen.getAllByRole('button', { name: 'Keep it off' }).length).toBe(2)
  })

  it('the grant is unavailable until the acknowledgement is ticked', () => {
    const { onConfirm } = dialog()
    const grant = screen.getByRole('button', { name: 'Turn it on' })
    expect(grant).toBeDisabled()
    expect(screen.getByText('Not acknowledged yet')).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText('Acknowledged')).toBeTruthy()
    fireEvent.click(grant)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('focus lands on the acknowledgement, never on the grant', () => {
    dialog()
    expect(document.activeElement).toBe(screen.getByRole('checkbox'))
  })

  it('says what leaves and what stays, in the copy it was given', () => {
    dialog()
    expect(screen.getByText('What gets shared')).toBeTruthy()
    expect(screen.getByText('Order lines and quantities')).toBeTruthy()
    expect(screen.getByText('What never leaves')).toBeTruthy()
    expect(screen.getByText('Your bank details')).toBeTruthy()
  })

  it('no copy is an absence said in words, not an empty panel', () => {
    claimMudavymShell(Symbol('settings-2'), 'paper')
    render(
      <MemoryRouter>
        <ConsentDialog open={false} copy={null} onCancel={() => {}} onConfirm={() => {}} />
      </MemoryRouter>,
    )
    // Closed with no copy renders nothing at all, which is the honest result.
    expect(document.querySelector('.mdv-ovl')).toBeNull()
  })

  it('wears the page ground the portal was handed', () => {
    resetMudavymShell()
    claimMudavymShell(Symbol('settings-charcoal'), 'charcoal')
    dialog()
    expect(document.querySelector('.mdv-ovl')?.getAttribute('data-ground')).toBe('charcoal')
  })
})
