import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ReceivingHome from './ReceivingHome'

/**
 * The staff view is the entrance to the door flow, and it used to fail into a reassuring
 * empty state: it asked for `status=SENT`, which is not a `ProcurementOrderStatus`, got a 400
 * from the gateway's `forbidNonWhitelisted` pipe, and rendered "nothing is out for delivery".
 * Then it unwrapped `data.items` from an endpoint that returns `data.orders`, so even a
 * successful call rendered nothing.
 *
 * These tests pin all three: the status is a real enum member, the unwrap matches the payload,
 * and a failed fetch is visibly a failure.
 */

const get = vi.hoisted(() => vi.fn())
vi.mock('../../services/api/client', () => ({ apiClient: { get } }))

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

// Anything unrecognised falls to the staff view, but say so explicitly: the role decides
// which of the three renderings mounts, and the manager/owner views call other endpoints.
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'u1', restaurantId: 'r1', role: 'staff' } }),
}))

/** `GET /procurement/orders` returns `OrderListResponseDto` — `orders`, never `items`. */
const orderListPayload = (orders: unknown[]) => ({
  data: { orders, total: orders.length, page: 1, limit: 25, hasMore: false },
})

function renderStaffView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReceivingHome />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Every `status` this page asked the gateway for, across all its requests. */
const requestedStatuses = () =>
  get.mock.calls
    .filter(([url]) => url === '/procurement/orders')
    .map(([, config]) => config?.params?.status)

/**
 * An order holds exactly one status, so the two requests this page makes are disjoint in
 * production. Serve a row under one status only, or the same delivery renders twice and the
 * assertions below start failing on a duplicate the real API cannot produce.
 */
const onlyForStatus = (status: string, orders: unknown[]) =>
  async (_url: string, config: any) =>
    orderListPayload(config?.params?.status === status ? orders : [])

/** Walk up from the test runner's cwd to the monorepo root, whatever it happens to be. */
const repoFile = (relative: string) => {
  let dir = process.cwd()
  for (let i = 0; i < 6; i += 1) {
    const candidate = resolve(dir, relative)
    if (existsSync(candidate)) return candidate
    dir = dirname(dir)
  }
  throw new Error(`could not locate ${relative} above ${process.cwd()}`)
}

describe('ReceivingHome — staff view', () => {
  beforeEach(() => {
    get.mockReset()
    navigate.mockReset()
  })

  /**
   * Read the enum out of the gateway source rather than restating it here. A literal copy of
   * the members would agree with itself forever; this fails the moment the API's enum changes
   * out from under the page, which is the failure that broke /receiving in the first place.
   */
  it('only asks for statuses that exist in the gateway ProcurementOrderStatus enum', async () => {
    const dtoPath = repoFile('apps/api-gateway/src/procurement/dto/procurement.dto.ts')
    const source = readFileSync(dtoPath, 'utf8')
    const body = source.slice(
      source.indexOf('export enum ProcurementOrderStatus {'),
      source.indexOf('}', source.indexOf('export enum ProcurementOrderStatus {')),
    )
    const members = [...body.matchAll(/^\s*(\w+)\s*=\s*"([^"]+)"/gm)].map((m) => m[2])

    // Guard the guard: if the parse ever silently yields nothing, the assertions below pass
    // vacuously and this test stops protecting anything.
    expect(members.length).toBeGreaterThan(5)
    expect(members).not.toContain('SENT')

    get.mockResolvedValue(orderListPayload([]))
    renderStaffView()
    await waitFor(() => expect(get).toHaveBeenCalled())

    const asked = requestedStatuses()
    expect(asked.length).toBeGreaterThan(0)
    for (const status of asked) expect(members).toContain(status)
    expect(asked).not.toContain('SENT')
  })

  it('asks for the in-flight statuses — placed with the vendor, not yet received', async () => {
    get.mockResolvedValue(orderListPayload([]))
    renderStaffView()

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    expect(requestedStatuses().sort()).toEqual(['CONFIRMED', 'IN_TRANSIT'])
    // The status the door flow itself writes on success must never be offered back.
    expect(requestedStatuses()).not.toContain('PARTIALLY_RECEIVED')
  })

  it('renders the deliveries from `orders`, the key the endpoint actually returns', async () => {
    get.mockImplementation(async (_url: string, config: any) =>
      config?.params?.status === 'IN_TRANSIT'
        ? orderListPayload([
            {
              id: 'ord-in-transit',
              orderNumber: 'PO-2001',
              quantity: 12,
              wineName: 'Produttori Barbaresco 2019',
              requestedAt: '2026-08-26T09:00:00.000Z',
            },
          ])
        : orderListPayload([
            {
              id: 'ord-confirmed',
              orderNumber: 'PO-2000',
              quantity: 6,
              wineName: 'Chablis 1er Cru',
              requestedAt: '2026-08-25T09:00:00.000Z',
            },
          ]),
    )

    renderStaffView()

    expect(await screen.findByText('PO-2001 · 12 bottles expected')).toBeInTheDocument()
    expect(screen.getByText('PO-2000 · 6 bottles expected')).toBeInTheDocument()
    expect(screen.queryByText('Nothing is out for delivery right now.')).not.toBeInTheDocument()
  })

  it('unwrapping `items` would render nothing — the old shape must not resurrect', async () => {
    // The exact payload the page used to be written against. If someone reverts the unwrap,
    // this stops being an empty list and starts being a failure.
    get.mockResolvedValue({ data: { items: [{ id: 'ord-1', orderNumber: 'PO-9' }] } })
    renderStaffView()

    expect(
      await screen.findByText('Nothing is out for delivery right now.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/PO-9/)).not.toBeInTheDocument()
  })

  it('opens the door flow for the tapped delivery', async () => {
    get.mockImplementation(
      onlyForStatus('IN_TRANSIT', [
        { id: 'ord-7', orderNumber: 'PO-7', quantity: 4, wineName: 'Muscadet' },
      ]),
    )
    renderStaffView()

    await userEvent.click(await screen.findByRole('button', { name: /PO-7/ }))
    expect(navigate).toHaveBeenCalledWith('/receiving/ord-7/door')
  })

  describe('when the request fails', () => {
    it('shows an error, not "nothing is out for delivery"', async () => {
      get.mockRejectedValue(
        Object.assign(new Error('Request failed with status code 400'), {
          response: { status: 400 },
        }),
      )
      renderStaffView()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent("Could not load today's deliveries.")
      expect(
        screen.queryByText('Nothing is out for delivery right now.'),
      ).not.toBeInTheDocument()
    })

    it('offers a retry that re-requests', async () => {
      get.mockRejectedValue(new Error('offline'))
      renderStaffView()

      await screen.findByRole('alert')
      const callsBefore = get.mock.calls.length

      get.mockImplementation(
        onlyForStatus('CONFIRMED', [
          { id: 'ord-8', orderNumber: 'PO-8', quantity: 2, wineName: 'Gamay' },
        ]),
      )
      await userEvent.click(screen.getByRole('button', { name: /try again/i }))

      expect(await screen.findByRole('button', { name: /PO-8/ })).toBeInTheDocument()
      expect(get.mock.calls.length).toBeGreaterThan(callsBefore)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
