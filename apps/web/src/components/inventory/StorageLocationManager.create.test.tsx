/**
 * PR #510 audit (2026-09-29): creating a zone closed the form and wiped the
 * input on click, before the server answered, so a refused create looked
 * created and lost what the person typed. And the create form offered a
 * parent picker although the gateway refuses every stated parent with a 422
 * (storage_locations has no parent column yet).
 *
 * The form must stay open with its input until the create is confirmed, and
 * the parent picked on the form is sent with the create (F-1330).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const addLocation = vi.hoisted(() => vi.fn())
const zones = vi.hoisted(() => ({ list: [] as unknown[] }))

vi.mock('../../hooks/useStorageLocations', () => ({
  useStorageLocations: () => ({
    locations: zones.list,
    locationsLoading: false,
    locationsUnavailable: false,
    getLocationsWithActualCounts: () => zones.list,
    mappings: [],
    assignWineToLocation: vi.fn(),
    removeWineFromLocation: vi.fn(),
    addLocation,
    updateLocation: vi.fn(),
    deleteLocation: vi.fn(),
    updateWineQuantityAtLocation: vi.fn(),
    getLocationStats: () => ({
      totalLocations: 0,
      totalCapacity: null,
      totalUsed: 0,
      utilizationRate: null,
      capacityUnknownCount: 0,
    }),
    recalculateLocationCounts: vi.fn(),
    setLocations: vi.fn(),
  }),
  // ADR 0238: an owner or manager (the create controls are offered).
  useZoneSetupAccess: () => ({ maySetUp: true, unknown: false, loading: false, assigned: null }),
}))

import { StorageLocationManager } from './StorageLocationManager'

function openCreateForm() {
  render(React.createElement(StorageLocationManager, { isOpen: true, onClose: vi.fn() }))
  fireEvent.click(screen.getByRole('button', { name: /Add Location/ }))
  fireEvent.change(screen.getByPlaceholderText('e.g., Main Cellar'), {
    target: { value: 'Back Cellar' },
  })
  fireEvent.change(screen.getByPlaceholderText(/Required/), { target: { value: '24' } })
}

const CELLAR = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Main Cellar',
  capacity: 200,
  currentCount: 0,
  color: '#be123c',
}

beforeEach(() => {
  addLocation.mockReset()
  zones.list = []
})

describe('zone create waits for the server', () => {
  it('a refused create keeps the form open with what was typed', async () => {
    addLocation.mockResolvedValue(null)
    openCreateForm()
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }))
    await waitFor(() => expect(addLocation).toHaveBeenCalledTimes(1))
    // Let the refused promise settle, then the form must still be there.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Create$/ })).not.toBeDisabled(),
    )
    expect(screen.getByPlaceholderText('e.g., Main Cellar')).toHaveValue('Back Cellar')
  })

  it('a stored create closes the form', async () => {
    addLocation.mockResolvedValue({ id: 'z1', name: 'Back Cellar' })
    openCreateForm()
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }))
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('e.g., Main Cellar')).not.toBeInTheDocument(),
    )
  })

  // #510 hid the parent picker on create because storage_locations had no
  // parent column; #515 (founder 2026-09-29, "Add parent column") stores
  // parent_id, so the create form offers it. Left empty, it sends none.
  it('the create form offers a parent, and sends none when it is left empty', async () => {
    addLocation.mockResolvedValue(null)
    openCreateForm()
    expect(screen.getByText('Parent Location')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }))
    await waitFor(() => expect(addLocation).toHaveBeenCalledTimes(1))
    expect(addLocation.mock.calls[0][0].parentId ?? undefined).toBeUndefined()
  })
})

// F-1330: the create form offered a parent and dropped it, so a zone made
// "inside" another was stored at the top level with nothing said.
describe('a zone created inside another keeps its parent', () => {
  it('the picked parent is sent with the create', async () => {
    zones.list = [CELLAR]
    addLocation.mockResolvedValue({ id: 'z2', name: 'Back Cellar' })
    openCreateForm()
    fireEvent.change(screen.getByDisplayValue('None (top-level)'), {
      target: { value: CELLAR.id },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }))
    await waitFor(() => expect(addLocation).toHaveBeenCalledTimes(1))
    expect(addLocation.mock.calls[0][0]).toMatchObject({ parentId: CELLAR.id })
  })
})

// F-1332: every field on the form is one the zone keeps.
describe('the zone form offers only what is saved', () => {
  it('no description box; humidity is a controlled/not choice that is sent', async () => {
    addLocation.mockResolvedValue(null)
    openCreateForm()
    expect(screen.queryByPlaceholderText('Brief description...')).toBeNull()
    expect(screen.queryByPlaceholderText('e.g., 70%')).toBeNull()
    fireEvent.change(screen.getByDisplayValue('Not stated'), {
      target: { value: 'Controlled' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }))
    await waitFor(() => expect(addLocation).toHaveBeenCalledTimes(1))
    expect(addLocation.mock.calls[0][0]).toMatchObject({ humidity: 'Controlled' })
    expect(addLocation.mock.calls[0][0]).not.toHaveProperty('description')
  })
})

// F-1335: the grip only reordered the cached list and was offered to every
// member; nothing saved the order, so it is gone.
describe('zones offer no drag-to-reorder', () => {
  it('a zone row has no grip', () => {
    zones.list = [CELLAR]
    render(React.createElement(StorageLocationManager, { isOpen: true, onClose: vi.fn() }))
    expect(screen.getByTestId('zone-row-Main Cellar')).toBeInTheDocument()
    expect(screen.queryByTitle('Drag to reorder')).toBeNull()
    expect(document.querySelector('[draggable="true"]')).toBeNull()
  })
})

// F-1336: on a phone the two halves stack; side by side from md up.
describe('the dialog stacks on a narrow screen', () => {
  it('the columns are a column below md and a row from md', () => {
    render(React.createElement(StorageLocationManager, { isOpen: true, onClose: vi.fn() }))
    const cols = screen.getByTestId('zone-manager-columns')
    expect(cols.className).toMatch(/(^|\s)flex-col(\s|$)/)
    expect(cols.className).toMatch(/md:flex-row/)
    for (const child of Array.from(cols.children)) {
      expect(child.className).toMatch(/(^|\s)w-full(\s|$)/)
      expect(child.className).toMatch(/md:w-1\/2/)
      expect(child.className).not.toMatch(/(^|\s)w-1\/2(\s|$)/)
    }
  })
})
