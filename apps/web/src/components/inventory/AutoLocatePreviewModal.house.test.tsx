/**
 * "Place N bottles by their zones?" — both branches.
 *
 * Flag off, the legacy modal renders byte for byte as it shipped; the pinned
 * literal class string is asserted against `git show origin/main:<path>` so a
 * drift fails rather than skips.
 *
 * The regressions: the panel counted skipped wines and never named one, and it
 * reported a batch of fire-and-forget writes as done without awaiting any of
 * them. Both tests below fail against a copy of the pre-fix file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { AutoLocatePreviewModal } from './AutoLocatePreviewModal'
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround'
import type { AutoLocateResult, WineLocationScore } from '../../lib/autoLocateEngine'
import type { StorageLocation } from '../../hooks/useStorageLocations'

const LEGACY_CARD =
  'bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col pointer-events-auto'

const LOCATIONS: StorageLocation[] = [
  { id: 'l1', name: 'Main Cellar', capacity: 100, currentCount: 12, color: '#000' },
  { id: 'l2', name: 'Bar Stock', capacity: null, currentCount: 3, color: '#000' },
]

function score(over: Partial<WineLocationScore>): WineLocationScore {
  return {
    wineId: 'w1',
    wineName: 'Öküzgözü 2022',
    wineType: 'red',
    locationId: 'l1',
    locationName: 'Main Cellar',
    locationColor: '#000',
    score: 82,
    reasons: ['temperature suits red', 'room for 88 more'],
    quantity: 6,
    ...over,
  }
}

const RESULT: AutoLocateResult = {
  assignments: [score({}), score({ wineId: 'w2', wineName: 'Ancyra Narince' })],
  skipped: [{ id: 'w9', name: 'Chablis 2021' } as never],
}

function panel(onApply?: never | ((s: WineLocationScore[]) => Promise<never>)) {
  return render(
    <AutoLocatePreviewModal
      isOpen
      onClose={() => {}}
      result={RESULT}
      allLocations={LOCATIONS}
      includeAssigned={false}
      onToggleIncludeAssigned={() => {}}
      onConfirm={() => {}}
      onApply={onApply as never}
    />,
  )
}

beforeEach(() => resetMudavymShell())
afterEach(() => vi.clearAllMocks())

describe('the pinned legacy string is the one the committed source ships', () => {
  it('AutoLocatePreviewModal', () => {
    const src = execFileSync(
      'git',
      ['show', 'origin/main:apps/web/src/components/inventory/AutoLocatePreviewModal.tsx'],
      { encoding: 'utf8', cwd: process.cwd() },
    )
    expect(src).toContain(LEGACY_CARD)
  })
})

describe('flag off — the legacy modal, class string for class string', () => {
  it('renders the legacy card and no house overlay', () => {
    panel()
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).not.toBeNull()
    expect(document.querySelector('.mdv-ovl')).toBeNull()
  })
})

describe('flag on — the house panel', () => {
  beforeEach(() => claimMudavymShell(Symbol('inventory-page'), 'paper'))

  it('is a Panel on the primitive, motion `settle`, closed in words', () => {
    panel()
    expect(document.querySelector('.mdv-ovl')?.getAttribute('data-shape')).toBe('panel')
    expect(document.querySelector('[data-motion="settle"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('bulk gets the plain die — no seal anywhere on it', () => {
    panel()
    expect(screen.getByRole('button', { name: 'Place 2 wines' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Hold to/ })).toBeNull()
  })

  it('states its contract', () => {
    panel()
    expect(
      screen.getByText(
        /The ticks choose; nothing is written until you apply\. Leaving writes nothing\./,
      ),
    ).toBeTruthy()
  })

  it("keeps the engine's proposal grey, with its score and its reasons", () => {
    panel()
    const grey = [...document.querySelectorAll('.mdv-grey')].map((n) => n.textContent)
    expect(grey[0]).toContain('proposes Main Cellar')
    expect(grey[0]).toContain('82 points')
    expect(grey[0]).toContain('temperature suits red')
  })

  it('a zone with no recorded capacity says so rather than showing a dash', () => {
    panel()
    expect(screen.getAllByRole('option', { name: 'Bar Stock (3/no capacity recorded)' }).length).toBe(
      2,
    )
  })

  /* THE REGRESSION — a count with no rows behind it is not a fact. */
  it('names every skipped wine, not just how many there were', () => {
    panel()
    expect(screen.getByText('Matched no zone — 1')).toBeTruthy()
    expect(screen.getByText('Chablis 2021')).toBeTruthy()
    expect(
      screen.getByText('No zone scored above nothing for this bottle. It stays where it is.'),
    ).toBeTruthy()
  })

  /* THE REGRESSION — the apply is awaited and reports what landed. */
  it('reports what the house accepted, and names what it refused', async () => {
    const onApply = vi.fn().mockResolvedValue({
      written: ['w1'],
      failed: [{ wineId: 'w2', label: 'Ancyra Narince', message: 'zone is full' }],
      denied: false,
    })
    panel(onApply as never)
    fireEvent.click(screen.getByRole('button', { name: 'Place 2 wines' }))

    await screen.findByText('Placed')
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(screen.getByText('1')).toBeTruthy()
    expect(document.querySelector('.mdv-panelbox .mdv-prov')?.textContent).toContain('of 2 ticked')
    expect(screen.getByText('Not placed')).toBeTruthy()
    expect(screen.getByText(/Ancyra Narince — zone is full/)).toBeTruthy()
    expect(screen.getByText(/It is unplaced — nothing else changed\./)).toBeTruthy()
  })

  it('a refusal is its own state, not a generic failure', async () => {
    const onApply = vi.fn().mockResolvedValue({
      written: [],
      failed: [{ wineId: 'w1', label: 'Öküzgözü 2022', message: 'forbidden' }],
      denied: true,
    })
    panel(onApply as never)
    fireEvent.click(screen.getByRole('button', { name: 'Place 2 wines' }))

    await screen.findByText('Not permitted')
    expect(
      screen.getByText(
        'This account is not permitted to write zone assignments. The wines below are unplaced.',
      ),
    ).toBeTruthy()
  })

  it('an empty proposal is an answer, said in words', () => {
    render(
      <AutoLocatePreviewModal
        isOpen
        onClose={() => {}}
        result={{ assignments: [], skipped: [] }}
        allLocations={LOCATIONS}
        includeAssigned={false}
        onToggleIncludeAssigned={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(screen.getByText(/The engine proposed no placements\./)).toBeTruthy()
  })

  it('mounted with no apply path, it says so rather than offering a dead button', () => {
    panel()
    expect(screen.getByRole('button', { name: 'Place 2 wines' })).toBeDisabled()
    expect(screen.getByText(/Nothing here can write\./)).toBeTruthy()
  })

  it('wears the page ground the portal was handed', () => {
    resetMudavymShell()
    claimMudavymShell(Symbol('inventory-charcoal'), 'charcoal')
    panel()
    expect(document.querySelector('.mdv-ovl')?.getAttribute('data-ground')).toBe('charcoal')
  })
})
