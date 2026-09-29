/**
 * ADR 0238 — zone setup is for owners, managers and the people they assign.
 * The founder, 2026-09-29, verbatim: "managers/owners+ the people they
 * assign". The gateway refuses a setup write with a 403 (PR #518); these
 * pages must not offer a control that would be refused, must say why in
 * words, and must leave placing and counting wines alone (OD-200).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockGet = vi.hoisted(() => vi.fn())
const mockPut = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
const mockRequest = vi.hoisted(() => vi.fn())
const zones = vi.hoisted(() => ({ current: null as unknown }))
const confirmZone = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('../../services/api/client', () => ({
  apiClient: { get: mockGet, put: mockPut, post: mockPost, request: mockRequest },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: RESTAURANT,
    isAuthenticated: true,
  }),
}))
vi.mock('../../pages/cellar/next/useCellarNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useZones: () => zones.current,
  useConfirmZone: () => confirmZone.current,
}))

import { StorageLocationManager } from './StorageLocationManager'
import FloorStrip from '../../pages/cellar/next/FloorStrip'
import { MemberSheet } from '../../pages/team/next/RosterSheet'

const RESTAURANT = '11111111-1111-4111-8111-111111111111'
const ZONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const STAFF_USER = '0c000000-0000-4000-8000-00000000000c'
const SETTLE = { timeout: 5000 }

type Access = { mine: { allowed: boolean; via: string | null }; assigned: string[] | null }

/** Routes GETs by URL: the zones, no mappings, and the setup answer given. */
function gateway(access: Access | Error) {
  mockGet.mockImplementation((url: string) => {
    if (url.endsWith('/setup-access')) {
      return access instanceof Error ? Promise.reject(access) : Promise.resolve({ data: access })
    }
    if (url.endsWith('/mappings')) return Promise.resolve({ data: [] })
    if (url === `/storage-locations/${RESTAURANT}`) {
      return Promise.resolve({
        data: [{ id: ZONE, name: 'Back cellar', capacity: 40, current_count: 0, color: '#be123c' }],
      })
    }
    return Promise.resolve({ data: [] })
  })
}

const STAFF: Access = { mine: { allowed: false, via: null }, assigned: null }
const ASSIGNED: Access = { mine: { allowed: true, via: 'assigned' }, assigned: null }
const MANAGER: Access = { mine: { allowed: true, via: 'house_role' }, assigned: [STAFF_USER] }

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  mockGet.mockReset()
  mockPut.mockReset()
})

