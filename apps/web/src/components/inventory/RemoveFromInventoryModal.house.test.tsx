/**
 * "Write off N bottles?" — both branches.
 *
 * The gate's promise (ADR 0112 / ADR 0042) is that with no Mudavym page on
 * screen this renders byte for byte as it shipped. "Looks the same" is not a
 * test — a class string that drifted by one utility would pass it — so the
 * assertion pins the LITERAL legacy class string, and one test reads
 * `git show origin/main:<path>` and FAILS (never skips) if that string is no
 * longer in the committed source. A skip there would be an absence reported as
 * health, the fault this repo measures most (ADR 0020).
 *
 * The regression this file carries is the third one in the component's header:
 * a row with no `inventoryId` is stepped over by `run()` and was then counted
 * as removed. Run against `git show HEAD:…/RemoveFromInventoryModal.tsx` the
 * "names the rows it did not write" test fails, because the pre-fix file has no
 * house branch and no skipped-row state at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { RemoveFromInventoryModal } from './RemoveFromInventoryModal'
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround'
import type { InventoryItem } from '../../pages/inventory/useInventoryPage'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const reconcile = vi.fn()
const del = vi.fn()
vi.mock('../../services/api/inventory', () => ({
  reconcileItem: (...a: unknown[]) => reconcile(...a),
  deleteInventoryItem: (...a: unknown[]) => del(...a),
}))

/** Transcribed from the committed legacy source; asserted against it below. */
const LEGACY_CARD = 'bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden'

function item(over: Partial<InventoryItem> & { id: string; name: string }): InventoryItem {
  return {
    liveStock: 6,
    shadowStock: 0,
    threshold: 2,
    lastCounted: null,
    isActive: true,
    inventoryId: `inv-${over.id}`,
    wac: 100,
    ...over,
  } as InventoryItem
}

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  resetMudavymShell()
  reconcile.mockResolvedValue({})
  del.mockResolvedValue({})
})
afterEach(() => vi.clearAllMocks())

describe('the pinned legacy string is the one the committed source ships', () => {
  it('RemoveFromInventoryModal', () => {
    const src = execFileSync(
      'git',
      ['show', 'origin/main:apps/web/src/components/inventory/RemoveFromInventoryModal.tsx'],
      { encoding: 'utf8', cwd: process.cwd() },
    )
    expect(src).toContain(LEGACY_CARD)
  })
})

describe('flag off — the legacy modal, class string for class string', () => {
  it('renders the legacy card and no house overlay', () => {
    wrap(
      <RemoveFromInventoryModal
        isOpen
        items={[item({ id: 'w1', name: 'Öküzgözü 2022' })]}
        onClose={() => {}}
        onRemoved={() => {}}
      />,
    )
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).not.toBeNull()
    expect(document.querySelector('.mdv-ovl')).toBeNull()
  })
})

