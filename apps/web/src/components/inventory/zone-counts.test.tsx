/**
 * F-1331 — one shelf, one count. The Storage Locations dialog's count and its
 * "Wines stored here" list read the zone's live lots through the gateway, the
 * same rows a delivery or a Move writes, and so does the cellar floor. Before
 * this the dialog overwrote the gateway's number with the sum of
 * wine_location_mappings (written only by its own stepper) and listed those
 * mappings, so a received case showed 0 and "No wines assigned", and a Move
 * changed none of the three surfaces until something else refetched them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InventoryItem } from '../../pages/inventory/useInventoryPage'

const RESTAURANT = '11111111-1111-4111-8111-111111111111'
const RACK_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const RACK_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const BAROLO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SETTLE = { timeout: 5000 }

const mockGet = vi.hoisted(() => vi.fn())
const transferStock = vi.hoisted(() => vi.fn())
/** What the gateway counts on each rack's lots right now. */
const shelf = vi.hoisted(() => ({ a: 12, b: 0 }))

vi.mock('../../services/api/client', () => ({
  apiClient: { get: mockGet, put: vi.fn(), post: vi.fn(), request: vi.fn() },
  // An opened row mounts SoldOutControl (F-145), which reads the active house.
  getActiveRestaurantId: () => RESTAURANT,
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}))
vi.mock('../../contexts/AuthContext', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useAuth: () => ({ activeRestaurantId: RESTAURANT, isAuthenticated: true }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../stores', () => ({
  useNotificationStore: () => ({ success: vi.fn(), error: vi.fn() }),
}))
vi.mock('../../services/api/inventory', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/inventory')>(
    '../../services/api/inventory',
  )
  return {
    ...actual,
    transferStock,
    getItemActivity: vi.fn().mockResolvedValue({
      daily: [], heat: [], totalOut28d: 0, totalIn28d: 0, includes: { out: '', in: '', window: '' },
    }),
    fetchAuctionLotRecords: vi.fn().mockResolvedValue([]),
  }
})
vi.mock('../../services/api/orders', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/orders')>(
    '../../services/api/orders',
  )
  return { ...actual, getOrders: vi.fn().mockResolvedValue([]) }
})

import { StorageLocationManager } from './StorageLocationManager'
import FloorStrip from '../../pages/cellar/next/FloorStrip'
import { RowExpansion } from '../../pages/inventory/command/RowExpansion'

const wineRow = (qty: number) => (qty > 0 ? [{ wineId: BAROLO, wineName: 'Barolo', producer: '', vintage: null, quantity: qty }] : [])
const floorZone = (id: string, name: string, n: number) => ({
  id, name, zone: name, section: null, capacityBottles: 60, itemsAssigned: n,
  confirmedAt: '2026-10-01T10:00:00Z', confirmedBy: null, provenance: 'confirmed',
})

/** The gateway: zones and wines from the lots, plus a mapping that disagrees. */
function gateway() {
  mockGet.mockImplementation((url: string) => {
    if (url === `/storage-locations/${RESTAURANT}`) {
      return Promise.resolve({
        data: [
          { id: RACK_A, name: 'Rack A', capacity: 60, current_count: shelf.a, color: '#be123c' },
          { id: RACK_B, name: 'Rack B', capacity: 60, current_count: shelf.b, color: '#f59e0b' },
        ],
      })
    }
    // A stale filing the old stepper wrote: 3 on Rack B. Not a bottle.
    if (url.endsWith('/mappings')) {
      return Promise.resolve({ data: [{ wineId: BAROLO, locationId: RACK_B, quantity: 3, assignedAt: '' }] })
    }
    if (url.endsWith(`/locations/${RACK_A}/wines`)) return Promise.resolve({ data: wineRow(shelf.a) })
    if (url.endsWith(`/locations/${RACK_B}/wines`)) return Promise.resolve({ data: wineRow(shelf.b) })
    if (url === `/cellar/${RESTAURANT}/zones`) {
      return Promise.resolve({
        data: {
          restaurantId: RESTAURANT,
          confirmed: [floorZone(RACK_A, 'Rack A', shelf.a), floorZone(RACK_B, 'Rack B', shelf.b)],
          unconfirmed: [],
          counts: { confirmed: 2, unconfirmed: 0, total: 2 },
          readable: true, reason: null, confirmable: true, scopeNote: '',
        },
      })
    }
    if (url.endsWith('/setup-access')) {
      return Promise.resolve({ data: { mine: { allowed: true, via: 'house_role' }, assigned: null } })
    }
    return Promise.resolve({ data: [] })
  })
}

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const zoneRow = (name: string) => screen.getByTestId(`zone-row-${name}`)
const floorCount = (id: string) => screen.getByTestId(`zone-${id}`).querySelector('.cl-zone-n')?.textContent

