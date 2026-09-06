/**
 * "POS buttons and stock" — both branches.
 *
 * Flag off, the legacy panel renders byte for byte as it shipped; the pinned
 * literal class string is asserted against `git show origin/main:<path>` so a
 * drift fails rather than skips. The existing `PosMappingPanel.test.tsx` covers
 * the legacy branch's behaviour and still passes untouched.
 *
 * The regression: every write's failure lived in a toast and nowhere else, so
 * an operator who missed it saw a panel that looked settled. The two failure
 * tests below fail against a copy of the pre-fix file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { PosMappingPanel } from './PosMappingPanel'
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

const api = {
  getMatchProposals: vi.fn(),
  getUnresolvedLines: vi.fn(),
  getItemMappings: vi.fn(),
  approveProposals: vi.fn(),
  rejectProposal: vi.fn(),
  runCatalogMatch: vi.fn(),
  setSaleUnits: vi.fn(),
}
vi.mock('../../services/api/posHub', () => ({
  getMatchProposals: (...a: unknown[]) => api.getMatchProposals(...a),
  getUnresolvedLines: (...a: unknown[]) => api.getUnresolvedLines(...a),
  getItemMappings: (...a: unknown[]) => api.getItemMappings(...a),
  approveProposals: (...a: unknown[]) => api.approveProposals(...a),
  rejectProposal: (...a: unknown[]) => api.rejectProposal(...a),
  runCatalogMatch: (...a: unknown[]) => api.runCatalogMatch(...a),
  setSaleUnits: (...a: unknown[]) => api.setSaleUnits(...a),
}))

const LEGACY_CARD = 'bg-white rounded-2xl shadow-xl w-full max-w-5xl my-6'

const INVENTORY = [
  { id: 'inv1', wineName: 'Öküzgözü 2022', bottleSizeMl: 750, pourSizeMl: 150 },
]

const PROPOSAL = {
  id: 'p1',
  item_name: 'Okuzgozu Glass',
  external_item_id: 'sq-1',
  candidate_inventory_id: 'inv1',
  confidence: 0.82,
  match_method: 'name',
}

const UNRESOLVED = {
  summary: { open_lines: 39, qty_total: 51, distinct_items: 7, truncated: false },
  items: [],
}

function panel() {
  return render(
    <PosMappingPanel isOpen onClose={() => {}} inventory={INVENTORY} restaurantId="r1" />,
  )
}

beforeEach(() => {
  resetMudavymShell()
  api.getMatchProposals.mockResolvedValue([PROPOSAL])
  api.getUnresolvedLines.mockResolvedValue(UNRESOLVED)
  api.getItemMappings.mockResolvedValue([])
  api.approveProposals.mockResolvedValue({ approved: 1, requested: 1, failed: 0, results: [] })
})
afterEach(() => vi.clearAllMocks())

describe('the pinned legacy string is the one the committed source ships', () => {
  it('PosMappingPanel', () => {
    const src = execFileSync(
      'git',
      ['show', 'origin/main:apps/web/src/components/inventory/PosMappingPanel.tsx'],
      { encoding: 'utf8', cwd: process.cwd() },
    )
    expect(src).toContain(LEGACY_CARD)
  })
})

describe('flag off — the legacy panel, class string for class string', () => {
  it('renders the legacy card and no house overlay', async () => {
    panel()
    await waitFor(() => expect(api.getMatchProposals).toHaveBeenCalled())
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).not.toBeNull()
    expect(document.querySelector('.mdv-ovl')).toBeNull()
  })
})

describe('flag on — the house sheet', () => {
  beforeEach(() => claimMudavymShell(Symbol('inventory-page'), 'paper'))

  it('is a Sheet on the primitive, motion `tuck`, closed in words', async () => {
    panel()
    await screen.findByText('Waiting for you — 1')
    expect(document.querySelector('.mdv-ovl')?.getAttribute('data-shape')).toBe('sheet')
    expect(document.querySelector('[data-motion="tuck"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).toBeNull()
  })

  it('carries no seal — a mapping row is not a ledger row', async () => {
    panel()
    await screen.findByText('Waiting for you — 1')
    expect(screen.queryByRole('button', { name: /Hold to/ })).toBeNull()
  })

  it('pre-selects no unit, and says an unanswered row is a real answer', async () => {
    panel()
    await screen.findByText('Waiting for you — 1')
    expect(screen.getByRole('button', { name: 'Bottle 750ml' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Glass 150ml' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(
      screen.getByText(
        /a size nobody chose is written as absent, and the sale queues\./,
      ),
    ).toBeTruthy()
  })

  it("keeps the matcher's raw score grey, never a verdict", async () => {
    panel()
    await screen.findByText('Waiting for you — 1')
    expect(document.querySelector('.mdv-grey')?.textContent).toContain(
      'proposes Öküzgözü 2022 · 82% · name',
    )
  })

  it('a queue read that failed is not a queue that is empty', async () => {
    api.getUnresolvedLines.mockRejectedValue(new Error('gateway down'))
    panel()
    await screen.findByText(/This is not a claim that the queue is empty\./)
    expect(screen.queryByText('39')).toBeNull()
  })

  it('a proposals read that failed is not "no buttons waiting"', async () => {
    api.getMatchProposals.mockRejectedValue(new Error('gateway down'))
    panel()
    await screen.findByText(/not the same as having none\./)
    expect(screen.queryByText(/No buttons are waiting on an answer from you\./)).toBeNull()
  })

  /* THE REGRESSION — a failed write says so on the paper, not only in a toast. */
  it('a failed confirm says what did not happen, in place', async () => {
    api.approveProposals.mockRejectedValue({
      response: { status: 500, data: { message: 'upstream down' } },
    })
    panel()
    await screen.findByText('Waiting for you — 1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm Okuzgozu Glass' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm 1' }))

    await screen.findByText('Not written')
    expect(
      screen.getByText(/Nothing was confirmed — upstream down\. Every row below is as it was\./),
    ).toBeTruthy()
  })

  it('a refusal is its own state', async () => {
    api.approveProposals.mockRejectedValue({
      response: { status: 403, data: { message: 'forbidden' } },
    })
    panel()
    await screen.findByText('Waiting for you — 1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm Okuzgozu Glass' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm 1' }))

    await screen.findByText('Not permitted')
    expect(
      screen.getByText(/not permitted to change the POS bridge/),
    ).toBeTruthy()
  })

  it('says out loud what confirming without a size will cost', async () => {
    panel()
    await screen.findByText('Waiting for you — 1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm Okuzgozu Glass' }))
    expect(
      screen.getByText(/their sales will keep queueing and move no stock until a size is set\./),
    ).toBeTruthy()
  })

  it('an empty bridge is said in words', async () => {
    api.getMatchProposals.mockResolvedValue([])
    api.getUnresolvedLines.mockResolvedValue({
      summary: { open_lines: 0, qty_total: 0, distinct_items: 0, truncated: false },
      items: [],
    })
    panel()
    await screen.findByText(/Nothing is waiting\./)
  })

  it('wears the page ground the portal was handed', async () => {
    resetMudavymShell()
    claimMudavymShell(Symbol('inventory-charcoal'), 'charcoal')
    panel()
    await screen.findByText('Waiting for you — 1')
    expect(document.querySelector('.mdv-ovl')?.getAttribute('data-ground')).toBe('charcoal')
  })
})