describe('the zone manager offers setup only to those who may set up zones', () => {
  it('a staff member nobody assigned sees no add, delete or save, and is told why', async () => {
    gateway(STAFF)
    render(wrap(<StorageLocationManager isOpen onClose={() => {}} />))
    expect(await screen.findByText('Back cellar', undefined, SETTLE)).toBeInTheDocument()
    expect(
      await screen.findByTestId('zone-setup-note', undefined, SETTLE),
    ).toHaveTextContent(/owners, managers and the people they assign\. You can place and count wines/)
    expect(screen.queryByRole('button', { name: /add location/i })).toBeNull()
    expect(screen.queryByTitle('Delete location')).toBeNull()

    // Opening the zone still shows it, and its wines, with the setup read-only.
    fireEvent.click(screen.getByText('Back cellar'))
    expect(screen.getByTestId('zone-setup-fields')).toBeDisabled()
    expect(screen.getByPlaceholderText('e.g., Main Cellar')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull()
    expect(screen.getByText('Stored Wines')).toBeInTheDocument()
  })

  it('a staff member an owner or manager assigned gets the controls', async () => {
    gateway(ASSIGNED)
    render(wrap(<StorageLocationManager isOpen onClose={() => {}} />))
    expect(
      await screen.findByRole('button', { name: /add location/i }, SETTLE),
    ).toBeInTheDocument()
    expect(screen.getByTitle('Delete location')).toBeInTheDocument()
    expect(screen.queryByTestId('zone-setup-note')).toBeNull()
    fireEvent.click(screen.getByText('Back cellar'))
    expect(screen.getByTestId('zone-setup-fields')).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument()
  })

  it('an unread answer offers nothing and says it could not be read', async () => {
    gateway(new Error('gateway down'))
    render(wrap(<StorageLocationManager isOpen onClose={() => {}} />))
    expect(
      await screen.findByTestId('zone-setup-note', undefined, SETTLE),
    ).toHaveTextContent(/could not be read/)
    expect(screen.queryByRole('button', { name: /add location/i })).toBeNull()
  })
})

describe('the cellar floor offers a rename only to those who may set up zones', () => {
  const zone = {
    id: 'z1',
    name: 'Wine Cellar',
    zone: 'Wine Cellar',
    section: null,
    capacityBottles: 500,
    itemsAssigned: 17,
    confirmedAt: null,
    confirmedBy: null,
    provenance: 'unconfirmed',
  }
  beforeEach(() => {
    zones.current = {
      data: {
        restaurantId: RESTAURANT,
        confirmed: [],
        unconfirmed: [zone],
        counts: { confirmed: 0, unconfirmed: 1, total: 1 },
        readable: true,
        reason: null,
        confirmable: true,
        scopeNote: 'note',
      },
      loading: false,
      error: null,
    }
    confirmZone.current = { confirm: vi.fn(), saving: false, error: null }
  })

  it('staff nobody assigned may confirm the name as it stands, not rename it', async () => {
    gateway(STAFF)
    render(wrap(<FloorStrip />))
    fireEvent.click(screen.getByTestId('floor-confirm-open'))
    expect(
      await screen.findByTestId('floor-rename-note', undefined, SETTLE),
    ).toHaveTextContent(/Renaming a zone is for owners, managers and the people they assign/)
    expect(screen.getByLabelText(/Name for Wine Cellar/)).toHaveAttribute('readonly')
    fireEvent.click(screen.getByTestId('zone-confirm-z1'))
    expect((confirmZone.current as { confirm: ReturnType<typeof vi.fn> }).confirm).toHaveBeenCalledWith({
      zoneId: 'z1',
    })
  })

  it('a manager may rename', async () => {
    gateway(MANAGER)
    render(wrap(<FloorStrip />))
    fireEvent.click(screen.getByTestId('floor-confirm-open'))
    await waitFor(() =>
      expect(screen.getByLabelText(/Name for Wine Cellar/)).not.toHaveAttribute('readonly'),
    )
    expect(screen.queryByTestId('floor-rename-note')).toBeNull()
  })
})

describe('the roster sheet carries the zone switch for an owner or manager', () => {
  const staffMember = {
    id: 'm-staff',
    restaurant_id: RESTAURANT,
    user_id: STAFF_USER,
    display_name: 'Sam',
    email: null,
    phone: null,
    avatar_url: null,
    position: 'Sommelier',
    employment_type: 'full_time',
    home_location: null,
    hourly_wage: null,
    skills: [],
    hire_date: null,
    status: 'active',
    notes: null,
    role: 'staff',
    accountLinked: true,
  }
  const sheet = () =>
    render(
      wrap(
        <MemberSheet
          member={staffMember as never}
          moneyVisible={false}
          ownerCount={1}
          onClose={() => {}}
          onChanged={() => {}}
        />,
      ),
    )

  it('shows the switch on a staff member, in its state, and withdraws it', async () => {
    gateway(MANAGER)
    mockPut.mockResolvedValue({
      data: { userId: STAFF_USER, allowed: false, changed: true, audited: true, notified: true },
    })
    sheet()
    const box = await screen.findByRole('checkbox', { name: 'Sets up storage zones' }, SETTLE)
    expect(box).toBeChecked()
    fireEvent.click(box)
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith(
        `/storage-locations/${RESTAURANT}/setup-access/${STAFF_USER}`,
        { allowed: false },
      ),
    )
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Sets up storage zones' })).not.toBeChecked(),
    )
  })

  it('offers no switch to a viewer the gateway does not list the assigned to', async () => {
    gateway(ASSIGNED)
    sheet()
    await waitFor(() => expect(mockGet).toHaveBeenCalled())
    expect(screen.queryByTestId('zone-setup-access')).toBeNull()
  })
})