beforeEach(() => {
  mockGet.mockReset()
  transferStock.mockReset()
  shelf.a = 12
  shelf.b = 0
  gateway()
})

describe('F-1331 — the dialog reads the lots', () => {
  it("a received case shows on the zone's count and in 'Wines stored here'", async () => {
    render(wrap(<StorageLocationManager isOpen onClose={() => {}} />))
    expect(await screen.findByText('12/60', undefined, SETTLE)).toBeInTheDocument()
    // Not the stale mapping's 3 on Rack B.
    expect(within(zoneRow('Rack B')).getByText('0/60')).toBeInTheDocument()

    fireEvent.click(within(zoneRow('Rack A')).getByText('Wines stored here'))
    const list = await within(zoneRow('Rack A')).findByText('Barolo', undefined, SETTLE)
    expect(list.closest('div.flex')).toHaveTextContent('12')
  })

  it('the in-zone stepper and Assign picker are gone; it says how bottles move', async () => {
    render(wrap(<StorageLocationManager isOpen onClose={() => {}} />))
    fireEvent.click(await screen.findByText('Rack A', undefined, SETTLE))
    expect(await screen.findByTestId(`zone-wine-qty-${BAROLO}`, undefined, SETTLE)).toHaveTextContent('12')
    expect(screen.queryByTitle('Increase quantity')).toBeNull()
    expect(screen.queryByTitle('Decrease quantity')).toBeNull()
    expect(screen.queryByRole('button', { name: /^assign$/i })).toBeNull()
    expect(screen.getByTestId('zone-wines-how')).toHaveTextContent(/use its Locations/)
    expect(screen.queryByText('Updated via wine movements')).toBeNull()
  })
})

describe('F-1331 — a transfer moves the number on all three surfaces', () => {
  it('Move 5 from Rack A to Rack B: the dialog count, its wine list and the floor all follow', async () => {
    const locations = [
      { id: RACK_A, name: 'Rack A', capacity: 60, currentCount: 12, color: '#be123c' },
      { id: RACK_B, name: 'Rack B', capacity: 60, currentCount: 0, color: '#f59e0b' },
    ]
    const item = {
      id: BAROLO, inventoryId: 'inv-1', name: 'Barolo', producer: '', price: 40, liveStock: 12, shadowStock: 0,
      threshold: 2, bottleSizeMl: 750, isActive: true, aromas: [], flavors: [],
      locations: [{ locationId: RACK_A, qty: 12, wac: null }],
    } as unknown as InventoryItem
    transferStock.mockImplementation(async () => {
      // What transfer_stock does to the lots; the gateway now counts this.
      shelf.a = 7
      shelf.b = 5
      return {}
    })

    render(
      wrap(
        <>
          <StorageLocationManager isOpen onClose={() => {}} />
          <FloorStrip />
          <RowExpansion item={item} locations={locations} />
        </>,
      ),
    )
    expect(await screen.findByText('12/60', undefined, SETTLE)).toBeInTheDocument()
    fireEvent.click(within(zoneRow('Rack A')).getByText('Wines stored here'))
    expect(await within(zoneRow('Rack A')).findByText('Barolo', undefined, SETTLE)).toBeInTheDocument()
    await waitFor(() => expect(floorCount(RACK_A)).toBe('12'), SETTLE)

    await userEvent.click(screen.getByTitle('Click to move bottles between locations'))
    const [from, to] = screen.getAllByRole('combobox').slice(-2)
    await userEvent.selectOptions(from, RACK_A)
    await userEvent.selectOptions(to, RACK_B)
    const qty = screen.getAllByRole('spinbutton').at(-1)!
    await userEvent.clear(qty)
    await userEvent.type(qty, '5')
    await userEvent.click(screen.getByRole('button', { name: /^move$/i }))
    expect(transferStock).toHaveBeenCalled()

    // The dialog's count, its "Wines stored here" and the floor, with no reload.
    expect(await within(zoneRow('Rack A')).findByText('7/60', undefined, SETTLE)).toBeInTheDocument()
    expect(within(zoneRow('Rack B')).getByText('5/60')).toBeInTheDocument()
    await waitFor(
      () => expect(within(zoneRow('Rack A')).getByText('Barolo').closest('div.flex')).toHaveTextContent('7'),
      SETTLE,
    )
    await waitFor(() => expect(floorCount(RACK_A)).toBe('7'), SETTLE)
    expect(floorCount(RACK_B)).toBe('5')
  })
})
