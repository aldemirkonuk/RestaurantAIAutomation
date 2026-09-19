/**
 * "Carry this bottle" — both branches.
 *
 * Flag off, the legacy modal renders byte for byte as it shipped; the pinned
 * literal class string is asserted against `git show origin/main:<path>` so a
 * drift fails rather than skips. `AddWineToInventoryModal.cost.test.tsx`
 * already covers the legacy branch's three cost outcomes and still passes.
 *
 * The regressions this file carries: the three cost outcomes were correct on
 * the wire and invisible on the paper, and the zone picker rendered an empty
 * list whether the tenant had no zones or the read had failed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AddWineToInventoryModal } from './AddWineToInventoryModal'
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('../wines/AddWineModal', () => ({ AddWineModal: () => <div data-testid="label-reader" /> }))
vi.mock('../scanner/MenuScannerFlow', () => ({
  MenuScannerFlow: () => <div data-testid="menu-reader" />,
}))

const wines = vi.fn()
vi.mock('../../hooks/queries', () => ({ useWines: (...a: unknown[]) => wines(...a) }))

const zones = {
  locations: [{ id: 'l1', name: 'Cellar · rack A', capacity: 96, currentCount: 0, color: '#000' }],
  locationsLoading: false,
  locationsUnavailable: false,
}
vi.mock('../../hooks/useStorageLocations', () => ({
  useStorageLocations: () => zones,
}))

const LEGACY_CARD =
  'bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col'

const LIBRARY_WINE = {
  id: 'mw1',
  name: 'Öküzgözü',
  producer: 'Kavaklıdere',
  vintage: 2022,
  region: 'Elazığ',
  country: 'Türkiye',
  grape: 'Öküzgözü',
  type: 'red',
  price: 713,
}

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>)
}

function sheet(onAddWine = vi.fn()) {
  return {
    onAddWine,
    ...wrap(<AddWineToInventoryModal isOpen onClose={() => {}} onAddWine={onAddWine} />),
  }
}

function pick() {
  fireEvent.click(screen.getByRole('button', { name: /Öküzgözü/ }))
}

beforeEach(() => {
  resetMudavymShell()
  zones.locationsLoading = false
  zones.locationsUnavailable = false
  wines.mockReturnValue({ data: [LIBRARY_WINE] })
})
afterEach(() => vi.clearAllMocks())

describe('the pinned legacy string is the one the committed source ships', () => {
  it('AddWineToInventoryModal', () => {
    const src = execFileSync(
      'git',
      ['show', 'origin/main:apps/web/src/components/inventory/AddWineToInventoryModal.tsx'],
      { encoding: 'utf8', cwd: process.cwd() },
    )
    expect(src).toContain(LEGACY_CARD)
  })
})

describe('flag off — the legacy modal, class string for class string', () => {
  it('renders the legacy card and no house overlay', () => {
    sheet()
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).not.toBeNull()
    expect(document.querySelector('.mdv-ovl')).toBeNull()
  })
})

describe('flag on — the house sheet', () => {
  beforeEach(() => claimMudavymShell(Symbol('inventory-page'), 'paper'))

  it('is a Sheet on the primitive, motion `tuck`, closed in words', () => {
    sheet()
    const root = document.querySelector('.mdv-ovl')
    expect(root?.getAttribute('data-shape')).toBe('sheet')
    expect(root?.getAttribute('data-wide')).toBeNull()
    expect(document.querySelector('[data-motion="tuck"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).toBeNull()
  })

  it('carries no seal — adding a bottle is additive', () => {
    sheet()
    expect(screen.queryByRole('button', { name: /Hold to/ })).toBeNull()
  })

  /* The census's sentence: three ways to start, one sheet. */
  it('offers all three starts on one sheet', () => {
    sheet()
    expect(screen.getByRole('button', { name: 'Search the library' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Read a label' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Read a menu' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Read a label' }))
    expect(screen.getByTestId('label-reader')).toBeTruthy()
  })

  it('the search result count names what it counted', () => {
    sheet()
    expect(document.querySelector('.mdv-prov')?.textContent).toContain(
      '1 of the first 200 library rows match',
    )
  })

  /* THE REGRESSION — the three cost outcomes, said on the paper. */
  it('a blank cost is stated as "no cost recorded", never as zero', () => {
    sheet()
    pick()
    expect(
      screen.getByText(
        /Left blank: this bottle is recorded with NO cost and no provenance/,
      ),
    ).toBeTruthy()
    expect(screen.getByLabelText('Cost a bottle')).toHaveValue('')
  })

  it('a free sample is stated as a deliberate zero excluded from average cost', () => {
    sheet()
    pick()
    fireEvent.click(screen.getByRole('button', { name: 'Free sample' }))
    expect(
      screen.getByText(
        /Recorded as a deliberate zero with provenance “sample”, and excluded from average cost\./,
      ),
    ).toBeTruthy()
  })

  it('a typed cost is stated as the cost this house paid', () => {
    sheet()
    pick()
    fireEvent.change(screen.getByLabelText('Cost a bottle'), { target: { value: '640' } })
    expect(
      screen.getByText(/Recorded as the cost this house paid, with provenance “manual”\./),
    ).toBeTruthy()
  })

  it("the library's reference price is offered, never pre-filled", () => {
    sheet()
    pick()
    expect(screen.getByLabelText('Cost a bottle')).toHaveValue('')
    const offer = screen.getByRole('button', { name: /reference price is 713/ })
    fireEvent.click(offer)
    expect(screen.getByLabelText('Cost a bottle')).toHaveValue('713')
  })

  it('sends the three cost shapes the API distinguishes', () => {
    const { onAddWine } = sheet()
    pick()
    fireEvent.click(screen.getByRole('button', { name: 'Carry 1 bottle' }))
    expect(onAddWine).toHaveBeenCalledTimes(1)
    // Blank: the key is OMITTED, so the API writes NULL and no provenance.
    expect(Object.keys(onAddWine.mock.calls[0][4])).not.toContain('costPerBottle')
  })

  /* THE REGRESSION — an unreadable zone list is not an empty one. */
  it('a zone read that failed says so, and does not offer an empty picker', () => {
    zones.locationsUnavailable = true
    sheet()
    pick()
    expect(
      screen.getByText(
        /The zones could not be read, so none can be offered here\. The bottle can still be carried and placed later/,
      ),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Zone')).toBeNull()
  })

  it('an unplaced bottle is an offered state, not an omission', () => {
    sheet()
    pick()
    expect(screen.getByRole('option', { name: 'Not placed yet' })).toBeTruthy()
  })

  it('a library that matches nothing says what to do instead', () => {
    wines.mockReturnValue({ data: [] })
    sheet()
    fireEvent.change(screen.getByLabelText('Search the Master Wine Library'), {
      target: { value: 'zzz' },
    })
    expect(
      screen.getByText(/Read the label instead and the house will carry it as a provisional entry\./),
    ).toBeTruthy()
  })

  it('going back to the list keeps the search', () => {
    sheet()
    fireEvent.change(screen.getByLabelText('Search the Master Wine Library'), {
      target: { value: 'Öküz' },
    })
    pick()
    fireEvent.click(screen.getByRole('button', { name: 'Choose a different bottle' }))
    expect(screen.getByLabelText('Search the Master Wine Library')).toHaveValue('Öküz')
  })

  it('wears the page ground the portal was handed', () => {
    resetMudavymShell()
    claimMudavymShell(Symbol('inventory-charcoal'), 'charcoal')
    sheet()
    expect(document.querySelector('.mdv-ovl')?.getAttribute('data-ground')).toBe('charcoal')
  })
})
