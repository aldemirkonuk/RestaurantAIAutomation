/**
 * "A delivery without an order" — both branches.
 *
 * Flag off, the legacy workspace renders byte for byte as it shipped; the
 * pinned literal class string is asserted against `git show origin/main:<path>`
 * so a drift fails rather than skips.
 *
 * The fork F3 answer is pinned too: this is a `Sheet · wide` (640), not a
 * route and not a 440 sheet, because its rows carry a name, a count, a cost and
 * a zone and 440 minus padding cannot hold them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ManualReceiptWorkspace } from './ManualReceiptWorkspace'
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const persist = vi.fn()
vi.mock('../../lib/menuScannerPersistence', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>)
  return { ...actual, persistBatchToInventory: (...a: unknown[]) => persist(...a) }
})
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { restaurantId: 'r1' }, activeRestaurantId: 'r1' }),
}))
const wines = vi.fn()
vi.mock('../../hooks/queries', () => ({
  useWines: (...a: unknown[]) => wines(...a),
}))
vi.mock('../../hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: [{ id: 'pv1', name: 'Selim Şarap' }] }),
}))
vi.mock('../../hooks/useStorageLocations', () => ({
  useStorageLocations: () => ({ locations: [{ id: 'l1', name: 'Main Cellar' }] }),
}))

const LEGACY_CARD =
  'bg-white rounded-3xl shadow-2xl w-full max-w-6xl h-[94vh] overflow-hidden flex flex-col'

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>)
}

function workspace() {
  return wrap(<ManualReceiptWorkspace isOpen onClose={() => {}} />)
}

beforeEach(() => {
  resetMudavymShell()
  wines.mockReturnValue({ data: [], isFetching: false })
  persist.mockResolvedValue({
    added: [{ wineName: 'x' }],
    stockAdded: [],
    reactivated: [],
    provisional: [],
    failed: [],
  })
})
afterEach(() => vi.clearAllMocks())

describe('the pinned legacy string is the one the committed source ships', () => {
  it('ManualReceiptWorkspace', () => {
    const src = execFileSync(
      'git',
      ['show', 'origin/main:apps/web/src/components/inventory/ManualReceiptWorkspace.tsx'],
      { encoding: 'utf8', cwd: process.cwd() },
    )
    expect(src).toContain(LEGACY_CARD)
  })
})

describe('flag off — the legacy workspace, class string for class string', () => {
  it('renders the legacy card and no house overlay', () => {
    workspace()
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).not.toBeNull()
    expect(document.querySelector('.mdv-ovl')).toBeNull()
  })
})

describe('flag on — the house sheet', () => {
  beforeEach(() => claimMudavymShell(Symbol('inventory-page'), 'paper'))

  /* Fork F3, pinned: a sheet, not a route — and the wide one. */
  it('is a WIDE Sheet on the primitive, motion `tuck`, closed in words', () => {
    workspace()
    const root = document.querySelector('.mdv-ovl')
    expect(root?.getAttribute('data-shape')).toBe('sheet')
    expect(root?.getAttribute('data-wide')).toBe('true')
    expect(document.querySelector('[data-motion="tuck"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).toBeNull()
  })

  it('carries no seal — a resumable batch is not a single commitment', () => {
    workspace()
    expect(screen.queryByRole('button', { name: /Hold to/ })).toBeNull()
  })

  it('states its contract', () => {
    workspace()
    expect(
      screen.getByText(
        /Recording it writes one inventory line per row\. Leaving writes nothing\./,
      ),
    ).toBeTruthy()
  })

  it('an empty receipt is said in words, and the record control is unavailable', () => {
    workspace()
    expect(screen.getByText(/Nothing is on this receipt yet\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Record 0 bottles' })).toBeDisabled()
  })

  it('a line says what a blank cost means, and never treats it as zero', () => {
    wines.mockReturnValue({
      data: [{ id: 'w1', name: 'Öküzgözü', producer: 'Kavaklıdere', vintage: 2022 }],
      isFetching: false,
    })
    workspace()
    fireEvent.change(screen.getByLabelText('Add a line from the Master Wine Library'), {
      target: { value: 'Öküz' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Öküzgözü/ }))

    expect(screen.getByText('On this receipt — 1')).toBeTruthy()
    expect(screen.getByPlaceholderText('leave blank if unknown')).toBeTruthy()
    expect(
      screen.getByText(
        /A blank cost is written as unknown, never as zero\. A free sample is written as an explicit zero and excluded from average cost\./,
      ),
    ).toBeTruthy()
  })

  it('the totals line names what it summed and what it left out', () => {
    wines.mockReturnValue({
      data: [{ id: 'w1', name: 'Öküzgözü', producer: 'Kavaklıdere', vintage: 2022 }],
      isFetching: false,
    })
    workspace()
    fireEvent.change(screen.getByLabelText('Add a line from the Master Wine Library'), {
      target: { value: 'Öküz' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Öküzgözü/ }))
    expect(document.querySelector('.mdv-prov')?.textContent).toContain(
      'lines with a blank cost add nothing to that figure',
    )
  })

  it('writes the same payload the legacy branch writes', async () => {
    wines.mockReturnValue({
      data: [{ id: 'w1', name: 'Öküzgözü', producer: 'Kavaklıdere', vintage: 2022 }],
      isFetching: false,
    })
    workspace()
    fireEvent.change(screen.getByLabelText('Add a line from the Master Wine Library'), {
      target: { value: 'Öküz' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Öküzgözü/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Record 1 bottle' }))

    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1))
    const [lines, options] = persist.mock.calls[0]
    expect(lines[0]).toMatchObject({ wineId: 'w1', stockLive: 1 })
    expect(lines[0].costPerBottle).toBeUndefined()
    expect(options).toMatchObject({ source: 'manual_receipt' })
  })

  it('a refusal is its own state, and says nothing was recorded', async () => {
    persist.mockRejectedValue({ response: { status: 403, data: { message: 'forbidden' } } })
    wines.mockReturnValue({
      data: [{ id: 'w1', name: 'Öküzgözü', producer: 'Kavaklıdere', vintage: 2022 }],
      isFetching: false,
    })
    workspace()
    fireEvent.change(screen.getByLabelText('Add a line from the Master Wine Library'), {
      target: { value: 'Öküz' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Öküzgözü/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Record 1 bottle' }))

    await screen.findByText('Not permitted')
    expect(
      screen.getByText(/Nothing was recorded; every line below is unchanged\./),
    ).toBeTruthy()
  })

  it('a partial write leaves the refused lines on the paper with their reason', async () => {
    persist.mockResolvedValue({
      added: [],
      stockAdded: [],
      reactivated: [],
      provisional: [],
      failed: [{ index: 0, error: 'no zone with that id' }],
    })
    wines.mockReturnValue({
      data: [{ id: 'w1', name: 'Öküzgözü', producer: 'Kavaklıdere', vintage: 2022 }],
      isFetching: false,
    })
    workspace()
    fireEvent.change(screen.getByLabelText('Add a line from the Master Wine Library'), {
      target: { value: 'Öküz' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Öküzgözü/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Record 1 bottle' }))

    await screen.findByText('Not recorded')
    expect(screen.getByText(/Not saved — no zone with that id/)).toBeTruthy()
  })

  it('wears the page ground the portal was handed', () => {
    resetMudavymShell()
    claimMudavymShell(Symbol('inventory-charcoal'), 'charcoal')
    workspace()
    expect(document.querySelector('.mdv-ovl')?.getAttribute('data-ground')).toBe('charcoal')
  })
})
