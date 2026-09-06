/**
 * "Spot count" — both branches.
 *
 * Flag off, this renders byte for byte as it shipped, and the pinned literal
 * class string is asserted against `git show origin/main:<path>` so a drift
 * fails rather than skips (a skip would be an absence reported as health —
 * ADR 0020, the fault this repo measures most).
 *
 * The regression: the endpoint has returned the count receipt since ADR 0078
 * (`inventory/stock-count-result.ts:36`) and the client's response type dropped
 * it, so the panel said "Count recorded" with no evidence and drew a queued
 * count and a booked count identically. Against
 * `git show HEAD:…/SpotCountPanel.tsx` every test below the fold fails, because
 * the pre-fix file has no ladder, no receipt and no house branch at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { SpotCountPanel } from './SpotCountPanel'
import { claimMudavymShell, resetMudavymShell } from '../../../lib/mudavym/shellGround'
import type { InventoryItem } from '../useInventoryPage'

const submit = vi.fn()
vi.mock('../../../lib/spotCountOutbox', () => ({
  submitSpotCount: (...a: unknown[]) => submit(...a),
  newClientCountId: () => 'ccid-1',
}))
vi.mock('../../../services/api/inventory', () => ({
  estimateCountFromPhoto: vi.fn(),
}))
const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('../../../stores', () => ({ useNotificationStore: () => notify }))

const LEGACY_CARD = 'bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden'

const ITEM = {
  id: 'w1',
  name: 'Öküzgözü 2022',
  inventoryId: 'inv-1',
  liveStock: 8,
  shadowStock: 0,
  threshold: 2,
  lastCounted: null,
  isActive: true,
} as unknown as InventoryItem

beforeEach(() => {
  resetMudavymShell()
  submit.mockResolvedValue({ synced: true, record: null })
})
afterEach(() => vi.clearAllMocks())

describe('the pinned legacy string is the one the committed source ships', () => {
  it('SpotCountPanel', () => {
    const src = execFileSync(
      'git',
      ['show', 'origin/main:apps/web/src/pages/inventory/command/SpotCountPanel.tsx'],
      { encoding: 'utf8', cwd: process.cwd() },
    )
    expect(src).toContain(LEGACY_CARD)
  })
})

describe('flag off — the legacy panel, class string for class string', () => {
  it('renders the legacy card and no house overlay', () => {
    render(<SpotCountPanel item={ITEM} onClose={() => {}} onCommitted={() => {}} />)
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).not.toBeNull()
    expect(document.querySelector('.mdv-ovl')).toBeNull()
  })
})

describe('flag on — the house sheet', () => {
  beforeEach(() => claimMudavymShell(Symbol('inventory-page'), 'paper'))

  it('is a Sheet on the primitive, motion `tuck`, closed in words', () => {
    render(<SpotCountPanel item={ITEM} onClose={() => {}} onCommitted={() => {}} />)
    expect(document.querySelector('.mdv-ovl')?.getAttribute('data-shape')).toBe('sheet')
    expect(document.querySelector('[data-motion="tuck"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).toBeNull()
  })

  it('states its contract — what it asks, what sealing writes, what leaving costs', () => {
    render(<SpotCountPanel item={ITEM} onClose={() => {}} onCommitted={() => {}} />)
    // Visible, at the top of the paper.
    expect(
      screen.getByText(
        /This asks one thing: how many bottles are on the shelf\. Holding the seal writes the count to the book\. Leaving writes nothing\./,
      ),
    ).toBeTruthy()
    // And carried on `label`, which the primitive puts on the scrim today and
    // which packet 0 makes the dialog's own accessible name.
    expect(
      document.querySelector(
        '[aria-label="Close Count Öküzgözü 2022 on the shelf. Sealing writes the count to the book. Leaving writes nothing."]',
      ),
    ).not.toBeNull()
  })

  it('the field names what the book says and when it was read', () => {
    render(<SpotCountPanel item={ITEM} onClose={() => {}} onCommitted={() => {}} />)
    const prov = document.querySelector('.mdv-prov')?.textContent ?? ''
    expect(prov).toContain('The book says 8')
    expect(prov).toMatch(/read \d/)
  })

  it('a bottle the book has never counted is an absence, not a zero', () => {
    render(
      <SpotCountPanel
        item={{ ...ITEM, liveStock: null } as InventoryItem}
        onClose={() => {}}
        onCommitted={() => {}}
      />,
    )
    expect(
      screen.getByText(/The book holds no count for this bottle — that is an absence, not a zero\./),
    ).toBeTruthy()
  })

  it('carries the seal, not a Submit button', () => {
    render(<SpotCountPanel item={ITEM} onClose={() => {}} onCommitted={() => {}} />)
    expect(screen.getByRole('button', { name: 'Hold to record 8 on the shelf' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Submit count' })).toBeNull()
  })

  /* THE REGRESSION — queued is never confirmed. */
  it('a queued count does not claim the house has it', async () => {
    submit.mockResolvedValue({ synced: false })
    render(<SpotCountPanel item={ITEM} onClose={() => {}} onCommitted={() => {}} />)
    const seal = screen.getByRole('button', { name: /Hold to record/ })
    fireEvent.keyDown(seal, { key: 'Enter' })
    fireEvent.keyDown(seal, { key: 'Enter' })

    await screen.findByText('How far the record got')
    const reached = [...document.querySelectorAll('.mdv-step[data-reached="true"] b')].map(
      (n) => n.textContent,
    )
    expect(reached).toEqual(['Written here', 'Sent'])
    expect(
      screen.getByText('Not yet — there was no signal, so it is queued on this device.'),
    ).toBeTruthy()
    expect(screen.getByText(/Queued is not counted\./)).toBeTruthy()
  })

  it('a booked count reads back the receipt the gateway returned', async () => {
    submit.mockResolvedValue({
      synced: true,
      record: {
        countId: 'c0ffee12-3456',
        expectedQty: 8,
        countedQty: 6,
        varianceQty: -2,
        transactionId: 't1',
        countedAt: '2026-09-06T18:31:00.000Z',
        replayed: false,
      },
    })
    render(<SpotCountPanel item={ITEM} onClose={() => {}} onCommitted={() => {}} />)
    fireEvent.change(screen.getByLabelText('Bottles on the shelf'), { target: { value: '6' } })
    const seal = screen.getByRole('button', { name: 'Hold to record 6 on the shelf' })
    fireEvent.keyDown(seal, { key: 'Enter' })
    fireEvent.keyDown(seal, { key: 'Enter' })

    await screen.findByText('How far the record got')
    const reached = [...document.querySelectorAll('.mdv-step[data-reached="true"] b')].map(
      (n) => n.textContent,
    )
    expect(reached).toEqual(['Written here', 'Sent', 'The house has it', 'On the book'])
    const prov = document.querySelector('.mdv-panelbox .mdv-prov')?.textContent ?? ''
    expect(prov).toContain('Counted 6')
    expect(prov).toContain('the book expected 8')
    expect(prov).toContain('variance -2')
    expect(screen.queryByText(/Queued is not counted\./)).toBeNull()
  })

  it('an answer with no receipt stops at "the house has it"', async () => {
    submit.mockResolvedValue({ synced: true, record: null })
    render(<SpotCountPanel item={ITEM} onClose={() => {}} onCommitted={() => {}} />)
    const seal = screen.getByRole('button', { name: /Hold to record/ })
    fireEvent.keyDown(seal, { key: 'Enter' })
    fireEvent.keyDown(seal, { key: 'Enter' })

    await screen.findByText('How far the record got')
    const reached = [...document.querySelectorAll('.mdv-step[data-reached="true"] b')].map(
      (n) => n.textContent,
    )
    expect(reached).toEqual(['Written here', 'Sent', 'The house has it'])
    expect(
      screen.getByText(/The house has not answered, so there is no receipt to show\./),
    ).toBeTruthy()
  })

  it('a refusal says what did not happen and what the book still reads', async () => {
    submit.mockRejectedValue({ response: { status: 403, data: { message: 'forbidden' } } })
    render(<SpotCountPanel item={ITEM} onClose={() => {}} onCommitted={() => {}} />)
    const seal = screen.getByRole('button', { name: /Hold to record/ })
    fireEvent.keyDown(seal, { key: 'Enter' })
    fireEvent.keyDown(seal, { key: 'Enter' })

    await screen.findByText('Not permitted')
    expect(
      screen.getByText(/Nothing was written; the book is unchanged\./),
    ).toBeTruthy()
  })

  it('a failure that is not a refusal names the figure the book still holds', async () => {
    submit.mockRejectedValue({ response: { status: 500, data: { message: 'boom' } } })
    render(<SpotCountPanel item={ITEM} onClose={() => {}} onCommitted={() => {}} />)
    const seal = screen.getByRole('button', { name: /Hold to record/ })
    fireEvent.keyDown(seal, { key: 'Enter' })
    fireEvent.keyDown(seal, { key: 'Enter' })

    await screen.findByText('Not recorded')
    expect(screen.getByText(/The book still reads 8\. Nothing was written\./)).toBeTruthy()
  })

  it('wears the page ground the portal was handed', async () => {
    resetMudavymShell()
    claimMudavymShell(Symbol('inventory-charcoal'), 'charcoal')
    render(<SpotCountPanel item={ITEM} onClose={() => {}} onCommitted={() => {}} />)
    await waitFor(() =>
      expect(document.querySelector('.mdv-ovl')?.getAttribute('data-ground')).toBe('charcoal'),
    )
  })
})
