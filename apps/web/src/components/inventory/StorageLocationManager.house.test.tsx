/**
 * "The zones" — both branches.
 *
 * Flag off, the legacy manager renders byte for byte as it shipped; the pinned
 * literal class string is asserted against `git show origin/main:<path>` so a
 * drift fails rather than skips. `hooks/useStorageLocations.test.tsx` already
 * covers the legacy branch's loading/unavailable wording and still passes.
 *
 * The regressions: a dead fetch and an empty cellar rendered the same; a delete
 * the server refused still removed the zone from the list; and a zone holding
 * bottles could be deleted out from under them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { StorageLocationManager } from './StorageLocationManager'
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround'

const hook = {
  locations: [] as unknown[],
  locationsLoading: false,
  locationsUnavailable: false,
  mappingsUnavailable: false,
  mappings: [] as unknown[],
  getLocationsWithActualCounts: () => hook.locations,
  assignWineToLocation: vi.fn(),
  assignWinesToLocations: vi.fn(),
  removeWineFromLocation: vi.fn(),
  addLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
  updateWineQuantityAtLocation: vi.fn(),
  getLocationStats: () => ({ totalUsed: 0 }),
  recalculateLocationCounts: vi.fn(),
  setLocations: vi.fn(),
  createLocationChecked: vi.fn(),
  updateLocationChecked: vi.fn(),
  deleteLocationChecked: vi.fn(),
}
vi.mock('../../hooks/useStorageLocations', () => ({
  useStorageLocations: () => hook,
}))

const LEGACY_CARD =
  'bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col'

const ZONE = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Cellar · rack A',
  capacity: 96,
  currentCount: 88,
  color: '#000',
  temperature: '13°C',
}

function manager() {
  return render(<StorageLocationManager isOpen onClose={() => {}} />)
}

beforeEach(() => {
  resetMudavymShell()
  hook.locations = [ZONE]
  hook.mappings = []
  hook.locationsLoading = false
  hook.locationsUnavailable = false
  hook.mappingsUnavailable = false
  hook.getLocationStats = () => ({ totalUsed: 88 })
  hook.getLocationsWithActualCounts = () => hook.locations
  hook.createLocationChecked.mockResolvedValue({ ok: true })
  hook.updateLocationChecked.mockResolvedValue({ ok: true })
  hook.deleteLocationChecked.mockResolvedValue({ ok: true })
})
afterEach(() => vi.clearAllMocks())

describe('the pinned legacy string is the one the committed source ships', () => {
  it('StorageLocationManager', () => {
    const src = execFileSync(
      'git',
      ['show', 'origin/main:apps/web/src/components/inventory/StorageLocationManager.tsx'],
      { encoding: 'utf8', cwd: process.cwd() },
    )
    expect(src).toContain(LEGACY_CARD)
  })
})

describe('flag off — the legacy manager, class string for class string', () => {
  it('renders the legacy card and no house overlay', () => {
    manager()
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).not.toBeNull()
    expect(document.querySelector('.mdv-ovl')).toBeNull()
  })
})

describe('flag on — the house sheet', () => {
  beforeEach(() => claimMudavymShell(Symbol('inventory-page'), 'paper'))

  it('is a Sheet on the primitive, motion `tuck`, closed in words', () => {
    manager()
    const root = document.querySelector('.mdv-ovl')
    expect(root?.getAttribute('data-shape')).toBe('sheet')
    expect(root?.getAttribute('data-wide')).toBeNull()
    expect(document.querySelector('[data-motion="tuck"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).toBeNull()
  })

  it('carries no seal — a zone is a place, not a ledger row', () => {
    manager()
    expect(screen.queryByRole('button', { name: /Hold to/ })).toBeNull()
  })

  /* THE REGRESSION — three answers, not one (ADR 0080). */
  it('a read still in flight is not an empty cellar', () => {
    hook.locationsLoading = true
    hook.locations = []
    manager()
    expect(screen.getByText(/Reading this tenant’s zones…/)).toBeTruthy()
    expect(screen.queryByText(/This house has no zones yet\./)).toBeNull()
  })

  it('a dead fetch is not an empty cellar, and says so', () => {
    hook.locationsUnavailable = true
    hook.locations = []
    manager()
    expect(screen.getByText('Not read')).toBeTruthy()
    expect(
      screen.getByText(/because nothing answered — not because the house has none/),
    ).toBeTruthy()
    expect(screen.queryByText(/This house has no zones yet\./)).toBeNull()
    // And there is nothing to press, because the house does not know the state.
    expect(screen.getByRole('button', { name: 'Add a zone' })).toBeDisabled()
  })

  it('a tenant with no zones is a claim the house is entitled to make', () => {
    hook.locations = []
    manager()
    expect(screen.getByText(/This house has no zones yet\./)).toBeTruthy()
  })

  it('a capacity nobody recorded is said in words, never a dash', () => {
    hook.locations = [{ ...ZONE, capacity: null }]
    manager()
    expect(screen.getByText(/capacity not recorded/)).toBeTruthy()
  })

  /* THE REGRESSION — a zone holding bottles is refused, not sealed. */
  it('refuses to delete a zone that is still holding bottles', () => {
    hook.mappings = [{ wineId: 'w1', locationId: ZONE.id, quantity: 88, assignedAt: '' }]
    manager()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(
      screen.getByText(
        /This zone is holding 88 bottles\. Move them first — deleting it would leave them recorded nowhere\./,
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Yes, delete/ })).toBeNull()
    expect(hook.deleteLocationChecked).not.toHaveBeenCalled()
  })

  it('deletes an empty zone through the awaited path', async () => {
    manager()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete Cellar · rack A' }))
    await vi.waitFor(() => expect(hook.deleteLocationChecked).toHaveBeenCalledWith(ZONE.id))
  })

  /* THE REGRESSION — a refused write no longer disappears silently. */
  it('a delete the server refused says so, and the list stays as the house has it', async () => {
    hook.deleteLocationChecked.mockResolvedValue({
      ok: false,
      message: 'zone is referenced by open lots',
    })
    manager()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete Cellar · rack A' }))

    await screen.findByText('Not written')
    expect(
      screen.getByText(
        /The zone was not deleted — zone is referenced by open lots\. The list below is as the house has it\./,
      ),
    ).toBeTruthy()
    expect(screen.getByText('Cellar · rack A')).toBeTruthy()
  })

  it('a refusal is its own state', async () => {
    hook.createLocationChecked.mockResolvedValue({
      ok: false,
      denied: true,
      message: 'forbidden',
    })
    manager()
    fireEvent.click(screen.getByRole('button', { name: 'Add a zone' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bar · back shelf' } })
    fireEvent.change(screen.getByLabelText('Bottles it holds'), { target: { value: '24' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create the zone' }))

    await screen.findByText('Not permitted')
    expect(
      screen.getByText(/not permitted to change the zones/),
    ).toBeTruthy()
  })

  it('a zone cannot be created without a capacity somebody counted', () => {
    manager()
    fireEvent.click(screen.getByRole('button', { name: 'Add a zone' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bar · back shelf' } })
    expect(screen.getByRole('button', { name: 'Create the zone' })).toBeDisabled()
    expect(
      screen.getByText(
        /there is no default: it is a number somebody counted or the zone is not created\./,
      ),
    ).toBeTruthy()
  })

  it('names the mappings its counts came from, and says when they are incomplete', () => {
    hook.mappingsUnavailable = true
    manager()
    const prov = document.querySelector('.mdv-prov')?.textContent ?? ''
    expect(prov).toContain('every count on this paper is summed from the')
    expect(prov).toContain('the mappings could not be read, so these counts are not complete')
  })

  /* THE REGRESSION found in a browser: the header summed the SERVER's
     per-zone `current_count` while every row under it was recomputed from the
     mappings, so the paper read "357 bottles placed" over three rows each
     saying "0 bottles". Two records printed as one. */
  it('sums the header from the same source as the rows, and names the disagreement', () => {
    // getLocationsWithActualCounts is mocked to return the raw zone (88), while
    // the stats stand in for the server's own figure (357).
    hook.getLocationsWithActualCounts = () => [{ ...ZONE, currentCount: 0 }]
    hook.getLocationStats = () => ({ totalUsed: 357 })
    manager()
    expect(screen.getByText('0 bottles placed')).toBeTruthy()
    expect(
      screen.getByText(/The zones themselves carry a server-side count of/),
    ).toBeTruthy()
    expect(screen.getByText(/Nothing here writes either one\./)).toBeTruthy()
  })

  it('says nothing about a disagreement when the two records agree', () => {
    hook.getLocationsWithActualCounts = () => [{ ...ZONE, currentCount: 88 }]
    hook.getLocationStats = () => ({ totalUsed: 88 })
    manager()
    expect(screen.getByText('88 bottles placed')).toBeTruthy()
    expect(screen.queryByText(/server-side count of/)).toBeNull()
  })

  it('wears the page ground the portal was handed', () => {
    resetMudavymShell()
    claimMudavymShell(Symbol('inventory-charcoal'), 'charcoal')
    manager()
    expect(document.querySelector('.mdv-ovl')?.getAttribute('data-ground')).toBe('charcoal')
  })
})