describe('flag on — the house panel', () => {
  beforeEach(() => claimMudavymShell(Symbol('inventory-page'), 'paper'))

  it('is a Panel on the primitive, motion `settle`, closed in words', () => {
    wrap(
      <RemoveFromInventoryModal
        isOpen
        items={[item({ id: 'w1', name: 'Öküzgözü 2022' })]}
        onClose={() => {}}
        onRemoved={() => {}}
      />,
    )
    const root = document.querySelector('.mdv-ovl')
    expect(root).not.toBeNull()
    expect(root?.getAttribute('data-shape')).toBe('panel')
    expect(document.querySelector('[data-motion="settle"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).toBeNull()
  })

  it('states its contract — what it asks, what sealing writes, what leaving costs', () => {
    wrap(
      <RemoveFromInventoryModal
        isOpen
        items={[item({ id: 'w1', name: 'Öküzgözü 2022' })]}
        onClose={() => {}}
        onRemoved={() => {}}
      />,
    )
    // The heading is the ask; 6 live + 0 shadow.
    expect(screen.getByRole('heading', { name: 'Write off 6 bottles?' })).toBeTruthy()
    // The contract is on the paper, in one sentence.
    expect(
      screen.getByText(
        /Holding the seal reconciles the stock to zero on the ledger and retires the row\. Leaving writes nothing\./,
      ),
    ).toBeTruthy()
    // And carried on `label`, which packet 0 makes the dialog's accessible name.
    expect(
      document.querySelector('[aria-label*="This writes to the ledger"]'),
    ).not.toBeNull()
  })

  it('the money figure names the rows it summed and when they were read', () => {
    wrap(
      <RemoveFromInventoryModal
        isOpen
        items={[
          item({ id: 'w1', name: 'Öküzgözü 2022' }),
          item({ id: 'w2', name: 'Ancyra Narince', wac: undefined, price: undefined } as never),
        ]}
        onClose={() => {}}
        onRemoved={() => {}}
      />,
    )
    const prov = document.querySelector('.mdv-prov')?.textContent ?? ''
    expect(prov).toContain('Summed from 2 inventory rows')
    expect(prov).toContain('carry no recorded cost')
    expect(prov).toMatch(/read \d/)
  })

  it('carries the seal — a ledger write is a real commitment', () => {
    wrap(
      <RemoveFromInventoryModal
        isOpen
        items={[item({ id: 'w1', name: 'Öküzgözü 2022' })]}
        onClose={() => {}}
        onRemoved={() => {}}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Hold to write off 6 bottles' }),
    ).toBeTruthy()
  })

  it('the seal reads back what it bound, and does not close itself', async () => {
    const onClose = vi.fn()
    const onRemoved = vi.fn()
    wrap(
      <RemoveFromInventoryModal
        isOpen
        items={[item({ id: 'w1', name: 'Öküzgözü 2022' })]}
        onClose={onClose}
        onRemoved={onRemoved}
      />,
    )
    const seal = screen.getByRole('button', { name: 'Hold to write off 6 bottles' })
    fireEvent.keyDown(seal, { key: 'Enter' })
    fireEvent.keyDown(seal, { key: 'Enter' })

    await waitFor(() => expect(onRemoved).toHaveBeenCalled())
    await screen.findByText('What the seal bound')
    expect(screen.getByText('6 bottles')).toBeTruthy()
    expect(document.querySelector('.mdv-panelbox .mdv-prov')?.textContent).toContain(
      '1 of 1 row written',
    )
    // Closing is the operator's act, in words — the panel does not vanish.
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
  })

  /* THE REGRESSION. Pre-fix this row was stepped over and then reported as
     removed; nothing on screen said otherwise. */
  it('names the rows it did NOT write — a skipped row is not a removed row', async () => {
    wrap(
      <RemoveFromInventoryModal
        isOpen
        items={[
          item({ id: 'w1', name: 'Öküzgözü 2022' }),
          item({ id: 'w2', name: 'Ancyra Narince', inventoryId: undefined }),
        ]}
        onClose={() => {}}
        onRemoved={() => {}}
      />,
    )
    // Said before the write, on the row itself.
    expect(
      screen.getByText('No inventory record — nothing will be written for this row.'),
    ).toBeTruthy()

    const seal = screen.getByRole('button', { name: /Hold to write off/ })
    fireEvent.keyDown(seal, { key: 'Enter' })
    fireEvent.keyDown(seal, { key: 'Enter' })

    await screen.findByText('Not written')
    expect(
      screen.getByText(/nothing was written for Ancyra Narince/),
    ).toBeTruthy()
    expect(document.querySelector('.mdv-panelbox .mdv-prov')?.textContent).toContain(
      '1 of 2 rows written',
    )
    expect(del).toHaveBeenCalledTimes(1)
  })

  it('a refusal says what did not happen, in words the operator can act on', async () => {
    del.mockRejectedValueOnce({ response: { status: 403, data: { message: 'forbidden' } } })
    wrap(
      <RemoveFromInventoryModal
        isOpen
        items={[item({ id: 'w1', name: 'Öküzgözü 2022' })]}
        onClose={() => {}}
        onRemoved={() => {}}
      />,
    )
    const seal = screen.getByRole('button', { name: /Hold to write off/ })
    fireEvent.keyDown(seal, { key: 'Enter' })
    fireEvent.keyDown(seal, { key: 'Enter' })

    await screen.findByText('Not permitted')
    expect(
      screen.getByText(/Nothing was written; every row below is unchanged\./),
    ).toBeTruthy()
  })

  it('nothing selected is said in words, and offers no seal', () => {
    wrap(<RemoveFromInventoryModal isOpen items={[]} onClose={() => {}} onRemoved={() => {}} />)
    expect(
      screen.getByText('Nothing is selected, so there is nothing to write off.'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Hold to/ })).toBeNull()
  })

  it('wears the page ground the portal was handed', () => {
    resetMudavymShell()
    claimMudavymShell(Symbol('inventory-charcoal'), 'charcoal')
    wrap(
      <RemoveFromInventoryModal
        isOpen
        items={[item({ id: 'w1', name: 'Öküzgözü 2022' })]}
        onClose={() => {}}
        onRemoved={() => {}}
      />,
    )
    expect(document.querySelector('.mdv-ovl')?.getAttribute('data-ground')).toBe('charcoal')
  })
})
