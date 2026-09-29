/**
 * PR #510 audit (2026-09-29): creating a zone closed the form and wiped the
 * input on click, before the server answered, so a refused create looked
 * created and lost what the person typed. And the create form offered a
 * parent picker although the gateway refuses every stated parent with a 422
 * (storage_locations has no parent column yet).
 *
 * The form must stay open with its input until the create is confirmed, and
 * a create must never offer (or send) a parent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const addLocation = vi.hoisted(() => vi.fn())

vi.mock('../../hooks/useStorageLocations', () => ({
  useStorageLocations: () => ({
    locations: [],
    locationsLoading: false,
    locationsUnavailable: false,
    getLocationsWithActualCounts: () => [],
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

beforeEach(() => {
  addLocation.mockReset()
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

  it('the create form offers no parent and sends none', async () => {
    addLocation.mockResolvedValue(null)
    openCreateForm()
    expect(screen.queryByText('Parent Location')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }))
    await waitFor(() => expect(addLocation).toHaveBeenCalledTimes(1))
    expect(addLocation.mock.calls[0][0]).not.toHaveProperty('parentId')
  })
})
